import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {depthAnswerFixture} from './fixtures/henosis-depth-answer.mjs';

// Production runtime, transport, JSON parsing, telemetry and attempt journal.
// Only deterministic chart/plan fixtures and every outbound fetch are synthetic.
const out='.sites-runtime/verification/henosis-generation';mkdirSync(out,{recursive:true});
globalThis.__henosisGenerationFixture={};
await build({stdin:{contents:"export * from './lib/henosis-generation'; export * from './lib/henosis-runtime'; export * from './lib/context-telemetry'; export * from './lib/henosis-context'; export * from './lib/henosis-answer'; export * from './lib/providers/client';",resolveDir:process.cwd(),loader:'ts'},outfile:out+'/bundle.mjs',bundle:true,platform:'node',format:'esm',external:['zod'],plugins:[{name:'synthetic-chart-and-planner',setup(b){
 b.onResolve({filter:/^\.\/henosis-(plan|evidence)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='env'?'export const env={};':args.path.endsWith('henosis-plan')?
  'export async function planHenosisQuestion(input){globalThis.__henosisGenerationFixture.plans++;await input.callModel("initial fixture",{kind:"initial"},"initial_plan");return structuredClone(globalThis.__henosisGenerationFixture.bundle.plan);} export async function reviseHenosisPlan(input){await input.callModel("refine fixture",{kind:"refine"},"refine_plan");return structuredClone(input.plan);}':
  'export async function collectHenosisEvidence(input){globalThis.__henosisGenerationFixture.evidence++;return {...structuredClone(globalThis.__henosisGenerationFixture.bundle),plan:structuredClone(input.plan)};}'}));
}}]});
const {generateHenosisStage,henosisGenerationBudget,runHenosis,withContextTelemetry,providerRequest,henosisAnswerPacket,henosisAnswerContract,renderHenosisDraft}=await import(pathToFileURL(resolve(out+'/bundle.mjs')).href);
const connection={provider:'bigmodel',baseUrl:'https://open.bigmodel.cn/api/paas/v4',protocol:'openai-chat',model:'glm-5.2',key:'SYNTHETIC_KEY_NEVER_SEND',thinking:'enabled',jsonMode:true};
const results=[],wire=[];let responder;
globalThis.fetch=async(url,options)=>{
 assert.equal(new URL(url).hostname,'open.bigmodel.cn','Every fetch is intercepted; no real provider calls');
 const body=JSON.parse(options.body);wire.push(body);return responder(body,options);
};
function sse(text,finishReason='stop',usage={prompt_tokens:100,completion_tokens:200}){
 const frames=[{choices:[{index:0,delta:{reasoning_content:'PRIVATE_HIDDEN_REASONING'}}]}, {choices:[{index:0,delta:{content:text}}]}, {usage,choices:[{index:0,delta:{},finish_reason:finishReason}]}];
 const bytes=new TextEncoder().encode(frames.map(f=>'data: '+JSON.stringify(f)+'\n\n').join('')+'data: [DONE]\n\n');
 return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=13)controller.enqueue(bytes.slice(i,i+13));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}
function largeReasoningSse(text,parts=12,size=220000){
 const frames=Array.from({length:parts},()=>({choices:[{index:0,delta:{reasoning_content:'思'.repeat(size)}}]}));
 frames.push({choices:[{index:0,delta:{content:text}}]},{usage:{prompt_tokens:100,completion_tokens:200},choices:[{index:0,delta:{},finish_reason:'stop'}]});
 const bytes=new TextEncoder().encode(frames.map(f=>'data: '+JSON.stringify(f)+'\n\n').join('')+'data: [DONE]\n\n');
 return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=32768)controller.enqueue(bytes.slice(i,i+32768));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}
function state(){const saved=new Map();return {saved,load:async name=>saved.has(name)?structuredClone(saved.get(name)):undefined,save:async(name,value)=>{saved.set(name,structuredClone(value));}};}
function generation(s,phase='initial_plan',extra={}){return {connection,instructions:'仅输出合成测试JSON。',data:{synthetic:true},phase,json:phase!=='answer',cacheKey:'model_'+phase+'_synthetic',...s,...extra};}
async function check(name,fn){wire.length=0;try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.message,stack:error.stack});console.error('FAIL '+name+': '+error.message);}}

