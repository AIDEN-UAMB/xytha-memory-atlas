import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {connection,plan} from './fixtures/bprime-runtime-provider.mjs';
const out='.sites-runtime/verification/context-upgrade';mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
class Prepared{constructor(q){this.q=q;this.v=[];}bind(...v){this.v=v;return this;}async first(){return sql.prepare(this.q).get(...this.v)||null;}async all(){return{results:sql.prepare(this.q).all(...this.v)};}async run(){return{meta:sql.prepare(this.q).run(...this.v)};}}
const db={prepare:q=>new Prepared(q),batch:async ss=>{sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__bindings={XYTHA_FRAMEWORK_V1:'true',XYTHA_ADAPTIVE_CONTEXT:'true',XYTHA_RESUMABLE_CHAT:'true',XYTHA_DIRECT_OUTPUT:'true',XYTHA_CHAT_HOURLY_LIMIT:'0',MODEL_VAULT_KEY:'a'.repeat(64),DB:db};
await build({entryPoints:['app/api/chat/route.ts','lib/chat-stream.ts','lib/focused-context.ts','lib/analysis-strategy.ts','lib/chart.ts','lib/context-capacity.ts','lib/timing.ts','lib/timing-request.ts'],outdir:out+'/bundles',bundle:true,platform:'node',format:'esm',external:['zod'],outExtension:{'.js':'.mjs'},plugins:[{name:'bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__bindings;',loader:'js'}));}}]});
const load=path=>import(pathToFileURL(resolve(out+'/bundles/'+path+'.mjs')).href);
const {POST}=await load('app/api/chat/route'),{consumeChat}=await load('lib/chat-stream'),{focusedPlan}=await load('lib/focused-context'),{retrospectiveYears}=await load('lib/analysis-strategy'),{createChart,example}=await load('lib/chart'),{modelContextWindow}=await load('lib/context-capacity');
const old={info:console.info,error:console.error,warn:console.warn};for(const k of Object.keys(old))console[k]=()=>{};
const results=[];let calls=[],fault=false,long=false;
const answerText='模拟模型直接回答：沿用已有背景和偏好。这是隔离测试数据，不是真实解读。';
globalThis.fetch=async(url,opts)=>{assert.equal(String(url),'https://mock.example.com/v1/chat/completions','No live provider calls');const body=JSON.parse(opts.body),data=JSON.parse(body.messages.at(-1).content);calls.push({data,body});if(fault)return new Response('',{status:503});return Response.json({usage:{prompt_tokens:1234,completion_tokens:56},choices:[{finish_reason:'stop',message:{content:data.frameworkContract?(long?answerText.repeat(900):answerText):JSON.stringify(plan)}}]});};
const request=(question,owner,id,recoveryOnly=false,extra={})=>new Request('https://fixture.test/api/chat',{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream','oai-authenticated-user-id':owner},body:JSON.stringify({profileId:'demo',target:'2026-09-09',scope:'natal',selected:9,connection:{...connection,contextWindow:200000},question,requestId:id,continuationProtocol:1,recoveryOnly,...extra})});
const seed=owner=>{sql.prepare('INSERT INTO messages(id,owner,profile_id,profile_revision,role,content,meta,created_at) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),owner,'demo',1,'user','我在研究岗位工作，沟通时间有限。','{}','2026-09-08');sql.prepare('INSERT INTO messages(id,owner,profile_id,profile_revision,role,content,meta,created_at) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),owner,'demo',1,'assistant','上一轮已经比较过准备步骤。','{}','2026-09-08T00:00:01');sql.prepare('INSERT INTO memories(id,owner,profile_id,content,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(),owner,'demo','偏好先给结论，再解释原因。','2026-09-08');};
async function complete(question,owner){seed(owner);calls=[];const id=crypto.randomUUID();let result,progress=[];
 for(let n=0;n<9;n++){const before=calls.length,response=await POST(request(question,owner,id,n>0));assert(response.ok);try{result=await consumeChat(response,p=>progress.push(p));break;}catch(e){assert.equal(e.code,'WORKFLOW_CONTINUE');assert(calls.length-before<=1);}}
 assert(result);assert.equal(result.content,answerText);assert.equal(result.verification,'direct');assert.equal(result.observation.actualCalls,calls.length);assert.equal(result.contextCapacity.inputTokensActual,1234);assert.equal(result.contextCapacity.windowTokens,200000);
 const generation=calls.find(c=>c.data.frameworkContract);assert(generation);assert(generation.data.dialogue.recent.some(m=>m.role==='assistant'&&m.content.includes('准备步骤')));assert(generation.data.dialogue.confirmedMemories.includes('偏好先给结论，再解释原因。'));assert(!generation.body.response_format);assert(!calls.some(c=>c.data.draft),'No reviewer added');assert(progress.some(p=>p.contextCapacity?.state==='prepared'));assert(progress.some(p=>p.contextCapacity?.state==='completed'));
 const before=calls.length,replayed=await consumeChat(await POST(request(question,owner,id,true)),()=>{});assert.equal(replayed.content,answerText);assert.equal(calls.length,before);results.push({case:owner,calls:calls.length,history:generation.data.dialogue.recent.length,memories:generation.data.dialogue.confirmedMemories.length,reviewerCalls:0});
}
try{
 for(const [owner,q] of [['general','我适合跳槽吗？'],['timing','今年哪个月适合跳槽？'],['mixed','今年适合跳槽吗？'],['unknown','请谈谈我想去的那个方向']])await complete(q,owner);
 const chart=createChart(example,'2026-09-09'),make=q=>focusedPlan(q,{goal:q},chart,'natal','2026-09-09');
 for(const q of ['过去几年事业怎么样','2022年之前财运怎么样','未来几年事业怎么样']){const p=make(q);assert(p.queries.some(x=>x.scope==='yearly'));for(const x of p.queries.filter(x=>x.scope==='yearly'))assert(p.queries.some(d=>d.scope==='decadal'&&d.date===x.date));results.push({case:q,years:[...new Set(p.queries.filter(x=>x.scope==='yearly').map(x=>x.date.slice(0,4)))]});}
 assert(make('2022年之前财运怎么样').queries.filter(x=>x.scope==='yearly').every(x=>x.date<'2022-01-01'));
 assert.equal(make('未来几年事业怎么样').queries.filter(x=>x.scope==='yearly').length,3);
 assert.deepEqual([...new Set(make('2022年至2024年事业怎么样').queries.filter(x=>x.scope==='yearly').map(x=>x.date.slice(0,4)))],['2022','2023','2024']);
 const {resolveTimingRequest}=await load('lib/timing-request');
 const earlier=[{role:'user',content:'我的申请截止日期是2026年9月20日。'}];
 const same=resolveTimingRequest('什么时候提交申请比较合适',earlier,'2026-09-09','1990-01-01');assert.equal(same.deadline,'2026-09-20');
 const switched=resolveTimingRequest('今年什么时候适合结婚',earlier,'2026-09-09','1990-01-01');assert.equal(switched.deadline,undefined);
 const reset=resolveTimingRequest('新申请，什么时候适合提交',earlier,'2026-09-09','1990-01-01');assert.equal(reset.deadline,undefined);
 results.push({case:'inclusive-year-range-and-task-local-deadline'});
 assert(retrospectiveYears('过去'+ '9'.repeat(400)+'年财运','2026-09-09').length<=20);results.push({case:'extreme-year-span-bounded'});
 assert.equal(modelContextWindow({model:'glm-5.2',baseUrl:'https://open.bigmodel.cn/api/paas/v4'}).windowTokens,1000000);assert.equal(modelContextWindow({model:'glm-5.2',baseUrl:'https://custom.example.com/v1'}).windowTokens,null);results.push({case:'capacity-source-no-invented-custom-limit'});
 calls=[];fault=true;const id=crypto.randomUUID();const failed=await POST(request('我适合跳槽吗？','failure',id));assert((await failed.text()).includes('PROVIDER_UNAVAILABLE'));fault=false;const retry=await POST(request('我适合跳槽吗？','failure',id,true));assert.equal((await retry.json()).code,'REQUEST_ENDED');assert.equal(calls.length,1);results.push({case:'ambiguous-provider-failure-not-retried',calls:1});
 long=true;calls=[];const lid=crypto.randomUUID();await (await POST(request('我适合跳槽吗？','long',lid))).text();const large=await consumeChat(await POST(request('我适合跳槽吗？','long',lid,true)),()=>{});assert(large.content.length>30000);assert.equal(large.content,answerText.repeat(900));assert.equal(calls.length,1);results.push({case:'long-direct-output-preserved',characters:large.content.length});
}finally{Object.assign(console,old);writeFileSync(out+'/results.json',JSON.stringify({mockOnly:true,realProviderCalls:0,results},null,2));}
console.log(JSON.stringify(results,null,2));console.log('PASS context upgrade: real routes, mocked provider, no new reviewer');
