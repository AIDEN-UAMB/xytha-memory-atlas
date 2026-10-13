import {createChartReader,scopeNames,type ChartData} from './chart';
import {buildDialogueContext,dialogueRecord} from './dialogue';
import {retrieveEvidence,type Answer,type Evidence,type LlmArgs} from './workflow';
import {analyzeTiming,timingModelContext,timingRecord,timingAnalysisIssues,type TimingAnalysis} from './timing';
import {analysisPlanContext,analysisInstructions,type AnalysisPlan,type AnalysisTask} from './analysis-plan';
import {CallLedger} from './workflow-observation';
import {classifyQuestionType} from './question-type';
import {runFramework} from './bprime/runtime';
import {WorkflowContinuation,phaseContext} from './workflow-phase';
import {decadeComparisonPlan} from './decade-comparison';
import {refineQuestionPlan} from './semantic-routing';

type ScheduledArgs=Omit<LlmArgs,'connection'> & {connection?:LlmArgs['connection'];analysisPlan:AnalysisPlan};
const uniqueEvidence=(items:Evidence[])=>[...new Map(items.map(e=>[e.id,e])).values()];

function recordCoverage(task:AnalysisTask,evidence:Evidence[]){
 const missing=task.queries.flatMap(q=>q.palaces.filter(p=>!evidence.some(e=>e.scope===q.scope&&(q.scope==='natal'||e.date===q.date)&&e.scopePalace===p)).map(p=>q.scope+':'+q.date+':'+p));
 return {status:missing.length?'partial' as const:task.coverage?.status||'complete' as const,precision:task.precision,periods:task.queries.length,reason:missing.length?'指定宫位资料不完整':task.coverage?.reason||'已按计划完成所有宫位与层级查询',...(missing.length?{missing}:{})};
}

