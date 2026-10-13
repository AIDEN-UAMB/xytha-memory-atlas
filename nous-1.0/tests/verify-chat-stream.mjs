import {build} from 'esbuild';import assert from 'node:assert/strict';
await build({entryPoints:['lib/chat-stream.ts'],bundle:true,format:'esm',platform:'node',outfile:'.sites-runtime/verification/chat-stream.mjs'});
const {consumeChat,normalizeChatError,recoveryProgress}=await import('../.sites-runtime/verification/chat-stream.mjs');
const result={id:'assistant-id',userId:'user-id',content:'巨门旺，文曲旺化忌。',mode:'llm'};
const response=text=>new Response(new ReadableStream({start(c){const bytes=new TextEncoder().encode(text);for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
let progress=[];const data=await consumeChat(response('event: progress\r\ndata: {"stage":"复核",\r\ndata: "detail":"检查事实","status":"running"}\r\n\r\nevent: result\r\ndata: '+JSON.stringify(result)+'\r\n\r\n'),p=>progress.push(p));assert.deepEqual(data,result);assert.equal(progress.length,1);
await assert.rejects(()=>consumeChat(response('event: progress\ndata: {}\n\n'),()=>{}),e=>e.retrySameRequest===true);
await assert.rejects(()=>consumeChat(response('event: error\ndata: {"error":"复核格式错误","code":"MODEL_OUTPUT_SCHEMA"}\n\n'),()=>{}),e=>e.retrySameRequest===false&&e.message.includes('MODEL_OUTPUT_SCHEMA'));
await assert.rejects(()=>consumeChat(new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),()=>{}),/登录/);
await assert.rejects(()=>consumeChat(response('event: result\ndata: {"content":"incomplete"}\n\n'),()=>{}),e=>e.retrySameRequest===true);
console.log('PASS: client SSE fragmented UTF-8, CRLF, multiline data, terminal errors, missing results, replayable interruption and expired-login HTML.');

let successfulCancel=false,serverClosed=false;
const completesNaturally=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('event: result\ndata: '+JSON.stringify(result)+'\n\n'));setTimeout(()=>{serverClosed=true;controller.close()},5)},cancel(){successfulCancel=true;}}),{headers:{'content-type':'text/event-stream'}});
assert.deepEqual(await consumeChat(completesNaturally,()=>{}),result);await new Promise(r=>setTimeout(r,15));assert.equal(serverClosed,true);assert.equal(successfulCancel,false);
// A valid terminal result must survive both a stuck EOF and a socket failure after result.
let closeLate;
const hungTail=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: result\ndata: '+JSON.stringify(result)+'\n\n'));closeLate=()=>c.close();}}),{headers:{'content-type':'text/event-stream'}});
const ready=consumeChat(hungTail,()=>{});assert.deepEqual(await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('WAITED_FOR_EOF')),200))]),result);closeLate();
const brokenTail=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: result\ndata: '+JSON.stringify(result)+'\n\n'));setTimeout(()=>c.error(new TypeError('Network Error')),5);}}),{headers:{'content-type':'text/event-stream'}});
assert.deepEqual(await consumeChat(brokenTail,()=>{}),result);
const networkError=normalizeChatError(new TypeError('Network Error'));assert.equal(networkError.code,'NETWORK_ERROR');assert.equal(networkError.retrySameRequest,true);assert(!networkError.message.includes('Network Error'));
const webviewNetworkError=normalizeChatError(Object.assign(new Error('Load failed'),{name:'NetworkError'}));assert.equal(webviewNetworkError.code,'NETWORK_ERROR');assert(!webviewNetworkError.message.includes('Load failed'));
console.log('PASS: complete result is immediate despite stuck/broken EOF; bounded background drain permits natural close; Chinese network errors.');

for(const code of ['REQUEST_CONFLICT','REQUEST_ENDED','PROFILE_CHANGED'])await assert.rejects(()=>consumeChat(Response.json({error:'请重新发送',code},{status:409}),()=>{}),e=>e.retrySameRequest===false);
await assert.rejects(()=>consumeChat(Response.json({error:'正在处理',code:'REQUEST_RUNNING'},{status:409}),()=>{}),e=>e.retrySameRequest===true);
console.log('PASS: stale/profile-changed requests get fresh IDs; a running request remains replayable.');
for(const code of ['CHAT_RATE_LIMIT','REQUEST_CONCURRENCY'])await assert.rejects(()=>consumeChat(Response.json({error:'稍后再试',code},{status:429}),()=>{}),e=>e.retrySameRequest===false);
assert.equal(recoveryProgress({code:'REQUEST_RUNNING'},2).stage,'等待原请求');
assert(recoveryProgress({code:'NETWORK_ERROR'},2).detail.includes('不重新生成'));
console.log('PASS: rate/concurrency limits are not retried as network failures; running recovery has truthful status.');

// Delivery frames are incremental, ordered, and bound to their final saved message.
await build({entryPoints:['lib/answer-delivery.ts'],bundle:true,format:'esm',platform:'node',outfile:'.sites-runtime/verification/answer-delivery.mjs'});
const {answerChunks}=await import('../.sites-runtime/verification/answer-delivery.mjs');
const content='已核对的回答：文曲生年化忌。🙂\n学习与升学需要结合实际经历讨论。'.repeat(12),parts=answerChunks(content);
assert(parts.length>1&&parts.length<=240);assert.equal(parts.join(''),content);assert(parts.every(p=>!/[\uD800-\uDBFF]$/.test(p)&&!(/^[\uDC00-\uDFFF]/.test(p))));
const frame=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const start=frame('answer_start',{id:result.id,userId:result.userId,contentLength:content.length});
const deltas=parts.map((text,seq)=>frame('answer_delta',{id:result.id,seq,text}));
let revealed=[];let processing=false;
const streamed=await consumeChat(response(start+deltas.join('')+frame('result',{...result,content})),()=>{},async d=>{assert.equal(processing,false);processing=true;await Promise.resolve();revealed.push(d.content);processing=false;});
assert.equal(streamed.content,content);assert.equal(revealed.length,parts.length);assert(revealed[0].length<content.length);assert.equal(revealed.at(-1),content);
for(const invalid of [deltas[0],start+deltas[1],start+deltas[0]+deltas[0],start+frame('answer_delta',{id:'other',seq:0,text:'x'}),start+frame('result',{...result,content}),start+deltas.join('')+frame('result',{...result,content:content+'x'}),start+start])await assert.rejects(()=>consumeChat(response(invalid),()=>{}),e=>e.retrySameRequest===true);
const controller=new AbortController();let delivered=0;
await assert.rejects(()=>consumeChat(response(start+deltas.join('')+frame('result',{...result,content})),()=>{},()=>{delivered++;controller.abort()},controller.signal),e=>e.name==='AbortError');assert.equal(delivered,1);
assert(answerChunks('字'.repeat(26000)).length<=240);
console.log('PASS: progressive delivery despite buffered network, Unicode-safe bounded chunks, missing/duplicate/reordered/cross-message frames, final equality and cancellation during display.');
