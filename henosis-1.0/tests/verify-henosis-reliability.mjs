import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const out='.sites-runtime/verification/henosis-reliability';mkdirSync(out,{recursive:true});
await build({stdin:{contents:"export * from './lib/henosis-plan'; export * from './lib/henosis-generation'; export * from './lib/henosis-recovery'; export * from './lib/chart'; export * from './lib/providers/client';",resolveDir:process.cwd(),loader:'ts'},outfile:out+'/bundle.mjs',bundle:true,platform:'node',format:'esm',external:['zod'],plugins:[{name:'local-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env={};',loader:'js'}));}}]});
const {planHenosisQuestion,generateHenosisStage,henosisStageLabel,henosisExecutionOrder,henosisDeliveryParts,henosisPartInvestigation,ProviderConnectionError,createChart,example}=await import(pathToFileURL(resolve(out+'/bundle.mjs')).href);
const chart=createChart({...example,date:'1999-06-27',calendar:'solar'},'2026-09-18'),today='2026-09-18',settings={historyDecades:2,maxSupplementRounds:0,thinking:'enabled'},checks=[];
const input={chart,today,settings,history:[],profileId:'synthetic',profileRevision:1};
const task=(quote,domains,kind='future_timing',precision='yearly',extra={})=>({quote,domains,kind,precision,...extra});
async function check(name,fn){try{await fn();checks.push({name,pass:true});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e.message});console.error('FAIL '+name+': '+e.message);}}
globalThis.fetch=async()=>{throw Error('Unexpected real provider request');};

await check('production failure shape: five facets, four domains and forward dependency survive without repair',async()=>{
 const quotes=['结合我的命盘，我未来更适合留在当前城市和现有职业体系内继续积累，还是换城市并逐步独立发展？','请先分析本命中职业发展、迁移环境、收入稳定性和合作资源的先天倾向，','再回顾过去大限到当前大限这些方向的变化，','说明当前大限与今年流年形成的支持和矛盾；','然后比较未来五年各流年，分别指出适合准备、适合迁移转型、适合正式启动和不宜冒进的年份，并说明关键转折点及成立条件。请自行决定必要宫位和时间精度，不要无依据地细化到月份。'];
 const all=['career','travel','wealth','network'];let calls=0;
 const proposal={tasks:[task(quotes[0],['career','travel','network'],'decision','yearly',{dependsOn:5,dependency:'conditional'}),task(quotes[1],all,'attribute','natal'),task(quotes[2],all,'historical_compare','decadal',{dependsOn:2,dependency:'conditional'}),task(quotes[3],all,'current_state','yearly',{dependsOn:3,dependency:'conditional'}),task(quotes[4],all,'future_timing','yearly',{dependsOn:4,dependency:'conditional'})]};
 const plan=await planHenosisQuestion({...input,question:quotes.join(''),callModel:async()=>{calls++;return proposal;}});
 assert.equal(calls,1,JSON.stringify(plan.henosis.decisions));assert.equal(plan.classificationSource,'semantic');assert.equal(plan.tasks.length,5);assert.deepEqual(henosisExecutionOrder(plan).map(t=>t.id),['task-2','task-3','task-4','task-5','task-1']);assert.equal(plan.tasks[0].timingRequest.end,plan.tasks[4].timingRequest.end);assert(plan.tasks[4].timingRequest.end>'2031-01-01');
 const fallback=await planHenosisQuestion({...input,question:quotes.join(''),callModel:async()=>{throw new ProviderConnectionError('synthetic timeout','PROVIDER_TOTAL_TIMEOUT');}});
 assert.equal(fallback.classificationSource,'rules');assert(fallback.tasks.length>=4,JSON.stringify(fallback.henosis.decisions));assert(fallback.tasks.some(t=>t.kind==='future_timing'&&t.timingRequest.start===today&&t.timingRequest.end>'2031-01-01'));assert(fallback.henosis.decisions.some(d=>d.action==='deterministic_facet_fallback'));
 const merged=await planHenosisQuestion({...input,question:quotes.join(''),callModel:async()=>({tasks:[task(quotes.join(''),all,'decision')]})});
 // A single event may carry its layers as requirements instead of separate
 // jobs. Preserve its full source, explicit horizon and all named domains.
 assert(merged.tasks.some(t=>t.timingRequest?.start===today&&t.timingRequest.end>'2031-01-01'));
 for(const domain of all)assert(merged.tasks.some(t=>t.domains.includes(domain)));
 for(const quote of quotes)assert(merged.tasks.some(t=>t.question.includes(quote.replace(/[，；。]$/,''))));
});

