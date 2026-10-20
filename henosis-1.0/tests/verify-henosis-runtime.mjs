import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {depthAnswerFixture} from './fixtures/henosis-depth-answer.mjs';
import {connection as fixtureConnection} from './fixtures/bprime-runtime-provider.mjs';

// Synthetic observations deliberately exercise context pressure. Planning/evidence
// fixtures are stubs; runtime, provider serialization, context telemetry and format
// validation are production code. Every outbound provider request is intercepted.
const out='.sites-runtime/verification/henosis-runtime';mkdirSync(out,{recursive:true});
globalThis.__henosisRuntimeFixture={};globalThis.__bindings={};
await build({entryPoints:['lib/henosis-runtime.ts','lib/context-capacity.ts'],outdir:out+'/bundles',bundle:true,platform:'node',format:'esm',external:['zod'],outExtension:{'.js':'.mjs'},plugins:[{name:'isolated-fixtures',setup(b){
 b.onResolve({filter:/^\.\/henosis-(plan|evidence)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='env'?'export const env=globalThis.__bindings;':args.path.endsWith('henosis-plan')?
  'export async function planHenosisQuestion(){globalThis.__henosisRuntimeFixture.planCalls++;return structuredClone(globalThis.__henosisRuntimeFixture.bundle.plan);} export async function reviseHenosisPlan(){throw Error("Unexpected refinement in compression-only fixture");}':
  'export async function collectHenosisEvidence(input){globalThis.__henosisRuntimeFixture.evidenceCalls++;return {...structuredClone(globalThis.__henosisRuntimeFixture.bundle),plan:structuredClone(input.plan)};}'}));
}}]});
const load=n=>import(pathToFileURL(resolve(out+'/bundles/'+n+'.mjs')).href);
const {runHenosis}=await load('henosis-runtime'),{estimateTokens}=await load('context-capacity');
const settings={historyDecades:2,maxSupplementRounds:0,thinking:'enabled'},today='2026-09-10',profileId='synthetic-runtime',palaces=['官禄','命宫','福德'];
const plan={version:1,id:'henosis-plan:synthetic-compression',policyVersion:'analysis-plan.1/xytha-henosis.1',registryVersion:'question-domains.1',question:'2027至2028年逐月事业比较（合成回归）',referenceDate:today,chartVersion:'synthetic-chart-only',profileId,profileRevision:1,tasks:[{
 id:'task-1',question:'2027至2028年逐月事业比较（合成回归）',source:{text:'2027至2028年逐月事业比较（合成回归）',start:0,end:24,origin:'current'},domains:['career'],palaces,corePalaces:['官禄','命宫'],kind:'future_timing',precision:'monthly',needsChart:true,needsCurrentEnvironment:true,timeDirection:'future',reasonCodes:[],assumptions:[],queries:[],
 timingRequest:{goal:'合成事业回归',start:'2027-01-01',end:'2028-12-31',today,detail:'monthly',task:'career',assumptions:[]},coverage:{status:'complete',precision:'monthly',periods:24,reason:'Synthetic observations supplied by the fixture'},
 }],issues:[],assumptions:[],status:'executed',classificationSource:'semantic',henosis:{version:'xytha-henosis.1',revision:0,settings,decisions:[],additions:[],perspective:'present_retrospective',asOf:today}};
const observations=Array.from({length:24},(_,i)=>palaces.map((palace,p)=>{
 const year=2027+Math.floor(i/12),month=String(i%12+1).padStart(2,'0'),date=`${year}-${month}-01`,end=`${year}-${month}-28`,id=`synthetic-observation-${i}-${p}`;
 return {id,taskId:'task-1',role:'candidate',scope:'monthly',date,start:date,end,palace,natalPalace:palace,palaceIndex:p,parentDecade:'synthetic-D1',temporalStatus:'projection',stars:[{name:'合成测试星曜标记'.repeat(40)+i+'-'+p,brightness:null}],transformations:[],evidenceIds:['synthetic-ref-'+i+'-'+p]};
})).flat();
for(const year of [2022,2024])observations.push({id:'synthetic-prior-'+year,taskId:'task-1',role:'retrospective',scope:'decadal',date:year+'-07-01',start:year+'-07-01',end:year+'-12-31',palace:'官禄',natalPalace:'官禄',palaceIndex:0,parentDecade:'synthetic-D0',temporalStatus:'past',stars:[],transformations:[],evidenceIds:['synthetic-prior-ref-'+year]});
for(const [p,palace] of palaces.entries())observations.push({id:'synthetic-natal-'+p,taskId:'task-1',role:'natal',scope:'natal',date:today,palace,natalPalace:palace,palaceIndex:p,temporalStatus:'timeless',stars:[{name:'合成固定星曜',brightness:null}],transformations:[],evidenceIds:['synthetic-natal-ref-'+p]});
const hypotheses=[{id:'synthetic-h1',taskId:'task-1',dimension:'合成测试维度',claim:'测试假设必须保留；这不是用户事实。',status:'interpretation_hypothesis',evidenceIds:[observations[0].evidenceIds[0]],ruleIds:['synthetic-rule1'],alternatives:['此处只验证传递，不验证命理判断'],asOf:today}];
const basis={environments:[{taskId:'task-1',referenceDate:today,chronologicalAge:27,nominalAge:28,decade:{label:'合成第三大限'}}],natalRegistry:[{id:'synthetic-natal',palace:'官禄',stars:['合成星曜']}],ruleVersion:'synthetic-rules.1',rules:[{id:'synthetic-rule1',status:'test_only'}],hypotheses,strings:['合成引用词典'],periods:[{id:'synthetic-period',start:'2027-01-01',end:'2027-01-28'}],encodingGuide:'Synthetic compact vocabulary used only for this regression.',semantics:{projection:'尚未发生的推演',history:'前史盘面不是经历'},perspective:'present_retrospective',asOf:today};
const bundle={version:1,chartVersion:plan.chartVersion,referenceDate:today,plan,observations,hypotheses,evidence:[],references:observations.flatMap(o=>o.evidenceIds.map(id=>({id,scope:o.scope,date:o.date,palace:o.palace,taskIds:[o.taskId]}))),coverage:[{taskId:'task-1',status:'complete',reason:'Synthetic comparison data',missing:[]}],issues:[],executedQueries:observations.map(o=>({taskId:o.taskId,query:{scope:o.scope,date:o.date,palaces:[o.palace],relations:true},role:o.role})),context:{...basis,observations,
 // The real collector may provide a substantial source registry. This clearly
 // labelled synthetic payload makes compaction mandatory under the small window.
 sourceRegistry:Array.from({length:100},(_,i)=>({id:'synthetic-source-'+i,detail:'原始来源说明，仅供合成压力测试。'.repeat(20)}))}};