/** One task graph, shared chart cache and one answer call; task count never multiplies model calls. */
export async function runAnalysisPlan(args:ScheduledArgs):Promise<Answer>{
 let plan=args.analysisPlan;
 const route=classifyQuestionType(args.question,buildDialogueContext(args.question,args.history));
 const ledger=new CallLedger('analysis',route.questionType==='decision_with_timing'?3:route.questionType==='timing'?6:7,args.requestId,plan.policyVersion+'/bprime.2/helpful.1'+(args.adaptiveContext?'/adaptive.1':''),plan.tasks.length>1?'decomposed_question':'classified_question');
 args.observer?.route(route,'general');args.observer?.attach(ledger.observation);
 const steps:Answer['steps']=[];
 const progress=(stage:string,detail:string,done=false)=>{args.onProgress?.({stage,detail,status:done?'done':'running'});if(done)steps.push({name:stage,detail});};
 try{
  if(plan.issues.includes('FOLLOWUP_TASK_UNRESOLVED'))return {content:'你说的这个时间调整，是指上一轮的哪个问题？',mode:'rules',model:null,evidence:[],intent:'确认时间调整所属任务',workflow:'xytha-analysis.1',responseType:'clarification',continuation:{reason:'missing_context',question:'你说的这个时间调整，是指上一轮的哪个问题？'},steps,analysisPlan:plan,observation:ledger.finish('validation')};
  if(args.connection&&plan.issues.includes('UNRESOLVED_SEMANTICS')){
   plan=await refineQuestionPlan(args,plan,ledger);
   if(plan.id!==args.analysisPlan.id){
    const personalContext=args.retrievePersonalContext?await phaseContext('personal:'+plan.id,async()=>await args.retrievePersonalContext!(plan)||null):null;
    args={...args,personalContext:personalContext||undefined};
   }
  }
  progress('拆分问题',`${plan.tasks.length} 个分析任务；分别确定主题、时间角色和精度`,true);
  const reader=createChartReader(args.chart.birth),charts=new Map<string,ChartData>(),all:Evidence[]=[],analyses=new Map<string,TimingAnalysis>();
  const executed:AnalysisTask[]=[],taskContexts:Record<string,unknown>[]=[];
  const retain=(chart:ChartData)=>charts.set(chart.target,chart);
  for(const task of plan.tasks){
   args.signal?.throwIfAborted();
   if(!task.needsChart){executed.push({...task,coverage:task.coverage||{status:'not_applicable',precision:'none',periods:0,reason:'知识或沟通问题无需个人命盘'}});continue;}
   if(task.timingRequest&&!task.timingRequest.issue){
    const request=task.timingRequest;
    progress('调查时间区间',`${task.id} · ${request.start} 至 ${request.end} · ${scopeNames[request.detail]}`);
    const a=await analyzeTiming(args.chart,request,args.signal,(done,total)=>progress('调查时间区间',`${task.id} · 已完成 ${done}/${total} ${request.detail==='yearly'?'年':request.detail==='monthly'?'个区段':'天'}`),reader,retain,args.observer);
    const missing=timingAnalysisIssues(a);
    // A broken tool result must not reach the answer generator as complete coverage.
    if(missing.length)throw new Error('ANALYSIS_COVERAGE_MISMATCH: '+missing.join(','));
    analyses.set(task.id,a);all.push(...a.evidence);
    const timing=timingRecord(a),queries=uniqueQueries(a.evidence.map(e=>({scope:e.scope,date:e.scope==='natal'?args.chart.solarDate:e.date,palaces:[e.scopePalace],relations:false})));
    executed.push({...task,queries,timing,coverage:{status:a.periods.length?'complete':'unavailable',precision:request.detail,periods:a.periods.length,reason:a.coverage?.stopReason||'已覆盖请求区间；精度足以回答本轮问题'}});
    if(plan.tasks.length>1){
     // Full facts enter once through the shared fact registry; this table only binds task and period.
     taskContexts.push({taskId:task.id,request:{start:request.start,end:request.end,detail:request.detail,assumptions:request.assumptions},palaces:a.palaces,method:a.method,comparisonMode:a.comparisonMode||'conditional_comparison',coverage:a.coverage,
      periods:a.periods.map(p=>({id:p.id,start:p.start,end:p.end,observedOn:p.snapshot.date,decade:p.snapshot.decade,supportLayers:p.snapshot.supportLayers,cautionLayers:p.snapshot.cautionLayers})),
      candidates:a.windows.map(w=>({start:w.start,end:w.end,observedOn:w.snapshot.date})),candidateUse:'程序初筛供比较参考，可并列或无明显差异，边界不是事件日期'});
    }
   }else if(task.timingRequest?.issue){executed.push(task);progress('说明查询范围',`${task.id} · ${task.timingRequest.issue}`,true);}
   else{
    progress('查询主题宫位',`${task.id} · ${task.precision==='natal'?'仅本命':scopeNames[task.precision as keyof typeof scopeNames]||task.precision} · ${task.palaces.join('、')}`);
    const evidence=retrieveEvidence(args.chart,task.queries,args.observer,retain,true);
    all.push(...evidence);executed.push({...task,coverage:recordCoverage(task,evidence)});
   }
  }
  plan={...plan,status:'executed',tasks:executed};
  const evidence=uniqueEvidence(all),queries=uniqueQueries(executed.flatMap(t=>t.queries));
  const distinctTiming=[...new Map([...analyses.values()].map(a=>[JSON.stringify([a.request.start,a.request.end,a.request.detail,a.palaces,a.comparisonMode,a.request.plan?.constraints]),a])).values()];
  const single=distinctTiming.length===1?{...distinctTiming[0],request:{...distinctTiming[0].request,goal:args.question}}:undefined;
  progress('完成调查',`${executed.filter(t=>t.coverage?.status==='complete'||t.coverage?.status==='not_applicable').length}/${executed.length} 个任务已完成取数；${evidence.length} 条去重宫位依据`,true);
  const trace={version:1 as const,planId:plan.id,policyVersion:plan.policyVersion,classificationSource:plan.classificationSource,tasks:executed.map(t=>({id:t.id,kind:t.kind,precision:t.precision,source:t.source.origin,coverage:t.coverage,evidenceCount:evidence.filter(e=>t.queries.some(q=>q.scope===e.scope&&(q.scope==='natal'||q.date===e.date)&&q.palaces.includes(e.scopePalace))).length})),queryCount:queries.length,evidenceCount:evidence.length};
  console.info(JSON.stringify({event:'analysis_execution',requestId:args.requestId,planId:plan.id,taskCount:executed.length,queryCount:queries.length,periodCount:executed.reduce((n,t)=>n+(t.coverage?.periods||0),0),complete:executed.every(t=>t.coverage?.status==='complete'||t.coverage?.status==='not_applicable')}));
  if(!args.connection){
   const sections=executed.map(t=>`${t.question}\n${t.coverage?.status==='not_applicable'?'本轮为知识说明问题；连接模型后可生成解释。':t.timingRequest?.issue||[t.timing?`已查询 ${t.timing.start} 至 ${t.timing.end}，${t.coverage?.periods} 个实际区段。`:`已查询 ${t.queries.length} 组${t.precision==='natal'?'本命':'分层'}宫位。`,...evidence.filter(e=>t.queries.some(q=>q.scope===e.scope&&(e.scope==='natal'||q.date===e.date)&&q.palaces.includes(e.scopePalace))).slice(0,3).map(e=>`${e.scopePalace}（${scopeNames[e.scope]}${e.scope==='natal'?'':' '+e.date}）：${e.stars.map(s=>s.name).join('、')}`)].join('\n')}`);
   return {content:sections.join('\n\n'),mode:'rules',model:null,evidence,intent:'按问题分类展示计算资料',workflow:'xytha-analysis.1',responseType:'answer',completion:'limited',steps,queries,analysisPlan:plan,analysisTrace:trace,...(single?{timing:timingRecord(single)}:{}),observation:ledger.finish('rules')};
  }
  const dialogue={...buildDialogueContext(args.question,args.history),goal:args.question,clarificationAllowed:false};
  const ranking=executed.length===1&&executed[0].precision==='decadal'?decadeComparisonPlan(executed[0].question,args.chart):null;
  const context={question:args.question,dialogue,history:args.history,confirmedMemories:args.memories,feedback:args.feedback,
   analysisPlan:analysisPlanContext(plan),analysisInstructions,taskComparisons:taskContexts,
   subquestions:executed.map(t=>t.question),...(single?{timing:timingModelContext(single)}:{}),...(ranking?{decadeComparison:ranking}:{})};
  const runtimeArgs={...args,analysisPlan:plan};
  // The existing registry validates engine identity even for zero-evidence knowledge answers.
  if(!charts.size)retain(args.chart);
  const answer=await runFramework({kind:single?(route.questionType==='decision_with_timing'?'mixed':'timing'):'general',args:runtimeArgs,ledger,evidence,charts:[...charts.values()],analysis:single,context,steps,intent:'按问题分类与时间计划分析',queries});
  return {...answer,...(executed.some(t=>t.coverage?.status==='partial'||t.coverage?.status==='unavailable')?{completion:'limited' as const}:{}),analysisPlan:plan,analysisTrace:{...trace,modelCalls:answer.observation?.actualCalls||0}};
 }catch(error){if(!(error instanceof WorkflowContinuation))ledger.finish(args.signal?.aborted?'cancelled':'failed');throw error;}
}

function uniqueQueries(queries:NonNullable<Answer['queries']> & {relations?:boolean}[]){
 const map=new Map<string,{scope:typeof queries[number]['scope'];date:string;palaces:string[];relations:boolean}>();
 for(const q of queries){const key=q.scope+'|'+q.date+'|'+!!q.relations,old=map.get(key);if(old)old.palaces=[...new Set([...old.palaces,...q.palaces])];else map.set(key,{...q,relations:!!q.relations});}
 return [...map.values()];
}
