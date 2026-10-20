import {ProviderConnectionError} from './transport';

// Upstream errors may echo prompts, keys or URLs. Classify in memory and expose
// only our own fixed codes/messages; never attach the upstream body to an Error.
export function classifyProviderError(status:number,body:unknown){
 const raw=body&&typeof body==='object'?body as Record<string,any>:{};
 const e=raw.error&&typeof raw.error==='object'?raw.error:raw;
 const code=typeof e.code==='string'?e.code.toLowerCase():'';
 const message=typeof e.message==='string'?e.message.toLowerCase():'';
 if(status===401)return new ProviderConnectionError('模型密钥验证失败，请检查已保存的连接。','PROVIDER_AUTH');
 if(status===403)return new ProviderConnectionError('当前密钥没有权限访问该模型或接口。','PROVIDER_PERMISSION');
 if(status===402)return new ProviderConnectionError('模型账户余额不足，请检查服务商账户。','PROVIDER_BALANCE');
 if(status===429)return new ProviderConnectionError('模型额度不足或请求频率受限，请稍后重试。','PROVIDER_RATE_LIMIT');
 if(status>=500)return new ProviderConnectionError('模型服务商暂时不可用，请稍后重试。','PROVIDER_UNAVAILABLE');
 if(status===400||status===422||status===413){
  if(status===413||code==='context_length_exceeded'||/(maximum context length|context (length|window|limit).{0,60}(exceed|limit)|too many tokens|input.{0,30}too long)/i.test(message))return new ProviderConnectionError('模型服务商拒绝了本轮输入长度。请核对模型实际容量或缩小分析范围。','PROVIDER_CONTEXT_LIMIT');
  if(/json/.test(message)&&/(must|contain|required|word)/.test(message))return new ProviderConnectionError('结构化输出的请求格式不符合模型要求，已保留处理进度。','PROVIDER_JSON_REQUIREMENT');
  if(code==='model_not_found'||/model.{0,40}(not exist|not found|invalid|not available)/.test(message))return new ProviderConnectionError('该模型名称不可用，请在模型连接中重新选择可用模型。','PROVIDER_MODEL_UNAVAILABLE');
  if(/(unsupported|not supported|not allowed|unrecognized|unknown parameter)/.test(message))return new ProviderConnectionError('模型不支持当前请求参数，请核对协议、JSON 模式及思考模式设置。','PROVIDER_UNSUPPORTED_PARAMETER');
  return new ProviderConnectionError('模型服务商拒绝了请求参数，已保留进度；请核对模型连接的协议与高级选项。','PROVIDER_BAD_REQUEST');
 }
 if(status===404)return new ProviderConnectionError('模型接口地址或模型名称不存在，请检查连接设置。','PROVIDER_MODEL_UNAVAILABLE');
 return new ProviderConnectionError(`模型服务商拒绝了请求（HTTP ${status}）。`,'PROVIDER_HTTP_'+status);
}

export async function readProviderError(response:Response,touch:()=>void,signal:AbortSignal){
 const reader=response.body?.getReader();let text='',bytes=0,tooLarge=false;
 const decoder=new TextDecoder(),abort=()=>{void reader?.cancel().catch(()=>{})};
 signal.addEventListener('abort',abort,{once:true});
 try{
  signal.throwIfAborted();
  if(reader)for(;;){const part=await reader.read();signal.throwIfAborted();if(part.done){text+=decoder.decode();break}touch();bytes+=part.value.byteLength;if(bytes>16384){tooLarge=true;break}text+=decoder.decode(part.value,{stream:true})}
  let body:unknown;try{if(!tooLarge)body=JSON.parse(text)}catch{}
  return classifyProviderError(response.status,body);
 }finally{signal.removeEventListener('abort',abort);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}}
}