const connection={...fixtureConnection,contextWindow:32768},outputTokens=8192,inputBudget=21955;
const saved=new Map(),calls=[];let interrupt=true;
globalThis.__henosisRuntimeFixture={bundle,planCalls:0,evidenceCalls:0};
const decode=source=>{const result={...source};for(const [key,t] of Object.entries(result.tables||{}))result[key]=t.rows.map(row=>({...Object.fromEntries(t.columns.map((k,i)=>[k,row[i]])),...row[t.columns.length]}));return result;};
globalThis.fetch=async(url,options)=>{
 assert.equal(String(url),'https://mock.example.com/v1/chat/completions');
 const body=JSON.parse(options.body),data=JSON.parse(body.messages.at(-1).content);
 assert(!data.units,'Oversized evidence must not trigger paid lossy compression');
 calls.push(data);
 if(interrupt){interrupt=false;throw new TypeError('synthetic network interruption');}
 return Response.json({usage:{prompt_tokens:400,completion_tokens:300},choices:[{finish_reason:'stop',message:{content:JSON.stringify(depthAnswerFixture(data))}}]});
};
const args={chart:{birth:{}},question:plan.question,history:[],settings,profileId,profileRevision:1,now:today+'T04:00:00Z',connection,
 load:async k=>saved.has(k)?structuredClone(saved.get(k)):undefined,save:async(k,v)=>saved.set(k,structuredClone(v))};
await assert.rejects(runHenosis(args),e=>e.code==='PROVIDER_NETWORK');
assert(saved.has('henosis-depth.10.initial_plan'));assert(saved.has('henosis-depth.10.initial_evidence'));
const result=await runHenosis(args);
assert.equal(result.answer.completion,'answered',JSON.stringify({issues:result.answer.henosis.deliveryIssues,limitations:result.answer.henosis.generationLimitations}));
assert.equal(globalThis.__henosisRuntimeFixture.planCalls,1);assert.equal(globalThis.__henosisRuntimeFixture.evidenceCalls,1);
assert(!calls.some(c=>c.units));
assert.equal(result.answer.henosis.contextRetention.essentialEvidenceRetained,true);
const candidateIds=new Set(calls.flatMap(c=>decode(c.investigation).candidates.map(x=>x.id)));
assert.equal(candidateIds.size,24,'Every monthly candidate must survive partitioning');
const compared=result.answer.henosis.delivery.tasks[0].comparison.flatMap(c=>c.candidateIds);
assert.equal(new Set(compared).size,24);assert.equal(compared.length,24);
const sentFacts=new Set(calls.flatMap(c=>decode(c.investigation).facts.map(f=>f.id)));
assert.equal(sentFacts.size,bundle.references.length,'No original fact omitted across parts');
const count=calls.length,replay=await runHenosis(args);assert.equal(calls.length,count);assert.equal(replay.answer.content,result.answer.content);
assert.deepEqual(replay.answer.henosis.usage,result.answer.henosis.usage);
writeFileSync(out+'/results.json',JSON.stringify({syntheticOnly:true,realProviderCalls:0,passed:10,calls:count,candidates:24,facts:sentFacts.size,paidCompressionCalls:0,usage:result.answer.henosis.usage},null,2));
console.log('PASS 10 Henosis context pressure, lossless partition and recovery checks; zero real provider calls');
