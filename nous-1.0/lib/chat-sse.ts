// SSE comments are transport padding, never simulated model output. Keep small heartbeats
// from sitting in a compressing/buffering intermediary until the entire workflow finishes.
export const CHAT_HEARTBEAT_MS=15000;
export const CHAT_SSE_HEADERS={
 'Content-Type':'text/event-stream; charset=utf-8',
 'Cache-Control':'no-store, no-transform',
 'Content-Encoding':'identity',
 'X-Accel-Buffering':'no',
};
const encoder=new TextEncoder();
const padding=': '+ ' '.repeat(8192)+'\n\n';
export function chatFrame(event:string,data:unknown){
 return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n${event==='heartbeat'?padding:''}`);
}