await check('real chunked UTF-8 SSE length retries once at 8192 then 16384 with direct recovery and updating telemetry',async()=>{
 const s=state(),telemetry=[];responder=()=>wire.length===1?sse('{"value":"半', 'length',{prompt_tokens:321,completion_tokens:8192}):sse('{"value":"命宫"}');
 const result=await withContextTelemetry(c=>telemetry.push(c),()=>generateHenosisStage(generation(s)));
 assert.deepEqual(result.value,{value:'命宫'});assert.deepEqual(wire.map(b=>b.max_tokens),[8192,16384]);
 assert.equal(wire[0].thinking.type,'disabled');assert.equal(wire[0].reasoning_effort,undefined);assert.equal(wire[1].thinking.type,'disabled');assert.equal(connection.thinking,'enabled');
 assert.deepEqual(telemetry.filter(c=>c.state==='prepared').map(c=>c.reservedOutputTokens),[8192,16384]);
 assert.equal(result.attempts[0].finishReason,'length');assert.deepEqual(result.attempts[0].tokenUsage,{inputTokens:321,outputTokens:8192});
 assert.equal(result.attempts[1].status,'completed');
 assert(!JSON.stringify([...s.saved.values()]).includes('PRIVATE_HIDDEN_REASONING'));assert(!JSON.stringify([...s.saved.values()]).includes(connection.key));
});
await check('individual task hits a smaller first ceiling then recovers directly with all evidence unchanged',async()=>{
 const data={evidence:['natal','history','current','all future candidates']};responder=()=>wire.length===1?sse('partial','length'):sse('{"ok":true}');
 const result=await generateHenosisStage(generation(state(),'answer_task_task-1',{data}));
 assert.deepEqual(wire.map(b=>b.max_tokens),[8192,32768]);assert.equal(wire[0].thinking.type,'enabled');assert.equal(wire[1].thinking.type,'disabled');assert.deepEqual(result.value,{ok:true});
 assert.deepEqual(wire[0].messages,wire[1].messages);
});
await check('refinement and answer use 16384 then 32768, with complete structured or direct output',async()=>{
 for(const phase of ['refine_plan','answer']){wire.length=0;responder=()=>wire.length===1?sse('partial','length'):sse(phase==='answer'?'完整合成回答':'{"requests":[]}');
  const result=await generateHenosisStage(generation(state(),phase));assert.deepEqual(wire.map(b=>b.max_tokens),[16384,32768]);
  assert.equal(phase==='answer'?result.value:result.value.requests.length,phase==='answer'?'完整合成回答':0);
 }
});
await check('two length failures persist exhaustion and repeated explicit continue makes zero further provider calls',async()=>{
 const s=state(),args=generation(s,'refine_plan');responder=()=>sse('partial','length');
 await assert.rejects(generateHenosisStage(args),e=>e.code==='HENOSIS_OUTPUT_LIMIT'&&e.phase==='refine_plan');assert.equal(wire.length,2);
 await assert.rejects(generateHenosisStage(args),e=>e.code==='HENOSIS_OUTPUT_LIMIT');assert.equal(wire.length,2);
 const journal=[...s.saved.values()][0];assert.equal(journal.attempts.length,2);assert(journal.attempts.every(a=>a.status==='failed'&&a.finishReason==='length'));
});
await check('a checkpoint written before sending survives interruption without resetting attempts or inventing usage',async()=>{
 const s=state(),args=generation(s),budget=henosisGenerationBudget(connection,'initial_plan');
 s.saved.set('generation_'+args.cacheKey,{version:1,phase:args.phase,attempts:[{attempt:1,phase:args.phase,status:'started',outputCap:budget.outputCap,inputTokensEstimate:100,windowTokens:budget.windowTokens,marginTokens:budget.marginTokens,thinking:'enabled',finishReason:null,tokenUsage:null,errorCode:null}]});
 responder=()=>sse('partial','length',null);await assert.rejects(generateHenosisStage(args),e=>e.code==='HENOSIS_OUTPUT_LIMIT');assert.equal(wire.length,1);
 const attempts=[...s.saved.values()][0].attempts;assert.equal(attempts.length,2);assert.equal(attempts[0].status,'started');assert.equal(attempts[1].tokenUsage,null);
 await assert.rejects(generateHenosisStage(args),e=>e.code==='HENOSIS_OUTPUT_LIMIT');assert.equal(wire.length,1);
});
await check('context clipping includes input plus reserved output and margin, and no-growth retry stops without another call',async()=>{
 const c={...connection,contextWindow:32768},data={text:'合'.repeat(16800)};responder=()=>wire.length===1?sse('partial','length'):sse('{"ok":true}');
 const result=await generateHenosisStage(generation(state(),'refine_plan',{connection:c,data}));
 assert.equal(result.attempts[0].outputCap,8192);assert(result.attempts[1].outputCap>8192&&result.attempts[1].outputCap<16384);
 for(const a of result.attempts)assert(a.inputTokensEstimate+a.outputCap+a.marginTokens<=a.windowTokens);
 wire.length=0;responder=()=>sse('partial','length');
 await assert.rejects(generateHenosisStage(generation(state(),'answer',{connection:c,data:{text:'合'.repeat(25000)}})),e=>e.code==='HENOSIS_OUTPUT_LIMIT');assert.equal(wire.length,1);
 wire.length=0;await assert.rejects(generateHenosisStage(generation(state(),'answer',{connection:{...connection,contextWindow:1024}})),e=>e.code==='HENOSIS_CONTEXT_BUDGET');assert.equal(wire.length,0);
 assert.equal(henosisGenerationBudget({...connection,baseUrl:'https://custom.example.com'},'answer').windowTokens,32768);
});
await check('refusal, content filter, invalid JSON, network, auth and interrupted streams never automatically retry',async()=>{
 const cases=[['filter',()=>sse('','content_filter'),'PROVIDER_INCOMPLETE'],['json',()=>sse('not JSON'),'PROVIDER_JSON'],['network',()=>{throw new TypeError('fetch failed');},'PROVIDER_NETWORK'],['auth',()=>new Response('',{status:401}),'PROVIDER_AUTH'],['interrupted',()=>new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}}),'PROVIDER_STREAM_INTERRUPTED']];
 for(const [name,respond,code] of cases){wire.length=0;responder=respond;await assert.rejects(generateHenosisStage(generation(state())),e=>name==='json'?/JSON/.test(e.message):e.code===code);assert.equal(wire.length,1,name);}
 wire.length=0;responder=()=>Response.json({stop_reason:'refusal',content:[{type:'text',text:'refused'}]});
 await assert.rejects(generateHenosisStage(generation(state(),'answer',{connection:{...connection,protocol:'anthropic'}})),e=>e.code==='PROVIDER_REFUSAL');assert.equal(wire.length,1);
 wire.length=0;responder=()=>new Response('data: {"choices":[{"delta":{"refusal":"synthetic refusal"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}});
 await assert.rejects(generateHenosisStage(generation(state(),'answer')),e=>e.code==='PROVIDER_REFUSAL');assert.equal(wire.length,1);
});
await check('abort remains terminal while answer timeout recovery is bounded and switches to direct synthesis',async()=>{
 const abort=new AbortController();responder=()=>{abort.abort();throw new DOMException('Aborted','AbortError');};
 await assert.rejects(generateHenosisStage(generation(state(),'answer',{signal:abort.signal})),e=>e.code==='PROVIDER_CANCELLED');assert.equal(wire.length,1);
 wire.length=0;responder=()=>new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'text/event-stream'}});
 await assert.rejects(generateHenosisStage(generation(state(),'answer',{options:{limits:{firstByteMs:50,idleMs:20,totalMs:100}}})),e=>e.code==='PROVIDER_IDLE_TIMEOUT');assert.equal(wire.length,3);
 assert.equal(wire[0].thinking.type,'enabled');assert.equal(wire[1].thinking.type,'disabled');assert.equal(wire[2].thinking.type,'disabled');
});
await check('nonstream Anthropic max_tokens and Responses max_output_tokens retry, refusal and context exhaustion do not',async()=>{
 for(const protocol of ['anthropic','openai-responses','gemini']){wire.length=0;
  responder=()=>Response.json(protocol==='anthropic'?{stop_reason:wire.length===1?'max_tokens':'end_turn',usage:{input_tokens:90,output_tokens:100},content:[{type:'text',text:'complete'}]}:protocol==='openai-responses'?{status:wire.length===1?'incomplete':'completed',incomplete_details:{reason:'max_output_tokens'},output:[{content:[{type:'output_text',text:'complete'}]}]}:{candidates:[{finishReason:wire.length===1?'MAX_TOKENS':'STOP',content:{parts:[{text:'complete'}]}}]});
  assert.equal((await generateHenosisStage(generation(state(),'answer',{connection:{...connection,protocol}}))).value,'complete');assert.equal(wire.length,2);
 }
 wire.length=0;responder=()=>Response.json({stop_reason:'model_context_window_exceeded',content:[{type:'text',text:'partial'}]});
 await assert.rejects(generateHenosisStage(generation(state(),'answer',{connection:{...connection,protocol:'anthropic'}})),e=>e.code==='PROVIDER_INCOMPLETE'&&e.completion.finishReason==='model_context_window_exceeded');assert.equal(wire.length,1);
 wire.length=0;responder=()=>Response.json({status:'failed',output:[{content:[{type:'output_text',text:'partial'}]}]});
 await assert.rejects(generateHenosisStage(generation(state(),'answer',{connection:{...connection,protocol:'openai-responses'}})),e=>e.code==='PROVIDER_INCOMPLETE'&&e.completion.finishReason==='failed');assert.equal(wire.length,1);
});
await check('opt-in effort and completion policy leave existing provider envelopes unchanged',async()=>{
 assert.equal(providerRequest(connection,'JSON',{},4500,{stage:'plan'}).body.reasoning_effort,undefined);
 assert.equal(providerRequest({...connection,thinking:'auto'},'JSON',{},4500,{stage:'answer'}).body.thinking.type,'disabled');
 assert.equal(providerRequest({...connection,model:'glm-5.1'},'JSON',{},4500,{stage:'plan',reasoningEffort:'high'}).body.reasoning_effort,undefined);
 assert.equal(providerRequest({...connection,model:'glm-5.3'},'JSON',{},16384,{stage:'plan',reasoningEffort:'high'}).body.reasoning_effort,'high');
 assert.equal(providerRequest({...connection,thinking:'disabled'},'JSON',{},4500,{stage:'plan',reasoningEffort:'high'}).body.reasoning_effort,undefined);
 responder=()=>sse('{"ok":true}');await generateHenosisStage(generation(state(),'refine_plan',{connection:{...connection,model:'glm-5.3',contextWindow:1000000}}));
 assert.equal(wire[0].model,'glm-5.3');assert.equal(wire[0].thinking.type,'disabled');assert.equal(wire[0].reasoning_effort,undefined);
});

