import {withContextTelemetry,currentContextCapacity} from '@/lib/context-telemetry';
import {compactSnapshot} from '@/lib/context-snapshot';
import {buildAnalysisPlan} from '@/lib/analysis-plan';
import {runAnalysisPlan} from '@/lib/analysis-runtime';
import {enqueuePalaceMemory} from '@/lib/palace-memory';
import {retrieveChartChatMemory as retrievePalaceMemory} from '@/lib/chat-evidence-bridge';
import {answerChunks} from '@/lib/answer-delivery';
import {createCheckpoint,resumeCheckpoint,PHASE_LIMIT_MS,type ChatCheckpoint} from '@/lib/chat-checkpoint';
import {WorkflowContinuation} from '@/lib/workflow-phase';
import {CHAT_HEARTBEAT_MS,CHAT_SSE_HEADERS,chatFrame} from '@/lib/chat-sse';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {owner,jsonBody,failure,publicError,HttpError} from '@/lib/server';
import {rawDb} from '@/db/raw';
import {createChart,example,todayShanghai} from '@/lib/chart';
import {requestsCurrentDate} from '@/lib/query-dates';
import {hasTimingIntent,resolveTimingRequest} from '@/lib/timing-request';
import {llmAnswer,ruleAnswer,Progress,type Answer} from '@/lib/workflow';
import {timingAnswer} from '@/lib/timing-answer';
import {connectionSchema,Connection} from '@/lib/providers/config';
import {getConnection} from '@/lib/providers/vault';
import {ProviderConnectionError} from '@/lib/providers/client';
import {claimRun,failRun,renewRun,RUN_LIMIT_MS,RUN_LEASE_RENEW_MS,hourlyChatLimit} from '@/lib/chat-runs';
import {DemandObservation,observationEnabled} from '@/lib/demand-observation';
import {persistObservation} from '@/lib/observation-store';
import {buildDialogueContext} from '@/lib/dialogue';
import {classifyQuestionType} from '@/lib/question-type';
import {loadChartChatHistory} from '@/lib/chart-chat-history';
const schema=z.object({requestId:z.string().uuid().optional(),profileId:z.string().max(80),profileRevision:z.number().int().positive().optional(),question:z.string().trim().min(1).max(3000),target:z.string(),scope:z.enum(['natal','decadal','yearly','monthly','daily']),selected:z.number().int().min(0).max(11),connection:connectionSchema.optional(),connectionId:z.string().max(100).optional(),reviewConnectionId:z.string().max(100).optional(),key:z.string().max(2000).optional(),model:z.string().max(160).optional()});
export async function POST(req:Request){try{
 const uid=owner(req),input=await jsonBody(req),b=schema.parse(input),db=rawDb();
 const historyCutoff=Date.now();
 // Transport-only option, deliberately excluded from the request fingerprint and prompts.
 const recoveryOnly=z.boolean().optional().parse(input.recoveryOnly)===true;
 const p=b.profileId==='demo'?null:await db.prepare('SELECT birth,revision FROM profiles WHERE id=? AND owner=?').bind(b.profileId,uid).first<{birth:string;revision:number}>();
 if(b.profileId!=='demo'&&!p)throw new HttpError('未找到该命盘，请重新选择。',404);
 const profileRevision=p?.revision||1;if(b.profileRevision!==undefined&&b.profileRevision!==profileRevision)throw new HttpError('命例资料已更新，请重新同步后再提问。',409,'PROFILE_CHANGED');
 // Relative questions are anchored by the server clock before any model or horoscope call.
 let chart=createChart(p?JSON.parse(p.birth):example,requestsCurrentDate(b.question)||hasTimingIntent(b.question)?todayShanghai():b.target);const e=env as unknown as Record<string,string>;
 let connection:Connection|undefined=b.connection;if(b.connectionId)connection=await getConnection(uid,b.connectionId);
 if(!connection&&(b.key||e.OPENAI_API_KEY))connection=connectionSchema.parse({provider:'openai',baseUrl:'https://api.openai.com/v1',protocol:'openai-responses',key:b.key||e.OPENAI_API_KEY,model:b.model||e.OPENAI_MODEL||'gpt-6-astra',jsonMode:true});
 const frameworkV1=e.XYTHA_FRAMEWORK_V1==='true';
 const adaptiveContext=e.XYTHA_ADAPTIVE_CONTEXT==='true';
 // Capability negotiation: existing APKs do not understand the continuation terminal event.
 const continuationProtocol=z.literal(1).optional().parse(input.continuationProtocol);
 const resumable=frameworkV1&&e.XYTHA_RESUMABLE_CHAT==='true'&&continuationProtocol===1;
 const reviewer=b.reviewConnectionId?await getConnection(uid,b.reviewConnectionId):undefined;
 const requestId=b.requestId||crypto.randomUUID();
 const frameworkIdentity={owner:uid,profileId:b.profileId,profileRevision,requestId};
 let checkpoint:ChatCheckpoint|null=null,phaseYielded=false;
 const replay=await claimRun(uid,requestId,b.profileId,{...b,profileSnapshot:p?.birth,requestId:undefined},hourlyChatLimit(e.XYTHA_CHAT_HOURLY_LIMIT),recoveryOnly,resumable?async()=>{checkpoint=await resumeCheckpoint(uid,requestId);return !!checkpoint;}:undefined);
 if(resumable&&!replay&&!checkpoint)try{checkpoint=await createCheckpoint(uid,requestId);}catch(error){await failRun(uid,requestId);throw error;}
 const observer=!replay&&observationEnabled(e)?new DemandObservation({owner:uid,requestId,profileId:b.profileId,profileRevision,hasConnection:!!connection,cohort:b.profileId==='demo'?'test':'production'}):undefined;
 let delivery:'saved'|'emitted'|'failed'|'cancelled'='failed',observedFailure:'failed'|'cancelled'|'validation'|undefined,observationFlushed=false;
 const flushObservation=async()=>{if(!observer||observationFlushed||phaseYielded)return;observationFlushed=true;await persistObservation(db,observer.finish(delivery,observedFailure));};
 const abort=new AbortController();const cancel=()=>abort.abort();req.signal.addEventListener('abort',cancel,{once:true});if(req.signal.aborted)cancel();
 const execute=async(onProgress?:(p:Progress)=>void)=>{
  const timer=setTimeout(()=>abort.abort(new ProviderConnectionError(checkpoint?'模型单阶段等待超时，问题已保留；未自动重发该模型请求。':'本次对话达到处理时限，问题已保留。',checkpoint?'WORKFLOW_PHASE_TIMEOUT':'WORKFLOW_TOTAL_TIMEOUT')),checkpoint?Math.max(1,Math.min(PHASE_LIMIT_MS,RUN_LIMIT_MS-(Date.now()-checkpoint.state.startedAt))):RUN_LIMIT_MS);
  const lease=!replay?setInterval(()=>{void renewRun(uid,requestId).then(alive=>{if(!alive)abort.abort(new HttpError('本轮连接已失效，问题已保留。',409,'REQUEST_ENDED'));}).catch(error=>console.warn(JSON.stringify({event:'chat_run_lease_failed',requestId,code:publicError(error).code})));},RUN_LEASE_RENEW_MS):undefined;
  try{
   if(replay){const times=await db.prepare('SELECT id,created_at FROM messages WHERE owner=? AND id IN (?,?)').bind(uid,replay.id,replay.userId).all<{id:string;created_at:string}>();return {...replay,createdAt:Date.parse(times.results.find(m=>m.id===replay.id)?.created_at||''),userCreatedAt:Date.parse(times.results.find(m=>m.id===replay.userId)?.created_at||'')};}
   if(p){const current=await db.prepare('SELECT birth FROM profiles WHERE id=? AND owner=?').bind(b.profileId,uid).first<{birth:string}>();if(current?.birth!==p.birth)throw new HttpError('命例资料已改变，请重新同步后提问。',409,'PROFILE_CHANGED');}
   const snapshot=checkpoint?.state.snapshot;
   if(snapshot?.chartTarget&&snapshot.chartTarget!==chart.target)chart=createChart(chart.birth,snapshot.chartTarget);
   const [hh,mm]=snapshot?[{results:snapshot.history},{results:snapshot.memories}]:await Promise.all([
    loadChartChatHistory({owner:uid,profileId:b.profileId,profileRevision,cutoff:historyCutoff,limit:32,consumer:'nous'}).then(results=>({results})),
    db.prepare('SELECT content FROM memories WHERE owner=? AND profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').bind(uid,b.profileId).all<{content:string}>()
   ]);
   const referenceToday=snapshot?.referenceToday||todayShanghai();
   const timeRoute=classifyQuestionType(b.question,buildDialogueContext(b.question,hh.results));
   const analysisPlan=snapshot?snapshot.analysisPlan:frameworkV1&&e.XYTHA_ANALYSIS_PLAN!=='false'?await buildAnalysisPlan({question:b.question,history:hh.results,chart,today:referenceToday,profileId:b.profileId,profileRevision}):undefined;
   const timingRequest=snapshot?snapshot.timingRequest:analysisPlan?(analysisPlan.tasks.length===1?analysisPlan.tasks[0].timingRequest||null:null):(timeRoute.questionType==='general'?null:resolveTimingRequest(b.question,hh.results,referenceToday,chart.solarDate,true,chart));
   let answer:Answer;
   if(connection){
    const ff=snapshot?{results:snapshot.feedback}:await db.prepare('SELECT content,feedback FROM messages WHERE owner=? AND profile_id=? AND profile_revision=? AND feedback<>0 ORDER BY created_at DESC LIMIT 6').bind(uid,b.profileId,profileRevision).all<{content:string;feedback:number}>();
    const prepared=snapshot||compactSnapshot({history:hh.results,memories:mm.results,feedback:ff.results,chartTarget:chart.target,referenceToday,timingRequest,analysisPlan,personalContext:await retrievePalaceMemory(uid,b.profileId,chart,b.question,referenceToday,buildDialogueContext(b.question,hh.results).goal,timingRequest||undefined,analysisPlan).catch(()=>{console.warn(JSON.stringify({event:'personal_memory_unavailable'}));return undefined;})});
    const frozen=checkpoint?await checkpoint.snapshot(prepared):prepared;
    const generate=()=>llmAnswer({question:b.question,chart,today:frozen.referenceToday,timingRequest:frozen.timingRequest,analysisPlan:frozen.analysisPlan,retrievePersonalContext:plan=>retrievePalaceMemory(uid,b.profileId,chart,b.question,referenceToday,b.question,undefined,plan).catch(()=>{console.warn(JSON.stringify({event:'personal_memory_unavailable'}));return undefined;}),scope:b.scope,selected:b.selected,memories:frozen.memories.map((m:{content:string})=>m.content),history:frozen.history,feedback:frozen.feedback,personalContext:frozen.personalContext,connection:connection!,reviewConnection:reviewer,signal:abort.signal,onProgress,requestId,observer,frameworkV1,adaptiveContext,directOutput:e.XYTHA_DIRECT_OUTPUT==='true',frameworkIdentity,questionTypeV2:e.XYTHA_QUESTION_TYPE_V2!=='false',mixedAnswerV1:e.XYTHA_MIXED_ANSWER_V1!=='false'});
    const decorateCapacity=(capacity:NonNullable<ReturnType<typeof currentContextCapacity>>)=>({...capacity,...(checkpoint?{checkpoint:{bytes:new TextEncoder().encode(JSON.stringify(checkpoint.state)).byteLength,limitBytes:4000000}}:{})});
    answer=await withContextTelemetry(capacity=>onProgress?.({stage:'上下文容量',detail:`${capacity.model} · 本次调用输入约 ${capacity.inputTokensEstimate.toLocaleString('zh-CN')} token`,status:capacity.state==='completed'?'done':'running',contextCapacity:decorateCapacity(capacity)}),async()=>{const result=checkpoint?await checkpoint.run(generate):await generate(),capacity=currentContextCapacity();return {...result,contextCapacity:capacity?decorateCapacity(capacity):undefined};});
   }else if(analysisPlan){
    answer=await runAnalysisPlan({question:b.question,chart,today:referenceToday,analysisPlan,scope:b.scope,selected:b.selected,history:hh.results,memories:mm.results.map((m:{content:string})=>m.content),feedback:[],signal:abort.signal,onProgress,requestId,observer,frameworkV1,adaptiveContext,frameworkIdentity});
   }else{
    const timed=await timingAnswer({question:b.question,chart,today:referenceToday,timingRequest,history:hh.results,signal:abort.signal,onProgress,requestId,observer,frameworkV1,frameworkIdentity,questionTypeV2:e.XYTHA_QUESTION_TYPE_V2!=='false',mixedAnswerV1:e.XYTHA_MIXED_ANSWER_V1!=='false'});
    if(timed)answer=timed;else{observer?.route(classifyQuestionType(b.question,buildDialogueContext(b.question,hh.results)),'general');answer=ruleAnswer(b.question,chart,b.scope,b.selected,hh.results,mm.results.map((m:{content:string})=>m.content),observer);}
   }
   observer?.answer(answer);
   if(abort.signal.aborted)throw new HttpError('对话已停止，问题已保留。',408);
   // Both rows commit together. Row insertion order breaks timestamp ties;
   // a future-dated answer would be excluded by the next request's cutoff.
   const id=crypto.randomUUID(),userId=crypto.randomUUID(),now=new Date().toISOString(),later=now;
   const meta={...answer,content:undefined,chartDate:chart.target,profileId:b.profileId,profileRevision,requestId};
   // Clearing/deleting a conversation invalidates its runs; an old completion cannot resurrect it.
   const insert='INSERT INTO messages(id,owner,profile_id,profile_revision,role,content,meta,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_runs WHERE owner=? AND id=? AND status=?)';
   const result=await db.batch([
    db.prepare(insert).bind(userId,uid,b.profileId,profileRevision,'user',b.question,'{}',now,uid,requestId,'running'),
    db.prepare(insert).bind(id,uid,b.profileId,profileRevision,'assistant',answer.content,JSON.stringify(meta),later,uid,requestId,'running'),
    db.prepare("UPDATE chat_runs SET status='completed',message_id=?,user_id=? WHERE owner=? AND id=? AND status='running'").bind(id,userId,uid,requestId)
   ]);
   if(!result[2].meta.changes)throw new HttpError('该对话已清空或失效，未保存旧回答。',410);
   delivery='saved';
   if(connection)await enqueuePalaceMemory(uid,b.profileId,id).catch(()=>console.warn(JSON.stringify({event:'memory_enqueue_deferred'})));
   if(checkpoint)await checkpoint.clear().catch(()=>console.warn(JSON.stringify({event:'checkpoint_cleanup_deferred',requestId})));
   return {...answer,id,userId,requestId,profileId:b.profileId,profileRevision,createdAt:Date.parse(later),userCreatedAt:Date.parse(now)};
  }catch(error){
   if(error instanceof WorkflowContinuation){phaseYielded=true;throw error;}
   observedFailure=abort.signal.aborted&&!['WORKFLOW_TOTAL_TIMEOUT','WORKFLOW_PHASE_TIMEOUT'].includes(abort.signal.reason?.code)?'cancelled':error instanceof HttpError&&[400,404,409,410,422,429].includes(error.status)?'validation':'failed';
   delivery=observedFailure==='cancelled'?'cancelled':'failed';
   if(!replay){await failRun(uid,requestId);if(checkpoint)await checkpoint.clear().catch(()=>{});}console.error(JSON.stringify({event:'chat_failed',requestId,code:publicError(error).code}));throw error;
  }
  finally{clearTimeout(timer);if(lease)clearInterval(lease);req.signal.removeEventListener('abort',cancel);}
 };
 if(!req.headers.get('accept')?.includes('text/event-stream')){
  try{return Response.json(await execute(),{headers:{'Cache-Control':'no-store'}});}catch(error){if(error instanceof WorkflowContinuation)return Response.json({requestId,continuation:true,completedCalls:error.completedCalls},{status:202,headers:{'Cache-Control':'no-store'}});throw error;}finally{await flushObservation();}
 }
 let open=true,terminalEmitted=false;
 const stream=new ReadableStream({start(controller){
  const emit=(event:string,data:unknown)=>{if(open)try{controller.enqueue(chatFrame(event,data));}catch{open=false;abort.abort();}};
  // Flush before the first DB/history/model await, not after generation. No draft is exposed.
  emit('heartbeat',{requestId});
  emit('progress',{stage:replay?'取回回答':'请求已接收',detail:replay?'正在取回已保存的回答，不重新调用模型':'正在读取命盘与对话条件',status:'running'});
  console.info(JSON.stringify({event:'chat_stream_open',requestId,replay:!!replay}));
  const heartbeat=setInterval(()=>emit('heartbeat',{requestId}),CHAT_HEARTBEAT_MS);
  void execute(p=>emit('progress',p)).then(a=>{
   if(!open||abort.signal.aborted){delivery='cancelled';observedFailure='cancelled';return;}
   emit('progress',{stage:'呈现回答',detail:a.responseType==='clarification'?'正在提出下一步需要确认的问题':a.mode==='llm'?(a.verification==='direct'?'生成完成，正在分段呈现回答':'核对完成，正在分段呈现回答'):a.decision?'正在呈现条件比较与分层依据':a.evidence.length?'正在呈现排盘事实':'正在回应当前问题',status:'running'});
   emit('answer_start',{id:a.id,userId:a.userId,requestId,profileId:b.profileId,profileRevision,contentLength:a.content.length,responseType:a.responseType||'answer'});
   answerChunks(a.content).forEach((text,seq)=>emit('answer_delta',{id:a.id,seq,text}));
   emit('result',a);
   terminalEmitted=true;
   delivery=open?'emitted':'cancelled';if(!open)observedFailure='cancelled';
  }).catch(error=>{if(error instanceof WorkflowContinuation)emit('continuation',{requestId,completedCalls:error.completedCalls,stage:'已保存阶段',detail:'已完成步骤已保存，继续后续分析，不重做已完成调用'});else emit('error',{...publicError(error),requestId});terminalEmitted=true;}).finally(async()=>{clearInterval(heartbeat);await flushObservation();if(open){open=false;controller.close();}});
 },cancel(){open=false;if(!terminalEmitted)abort.abort();}});
 return new Response(stream,{headers:CHAT_SSE_HEADERS});
}catch(error){return failure(error);}}
