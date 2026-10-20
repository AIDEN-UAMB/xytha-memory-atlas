import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {depthAnswerFixture} from './fixtures/henosis-depth-answer.mjs';
const out='.sites-runtime/verification/henosis-depth';mkdirSync(out,{recursive:true});
await build({entryPoints:['henosis-plan','henosis-evidence','henosis-context','henosis-answer','henosis-runtime','chart','context-capacity'].map(n=>'lib/'+n+'.ts'),outdir:out+'/bundles',bundle:true,platform:'node',format:'esm',external:['zod'],outExtension:{'.js':'.mjs'},plugins:[{name:'bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env={};',loader:'js'}));}}]});
const load=async n=>import(pathToFileURL(resolve(out+'/bundles/'+n+'.mjs')).href);
const {planHenosisQuestion,reviseHenosisPlan}=await load('henosis-plan'),{collectHenosisEvidence}=await load('henosis-evidence'),{henosisAnswerPacket,henosisRefinementBrief,henosisEvidenceDetails}=await load('henosis-context'),{henosisAnswerContract,checkHenosisDraft}=await load('henosis-answer'),{runHenosis}=await load('henosis-runtime'),{createChart,example,referenceIds}=await load('chart'),{estimateTokens}=await load('context-capacity');
const today='2026-09-11',chart=createChart({...example,date:'1999-06-27',calendar:'solar'},today),settings={historyDecades:2,maxSupplementRounds:1,thinking:'enabled'};
const {repairHenosisEnvelope,mergeHenosisRepair}=await load('henosis-answer');
const base={chart,today,history:[],profileId:'synthetic-depth',profileRevision:1,settings},results=[],metrics=[];
const task=(quote,domains,kind='future_timing',precision='yearly')=>({quote,domains,kind,precision});
const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}};
globalThis.fetch=async()=>{throw Error('Network forbidden outside mocked runtime test');};
const questions=[
 ['2024年开始的恋爱什么时候适合结婚',[task('2024年开始的恋爱什么时候适合结婚',['relationship'])]],
 ['2026年之前哪年身体最需要注意',[task('2026年之前哪年身体最需要注意',['health'],'historical_compare')]],
 ['我适合怎样的职业；未来五年哪年换工作比较合适',[task('我适合怎样的职业',['career'],'attribute','natal'),task('未来五年哪年换工作比较合适',['career'])]],
 ['2028年几月适合结婚',[task('2028年几月适合结婚',['relationship'],'future_timing','monthly')]],
];
const bundles=[];
for(const [question,tasks] of questions)await check('real engine and compact packet preserve '+question,async()=>{
 const plan=await planHenosisQuestion({...base,question,callModel:async()=>({tasks})}),bundle=await collectHenosisEvidence({chart,plan,settings}),packet=henosisAnswerPacket(bundle);
 assert(bundle.coverage.every(c=>c.status==='complete'),JSON.stringify(bundle.coverage));
 assert.equal(packet.facts.length,bundle.references.length);assert.equal(new Set(packet.natalRegistry.map(n=>n.id)).size,packet.natalRegistry.length);
 const aliases=new Map(bundle.references.map((r,i)=>[r.id,'e'+(i+1)]));
 for(const observation of bundle.observations)assert(packet.periods.some(p=>p.scope===observation.scope&&p.role===observation.role&&(observation.scope==='natal'||p.start===(observation.start||observation.date)&&p.end===(observation.end||observation.date))&&observation.evidenceIds.every(id=>p.citations.includes(aliases.get(id)))),'Lost observation binding '+observation.id);
 if(question.startsWith('2024')){assert(bundle.plan.tasks[0].timingRequest.start===today);assert(packet.candidates.at(-1).end>'2031-01-01');}
 if(question.startsWith('2026'))assert(packet.candidates.every(c=>c.end<'2026-01-01'));
 const fixture=depthAnswerFixture({answerContract:henosisAnswerContract(bundle.plan,packet),investigation:packet});assert.deepEqual(checkHenosisDraft(fixture,bundle.plan,packet).issues,[]);
 const original=estimateTokens(JSON.stringify(bundle.context)),compact=estimateTokens(JSON.stringify(packet));metrics.push({question,originalTokens:original,packetTokens:compact,ratio:compact/original,facts:packet.facts.length,candidates:packet.candidates.length});
 assert(compact<original,'Compact fact packet should cost less than the former whole interpretation registry');bundles.push(bundle);
});
await check('saved star and transformation detail equals deterministic Nous evidence at the answer date',()=>{
 for(const e of henosisEvidenceDetails(bundles[0])){const expected=referenceIds(createChart(chart.birth,e.date),e.scope,[e.index])[0];assert.deepEqual(e.stars.map(s=>[s.name,s.brightness,s.transformations.map(t=>[t.scope,t.star,t.value])]),expected.stars.map(s=>[s.name,s.brightness||null,s.transformations.map(t=>[t.scope,t.star,t.value])]));}
});
await check('refinement represents all anchored palaces and the current, prior and candidate layers',()=>{
 const b=bundles[0],brief=henosisRefinementBrief(b);for(const palace of b.plan.tasks[0].palaces)assert(brief.references.some(r=>r.palace===palace));assert(brief.references.some(r=>r.scope==='natal'));assert(brief.references.some(r=>r.scope==='decadal'));assert(brief.references.some(r=>r.scope==='yearly'));assert(brief.natalRegistry.length);assert(estimateTokens(JSON.stringify(brief))<16000);
});
await check('missing tasks and candidate years or cross-task citations cannot be labeled complete',()=>{
 const b=bundles[2],p=henosisAnswerPacket(b),draft=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p});draft.tasks.pop();assert(checkHenosisDraft(draft,b.plan,p).issues.some(i=>i.code==='TASK_MISSING'));
 const d=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p});d.tasks[1].comparison.pop();assert(checkHenosisDraft(d,b.plan,p).issues.some(i=>i.code==='CANDIDATE_MISSING'));
 d.tasks[0].sections[0].citations=['e999999'];assert(checkHenosisDraft(d,b.plan,p).issues.some(i=>i.code==='EVIDENCE_ID'));
});
await check('shallow, grouped and false-insufficient answers cannot pass the depth baseline',()=>{
 const b=bundles[0],p=henosisAnswerPacket(b),d=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p}),report=d.tasks[0];
 report.conclusion='结论过短。';report.sections.forEach(s=>s.text='解释过短。');
 assert(checkHenosisDraft(d,b.plan,p).issues.some(i=>i.code==='DEPTH_INSUFFICIENT'));
 const grouped=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p});
 if(grouped.tasks[0].comparison.length>1){grouped.tasks[0].comparison[0].candidateIds.push(grouped.tasks[0].comparison[1].candidateIds[0]);assert(checkHenosisDraft(grouped,b.plan,p).issues.some(i=>i.code==='CANDIDATE_GROUPED'));}
  const falseMissing=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p});falseMissing.tasks[0].sections[0].text+=' 本轮无法跨年比较，需要重新补充盘面数据。';assert(checkHenosisDraft(falseMissing,b.plan,p).issues.some(i=>i.code==='COVERAGE_CONTRADICTION'));
  const overreach=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p});overreach.tasks[0].conclusion+=' 仅凭流年资料判断2028年下半年最好。';assert(checkHenosisDraft(overreach,b.plan,p).issues.some(i=>i.code==='PRECISION_OVERREACH'));
});
await check('open entrepreneurship receives Henosis-only operating-condition palaces before evidence collection',async()=>{
 const question='什么时候适合自己创业单干？',p=await planHenosisQuestion({...base,question,callModel:async()=>({tasks:[task(question,['career'])]})}),t=p.tasks[0];
 for(const palace of ['官禄','命宫','财帛','迁移','交友','福德'])assert(t.palaces.includes(palace),palace);
 assert(p.henosis.decisions.some(d=>d.action==='depth_palaces_added'));
});
await check('explicit mutagen attached to the wrong natal star is flagged without adding a model reviewer',()=>{
 const b=bundles[2],p=henosisAnswerPacket(b),d=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p});
 d.tasks[0].sections.find(s=>s.kind==='natal').text='命宫巨门旺化忌，迁移天马化权。';
 const issues=checkHenosisDraft(d,b.plan,p).issues;assert(issues.some(i=>i.code==='STAR_MUTAGEN_MISMATCH'&&i.detail.includes('巨门化忌')));assert(issues.some(i=>i.code==='STAR_MUTAGEN_MISMATCH'&&i.detail.includes('天马化权')));
 d.tasks[0].sections.find(s=>s.kind==='natal').text='命宫巨门旺，与文曲化忌同宫。';assert(!checkHenosisDraft(d,b.plan,p).issues.some(i=>i.code==='STAR_MUTAGEN_MISMATCH'));
});
await check('completed prose with unescaped quotation marks is repaired without changing its content or completing truncation',()=>{
 const raw='{"tasks":[{"taskId":"task-1","conclusion":"适合以"专业分析"为方向。","sections":[{"kind":"natal","text":"文曲化忌提示"复核"。\n第二段。","citations":["e1"]}],"comparison":[]}]}';
 const repaired=repairHenosisEnvelope(raw);assert.equal(repaired.tasks[0].conclusion,'适合以"专业分析"为方向。');assert.equal(repaired.tasks[0].sections[0].text,'文曲化忌提示"复核"。\n第二段。');
 assert.equal(repairHenosisEnvelope(raw.slice(0,-9)),undefined);assert.equal(repairHenosisEnvelope('not JSON'),undefined);
});
await check('localized repair preserves all citation pointers and never discards a valid first draft',()=>{
 const b=bundles[0],p=henosisAnswerPacket(b),original=depthAnswerFixture({answerContract:henosisAnswerContract(b.plan,p),investigation:p}),raw=structuredClone(original),id=original.tasks[0].taskId;
 raw.tasks[0].sections[0].citations=Array.from({length:30},(_,index)=>'e'+(index+1));
 const merged=mergeHenosisRepair(original,{tasks:[raw.tasks[0]]},[id]);assert.deepEqual(merged.tasks[0].sections[0].citations,raw.tasks[0].sections[0].citations);
 assert.deepEqual(mergeHenosisRepair(original,{invalid:true},[id]),original);
});
await check('one literal planning repair preserves independent property and future questions',async()=>{
 const [question,tasks]=questions[2],phases=[];const p=await planHenosisQuestion({...base,question,callModel:async(_i,_d,phase)=>{phases.push(phase);return {tasks:phases.length===1?[task(question,['career'])]:tasks};}});assert.deepEqual(phases,['initial_plan','initial_plan_repair']);assert.equal(p.tasks.length,2);assert(p.henosis.decisions.some(d=>d.action==='semantic_plan_repaired'));
});
await check('a five-query proposal is split losslessly rather than discarded by per-item schema limit',async()=>{
 const b=bundles[0],t=b.plan.tasks[0],phases=[];const queries=[2027,2028,2029,2030,2031].map(year=>({scope:'yearly',date:year+'-06-01',palaces:['父母'],relations:true}));
 const p=await reviseHenosisPlan({...base,question:b.plan.question,plan:b.plan,bundle:b,callModel:async(_i,_d,phase)=>{phases.push(phase);return {requests:[{taskId:t.id,reason:'合成补查用于验证五条请求的无损分组与边界处理',evidenceIds:[b.references.find(r=>r.taskIds.includes(t.id)).id],queries}]};}});
 assert.deepEqual(phases,['refine_plan']);assert(!p.henosis.decisions.some(d=>d.reason.startsWith('HENOSIS_REFINE_SCHEMA')));assert(p.henosis.additions.length<=5);
});
await check('full runtime pre-partitions a large candidate set, preserves layered delivery and reuses saved stages',async()=>{
 const saved=new Map(),calls=[],[question,tasks]=questions[0];
 globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).hostname,'mock.example.com');const body=JSON.parse(options.body),i=body.messages[0].content,data=JSON.parse(body.messages.at(-1).content);let value,phase;
  if(i.includes('问题规划器')){phase='initial';value={tasks};}else if(i.includes('一次补充规划器')){phase='refine';value={requests:[]};}else{phase='answer';value=depthAnswerFixture(data);}
  calls.push({phase,inputTokens:estimateTokens(JSON.stringify(body)),outputCap:body.max_tokens});return Response.json({usage:{prompt_tokens:estimateTokens(JSON.stringify(body)),completion_tokens:900},choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});};
 const args={...base,question,now:today+'T04:00:00Z',connection:{provider:'custom',protocol:'openai-chat',model:'synthetic-model',baseUrl:'https://mock.example.com/v1',key:'SYNTHETIC',thinking:'enabled',jsonMode:true,contextWindow:128000},load:async name=>saved.get(name),save:async(name,value)=>{saved.set(name,structuredClone(value));}};
 const r=await runHenosis(args);assert.equal(r.answer.completion,'answered');assert.deepEqual(calls.map(c=>c.phase),['initial','refine','answer','answer','answer','answer','answer']);assert(saved.get('henosis-depth.10.partition_task-1'));assert(r.answer.evidence.length>0);assert(r.answer.steps.some(s=>s.name==='提前分段'));assert(r.answer.henosis.delivery.tasks[0].sections.length>=3);assert.equal(r.answer.henosis.deliveryIssues.length,0);assert(calls.slice(2).every(call=>call.inputTokens<48000));
 const second=await runHenosis(args);assert.equal(second.answer.content,r.answer.content);assert.equal(calls.length,7);metrics.push({runtimeCalls:calls});
});
writeFileSync(out+'/results.json',JSON.stringify({syntheticOnly:true,realModelCalls:0,results,metrics},null,2));console.log(JSON.stringify({results,metrics},null,2));assert.equal(results.filter(r=>!r.pass).length,0);