function runtimeFixture({coverage='complete',supplement=true}={}){
 const settings={historyDecades:2,maxSupplementRounds:supplement?1:0,thinking:'enabled'},s=state();
 const plan={version:1,id:'synthetic-plan',policyVersion:'analysis-plan.1/xytha-henosis.1',registryVersion:'question-domains.1',question:'合成事业调查',referenceDate:'2026-09-10',chartVersion:'synthetic',profileId:'synthetic-profile',profileRevision:1,tasks:[{id:'task-1',question:'合成事业调查',source:{text:'合成事业调查',start:0,end:6,origin:'current'},domains:['career'],palaces:['官禄'],corePalaces:['官禄'],kind:'decision',precision:'yearly',needsChart:true,needsCurrentEnvironment:true,timeDirection:'current',reasonCodes:[],assumptions:[],queries:[],coverage:{status:coverage,precision:'yearly',periods:1,reason:'synthetic'}}],issues:[],assumptions:[],status:'executed',classificationSource:'semantic',henosis:{version:'xytha-henosis.1',revision:0,settings,decisions:[],additions:[],perspective:'present_retrospective',asOf:'2026-09-10'}};
 const bundle={version:1,chartVersion:'synthetic',referenceDate:'2026-09-10',plan,observations:[],hypotheses:[],evidence:[],references:[],coverage:[{taskId:'task-1',status:coverage,reason:'synthetic',missing:coverage==='complete'?[]:['synthetic missing interval']}],issues:[],executedQueries:[],context:{synthetic:true}};
 for(const [index,scope] of ['natal','decadal','yearly'].entries()){
  const id=scope+':P0',date=scope==='natal'?'1999-06-27':'2026-09-10',role=scope==='natal'?'natal':'current';
  bundle.references.push({id,scope,date,palace:'官禄',palaceIndex:0,taskIds:['task-1']});bundle.evidence.push({id,index:0,scope,date,scopePalace:'官禄',natalPalace:'官禄',sourceIds:[]});
  bundle.observations.push({id,taskId:'task-1',scope,date,role,palace:'官禄',natalPalace:'官禄',palaceIndex:0,temporalStatus:scope==='natal'?'timeless':'current',stars:[],transformations:[],evidenceIds:[id]});
 }
 globalThis.__henosisGenerationFixture={bundle,plans:0,evidence:0};
 return {s,plan,bundle,input:{chart:{synthetic:true},question:plan.question,history:[],settings,profileId:plan.profileId,profileRevision:1,now:'2026-09-10T12:00:00Z',connection,...s}};
}
await check('current delivery stage artifacts replay with no model work and no attempt journal requirement',async()=>{
 const f=runtimeFixture(),packet=henosisAnswerPacket(f.bundle),draft=depthAnswerFixture({investigation:packet,answerContract:henosisAnswerContract(f.plan,packet)});
 for(const [name,value] of [['initial_plan',f.plan],['initial_evidence',f.bundle],['refined_plan',f.plan],['borrowed_evidence',[]],['final_answer',draft]])f.s.saved.set('henosis-depth.10.'+name,value);
 responder=()=>{throw Error('Cached answer must not call provider');};const result=await runHenosis(f.input);
 assert.equal(result.answer.content,renderHenosisDraft(draft,f.plan,packet).content);assert.equal(wire.length,0);assert.equal(globalThis.__henosisGenerationFixture.plans,0);
});
await check('optional refinement may degrade only after two length failures with complete coverage and labels content/context/completion',async()=>{
 const f=runtimeFixture();let finalContext;
 responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');if(data.kind==='refine')return sse('partial','length');finalContext=data;return sse(JSON.stringify(depthAnswerFixture(data)));};
 const result=await runHenosis(f.input);assert.equal(wire.length,4);assert.equal(result.answer.completion,'answered');assert(result.answer.henosis.generationLimitations.length===1);assert(!finalContext.generationLimitations); // Optional diagnostic does not invalidate fulfilled requirements.
assert(f.s.saved.has('henosis-depth.10.final_answer'));
 assert.equal(result.answer.henosis.modelCalls,4);const before=wire.length;await runHenosis(f.input);assert.equal(wire.length,before);assert.equal(globalThis.__henosisGenerationFixture.plans,1);assert.equal(globalThis.__henosisGenerationFixture.evidence,1);
});
await check('incomplete coverage survives optional-refinement exhaustion and stays explicitly limited',async()=>{
 const f=runtimeFixture({coverage:'partial'});responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');if(data.kind==='refine')return sse('partial','length');return sse(JSON.stringify(depthAnswerFixture(data)));};
 const result=await runHenosis(f.input);assert.equal(result.answer.completion,'limited');assert(f.s.saved.has('henosis-depth.10.refinement_limited'));assert(result.answer.henosis.coverage.some(c=>c.status==='partial'));
});
await check('answer length exhaustion switches to checkpointed delivery parts instead of failing the whole run',async()=>{
 const f=runtimeFixture({supplement:false});responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');if(!data.answerPart&&!data.repairTaskIds)return sse('partial','length');return sse(JSON.stringify(depthAnswerFixture(data)));};
 const result=await runHenosis(f.input);assert.equal(result.answer.completion,'answered');assert(f.s.saved.has('henosis-depth.10.answer_part_task-1_0'));assert(f.s.saved.has('henosis-depth.10.final_answer'));
 const before=wire.length;await runHenosis(f.input);assert.equal(wire.length,before);
});
await check('exhausted delivery parts cannot be labeled a completed answer',async()=>{
 const f=runtimeFixture({supplement:false});responder=body=>JSON.parse(body.messages.at(-1).content).kind==='initial'?sse('{"tasks":[]}'):sse('partial','length');
 const result=await runHenosis(f.input);assert.equal(result.answer.completion,'limited');assert(result.answer.henosis.deliveryIssues.some(i=>i.code==='TASK_MISSING'));assert(!f.s.saved.has('henosis-depth.10.final_answer'));assert(result.answer.content.includes('尚未完成解释'));
});
await check('expired soft run budget skips optional refinement but preserves the core answer budget',async()=>{
 const f=runtimeFixture();f.s.saved.set('henosis-depth.10.run_control',{version:1,startedAt:0,softDeadlineAt:0,maxCalls:32,reservedAnswerCalls:6});
 responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');assert.notEqual(data.kind,'refine');return sse(JSON.stringify(depthAnswerFixture(data)));};
 const result=await runHenosis(f.input);assert.equal(wire.length,2);assert.equal(result.answer.completion,'answered');assert(result.answer.henosis.generationLimitations.length);assert.equal(result.answer.henosis.questionCompletion,'complete');assert.equal(result.answer.henosis.runBudget.startedAt,0);
});
await check('one exhausted task preserves the completed sibling and never invents the missing answer',async()=>{
 const f=runtimeFixture({supplement:false});const second=structuredClone(f.plan.tasks[0]);second.id='task-2';second.question='第二个合成事业问题';f.plan.tasks.push(second);
 f.bundle.coverage.push({...f.bundle.coverage[0],taskId:'task-2'});for(const ref of f.bundle.references)ref.taskIds.push('task-2');f.bundle.observations.push(...f.bundle.observations.map(o=>({...o,id:o.id+'-second',taskId:'task-2'})));
 responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');if(data.answerContract?.tasks.length>1||data.answerTask?.taskId==='task-1')return sse('partial','length');return sse(JSON.stringify(depthAnswerFixture(data)));};
 const result=await runHenosis(f.input);assert.equal(result.answer.completion,'limited');assert.deepEqual(result.answer.henosis.delivery.tasks.map(t=>t.taskId),['task-2']);assert(result.answer.henosis.deliveryIssues.some(i=>i.taskId==='task-1'&&i.code==='TASK_MISSING'));assert(!f.s.saved.has('henosis-depth.10.final_answer'));assert(f.s.saved.has('henosis-depth.10.final_answer_task-2'));
});
await check('length recovery carries direct synthesis to later tasks and across replay without changing user settings',async()=>{
 const f=runtimeFixture({supplement:false}),second={...structuredClone(f.plan.tasks[0]),id:'task-2'};f.plan.tasks.push(second);f.bundle.coverage.push({...f.bundle.coverage[0],taskId:'task-2'});
 for(const ref of f.bundle.references)ref.taskIds.push('task-2');f.bundle.observations.push(...f.bundle.observations.map(o=>({...o,id:o.id+'-second',taskId:'task-2'})));
 let failed=false;responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');if(!failed){failed=true;return sse('partial','length');}if(data.answerTask?.taskId==='task-2')assert.equal(body.thinking.type,'disabled');return sse(JSON.stringify(depthAnswerFixture(data)));};
 const result=await runHenosis(f.input);assert.equal(result.answer.completion,'answered');assert.equal(f.s.saved.get('henosis-depth.10.direct_synthesis'),true);assert.equal(f.input.settings.thinking,'enabled');
 const before=wire.length;await runHenosis(f.input);assert.equal(wire.length,before);
});

