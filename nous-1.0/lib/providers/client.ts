import {Connection,connectionSchema} from './config';
import {withProviderResponse,readResponse,readChatStream,CallOptions,ProviderConnectionError} from './transport';
import {observeModelContext} from '../context-telemetry';
import {providerUsage,completionMetadata} from './transport';
import {parseModelJSON} from './output';
export {ProviderConnectionError} from './transport';
export type {CallOptions,Activity,CallStage} from './transport';
// Custom endpoints are explicit user selections. Workerd supports manual/follow,
// not redirect:error. Inspect 3xx explicitly so credentials never follow redirects.
export function endpointFor(input:Connection,operation:'generate'|'models'='generate'){
 const c=connectionSchema.parse(input),url=new URL(c.baseUrl);const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('接口地址须为不含密钥、账号或查询参数的 HTTPS Base URL。');
 if((url.port&&url.port!=='443')||!host.includes('.')||host.includes(':')||/^\d+(?:\.\d+)*$/.test(host)||host==='localhost'||/\.(localhost|local|internal|lan|test|invalid)$/.test(host)||host.endsWith('.chatgpt.site'))throw Error('请使用模型服务商的公网 HTTPS 接口地址。');
 let path=url.pathname.replace(/\/+$/,'');path=path.replace(/\/(chat\/completions|responses|messages|models)$/,'');
 if(operation==='models')path+='/models';
 else if(c.protocol==='openai-chat')path+='/chat/completions';
 else if(c.protocol==='openai-responses')path+='/responses';
 else if(c.protocol==='anthropic')path+='/messages';
 else path+='/models/'+encodeURIComponent(c.model.replace(/^models\//,''))+':generateContent';
 url.pathname=path;return url;
}
const errorCode=(status:number)=>status===401?'PROVIDER_AUTH':status===403?'PROVIDER_PERMISSION':status===429?'PROVIDER_RATE_LIMIT':status>=500?'PROVIDER_UNAVAILABLE':`PROVIDER_HTTP_${status}`;
function errorFor(status:number){return status===401||status===403?'密钥无效、接口地区不符或无模型访问权限。':status===404?'接口地址或模型 ID 不存在，请核对 Base URL 与模型名称。':status===429?'模型额度不足或请求频率受限，请稍后重试。':status>=500?'模型服务商暂时不可用，请稍后重试。':`服务商拒绝了请求（${status}），请核对协议、模型和 JSON 模式。`;}
export function supportsGLMReasoningEffort(c:Pick<Connection,'protocol'|'provider'|'model'>){const version=/^glm-5\.(\d+)(?:$|-)/.exec(c.model);return c.protocol==='openai-chat'&&['bigmodel','zai'].includes(c.provider)&&!!version&&Number(version[1])>=2;}
export function providerRequest(c:Connection,instructions:string,data:unknown,maxTokens=8000,options:CallOptions={}){
 const headers:Record<string,string>={'Content-Type':'application/json'};const input=JSON.stringify(data);let body:Record<string,unknown>;
 if(c.protocol==='openai-responses'){headers.Authorization=`Bearer ${c.key}`;body={model:c.model,instructions,input,store:false,max_output_tokens:maxTokens,...(c.jsonMode?{text:{format:{type:'json_object'}}}:{})};}
 else if(c.protocol==='anthropic'){headers['x-api-key']=c.key;headers['anthropic-version']='2023-06-01';body={model:c.model,system:instructions,messages:[{role:'user',content:input}],max_tokens:maxTokens};}
 else if(c.protocol==='gemini'){headers['x-goog-api-key']=c.key;body={systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{maxOutputTokens:maxTokens,...(c.jsonMode?{responseMimeType:'application/json'}:{})}};}
 else{headers.Authorization=`Bearer ${c.key}`;body={model:c.model,messages:[{role:'system',content:instructions},{role:'user',content:input}],max_tokens:maxTokens,stream:true,...(c.jsonMode?{response_format:{type:'json_object'}}:{})};if(['bigmodel','zai','deepseek'].includes(c.provider)&&c.thinking!=='auto')body.thinking={type:c.thinking};}
 // Auxiliary GLM 5.2 steps use direct structured answers in automatic mode.
 // Explicit enabled/disabled choices are respected; never alter the model ID.
 if(c.protocol==='openai-chat'&&['bigmodel','zai'].includes(c.provider)&&/^glm-5\.2(?:$|-)/.test(c.model)&&c.thinking==='auto'&&options.stage){
  if(['plan','audit','connection','answer'].includes(options.stage))body.thinking={type:'disabled'};
  // auto means provider default, not an implicit opt-in to the slowest reasoning effort.
  // A user's explicit enabled/disabled choice above is still preserved.
 }
 // Opt-in per call; existing Nous/personal requests retain their provider policy.
 if(options.reasoningEffort&&supportsGLMReasoningEffort(c)&&(body.thinking as {type?:string}|undefined)?.type==='enabled')body.reasoning_effort=options.reasoningEffort;
 return {url:endpointFor(c),headers,body};
}
export function extractText(protocol:Connection['protocol'],r:Record<string,unknown>,options:CallOptions={}):string{
 if(r.error)throw new ProviderConnectionError('服务商返回错误，请核对模型、密钥与账户额度。','PROVIDER_RESPONSE_ERROR');
 const raw=r as any,reason=protocol==='openai-responses'?(r.status==='incomplete'?raw.incomplete_details?.reason||'incomplete':r.status):protocol==='anthropic'?r.stop_reason:protocol==='gemini'?raw.candidates?.[0]?.finishReason:raw.choices?.[0]?.finish_reason;
 const completion=completionMetadata(reason,providerUsage(r));options.onCompletion?.(completion);
 if(options.requireComplete){
  const refusal=protocol==='anthropic'&&reason==='refusal'||protocol==='openai-chat'&&!!raw.choices?.[0]?.message?.refusal||protocol==='openai-responses'&&raw.output?.some((o:any)=>o.content?.some((v:any)=>v.type==='refusal'));
  if(refusal)throw new ProviderConnectionError('模型未提供可用回答，请调整问题。','PROVIDER_REFUSAL',completion);
  if(protocol==='openai-responses'&&r.status&&!['completed','incomplete'].includes(String(r.status)))throw new ProviderConnectionError('模型未完成可用回答，请调整问题后重试。','PROVIDER_INCOMPLETE',completion);
  if(protocol==='anthropic'&&reason&&!['end_turn','stop_sequence','max_tokens'].includes(String(reason))||protocol==='openai-chat'&&reason&&!['stop','length'].includes(String(reason)))throw new ProviderConnectionError('模型未完成可用回答，请调整问题后重试。','PROVIDER_INCOMPLETE',completion);
 }
 if(protocol==='openai-responses'){
  if(r.status==='incomplete')throw new ProviderConnectionError('模型输出未完成，请缩短问题或换用输出额度更大的模型。','PROVIDER_INCOMPLETE',completion);
  return ((r.output||[]) as {content?:{type:string;text?:string}[]}[]).flatMap(o=>o.content||[]).filter(v=>v.type==='output_text').map(v=>v.text||'').join('');
 }
 if(protocol==='anthropic'){if(r.stop_reason==='max_tokens')throw new ProviderConnectionError('模型输出被截断，请调整模型或缩短问题。','PROVIDER_INCOMPLETE',completion);return ((r.content||[]) as {type:string;text?:string}[]).filter(v=>v.type==='text').map(v=>v.text||'').join('');}
 if(protocol==='gemini'){const choice=((r.candidates||[]) as {finishReason?:string;content?:{parts?:{text?:string;thought?:boolean}[]}}[])[0];if(choice?.finishReason&&choice.finishReason!=='STOP')throw new ProviderConnectionError('模型没有完成回答，请修改问题后重试。','PROVIDER_INCOMPLETE',completion);return (choice?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');}
 const choice=((r.choices||[]) as {finish_reason?:string;message?:{content?:string|{text?:string}[]}}[])[0];if(choice?.finish_reason==='length')throw new ProviderConnectionError('模型输出被截断，请调整模型或缩短问题。','PROVIDER_INCOMPLETE',completion);const content=choice?.message?.content;return typeof content==='string'?content:Array.isArray(content)?content.map(p=>p.text||'').join(''):'';
}
export const parseJSON=parseModelJSON;
export async function generateJSON(connection:Connection,instructions:string,data:unknown,signal?:AbortSignal,maxTokens=8000,options:CallOptions={}){
 const c=connectionSchema.parse(connection),observed=observeModelContext(c,instructions,data,maxTokens,options);options=observed.options;const r=providerRequest(c,instructions,data,maxTokens,options);
  const result=await withProviderResponse(c,r.url,{method:'POST',headers:r.headers,body:JSON.stringify(r.body)},signal,options,async(response,touch,activeSignal)=>{
  if(!response.ok){await response.body?.cancel();throw new ProviderConnectionError(errorFor(response.status),errorCode(response.status));}
  if(c.protocol==='openai-chat'&&response.headers.get('content-type')?.includes('text/event-stream'))return parseJSON(await readChatStream(response,touch,activeSignal,options));
   const raw=await readResponse(response,touch,activeSignal,undefined,options.responseByteLimit);let obj:Record<string,unknown>;
  try{obj=JSON.parse(raw)}catch{throw new ProviderConnectionError('服务商返回的内容不符合所选 API 协议。','PROVIDER_PROTOCOL');}
  options.onUsage?.(providerUsage(obj));
   const text=extractText(c.protocol,obj,options);if(!text.trim())throw new ProviderConnectionError('模型返回了空响应。','PROVIDER_EMPTY');
  return parseJSON(text);
 });
  observed.complete(JSON.stringify(result));return result;
}
/** Direct-output mode: returns the model's natural-language text verbatim, without JSON parsing.
 * Disables jsonMode so the provider is not forced to emit a JSON object. */
export async function generateText(connection:Connection,instructions:string,data:unknown,signal?:AbortSignal,maxTokens=8000,options:CallOptions={}){
 const c=connectionSchema.parse(connection);const cc={...c,jsonMode:false};
  const observed=observeModelContext(cc,instructions,data,maxTokens,options);options=observed.options;
 const r=providerRequest(cc,instructions,data,maxTokens,options);
 const result=await withProviderResponse(cc,r.url,{method:'POST',headers:r.headers,body:JSON.stringify(r.body)},signal,options,async(response,touch,activeSignal)=>{
  if(!response.ok){await response.body?.cancel();throw new ProviderConnectionError(errorFor(response.status),errorCode(response.status));}
  if(cc.protocol==='openai-chat'&&response.headers.get('content-type')?.includes('text/event-stream'))return await readChatStream(response,touch,activeSignal,options);
   const raw=await readResponse(response,touch,activeSignal,undefined,options.responseByteLimit);let obj:Record<string,unknown>;
  try{obj=JSON.parse(raw)}catch{throw new ProviderConnectionError('服务商返回的内容不符合所选 API 协议。','PROVIDER_PROTOCOL');}
  options.onUsage?.(providerUsage(obj));
   const text=extractText(cc.protocol,obj,options);if(!text.trim())throw new ProviderConnectionError('模型返回了空响应。','PROVIDER_EMPTY');
  return text;
 });
  observed.complete(result);return result;
}
export async function listModels(c:Connection){const url=endpointFor(c,'models');const headers:Record<string,string>={};if(c.protocol==='gemini')headers['x-goog-api-key']=c.key;else if(c.protocol==='anthropic'){headers['x-api-key']=c.key;headers['anthropic-version']='2023-06-01';}else headers.Authorization=`Bearer ${c.key}`;
 return withProviderResponse(c,url,{headers},undefined,{limits:{firstByteMs:20000,idleMs:20000,totalMs:30000}},async(res,touch,signal)=>{
  if(!res.ok){await res.body?.cancel();throw new ProviderConnectionError('该服务未提供可访问的模型列表，请手动填写控制台中的模型 ID。',errorCode(res.status));}
  const data=JSON.parse(await readResponse(res,touch,signal)) as {data?:{id:string}[];models?:{name:string}[]};return (data.data?.map(m=>m.id)||data.models?.map(m=>m.name.replace(/^models\//,''))||[]).filter(Boolean).slice(0,250);
 });
}
