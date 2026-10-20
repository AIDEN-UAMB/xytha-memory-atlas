export const HENOSIS_ROUTER_LABELS=['attribute','current_state','historical_compare','future_timing','decision','mixed','unknown'] as const;
/** Shadow-only: a local classifier never changes chart facts, scope or execution. */
export async function observeHenosisRouter(question:string,endpoint?:string,signal?:AbortSignal){
 if(!endpoint)return {mode:'disabled' as const};
 if(question.length>1200)return {mode:'shadow' as const,status:'input_too_long' as const};
 let url:URL;try{url=new URL(endpoint);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:'||url.username||url.password)return {mode:'shadow' as const,status:'invalid_endpoint' as const};}catch{return {mode:'shadow' as const,status:'invalid_endpoint' as const};}
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),1000),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});
 if(signal?.aborted)abort.abort();
 const start=Date.now();
 try{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question}),signal:abort.signal,redirect:'error'});
  if(!response.ok)return {mode:'shadow' as const,status:'unavailable' as const};
  const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0,text='';const decoder=new TextDecoder();
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096)throw Error('response size');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  const value=JSON.parse(text);
  if(!HENOSIS_ROUTER_LABELS.includes(value.label)||typeof value.confidence!=='number'||!Number.isFinite(value.confidence)||value.confidence<0||value.confidence>1||typeof value.model!=='string'||value.model.length>120)throw Error('schema');
  return {mode:'shadow' as const,status:'observed' as const,label:value.label as typeof HENOSIS_ROUTER_LABELS[number],confidence:value.confidence,model:value.model,
   calibration:'not_domain_validated' as const,elapsedMs:Date.now()-start,affectsExecution:false};
 }catch{return {mode:'shadow' as const,status:'unavailable' as const};}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
