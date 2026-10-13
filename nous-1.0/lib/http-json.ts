/** Decode complete API objects without leaking native parser errors or HTML bodies. */
export class JsonResponseError extends Error {
 constructor(message:string,public code='INVALID_JSON_RESPONSE',public status=0){super(message);this.name='JsonResponseError';}
}
export function incompleteResponse(status=0){
 if(status===401)return new JsonResponseError('登录已失效，请重新登录后继续。','AUTH_REQUIRED',status);
 if(status===413)return new JsonResponseError('请求内容过大，请先导出归档后缩小范围。','REQUEST_TOO_LARGE',status);
 if(status===429)return new JsonResponseError('请求较多，请稍后重试。','RATE_LIMITED',status);
 return new JsonResponseError('服务返回的数据不完整，请重试；本地已保存的记录不会被清空。','INVALID_JSON_RESPONSE',status);
}
export function parseJsonObject<T=any>(text:string,status=0):T {
 try{const value=JSON.parse(text.replace(/^\uFEFF/,''));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value as T;}
 catch{throw incompleteResponse(status);}
}
export async function readJsonResponse<T=any>(response:Response):Promise<T>{
 let text:string;
 try{text=await response.text();}catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw incompleteResponse(response.status);}
 return parseJsonObject<T>(text,response.status);
}
/** Retry only an explicitly read-only operation, once, for incomplete transport data. */
export async function readJsonRequest<T=any>(fetcher:()=>Promise<Response>,readOnly=false):Promise<{response:Response;data:T}>{
 for(let attempt=0;;attempt++){
  try{const response=await fetcher();return {response,data:await readJsonResponse<T>(response)};}
  catch(error){if(!readOnly||attempt>0||!(error instanceof JsonResponseError)||error.code!=='INVALID_JSON_RESPONSE'||(error.status>=400&&![502,503,504].includes(error.status)))throw error;}
 }
}
