import {build} from 'esbuild';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';
const out='.sites-runtime/verification/bprime/budget-faults';mkdirSync(out,{recursive:true});
await build({entryPoints:['lib/structured.ts','lib/workflow-observation.ts','lib/bprime/contracts.ts','lib/bprime/guarded-delivery.ts'],outdir:out,bundle:true,platform:'node',format:'esm',external:['zod'],outExtension:{'.js':'.mjs'}});
const load=n=>import('../'+out+'/'+n+'.mjs');
const {structuredCall}=await load('structured'),{CallLedger}=await load('workflow-observation'),{frameworkDraftSchema,frameworkAuditSchema}=await load('bprime/contracts'),{recoveryChoice}=await load('bprime/guarded-delivery');
const draft=frameworkDraftSchema.parse({decision:{targetId:'career',stance:'conditional',preferredOptionId:'change',conditionIds:[],assumptionIds:['a1']},blocks:[{id:'b1',kind:'condition',conditionIds:[],assumptionIds:['a1'],text:'如果岗位条件匹配，可先比较机会。'}],windowIds:[],references:[]});
const review=pass=>({pass,checks:{facts:'na',boundaries:'pass',references:'na',relevance:pass?'pass':'fail'},issues:pass?[]:[{code:'fixture_reject',blockId:'b1'}]});
const model={provider:'custom',baseUrl:'https://mock.example.com/v1',protocol:'openai-chat',model:'fixture',key:'mock-only',jsonMode:true,thinking:'auto'};
const rows=[],oldInfo=console.info,oldError=console.error;console.info=()=>{};console.error=()=>{};
try{
 for(const [name,replies,expected,outcome] of [
  ['normal',[draft,review(true)],2,'model'],
  ['T1-format-repaired',[{},draft,review(true)],3,'model'],
  ['T1-repaired-T2-rejected-no-fourth',[{},draft,review(false)],3,'rules'],
  ['T1-format-twice',[{},{}],2,'rules'],
  ['T2-format-repaired',[draft,{},review(true)],3,'model'],
  ['T2-format-twice',[draft,{},{}],3,'rules'],
  ['T2-rejected-fresh-isolation',[draft,review(false),review(true)],3,'isolated_model'],
  ['T2-rejected-isolation-rejected',[draft,review(false),review(false)],3,'rules'],
 ]){
  const ledger=new CallLedger('decision_with_timing',3),calls=[];let result='rules';
  globalThis.fetch=async(url,opts)=>{assert.equal(String(url),'https://mock.example.com/v1/chat/completions');const body=JSON.parse(opts.body);calls.push(JSON.parse(body.messages.at(-1).content));assert(calls.length<=3,'Must stop BEFORE the fourth transport request');assert(calls.length<=replies.length);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(replies[calls.length-1])}}]});};
  const call=(audit,data)=>structuredCall({schema:audit?frameworkAuditSchema:frameworkDraftSchema,stage:audit?'audit':'answer',stageId:audit?'T2':'T1',label:'fixture',model,instructions:audit?'独立复核':'组织回答',data,tokens:200,ledger,reserveCalls:audit?0:1,reserveRepair:()=>true,onRepair:()=>{},onActivity:()=>{},requiredFields:audit?{pass:'boolean',checks:'object',issues:'array'}:{decision:'object',blocks:'array'}});
  try{
   const d=await call(false,{question:'我今年适合跳槽吗？'}),a=await call(true,{draft:d,isolated:false});
   if(a.pass&&!a.issues.length)result='model';
   else if(recoveryChoice(d,[],ledger.remaining).action==='independent_review'){
    const isolated=await call(true,{draft:d,isolated:true});if(isolated.pass&&!isolated.issues.length)result='isolated_model';
   }
  }catch(e){assert(['MODEL_OUTPUT_SCHEMA','WORKFLOW_BUDGET_EXHAUSTED'].includes(e.code));}
  assert.equal(calls.length,expected,name);assert.equal(ledger.observation.actualCalls,expected);assert.equal(result,outcome,name);
  if(name==='T1-repaired-T2-rejected-no-fourth')assert(!calls.some(x=>(x.originalTask||x).isolated),'Budget tradeoff, never a missing isolation condition');
  if(name==='T2-rejected-fresh-isolation')assert.equal(calls[2].isolated,true);
  rows.push({case:name,calls:expected,outcome:result,stages:ledger.observation.attempts.map(a=>a.stage)});
 }
}finally{console.info=oldInfo;console.error=oldError;globalThis.fetch=async()=>{throw Error('NO_NETWORK_AFTER_FIXTURE');};}
writeFileSync('.sites-runtime/verification/bprime/call-budget.json',JSON.stringify({cases:rows,productionInferenceCalls:0,scope:'New schemas + real structuredCall + existing ledger; offline branch harness, not production wiring'},null,2));
console.log(`PASS B′-1: ${rows.length} new-schema fault paths, actual structuredCall retries, mixed ceiling=3.`);
