import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {connection,plan,audit,validDraft} from './fixtures/bprime-runtime-provider.mjs';
const out='.sites-runtime/verification/bprime-runtime';mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
class Prepared{constructor(q){this.q=q;this.v=[];}bind(...v){this.v=v;return this;}async first(){return sql.prepare(this.q).get(...this.v)||null;}async all(){return{results:sql.prepare(this.q).all(...this.v)};}async run(){return{meta:sql.prepare(this.q).run(...this.v)};}}
// Freeze the legacy route protocol in this compatibility suite. The new scheduler
// is exercised by the 15 actual-API cases in verify-analysis-routing.mjs.
globalThis.__bindings={XYTHA_ANALYSIS_PLAN:'false',XYTHA_FRAMEWORK_V1:'true',MODEL_VAULT_KEY:'a'.repeat(64),DB:{prepare:q=>new Prepared(q),batch:ss=>Promise.all(ss.map(s=>s.run()))}};
await build({entryPoints:['app/api/chat/route.ts','lib/chat-stream.ts'],outdir:out+'/api',bundle:true,platform:'node',format:'esm',external:['zod'],outExtension:{'.js':'.mjs'},plugins:[{name:'bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__bindings;',loader:'js'}));}}]});
const {POST}=await import('../'+out+'/api/app/api/chat/route.mjs'),{consumeChat}=await import('../'+out+'/api/lib/chat-stream.mjs');
const oldInfo=console.info,oldError=console.error,oldWarn=console.warn;console.info=()=>{};console.error=()=>{};console.warn=()=>{};
const rows=[],frame=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const body={profileId:'demo',target:'2026-09-07',scope:'natal',selected:9,connection};
const request=(question,owner='fixture',extra={},signal)=>new Request('https://fixture.test/api/chat',{method:'POST',headers:{'content-type':'application/json',Accept:'text/event-stream',...(owner?{'oai-authenticated-user-id':owner}:{})},body:JSON.stringify({...body,question,...extra}),signal});
const reply=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
let count=0,releaseReview,notifyReview;let gated=new Promise(r=>notifyReview=r),reviewBlock=new Promise(r=>releaseReview=r),allFrames='';
try{
 globalThis.fetch=async(url,opts)=>{assert.equal(String(url),'https://mock.example.com/v1/chat/completions');count++;const raw=JSON.parse(JSON.parse(opts.body).messages.at(-1).content),d=raw.originalTask||raw;if(d.draft){notifyReview();await reviewBlock;return reply(audit(true));}return reply(validDraft(d));};
 const r=await POST(request('我今年适合跳槽吗？')),reader=r.body.getReader(),decoder=new TextDecoder();
 const drain=(async()=>{while(true){const part=await reader.read();if(part.done)break;allFrames+=decoder.decode(part.value,{stream:true});}})();
 await gated;assert(!allFrames.includes('event: answer_delta'));assert(!allFrames.includes('event: answer_start'));releaseReview();await drain;
 assert.equal(count,2);const actual=await consumeChat(new Response(allFrames,{headers:{'content-type':'text/event-stream'}}),()=>{});
 assert.equal(actual.mode,'llm');assert(actual.content.includes(actual.blocks[0].text));assert.equal(actual.blocks[0].kind,'reflection');assert(!actual.blocks.some(b=>b.kind==='condition'));assert.equal(actual.observation.factsConditional,false);
 const persisted=sql.prepare('SELECT * FROM workflow_observations WHERE request_id=?').get(actual.requestId);assert(persisted);assert.equal(persisted.actual_calls,2);assert.equal(persisted.delivery_state,'emitted');assert.equal(persisted.first_t2,'passed');assert.equal(persisted.facts_conditional,0);assert(persisted.version.includes('bprime.2'));assert.equal(sql.prepare('SELECT COUNT(*) n FROM knowledge_demand WHERE injected=1').get().n>0,true);
 writeFileSync(out+'/api-actual-answer.json',JSON.stringify(actual,null,2));rows.push('actual-route-no-text-until-review-and-save','actual-model-first-paragraph','old-condition-reflection-mapping','frozen-observation-cohort-and-injection');
 // Dedupe replays the already-saved result without another provider request or observation row.
 globalThis.fetch=async()=>{throw Error('REPLAY_CALLED_PROVIDER');};
 const replay=await consumeChat(await POST(request('我今年适合跳槽吗？','fixture',{requestId:actual.requestId})),()=>{});assert.equal(replay.id,actual.id);assert.equal(sql.prepare('SELECT COUNT(*) n FROM workflow_observations WHERE request_id=?').get(actual.requestId).n,1);rows.push('replay-exact-no-provider-no-extra-observation');
 // Reject a whole draft: a new independent review cannot erase a null-block rejection by pretending a window was isolated.
 count=0;globalThis.fetch=async(url,opts)=>{count++;const d=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return reply(d.draft?audit(false):validDraft(d));};
 const rules=await consumeChat(await POST(request('我今年适合跳槽吗？','rejected')),()=>{});assert.equal(rules.mode,'rules');assert.equal(rules.observation.outcome,'rules');assert.equal(count,2);assert.equal(rules.observation.factsConditional,true);rows.push('whole-draft-rejection-not-erased','rule-fallback-not-model-success');
 globalThis.fetch=async()=>new Response('',{status:401});
 const failed=await POST(request('我适合跳槽吗？','provider401'));assert.equal(failed.status,200);const failedText=await failed.text();assert(failedText.includes('event: error'));assert(failedText.includes('PROVIDER_AUTH'),failedText);assert(!failedText.includes('event: result'));assert.equal(sql.prepare("SELECT COUNT(*) n FROM messages WHERE owner='provider401'").get().n,0);rows.push('HTTP200-provider401-error-not-success');
 const ingress=await POST(request('我适合跳槽吗？',''));assert.equal(ingress.status,401);rows.push('ingress401-distinct');
 globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"{"},"finish_reason":null}]}\n\n',{headers:{'content-type':'text/event-stream'}});
 const interrupted=await POST(request('我适合跳槽吗？','interrupted'));const interruptedText=await interrupted.text();assert(interruptedText.includes('event: error'));assert(/PROVIDER_(STREAM|EMPTY|INCOMPLETE)/.test(interruptedText));assert(!interruptedText.includes('event: result'));rows.push('provider-stream-interrupted-no-answer');
 // Cancellation while the provider is pending never stores a completed model answer.
 const ac=new AbortController(),recoveryRequestId='33333333-3333-4333-8333-333333333333';let contacted;const contact=new Promise(r=>contacted=r);
 globalThis.fetch=async(url,opts)=>{contacted();await new Promise((resolve,reject)=>{if(opts.signal.aborted)reject(opts.signal.reason);else opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true});});};
 const cancelled=await POST(request('我适合跳槽吗？','cancelled',{requestId:recoveryRequestId},ac.signal));const cancelledText=cancelled.text();await contact;ac.abort();await cancelledText;const cancelledRow=sql.prepare("SELECT outcome,delivery_state FROM workflow_observations WHERE owner='cancelled'").get();assert.equal(cancelledRow.outcome,'cancelled');assert.equal(sql.prepare("SELECT COUNT(*) n FROM messages WHERE owner='cancelled'").get().n,0);assert.equal(sql.prepare("SELECT status FROM chat_runs WHERE owner='cancelled' AND id=?").get(recoveryRequestId).status,'failed');rows.push('user-cancel-distinct-from-timeout');
 // Passive recovery must never replay model work. A deliberate new send uses a fresh ID.
 count=0;globalThis.fetch=async(url,opts)=>{count++;const d=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return reply(d.draft?audit(true):d.frameworkContract?validDraft(d):plan);};
 const legacyRetry=await POST(request('我适合跳槽吗？','cancelled',{requestId:recoveryRequestId}));assert.equal((await legacyRetry.json()).code,'REQUEST_ENDED');assert.equal(count,0);
 const ended=await POST(request('我适合跳槽吗？','cancelled',{requestId:recoveryRequestId,recoveryOnly:true}));assert.equal(ended.status,409);assert.equal((await ended.json()).code,'REQUEST_ENDED');assert.equal(count,0);
 const unknown=await POST(request('我适合跳槽吗？','cancelled',{requestId:crypto.randomUUID(),recoveryOnly:true}));assert.equal((await unknown.json()).code,'REQUEST_NOT_FOUND');assert.equal(count,0);
 const recovered=await consumeChat(await POST(request('我适合跳槽吗？','cancelled',{requestId:crypto.randomUUID()})),()=>{});assert.equal(recovered.mode,'llm');assert.equal(count,3);rows.push('passive-recovery-no-model-restart','deliberate-new-send-new-id');
 // Actual pure timing and general endpoints use the same three guards and old-client adapter.
 for(const [owner,question,expected] of [['general','我适合跳槽吗？',3],['timing','今年哪个月适合跳槽？',2]]){
  count=0;globalThis.fetch=async(url,opts)=>{count++;const d=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return reply(d.draft?audit(true):d.frameworkContract?validDraft(d):plan);};
  const answer=await consumeChat(await POST(request(question,owner)),()=>{});assert.equal(answer.mode,'llm');assert.equal(count,expected);assert(answer.dialogue);assert.equal(answer.dialogue.questionPolicy,'answer_first');if(owner==='timing')assert(answer.content.startsWith('候选窗口：'));rows.push('actual-'+owner+'-guarded-output');
 }
 // Program redlines and repeated-judgment checks reject hostile output even when mock reviewer passes.
 for(const [owner,text] of [['health-redline','你一定会患病。'],['reverse-question','你自己判断哪条路更适合。']]){
  count=0;globalThis.fetch=async(url,opts)=>{count++;const raw=JSON.parse(JSON.parse(opts.body).messages.at(-1).content),d=raw.originalTask||raw;if(d.draft)return reply(audit(true));if(!d.frameworkContract)return reply(plan);const bad=validDraft(d);bad.blocks[0].text=text;return reply(bad);};
  const answer=await consumeChat(await POST(request('我适合跳槽吗？',owner)),()=>{});assert.equal(answer.mode,'rules');assert(!answer.content.includes(text));assert.equal(count,3);rows.push('actual-'+owner+'-blocked');
 }
 // Original frozen storage schema remains exactly 19 + 11 columns.
 assert.equal(sql.prepare('PRAGMA table_info(workflow_observations)').all().length,19);assert.equal(sql.prepare('PRAGMA table_info(knowledge_demand)').all().length,11);rows.push('storage-columns-19-plus-11');
}finally{console.info=oldInfo;console.error=oldError;console.warn=oldWarn;writeFileSync(out+'/api-acceptance.json',JSON.stringify({runtimeIntegrated:true,productionInferenceCalls:0,cases:rows.map(id=>({id,status:'PASS'}))},null,2));}
console.log('PASS actual API/SSE/observation/error cases:',rows.length);
