import {estimateTokens} from '../context-capacity';
import type {Connection} from './config';
export type CallStage='plan'|'answer'|'audit'|'repair'|'connection';
export type Activity={kind:'thinking'|'content';elapsedMs:number;characters:number;outputTokensEstimate?:number};
export type ProviderUsage={inputTokens?:number;outputTokens?:number};
export type ProviderCompletion={finishReason:string|null;tokenUsage:ProviderUsage|null};
export function completionMetadata(reason:unknown,usage?:ProviderUsage):ProviderCompletion {
 return {finishReason:typeof reason==='string'&&/^[a-z0-9_]{1,64}$/i.test(reason)?reason:null,
  tokenUsage:usage&&(usage.inputTokens!==undefined||usage.outputTokens!==undefined)?usage:null};
}
export function providerUsage(raw:any):ProviderUsage{const u=raw?.usage||raw?.usageMetadata||{};const safe=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:undefined;return {inputTokens:safe(u.prompt_tokens??u.input_tokens??u.promptTokenCount),outputTokens:safe(u.completion_tokens??u.output_tokens??u.candidatesTokenCount)};}
export type CallOptions={onUsage?:(usage:ProviderUsage)=>void;onCompletion?:(completion:ProviderCompletion)=>void;requireComplete?:boolean;reasoningEffort?:'low'|'high'|'max';stage?:CallStage;onActivity?:(activity:Activity)=>void;beforeRequest?:()=>void;limits?:{firstByteMs:number;idleMs:number;totalMs:number|null};responseByteLimit?:number;streamFrameCharacterLimit?:number};
export class ProviderConnectionError extends Error {
 constructor(message:string,public code:string,public completion?:ProviderCompletion){super(message);this.name='ProviderConnectionError';}
}
function parentAbortReason(parent:AbortSignal|undefined){
 const reason=parent?.reason as {code?:unknown;message?:unknown}|undefined;
 if(reason instanceof ProviderConnectionError)return reason;
 if(reason&&typeof reason.code==='string'&&typeof reason.message==='string')return new ProviderConnectionError(reason.message,reason.code);
 return new ProviderConnectionError('对话已停止。','PROVIDER_CANCELLED');
}
export async function withProviderResponse<T>(c:Connection,url:URL,init:RequestInit,parent:AbortSignal|undefined,options:CallOptions,consume:(response:Response,touch:()=>void,signal:AbortSignal)=>Promise<T>):Promise<T>{
 const limits=options.limits||{firstByteMs:120000,idleMs:90000,totalMs:options.stage==='connection'?60000:240000};
 const controller=new AbortController(),started=Date.now();
 const cancel=()=>controller.abort(parentAbortReason(parent));
 const expire=(code:string,message:string)=>controller.abort(new ProviderConnectionError(message,code));
 let idleTimer:ReturnType<typeof setTimeout>;
 const arm=(ms:number,first=false)=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>expire(first?'PROVIDER_FIRST_BYTE_TIMEOUT':'PROVIDER_IDLE_TIMEOUT',first?'模型长时间未开始响应。请稍后重试。':'模型输出已中断较长时间，请重试本次问题。'),ms);};
 const totalTimer=limits.totalMs===null?undefined:setTimeout(()=>expire('PROVIDER_TOTAL_TIMEOUT','本阶段处理已达到时限，请缩小问题范围后重试。'),limits.totalMs);
 parent?.addEventListener('abort',cancel,{once:true});if(parent?.aborted)cancel();arm(limits.firstByteMs,true);
 try{
  controller.signal.throwIfAborted();
  options.beforeRequest?.();
  const response=await fetch(url,{...init,redirect:'manual',signal:controller.signal});
  arm(limits.idleMs);
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ProviderConnectionError(`接口返回了重定向（HTTP ${response.status}）。请填写服务商最终 API Base URL；为保护 API Key，Xytha 不会自动跳转。`,'PROVIDER_REDIRECT');}
  return await consume(response,()=>arm(limits.idleMs),controller.signal);
 }catch(error){
  if(controller.signal.aborted){const reason=controller.signal.reason as ProviderConnectionError;if(reason.code!=='PROVIDER_CANCELLED')console.error(JSON.stringify({event:'provider_transport_failed',code:reason.code,stage:options.stage||'request',elapsedMs:Date.now()-started,host:url.hostname,protocol:c.protocol}));throw reason;}
  if(error instanceof ProviderConnectionError)throw error;
  const name=error instanceof Error?error.name:'UnknownError',message=error instanceof Error?error.message:'';
  // Preserve application validation errors, but never expose native transport internals.
  if(name!=='TypeError'&&name!=='AbortError'&&name!=='TimeoutError'&&!/network|connection|socket|TLS|fetch failed/i.test(message))throw error;
  const code=/Invalid redirect|AbortSignal.*not a function|Invalid.*RequestInit/i.test(message)?'PROVIDER_REQUEST_OPTIONS':'PROVIDER_NETWORK';
  console.error(JSON.stringify({event:'provider_transport_failed',code,stage:options.stage||'request',errorType:name,elapsedMs:Date.now()-started,host:url.hostname,protocol:c.protocol}));
  throw new ProviderConnectionError(code==='PROVIDER_REQUEST_OPTIONS'?'云端请求参数不兼容，请反馈此故障码。':'云端与模型服务的连接中断，请稍后重试。',code);
 }finally{clearTimeout(idleTimer!);clearTimeout(totalTimer);parent?.removeEventListener('abort',cancel);}
}
async function readNext(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal){
 signal.throwIfAborted();
 return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason)};
  signal.addEventListener('abort',abort,{once:true});
  reader.read().then(v=>{signal.removeEventListener('abort',abort);resolve(v)},e=>{signal.removeEventListener('abort',abort);reject(e)});
 });
}
export async function readResponse(response:Response,touch:()=>void,signal:AbortSignal,onText?:(text:string)=>boolean,maxBytes=2000000){
 if(!response.body)throw new ProviderConnectionError('模型返回了空响应。','PROVIDER_EMPTY');
 maxBytes=Math.min(16000000,Math.max(2000000,Math.floor(maxBytes)));
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,raw='';
 try{while(true){const part=await readNext(reader,signal);if(part.done){const rest=decoder.decode();if(onText){if(rest)onText(rest);}else raw+=rest;break;}
  touch();bytes+=part.value.byteLength;if(bytes>maxBytes)throw new ProviderConnectionError(
   maxBytes===2000000?'模型返回内容过大，请缩小问题范围。':'模型传输数据超过本阶段安全上限；已完成阶段保留，可继续恢复。',
   'PROVIDER_TOO_LARGE'
  );
  const text=decoder.decode(part.value,{stream:true});if(onText){if(onText(text))break;}else raw+=text;
 }return raw;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readChatStream(response:Response,touch:()=>void,signal:AbortSignal,options:CallOptions){
 let buffer='',content='',terminal=false,started=Date.now(),lastNotice=-Infinity,usage:ProviderUsage|undefined;
 const frameLimit=options.streamFrameCharacterLimit===undefined
  ?Number.POSITIVE_INFINITY
  :Math.min(2000000,Math.max(64000,Math.floor(options.streamFrameCharacterLimit)));
 const notify=(kind:Activity['kind'])=>{const now=Date.now();if(now-lastNotice>=2000){options.onActivity?.({kind,elapsedMs:now-started,characters:content.length,outputTokensEstimate:estimateTokens(content)});lastNotice=now;}};
 const frame=(value:string)=>{
  const data=value.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
  if(!data)return;if(data.trim()==='[DONE]'){terminal=true;return;}
  let event;try{event=JSON.parse(data)}catch{throw new ProviderConnectionError('模型的流式响应格式不完整，请重试。','PROVIDER_STREAM_FORMAT');}
  if(event.error)throw new ProviderConnectionError('模型服务在生成过程中返回错误，请稍后重试。','PROVIDER_STREAM_ERROR');
  if(event.usage){usage=providerUsage(event);options.onUsage?.(usage);}
   const choice=event.choices?.find((c:{index?:number})=>c.index===0)||event.choices?.[0];if(!choice)return;
  const delta=choice.delta||{};
  if(options.requireComplete&&delta.refusal){const completion=completionMetadata('refusal',usage);options.onCompletion?.(completion);throw new ProviderConnectionError('模型未提供可用回答，请调整问题。','PROVIDER_REFUSAL',completion);}
  if(typeof delta.content==='string'&&delta.content){content+=delta.content;notify('content');}
  else if(delta.reasoning_content||delta.reasoning)notify('thinking'); // Never store or show hidden reasoning.
  if(choice.finish_reason){const completion=completionMetadata(choice.finish_reason,usage);options.onCompletion?.(completion);if(choice.finish_reason!=='stop')throw new ProviderConnectionError(choice.finish_reason==='length'?'模型输出被截断，请关闭额外思考或缩小问题范围。':'模型未完成可用回答，请调整问题后重试。','PROVIDER_INCOMPLETE',completion);terminal=true;}
 };
 await readResponse(response,touch,signal,text=>{buffer+=text;buffer=buffer.replace(/^\uFEFF/,'');let split;while((split=/\r?\n\r?\n/.exec(buffer))){const current=buffer.slice(0,split.index);buffer=buffer.slice(split.index+split[0].length);frame(current);if(terminal)return true;}if(buffer.length>frameLimit)throw new ProviderConnectionError('模型返回了异常大的单个流式事件；已停止该阶段以保护运行内存。','PROVIDER_STREAM_FRAME_TOO_LARGE');return false;},options.responseByteLimit);
 if(!terminal&&buffer.trim())frame(buffer);
 if(!terminal)throw new ProviderConnectionError('模型输出在完成前中断，未展示不完整回答，请重试。','PROVIDER_STREAM_INTERRUPTED');
 options.onActivity?.({kind:'content',elapsedMs:Date.now()-started,characters:content.length,outputTokensEstimate:estimateTokens(content)});
 return content;
}