await check('a complete but malformed delivery uses one format repair and replay does not regenerate it',async()=>{
 const f=runtimeFixture({supplement:false});responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');return data.repairIssues?sse(JSON.stringify(depthAnswerFixture(data))):sse('INVALID_SYNTHETIC_JSON');};
 const result=await runHenosis(f.input);assert.equal(result.answer.completion,'answered');assert.equal(wire.length,3);assert.equal(result.answer.henosis.generation.filter(a=>a.status==='failed').length,1);
 const before=wire.length;await runHenosis(f.input);assert.equal(wire.length,before);assert(!JSON.stringify([...f.s.saved.values()]).includes('INVALID_SYNTHETIC_JSON'));
});
await check('Henosis may raise only its wire budget while default calls and giant single frames remain bounded',async()=>{
 responder=()=>largeReasoningSse('{"ok":true}');
 await assert.rejects(generateHenosisStage(generation(state())),e=>e.code==='PROVIDER_TOO_LARGE');
 wire.length=0;const result=await generateHenosisStage(generation(state(),'initial_plan',{options:{responseByteLimit:12000000,streamFrameCharacterLimit:1000000}}));assert.deepEqual(result.value,{ok:true});
 wire.length=0;responder=()=>largeReasoningSse('{"ok":true}',1,1100000);
 await assert.rejects(generateHenosisStage(generation(state(),'initial_plan',{options:{responseByteLimit:12000000,streamFrameCharacterLimit:1000000}})),e=>e.code==='PROVIDER_STREAM_FRAME_TOO_LARGE');
});
await check('mechanical repair disables extra thinking without changing the connection setting',async()=>{
 responder=()=>sse('{"ok":true}');await generateHenosisStage(generation(state(),'answer_repair'));
 assert.equal(wire[0].thinking.type,'disabled');assert.equal(connection.thinking,'enabled');assert.equal(wire[0].reasoning_effort,undefined);
});
await check('failed localized repair preserves the first layered draft instead of failing the whole answer',async()=>{
 const f=runtimeFixture({supplement:false});responder=body=>{const data=JSON.parse(body.messages.at(-1).content);if(data.kind==='initial')return sse('{"tasks":[]}');if(data.repairTaskIds)throw new TypeError('fetch failed');const draft=depthAnswerFixture(data);draft.tasks[0].conclusion='第一版结论虽短，但必须保留。';draft.tasks[0].sections.forEach(s=>s.text='第一版分层正文。');return sse(JSON.stringify(draft));};
 const result=await runHenosis(f.input);assert.equal(wire.length,3);assert.equal(result.answer.completion,'limited');assert(result.answer.content.includes('第一版结论虽短，但必须保留'));assert(result.answer.henosis.deliveryWarnings.some(i=>i.code==='DEPTH_INSUFFICIENT'));assert(!result.answer.henosis.deliveryIssues.some(i=>i.code==='DEPTH_INSUFFICIENT'));assert(result.answer.henosis.generationLimitations.some(x=>x.includes('PROVIDER_NETWORK')));
});
await check('two malformed delivery envelopes stop the repair loop and preserve the chart evidence',async()=>{
 const f=runtimeFixture({supplement:false});responder=body=>JSON.parse(body.messages.at(-1).content).kind==='initial'?sse('{"tasks":[]}'):sse('INVALID_SYNTHETIC_JSON');
 const result=await runHenosis(f.input);assert.equal(result.answer.completion,'limited');assert.equal(wire.length,3);assert(result.answer.evidence.length>0);assert(!result.answer.content.includes('INVALID_SYNTHETIC_JSON'));assert(result.answer.henosis.deliveryIssues.length>0);
});
await check('a length retry yields before starting a second provider attempt and resumes its same journal',async()=>{
 const saved=state(),pause=new Error('controlled phase yield');responder=()=>sse('{}','length');
 await assert.rejects(generateHenosisStage(generation(saved,'answer_task_1',{beforeAttempt:()=>{if(wire.length)throw pause;}})),e=>e===pause);
 assert.equal(wire.length,1);responder=()=>sse('{"ok":true}');
 const done=await generateHenosisStage(generation(saved,'answer_task_1'));assert.deepEqual(done.value,{ok:true});
 assert.equal(wire.length,2);assert.equal(done.attempts.length,2);assert.equal(done.attempts[1].thinking,'disabled');assert.equal(done.attempts[1].outputCap,32768);
});
writeFileSync(out+'/results.json',JSON.stringify({syntheticOnly:true,realProviderCalls:0,checks:results},null,2));
assert.equal(results.filter(r=>!r.pass).length,0,'See .sites-runtime/verification/henosis-generation/results.json');
console.log(`PASS ${results.length} Henosis generation recovery checks; zero real provider calls`);
