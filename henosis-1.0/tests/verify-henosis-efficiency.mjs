import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {depthAnswerFixture} from './fixtures/henosis-depth-answer.mjs';
const out='.sites-runtime/verification/henosis-efficiency';mkdirSync(out,{recursive:true});
await build({stdin:{contents:['henosis-plan','henosis-evidence','henosis-context','henosis-answer','henosis-efficiency','henosis-recovery','henosis-runtime','henosis-generation','chart','context-capacity','providers/client'].map(n=>`export * from './lib/${n}';`).join('\n'),resolveDir:process.cwd(),loader:'ts'},outfile:out+'/bundle.mjs',bundle:true,platform:'node',format:'esm',external:['zod'],plugins:[{name:'bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env={};',loader:'js'}));}}]});
const api=await import(pathToFileURL(resolve(out+'/bundle.mjs')).href);
const {planHenosisQuestion,collectHenosisEvidence,henosisAnswerPacket,henosisAnswerContract,checkHenosisDraft,encodeHenosisInvestigation,henosisRepairSlots,henosisRepairInvestigation,mergeHenosisPatch,henosisTaskOutcome,shouldPartitionHenosisTask,prepareHenosisModelInput,runHenosis,createChart,example,estimateTokens,HENOSIS_DEPTH_VERSION:version}=api;
const today='2026-09-18',chart=createChart({...example,date:'1999-06-27',calendar:'solar'},today),settings={historyDecades:2,maxSupplementRounds:0,thinking:'enabled'};
const quotes=['我在2024年开始了一段感情，现在想判断这段关系是否适合长期走下去，','以及未来什么时候适合结婚。','请先分析我的本命婚恋倾向，','再结合过去到当前大限、今年流年的变化，区分哪些是长期相处模式，哪些可能只是阶段性的压力。','然后比较未来五年的婚姻窗口；如果跨入下一大限，请先解释大限背景的变化，再比较流年，不必强行细化到月份。','请分别说明“继续磨合”和“推进结婚”各自需要满足哪些现实条件。如果只有我的命盘，无法判断伴侣的想法或双方适配程度，请明确指出，不要替对方下结论。'];
const kinds=['decision','future_timing','attribute','historical_compare','future_timing','decision'];
const proposal={tasks:quotes.map((quote,i)=>({quote,domains:['relationship'],kind:kinds[i],precision:i===2?'natal':'yearly'}))};
const question=quotes.join(''),input={chart,today,question,history:[],settings,profileId:'synthetic-efficiency',profileRevision:1};
const checks=[],metrics={};
async function check(name,fn){try{await fn();checks.push({name,pass:true});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e.stack});console.error('FAIL '+name+': '+e.stack);}}
globalThis.fetch=async()=>{throw Error('Real provider calls forbidden');};
const plan=await planHenosisQuestion({...input,callModel:async()=>proposal}),bundle=await collectHenosisEvidence({chart,plan,settings}),packet=henosisAnswerPacket(bundle),contract=henosisAnswerContract(bundle.plan,packet);
await check('exact relationship wording shares explicit five years without losing background, natal or history',()=>{
 assert.equal(plan.classificationSource,'semantic',JSON.stringify(plan.henosis.decisions));
 const future=plan.tasks[4].timingRequest;assert.equal(future.start,today);assert.equal(future.end,'2031-09-17');
 for(const i of [0,1,5]){assert.equal(plan.tasks[i].timingRequest.start,future.start);assert.equal(plan.tasks[i].timingRequest.end,future.end);}
 assert.equal(plan.tasks[0].temporalIntent.backgroundEvents[0].year,2024);assert.equal(plan.tasks[2].precision,'natal');assert.equal(plan.tasks[3].kind,'historical_compare');
 assert.equal(plan.question,question);assert.deepEqual(plan.tasks.map(t=>t.source.text),quotes);
});
await check('independent explicit years, topics and third-party subjects cannot acquire a shared horizon',async()=>{
 const qs=['未来五年婚姻如何','2035年婚姻如何','什么时候适合创业'];
 const p=await planHenosisQuestion({...input,question:qs.join('，'),callModel:async()=>({tasks:qs.map((quote,i)=>({quote,domains:[i===2?'career':'relationship'],kind:'future_timing',precision:'yearly'}))})});
 assert.equal(p.tasks[1].timingRequest.start,'2035-01-01');assert(!p.tasks[2].reasonCodes.includes('henosis_shared_decision_horizon'));
});
await check('real-provider malformed source spans fall back to complete natal/history/future facets',async()=>{
 const p=await planHenosisQuestion({...input,callModel:async(_instructions,data)=>{
  assert(data.ruleProposal.every(t=>question.includes(t.quote)),'Planner hints must be contiguous verbatim spans');
  return {tasks:[{quote:'我在2024年开始了一段感情',domains:['relationship'],kind:'historical_compare',precision:'yearly'},{quote:'以及未来什么时候适合结婚然后比较未来五年的婚姻窗口',domains:['relationship'],kind:'future_timing',precision:'yearly'}]};
 }});
 assert.equal(p.classificationSource,'rules');assert(p.tasks.some(t=>t.kind==='attribute'&&t.precision==='natal'));
 assert(p.tasks.some(t=>t.kind==='historical_compare'));assert(p.tasks.some(t=>t.kind==='future_timing'&&t.timingRequest.start===today&&t.timingRequest.end==='2031-09-17'),JSON.stringify(p.henosis.decisions));
 assert(!p.tasks.some(t=>t.kind==='mixed'&&t.precision==='none'));
});
const encoded=encodeHenosisInvestigation(packet);
function decode(source){const result={...source};for(const [key,table] of Object.entries(result.tables||{}))result[key]=table.rows.map(row=>({...Object.fromEntries(table.columns.map((name,i)=>[name,row[i]])),...row[table.columns.length]}));delete result.tables;delete result.tableEncoding;return result;}
await check('column encoding preserves every fact, field, candidate, date and citation',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(decode(encoded))),JSON.parse(JSON.stringify(packet)));
 const before=estimateTokens(JSON.stringify(packet)),after=estimateTokens(JSON.stringify(encoded));metrics.packet={before,after,saving:1-after/before,facts:packet.facts.length,candidates:packet.candidates.length};assert(after<before*.85,JSON.stringify(metrics.packet));
});
await check('prepared-call sizing uses the same expanded facts that are sent to the model',()=>{
 const prepared=prepareHenosisModelInput('Synthetic instructions',{investigation:packet});
 assert.equal(prepared.inputTokensEstimate,estimateTokens(prepared.instructions+'\n'+JSON.stringify(prepared.data)));
 assert(prepared.instructions.includes('程序已展开的逐期事实'));
 const factTable=prepared.data.investigation.tables?.facts;assert(factTable&&factTable.columns.includes('transformations'));assert(!('states' in prepared.data.investigation));
});
await check('task outcomes preserve conditions, citations and candidate coverage without passing a blind prefix',()=>{
 const draft=depthAnswerFixture({answerContract:contract,investigation:packet}),report=draft.tasks[4];
 report.conclusion+='如果现实沟通条件尚未满足，则该结论需要延后确认。';
 const outcome=henosisTaskOutcome(report,[{taskId:report.taskId,code:'SYNTHETIC',detail:'待核对'}]);
 assert.equal(outcome.status,'partial');assert(outcome.conditions.some(x=>x.includes('现实沟通条件')));assert(outcome.evidenceIds.length>0);assert(outcome.candidateIds.length===report.comparison.length);assert.equal(outcome.unresolved[0].code,'SYNTHETIC');
});
await check('large candidate or near-capacity tasks select lossless partitioning before generation',()=>{
 assert.equal(shouldPartitionHenosisTask({inputTokensEstimate:1000,inputBudget:20000,maximumCharacters:2600,candidateCount:2}),false);
 assert.equal(shouldPartitionHenosisTask({inputTokensEstimate:17000,inputBudget:20000,maximumCharacters:2600,candidateCount:2}),true);
 assert.equal(shouldPartitionHenosisTask({inputTokensEstimate:1000,inputBudget:20000,maximumCharacters:5200,candidateCount:9}),true);
});
await check('false missing-range claim and explicit wrong palace star are detected',()=>{
 const draft=depthAnswerFixture({answerContract:contract,investigation:packet});
 draft.tasks[4].conclusion+='未来五年后续年份（2027-2030）的运限数据尚不在本轮调查覆盖范围内。';
 assert(checkHenosisDraft(draft,bundle.plan,packet).issues.some(i=>i.code==='COVERAGE_CONTRADICTION'));
 const report=draft.tasks[4],row=report.comparison.find(c=>packet.candidates.find(x=>x.id===c.candidateIds[0]).label==='2030');
 const candidate=packet.candidates.find(c=>c.id===row.candidateIds[0]);
 const facts=packet.facts.filter(f=>candidate.citations.includes(f.id)&&f.scope==='yearly'&&f.palace==='夫妻');assert(facts.length);
 const allowed=facts.flatMap(f=>packet.natalRegistry.find(n=>n.id===f.natalRef).stars.map(s=>s[0]));const wrong=['紫微','天机','太阳','太阴','七杀'].find(s=>!allowed.includes(s));
 row.citations=facts.map(f=>f.id);row.text+=`流年夫妻宫${wrong}。`;
 const issues=checkHenosisDraft(draft,bundle.plan,packet).issues;assert(issues.some(i=>i.code==='PALACE_STAR_MISMATCH'));
 const original=JSON.stringify(draft),rendered=api.renderHenosisDraft(draft,bundle.plan,packet,issues);
 assert(!rendered.content.includes(`流年夫妻宫${wrong}。`),'Unresolved contradiction must not be shown as a confident claim');assert.equal(JSON.stringify(draft),original,'Raw evidence-linked draft remains inspectable');
});
await check('patch updates faulty evidence and dependent conclusions, preserves other prose and rejects unsolicited replacements',()=>{
 const draft=depthAnswerFixture({answerContract:contract,investigation:packet}),report=draft.tasks[4],candidateId=report.comparison[0].candidateIds[0];
 const issues=[{taskId:report.taskId,code:'STAR_MUTAGEN_MISMATCH',detail:`comparison:${candidateId} 中的 不支持星曜`}];
 const slots=henosisRepairSlots(report,issues);assert.equal(slots.length,3);assert(slots.some(s=>s.kind==='conclusion'));assert(slots.some(s=>s.kind==='section'&&s.value.kind==='synthesis'));
 const selected=henosisRepairInvestigation(packet,report.taskId,slots);assert(selected.facts.length<packet.facts.length);assert(selected.candidates.some(c=>c.id===candidateId));
 const patch={patches:slots.map(slot=>({id:slot.id,text:'已根据修订后的依据同步核对该判断，仅作协议测试。',citations:slot.value?.citations||[]}))};
 const merged=mergeHenosisPatch(draft,report.taskId,slots,patch);assert.notDeepEqual(merged,draft);assert.deepEqual(merged.tasks[0],draft.tasks[0]);assert.deepEqual(merged.tasks[4].sections.filter(s=>s.kind!=='synthesis'),draft.tasks[4].sections.filter(s=>s.kind!=='synthesis'));assert.notEqual(merged.tasks[4].conclusion,draft.tasks[4].conclusion);assert.deepEqual(merged.tasks[4].comparison[0].candidateIds,[candidateId]);
 assert.deepEqual(mergeHenosisPatch(draft,report.taskId,slots,{patches:[...patch.patches,{...patch.patches[0],id:'unauthorized'}]}),merged,'Unrequested slots are ignored while valid requested repairs survive');
 assert.equal(mergeHenosisPatch(draft,report.taskId,slots,{patches:[{...patch.patches[0],citations:['fake']}]}),draft);
 metrics.patch={allPacketTokens:estimateTokens(JSON.stringify(packet)),localPacketTokens:estimateTokens(JSON.stringify(encodeHenosisInvestigation(selected)))};
});
const saved=new Map([[version+'.initial_plan',structuredClone(plan)],[version+'.initial_evidence',structuredClone(bundle)],[version+'.borrowed_evidence',[]]]),requests=[];
const connection={provider:'custom',protocol:'openai-chat',model:'synthetic-model',baseUrl:'https://mock.example.com/v1',key:'SYNTHETIC',thinking:'enabled',jsonMode:true,contextWindow:1000000};
const args={...input,now:today+'T04:00:00Z',connection,load:async k=>saved.has(k)?structuredClone(saved.get(k)):undefined,save:async(k,v)=>saved.set(k,structuredClone(v))};
await check('six deep tasks avoid an oversized joint attempt, retain all tasks and replay without API cost',async()=>{
 globalThis.fetch=async(_u,options)=>{const body=JSON.parse(options.body),data=JSON.parse(body.messages.at(-1).content);requests.push(data);assert(data.globalCoverage.length===6);return Response.json({usage:{prompt_tokens:2000,completion_tokens:1200},choices:[{finish_reason:'stop',message:{content:JSON.stringify(depthAnswerFixture(data))}}]});};
 const result=await runHenosis(args);assert.equal(result.answer.completion,'answered',JSON.stringify(result.answer.henosis.deliveryIssues));assert.equal(result.answer.henosis.delivery.tasks.length,6);assert.equal(requests.length,6,'Large contracts must go directly to tasks');assert(requests.every(data=>data.answerTask));
 assert.equal(result.answer.henosis.usage.inputTokens,12000);assert.equal(result.answer.henosis.usage.outputTokens,7200);assert.equal(result.answer.henosis.usage.missingUsageCalls,0);
 assert.equal(result.answer.henosis.questionCompletion,'complete');assert.equal(result.answer.henosis.runBudget.maxCalls,32);assert.equal(result.answer.henosis.runBudget.remainingCalls,26);
 const replay=await runHenosis(args);assert.equal(requests.length,6);assert.equal(replay.answer.content,result.answer.content);assert.deepEqual(replay.answer.henosis.usage,result.answer.henosis.usage);assert.deepEqual(replay.answer.henosis.runBudget,result.answer.henosis.runBudget);
 metrics.taskWriters={modelCalls:requests.length,oversizedJointCalls:0,tasks:6};
});
const smallPlan=structuredClone(plan);smallPlan.tasks=smallPlan.tasks.filter(t=>['task-3','task-4'].includes(t.id));smallPlan.henosis.dependencies=[];
const smallBundle=await collectHenosisEvidence({chart,plan:smallPlan,settings});
const smallState=()=>new Map([[version+'.initial_plan',structuredClone(smallPlan)],[version+'.initial_evidence',structuredClone(smallBundle)],[version+'.borrowed_evidence',[]]]);
await check('two small tasks share a single bounded joint writer',async()=>{
 const isolated=smallState();let calls=0;
 globalThis.fetch=async(_u,options)=>{calls++;const data=JSON.parse(JSON.parse(options.body).messages.at(-1).content);assert(!data.answerTask);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(depthAnswerFixture(data))}}]});};
 const result=await runHenosis({...args,load:async k=>isolated.has(k)?structuredClone(isolated.get(k)):undefined,save:async(k,v)=>isolated.set(k,structuredClone(v))});assert.equal(calls,1);assert.equal(result.answer.completion,'answered');assert.equal(result.answer.henosis.usage.missingUsageCalls,1);metrics.smallJoint={calls,tasks:2};
});
await check('locally repaired JSON does not disable thinking for later analysis tasks',async()=>{
 const isolated=new Map([[version+'.initial_plan',structuredClone(plan)],[version+'.initial_evidence',structuredClone(bundle)],[version+'.borrowed_evidence',[]]]);let count=0;const thinking=[];
 globalThis.fetch=async(_u,options)=>{const body=JSON.parse(options.body),data=JSON.parse(body.messages.at(-1).content);thinking.push(body.thinking?.type);const draft=depthAnswerFixture(data);let text=JSON.stringify(draft);if(count++===0)text=text.replace('合成协议回答','合成"协议回答');return Response.json({choices:[{finish_reason:'stop',message:{content:text}}]});};
 const result=await runHenosis({...args,load:async k=>isolated.has(k)?structuredClone(isolated.get(k)):undefined,save:async(k,v)=>isolated.set(k,structuredClone(v))});
 assert(result.answer.henosis.delivery.tasks.length===6);assert.equal(isolated.get(version+'.direct_synthesis'),undefined);
 assert(thinking.every(value=>value===thinking[0]));
});
await check('joint length limit transitions to bounded task output once without compression or repeated joint attempts',async()=>{
 const isolated=smallState();let batchCalls=0,taskCalls=0;
 globalThis.fetch=async(_u,options)=>{const data=JSON.parse(JSON.parse(options.body).messages.at(-1).content);assert(!data.units,'No paid compression');if(!data.answerTask){batchCalls++;return Response.json({usage:{prompt_tokens:500,completion_tokens:300},choices:[{finish_reason:'length',message:{content:'{"tasks":['}}]});}taskCalls++;return Response.json({usage:{prompt_tokens:500,completion_tokens:300},choices:[{finish_reason:'stop',message:{content:JSON.stringify(depthAnswerFixture(data))}}]});};
 const result=await runHenosis({...args,load:async k=>isolated.has(k)?structuredClone(isolated.get(k)):undefined,save:async(k,v)=>isolated.set(k,structuredClone(v))});
 assert.equal(result.answer.completion,'answered',JSON.stringify(result.answer.henosis.deliveryIssues));assert.equal(batchCalls,1);assert.equal(taskCalls,2);assert.equal(result.answer.henosis.usage.calls,3);assert.equal(result.answer.henosis.usage.outputTokens,900);
 const before=batchCalls+taskCalls;await runHenosis({...args,load:async k=>isolated.has(k)?structuredClone(isolated.get(k)):undefined,save:async(k,v)=>isolated.set(k,structuredClone(v))});assert.equal(batchCalls,1);assert.equal(batchCalls+taskCalls,before);
});
await check('joint writing preserves requested reasoning and API accounting marks unavailable usage honestly',async()=>{
 const state=new Map();let calls=0;
 globalThis.fetch=async(_u,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.thinking.type,'enabled');assert.equal(body.max_tokens,32768,'Joint output reserves space for reasoning and all task bodies');return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});};
 const result=await api.generateHenosisStage({connection:{...connection,provider:'bigmodel',model:'glm-5.2'},instructions:'Synthetic joint writer',data:{},phase:'answer_batch',json:true,cacheKey:'reasoning',load:async k=>state.get(k),save:async(k,v)=>state.set(k,structuredClone(v))});
 assert.equal(calls,1);assert.equal(result.attempts[0].thinking,'enabled');assert.equal(result.attempts[0].tokenUsage,null);
});
await check('optional repair timeout is attempted once and replay cannot reset its budget',async()=>{
 const state=new Map();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});};
 const input={connection,instructions:'Synthetic repair',data:{},phase:'answer_patch_task-1_repair',json:true,cacheKey:'bounded-repair',load:async k=>state.get(k),save:async(k,v)=>state.set(k,structuredClone(v)),validate:()=>{throw new api.ProviderConnectionError('Synthetic timeout at completion','PROVIDER_TOTAL_TIMEOUT');}};
 await assert.rejects(api.generateHenosisStage(input),e=>e.code==='PROVIDER_TOTAL_TIMEOUT');assert.equal(calls,1);
 await assert.rejects(api.generateHenosisStage(input),e=>e.code==='HENOSIS_GENERATION_LIMIT');assert.equal(calls,1);
});
await check('reserve repair output before admitting normal calls',async()=>{
 assert.equal(api.henosisOutputAllowance(260000,10000,16000,'answer'),0);
 assert.equal(api.henosisOutputAllowance(260000,10000,16000,'answer_patch_task-1_repair'),16000);
 assert.equal(api.henosisOutputAllowance(280000,10000,16000,'answer_part_task-1_synthesis'),9000);
 const state=new Map();let requested=0;
 globalThis.fetch=async(_url,options)=>{requested=JSON.parse(options.body).max_tokens;return Response.json({choices:[{finish_reason:'stop',message:{content:'{\"ok\":true}'}}]});};
 await api.generateHenosisStage({connection,instructions:'budget bound',data:{},phase:'answer',json:true,cacheKey:'allowance',beforeAttempt:()=>1024,load:async k=>state.get(k),save:async(k,v)=>state.set(k,v)});
 assert.equal(requested,1024);
});
writeFileSync(out+'/results.json',JSON.stringify({syntheticOnly:true,realProviderCalls:0,checks,metrics},null,2));console.log(JSON.stringify(metrics,null,2));assert.equal(checks.filter(c=>!c.pass).length,0);
