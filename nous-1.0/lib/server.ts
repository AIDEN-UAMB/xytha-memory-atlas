import { z } from 'zod';
import { env } from 'cloudflare:workers';
import {ProviderConnectionError} from './providers/client';
export class HttpError extends Error{constructor(message:string,public status=400,public code?:string){super(message)}}
export function owner(req:Request){
 const id=req.headers.get('oai-authenticated-user-id');
 if(id)return id;
 const local=env as unknown as Record<string,string>;
 const host=new URL(req.url).hostname;
 if(local.XYTHA_LOCAL_DEV_MODE==='true'&&(host==='127.0.0.1'||host==='localhost'||host==='::1'))return local.XYTHA_LOCAL_DEV_USER_ID||'xytha-local-debug';
 throw new HttpError('请先使用 ChatGPT 登录后再保存或对话。',401);
}
export async function jsonBody(req:Request){
 if(req.headers.get('sec-fetch-site')==='cross-site'||(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin))throw new HttpError('请从本站发起操作。',403);
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new HttpError('请使用 JSON 请求格式。',415);
 const reader=req.body?.getReader();if(!reader)throw new HttpError('请求内容不完整，请重试。');let bytes=0,txt='';const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>30000)throw new HttpError('内容过长，请缩短后重试。',413);txt+=decoder.decode(part.value,{stream:true});}txt+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 try{const value=JSON.parse(txt);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new HttpError('请求内容不完整，请重试。');}
}
export function publicError(error:unknown){
 if(error instanceof ProviderConnectionError)return {error:error.message,code:error.code};
 if(error instanceof z.ZodError)return {error:'输入格式不完整，请检查必填项、日期或模型连接设置。',code:'INVALID_INPUT'};
 if(error instanceof HttpError)return {error:error.message,code:error.code||`HTTP_${error.status}`};
 return {error:error instanceof Error&&/^[\u3400-\u9fff]/.test(error.message)?error.message:'服务暂时不可用，请稍后重试。',code:'REQUEST_FAILED'};
}
export function failure(error:unknown){return Response.json(publicError(error),{status:error instanceof HttpError?error.status:400,headers:{'Cache-Control':'no-store'}});}
