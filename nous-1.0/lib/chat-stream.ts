import type {Answer,Progress} from './workflow';
import {readJsonResponse,JsonResponseError} from './http-json';
export type ChatResult=Answer&{id:string;userId:string;requestId?:string;profileId?:string;profileRevision?:number;createdAt?:number;userCreatedAt?:number};
export type AnswerDelta={id:string;seq:number;text:string;content:string};
export class ChatStreamError extends Error {
 constructor(message:string,public retrySameRequest=false,public code='',public completedCalls=0,public requestId=''){super(message);this.name='ChatStreamError';}
}
export function normalizeChatError(error:unknown){
 if(error instanceof ChatStreamError||error instanceof Error&&error.name==='AbortError')return error;
 if(error instanceof JsonResponseError)return new ChatStreamError(error.message,error.code==='INVALID_JSON_RESPONSE',error.code);
 if(error instanceof TypeError||error instanceof Error&&/(?:network|failed to fetch|load failed)/i.test(`${error.name} ${error.message}`))return new ChatStreamError('网络连接中断，系统会保留问题并尝试取回回答。',true,'NETWORK_ERROR');
 return new ChatStreamError(error instanceof Error?error.message:'网络连接异常，请重试。',false,'UNKNOWN_CLIENT_ERROR');
}
export function retryPause(signal:AbortSignal,ms:number){
 signal.throwIfAborted();return new Promise<void>((resolve,reject)=>{
  const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(signal.reason)};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve()},ms);
  signal.addEventListener('abort',cancel,{once:true});
 });
}
export async function consumeChat(response:Response,onProgress:(p:Progress)=>void,onDelta?:(d:AnswerDelta)=>void|Promise<void>,signal?:AbortSignal):Promise<ChatResult>{
 const type=response.headers.get('content-type')||'';
 if(!response.ok){
  let error='请求未完成，请稍后重试。',code='';
  if(type.includes('application/json')){try{const data=await readJsonResponse(response);error=data.error||error;code=data.code||'';}catch(e){if(e instanceof JsonResponseError)throw new ChatStreamError(e.message,[502,503,504].includes(response.status),e.code);throw e;}}
  else if(response.status===401||response.redirected)error='登录已失效，请重新登录后继续。';
  throw new ChatStreamError(error,code==='REQUEST_RUNNING'||(response.status===409&&error.includes('上一条问题仍在处理')),code||`HTTP_${response.status}`);
 }
 if(!type.includes('text/event-stream')||!response.body)throw new ChatStreamError('未收到对话数据，请确认登录状态后重试。',!type.includes('text/html')&&!response.redirected,'UNEXPECTED_RESPONSE');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',size=0,streamId='',streamUserId='',expectedLength=0,sequence=0,assembled='';
 async function parse(frame:string){
  signal?.throwIfAborted();
  const lines=frame.split(/\r?\n/),event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim(),text=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
  if(!text)return;
  let data;try{data=JSON.parse(text);}catch{throw new ChatStreamError('对话数据传输不完整，请重试取回结果。',true);}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ChatStreamError('对话事件格式无效，请重试取回结果。',true);
  if(event==='error')throw new ChatStreamError((data.error||'对话未完成。')+(data.code?`（${data.code}）`:''),false,data.code||'');
  if(event==='continuation'){
   if(!Number.isSafeInteger(data.completedCalls)||data.completedCalls<1||data.completedCalls>7||typeof data.requestId!=='string'||!data.requestId||streamId)throw new ChatStreamError('续接状态无效，问题已保留。',false,'CONTINUATION_INVALID');
   throw new ChatStreamError('已保存本阶段，正在继续后续分析。',true,'WORKFLOW_CONTINUE',data.completedCalls,data.requestId);
  }
  if(event==='progress'&&typeof data.stage==='string'&&typeof data.detail==='string'&&['done','running'].includes(data.status))onProgress(data);
  if(event==='answer_start'){
   if(streamId||typeof data.id!=='string'||!data.id||typeof data.userId!=='string'||!data.userId||!Number.isSafeInteger(data.contentLength)||data.contentLength<1||data.contentLength>2000000)throw new ChatStreamError('回答流标识无效，请重试取回结果。',true);
   streamId=data.id;streamUserId=data.userId;expectedLength=data.contentLength;
  }
  if(event==='answer_delta'){
   if(!streamId||data.id!==streamId||data.seq!==sequence||typeof data.text!=='string'||!data.text||data.text.length>2048||assembled.length+data.text.length>expectedLength)throw new ChatStreamError('回答片段顺序不完整，请重试取回结果。',true);
   assembled+=data.text;sequence++;await onDelta?.({...data,content:assembled});signal?.throwIfAborted();
  }
  if(event==='result'){
   if(streamId&&(data.id!==streamId||data.userId!==streamUserId||assembled.length!==expectedLength||data.content!==assembled))throw new ChatStreamError('回答片段与最终结果不一致，请重试取回结果。',true);
   if(typeof data.id!=='string'||typeof data.userId!=='string'||typeof data.content!=='string'||!data.content.trim())throw new ChatStreamError('回答未完整传回，请重试取回结果。',true);
   return data as ChatResult;
  }
 }
 let finalResult:ChatResult|undefined;
 try{while(true){signal?.throwIfAborted();const part=await reader.read();buffer+=part.done?decoder.decode():decoder.decode(part.value,{stream:true});size+=part.value?.byteLength||0;if(size>8000000)throw new ChatStreamError('返回数据过大，请缩小问题范围。');let match;while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const result=await parse(frame);if(result){if(finalResult)throw new ChatStreamError('收到重复的最终回答，请重试取回结果。',true);finalResult=result;}}if(part.done){if(buffer.trim()){const result=await parse(buffer);if(result){if(finalResult)throw new ChatStreamError('收到重复的最终回答，请重试取回结果。',true);finalResult=result;}}if(finalResult)return finalResult;break;}if(finalResult)return finalResult;}
  throw new ChatStreamError('连接中断，问题已保留，系统会用同一请求标识尝试取回回答。',true,'NETWORK_INTERRUPTED');
 }finally{
  if(!finalResult){await reader.cancel().catch(()=>{});reader.releaseLock();}
  else{
   // result is the validated, saved terminal event. Do not lose it to a later socket error
   // or wait forever for EOF. Allow server telemetry to finish closing without blocking UI.
   void drainCompletedStream(reader);
  }
 }
}
async function drainCompletedStream(reader:ReadableStreamDefaultReader<Uint8Array>){
 const timer=setTimeout(()=>{void reader.cancel().catch(()=>{});},2000);
 try{let bytes=0;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2000000){await reader.cancel();break;}}}catch{/* terminal result already verified */}
 finally{clearTimeout(timer);reader.releaseLock();}
}

export function recoveryProgress(error:ChatStreamError,attempt:number):Progress{
 return error.code==='REQUEST_RUNNING'
  ?{stage:'等待原请求',detail:'原阶段仍在处理，等待结果后继续，不重做已完成步骤',status:'running'}
  :{stage:'恢复连接',detail:`连接中断，正在第 ${attempt} 次取回进度，不重新生成已完成步骤`,status:'running'};
}

/** Rendering cadence keeps even proxy-buffered SSE readable; it does not simulate LLM work. */
export function revealFrame(signal:AbortSignal,ms=32){
 signal.throwIfAborted();return new Promise<void>((resolve,reject)=>{
  const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(signal.reason)};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve()},ms);
  signal.addEventListener('abort',cancel,{once:true});
 });
}