await check('four explicit domains are preserved without a schema repair call',async()=>{
 const question='未来五年职业发展、迁移、财富和交友如何',proposal={tasks:[task(question,['career','travel','wealth','network'])]};let calls=0;
 const plan=await planHenosisQuestion({...input,question,callModel:async()=>{calls++;return proposal;}});
 assert.equal(calls,1);assert.equal(plan.classificationSource,'semantic');assert.equal(plan.tasks[0].domains.length,4);
});
await check('forward conditional dependency executes supporting comparison before decision and keeps five-year horizon',async()=>{
 const a='我应该继续现有职业还是独立创业',b='请比较未来五年事业的机会',question=a+'，'+b;
 const plan=await planHenosisQuestion({...input,question,callModel:async()=>({tasks:[task(a,['career'],'decision','yearly',{dependsOn:2,dependency:'conditional'}),task(b,['career'])]})});
 assert.equal(plan.classificationSource,'semantic');assert.deepEqual(henosisExecutionOrder(plan).map(t=>t.id),['task-2','task-1']);
 assert.equal(plan.tasks[0].timingRequest.end,plan.tasks[1].timingRequest.end);
});
await check('same-event analysis facets keep explicit future time rather than rejecting the whole plan',async()=>{
 const a='我的职业先天倾向是什么',b='说明当前大限与今年流年的变化',c='然后比较未来五年事业机会';let calls=0;
 const plan=await planHenosisQuestion({...input,question:[a,b,c].join('，'),callModel:async()=>{calls++;return {tasks:[task(a,['career'],'attribute','natal'),task(b,['career'],'current_state','yearly',{dependsOn:1,dependency:'same_event'}),task(c,['career'],'future_timing','yearly',{dependsOn:2,dependency:'same_event'})]};}});
 assert.equal(calls,1,JSON.stringify(plan.henosis.decisions));assert.equal(plan.classificationSource,'semantic');assert.equal(plan.tasks.length,3);assert.equal(plan.tasks[2].timingRequest.start,today);assert(plan.tasks[2].timingRequest.end>'2031-01-01');assert(!plan.tasks[2].dependsOnTaskId);
});
await check('cycles do not reach execution',async()=>{
 const a='2028年事业如何',b='2029年财富如何';const plan=await planHenosisQuestion({...input,question:a+'，'+b,callModel:async()=>({tasks:[task(a,['career'],'future_timing','yearly',{dependsOn:2,dependency:'conditional'}),task(b,['wealth'],'future_timing','yearly',{dependsOn:1,dependency:'conditional'})]})});
 assert.equal(plan.classificationSource,'rules');assert(plan.henosis.decisions.some(d=>d.reason==='HENOSIS_DEPENDENCY_CYCLE'));
});
await check('repair sees the rejected proposal and only then can replace it',async()=>{
 const question='2028年事业如何',bad={tasks:[task(question,['career']),task('并不存在于原文',['wealth'])]};let calls=0;
 const plan=await planHenosisQuestion({...input,question,callModel:async(_i,data,phase)=>{calls++;if(phase==='initial_plan')return bad;assert.deepEqual(data.repair.previousProposal,bad);assert(data.repair.issue);return {tasks:[task(question,['career'])]};}});
 assert.equal(calls,2);assert.equal(plan.classificationSource,'semantic');
});
await check('missing dependency kind reports an exact repair field without inventing the relationship',async()=>{
 const a='2028年事业如何',b='2029年财富如何';let calls=0;
 const plan=await planHenosisQuestion({...input,question:a+'，'+b,callModel:async(instructions,data)=>{calls++;assert(instructions.includes('必须成对出现'));if(calls===1)return {tasks:[task(a,['career']),task(b,['wealth'],'future_timing','yearly',{dependsOn:1})]};assert.equal(data.repair.issue,'HENOSIS_DEPENDENCY_INVALID');assert.equal(data.repair.dependencyIssues[0].task,2);assert.equal(data.repair.dependencyIssues[0].field,'dependency');return {tasks:[task(a,['career']),task(b,['wealth'],'future_timing','yearly',{dependsOn:1,dependency:'conditional'})]};}});
 assert.equal(calls,2);assert.equal(plan.classificationSource,'semantic');assert.equal(plan.tasks[1].timingRequest.start,'2029-01-01');
});
await check('exhausted planning repair preserves explicit historical cutoff and health palaces',async()=>{
 const question='2026年之前哪年身体最需要注意';let calls=0;
 const plan=await planHenosisQuestion({...input,question,callModel:async()=>{if(++calls===1)return {tasks:[]};throw new ProviderConnectionError('synthetic length','HENOSIS_OUTPUT_LIMIT');}});
 assert.equal(calls,2);assert.equal(plan.tasks[0].timingRequest.end,'2025-12-31');assert(plan.tasks[0].palaces.includes('疾厄'));assert(plan.henosis.decisions.some(d=>d.action==='planning_unavailable'));
});
await check('planning timeout uses rules; cancellation, refusal, authentication and unknown errors remain terminal',async()=>{
 const question='2028年事业如何';const p=await planHenosisQuestion({...input,question,callModel:async()=>{throw new ProviderConnectionError('synthetic timeout','PROVIDER_TOTAL_TIMEOUT');}});assert.equal(p.classificationSource,'rules');
 for(const code of ['PROVIDER_CANCELLED','PROVIDER_REFUSAL','PROVIDER_AUTH','PROVIDER_NETWORK'])await assert.rejects(planHenosisQuestion({...input,question,callModel:async()=>{throw new ProviderConnectionError('synthetic terminal',code);}}),e=>e.code===code);
 await assert.rejects(planHenosisQuestion({...input,question,callModel:async()=>{throw Error('programming error');}}),/programming error/);
});
await check('planning repair has an accurate stage label',async()=>{assert.equal(henosisStageLabel('initial_plan_repair'),'初始问题规划修复');assert.equal(henosisStageLabel('compress_1'),'证据压缩');});
await check('formatting and compression use direct output without mutating user settings',async()=>{
 for(const phase of ['initial_plan','initial_plan_repair','refine_plan','refine_plan_repair','compress_0','answer_repair','answer_part_task-1_0']){
  const connection={provider:'bigmodel',protocol:'openai-chat',model:'glm-5.2',baseUrl:'https://mock.example.com/v1',key:'SYNTHETIC',thinking:'enabled',jsonMode:true,contextWindow:1000000},saved=new Map();
  globalThis.fetch=async(_u,options)=>{const body=JSON.parse(options.body);assert.equal(body.thinking.type,'disabled');assert.equal(body.reasoning_effort,undefined);return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});};
  await generateHenosisStage({connection,instructions:'synthetic',data:{},phase,json:true,cacheKey:phase,load:async k=>saved.get(k),save:async(k,v)=>saved.set(k,v)});assert.equal(connection.thinking,'enabled');
 }
});
await check('delivery parts cover every candidate exactly once without narrowing years',async()=>{
 const comparisonTargets=Array.from({length:13},(_,i)=>({id:'c'+i,label:String(2026+i)})),parts=henosisDeliveryParts({taskId:'task-1',requiredSections:['natal','current','trajectory','synthesis'],comparisonTargets});
 assert.equal(parts.length,5);assert.deepEqual(parts.flatMap(p=>p.comparisonTargets),comparisonTargets);assert(parts.every(p=>p.comparisonTargets.length<=4));assert.deepEqual(parts[0].requiredSections,['natal','current','trajectory'],'Synthesis must follow completed candidates, never the foundation-only call');
});
await check('candidate context retains natal and parent period; foundation owns current/history',async()=>{
 const source={facts:['e1','e2','e3','e4','e5','e6'].map(id=>({id,state:id,natalRef:'n'})),states:['e1','e2','e3','e4','e5','e6'].map(id=>({id,sourceIds:[]})),natalRegistry:[{id:'n'}],sources:[],candidates:[{id:'c1',start:'2028-01-01',end:'2028-12-31'},{id:'c2',start:'2029-01-01',end:'2029-12-31'}],periods:[{role:'natal',citations:['e1']},{role:'current',citations:['e2']},{role:'retrospective',citations:['e3']},{role:'candidate',scope:'yearly',start:'2028-01-01',end:'2028-12-31',citations:['e4']},{role:'candidate',scope:'yearly',start:'2029-01-01',end:'2029-12-31',citations:['e5']},{role:'candidate',scope:'decadal',start:'2024-01-01',end:'2033-12-31',citations:['e6']}]};
 const part=henosisPartInvestigation(source,['c1']);assert.deepEqual(part.facts.map(f=>f.id),['e1','e4','e6']);assert.deepEqual(henosisPartInvestigation(source,[]).facts.map(f=>f.id),['e1','e2','e3']);assert.equal(source.facts.length,6);
});
writeFileSync(out+'/results.json',JSON.stringify({syntheticOnly:true,realProviderCalls:0,checks},null,2));assert.equal(checks.filter(c=>!c.pass).length,0);console.log(`PASS ${checks.length} reliability checks; zero real provider calls`);
