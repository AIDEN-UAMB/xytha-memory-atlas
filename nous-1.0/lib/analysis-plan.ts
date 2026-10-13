import {createChart,type ChartData,type Scope} from './chart';
import type {HistoryMessage} from './dialogue';
import {analyzeQuestion} from './question-planner';
import {resolveTimingRequest,type TimingRequest} from './timing-request';
import {timingEnvironment,type TimingRecord} from './timing';
import {solarISO,type DatedQuery} from './query-dates';
import {chartVersion,digest} from './palace-memory-facts';
import {temporalNumber} from './temporal-intent';
import {decadeComparisonPlan} from './decade-comparison';
import {splitTimingPeriods} from './timing-periods';

export const ANALYSIS_PLAN_VERSION='analysis-plan.1';
type ClassifiedTask=ReturnType<typeof analyzeQuestion>['tasks'][number];
export type AnalysisTask=ClassifiedTask&{
 timingRequest?:TimingRequest|null;queries:DatedQuery[];
 orientation?:ReturnType<typeof orientTask>;
 timing?:TimingRecord;coverage?:{status:'complete'|'partial'|'unavailable'|'not_applicable';precision:string;periods:number;reason:string;missing?:string[]};
};
export type AnalysisPlan={
 version:1;id:string;parentPlanId?:string;policyVersion:string;registryVersion:string;question:string;referenceDate:string;chartVersion:string;
 profileId?:string;profileRevision?:number;tasks:AnalysisTask[];issues:string[];assumptions:string[];
 status:'planned'|'executed';classificationSource:'rules'|'semantic';
};
export type PlanInput={question:string;history:HistoryMessage[];chart:ChartData;today:string;profileId?:string;profileRevision?:number;classification?:ReturnType<typeof analyzeQuestion>};

/** Orientation is computed before choosing a default range. Interpretations never become user facts. */
function orientTask(chart:ChartData,palaces:string[],withCurrent:boolean){
 const natal=palaces.flatMap(name=>{const p=chart.palaces.find(p=>p.name===name);return p?[{palace:name,index:p.index,stars:[...p.majorStars,...p.minorStars].map(s=>({name:s.name,brightness:s.brightness||null})),transformations:chart.transformationSources.natal.mutations.filter(m=>m.palaceIndex===p.index).map(m=>({id:m.id,star:m.star,value:m.value}))}]:[];});
 if(!withCurrent)return {kind:'computed_orientation' as const,natal};
 const current=timingEnvironment(chart,palaces);
 return {kind:'computed_orientation' as const,natal,current:{referenceDate:current.referenceDate,chronologicalAge:current.chronologicalAge,nominalAge:current.nominalAge,decade:current.decade,layers:current.layers.filter(l=>l.scope!=='natal').map(l=>({scope:l.scope,sourceId:l.sourceId,stemBranch:l.stemBranch,focus:l.focus,hits:l.hits}))}};
}

function queriesForDecades(task:ClassifiedTask,chart:ChartData,today:string){
 const q=task.question,rank=decadeComparisonPlan(q,chart),queries:DatedQuery[]=[{scope:'natal',date:solarISO(chart.solarDate),palaces:task.palaces,relations:true}];
 const ordinal=[...q.matchAll(/第\s*([一二两三四五六七八九十\d]+)\s*(?:个|步|段)?大限/g)].map(m=>temporalNumber(m[1])-1);
 const explicitYears=task.temporalIntent.explicitYears,range=task.temporalIntent.yearRange;
 if(explicitYears.length||range){
  if(range&&(range.endYear<range.startYear||range.startYear<1900||range.endYear>2100))return {queries,issues:['所问大限年份范围无效或超出引擎范围，未擅自截断。']};
  const years=range?Array.from({length:range.endYear-range.startYear+1},(_,i)=>range.startYear+i):explicitYears;
  const issues:string[]=[],seen=new Set<string>(),birth=solarISO(chart.solarDate);
  for(const year of [...new Set(years)]){
   if(year<1900||year>2100){issues.push('所问年份超出引擎可计算日期范围。');continue;}
   const start=birth>`${year}-01-01`?birth:`${year}-01-01`,end=`${year}-12-31`;
   if(start>end){issues.push('所问时期早于命例出生日期。');continue;}
   // A civil year can straddle the true lunar decade boundary. Resolve both
   // segments from the engine instead of silently substituting the current decade.
   for(const period of splitTimingPeriods(date=>createChart(chart.birth,date),start,end)){
    const ageRange=period.chart.transformationSources.decadal.ageRange,key=JSON.stringify(ageRange);
    if(ordinal.length&&!ordinal.some(i=>JSON.stringify(chart.decades[i]?.ageRange)===key)){
     issues.push('所述年份与指定序号大限不一致，请以实际边界区分。');continue;
    }
    if(!seen.has(key)){seen.add(key);queries.push({scope:'decadal',date:period.start,palaces:task.palaces,relations:true});}
   }
  }
  return {queries,issues:[...new Set(issues)]};
 }
 if(rank)return {queries:rank.queries.map(x=>({...x,palaces:task.palaces})),issues:[] as string[]};
 const current=chart.decades.findIndex(d=>chart.age>=d.ageRange[0]&&chart.age<=d.ageRange[1]);
 let indices:number[]=[];
 if(ordinal.length)indices=ordinal;
 else if(/下(?:一)?(?:个|步|段)?大限/.test(q))indices=[current+1];
 else if(/上(?:一)?(?:个|步|段)?大限/.test(q))indices=[current-1];
 else if(/几个大限|各个大限|一生|一辈子/.test(q))indices=chart.decades.map((_,i)=>i);
 else indices=[current];
 const issues:string[]=[];
 for(const index of [...new Set(indices)]){
  const d=chart.decades[index];if(!d){issues.push('所问大限不在当前命例可计算的大限列表中。');continue;}
  const start=Math.max(1900,d.yearRange[0]),end=Math.min(2100,d.yearRange[1]);
  if(start>end){issues.push('所问大限超出引擎可计算日期范围。');continue;}
  const date=index===current?today:`${Math.floor((start+end)/2)}-07-01`;
  if(date<solarISO(chart.solarDate)){issues.push('所问时期早于命例出生日期。');continue;}
  const actual=createChart(chart.birth,date).transformationSources.decadal;
  if(JSON.stringify(actual.ageRange)!==JSON.stringify(d.ageRange)){issues.push('大限观察日期与引擎边界不一致，未采用替代年份。');continue;}
  queries.push({scope:'decadal',date,palaces:task.palaces,relations:true});
 }
 return {queries,issues};
}

export async function buildAnalysisPlan(input:PlanInput):Promise<AnalysisPlan>{
 const classified=input.classification||analyzeQuestion(input.question,input.history,input.chart,input.today),version=await chartVersion(input.chart);
 const tasks:AnalysisTask[]=[],issues=[...classified.issues],assumptions=[...classified.assumptions];
 for(const source of classified.tasks){
  const task:AnalysisTask={...source,queries:[]};
  if(source.reasonCodes.includes('subject_identity_required')||source.reasonCodes.includes('task_limit_requires_bounded_planning')){
   task.needsChart=false;task.coverage={status:'unavailable',precision:source.precision,periods:0,reason:source.reasonCodes.includes('subject_identity_required')?'没有所问对象的独立命盘，不能使用当前命例替代':'超过单轮独立调查任务上限，已保留未执行的问题'};tasks.push(task);continue;
  }
  if(!source.needsChart||source.precision==='none'){task.coverage={status:'not_applicable',precision:'none',periods:0,reason:'知识或沟通问题无需个人命盘'};tasks.push(task);continue;}
  const reference=source.temporalIntent.referenceDate||input.today;
  const current=source.needsCurrentEnvironment&&input.chart.target!==reference?createChart(input.chart.birth,reference):input.chart;
  task.orientation=orientTask(current,source.palaces,source.needsCurrentEnvironment);
  if(source.precision==='natal')task.queries=[{scope:'natal',date:solarISO(input.chart.solarDate),palaces:source.palaces,relations:true}];
  else if(source.precision==='decadal'){
   const result=queriesForDecades(source,current,reference);task.queries=result.queries;issues.push(...result.issues.map(s=>`${source.id}: ${s}`));
   if(result.issues.length)task.coverage={status:'partial',precision:'decadal',periods:Math.max(0,result.queries.length-1),reason:result.issues.join(' ')};
  }else if(source.precision==='yearly'&&(source.kind==='current_state'||source.kind==='decision')&&!source.temporalIntent.explicitYears.length&&!source.temporalIntent.yearRange&&!source.temporalIntent.spanYears&&!/今年|本年|本月|这个月|\d月|哪|什么时候|何时|未来|接下来|往后|明年|去年|前年|后年|过去/.test(source.temporalIntent.targetText)){
   task.queries=(['natal','decadal','yearly'] as Scope[]).map(scope=>({scope,date:scope==='natal'?solarISO(input.chart.solarDate):reference,palaces:source.palaces,relations:true}));
  }else{
   // Independent tasks never inherit a different task's timing record. Follow-ups retain their original history.
   let history=classified.tasks.length===1?input.history:[],inherited:TimingRequest|undefined;
   if(source.dependsOnTaskId)inherited=tasks.find(t=>t.id===source.dependsOnTaskId)?.timingRequest||undefined;
   if(source.inheritedTaskId){
    const prior=input.history.slice().reverse().flatMap(h=>{try{const m=typeof h.meta==='string'?JSON.parse(h.meta):h.meta;return m?.analysisPlan?.tasks||[];}catch{return [];}}).find((t:any)=>t.id===source.inheritedTaskId);
    if(prior){inherited=prior.timingRequest;history=[{role:'user',content:prior.question},{role:'assistant',content:'沿用已明确的同一任务条件。',meta:{dialogue:{version:1,goal:prior.question,questionPolicy:'answer_first'},timing:{version:1,...(prior.timing||prior.timingRequest),windows:prior.timing?.windows||[]}}}];}
   }
   let request=resolveTimingRequest(source.question,history,input.today,input.chart.solarDate,true,current,{...(source.kind==='current_state'||source.kind==='historical_compare'?{mode:'descriptive' as const}:{}),palaces:source.palaces});
   const intent=source.temporalIntent,newBounds=intent.explicitYears.length||intent.yearRange||intent.spanYears||intent.deadline||intent.retrospectiveEndYear!==undefined||intent.excludedYears.length||/今年|明年|后年|去年|前年|本月|下月|个月|今天|明天|后天|未来|接下来|往后|过去|具体|细化|精确|首选|备选|几月|哪(?:一|个|些)?月|哪(?:一|几)?天/.test(intent.targetText);
   if(inherited&&!newBounds)request={...inherited,goal:source.question,palaces:source.palaces,assumptions:[...inherited.assumptions,'沿用同一分析任务的完整时间区间。'],...(inherited.plan?{plan:{...inherited.plan,rangeSource:'inherited'}}:{})};
   if(request){
    task.timingRequest={...request,palaces:source.palaces};
    // A year-only description/comparison must not fall through the old default monthly path.
    // Explicit finer date requests remain authoritative in the shared resolver.
    if(source.precision==='yearly'&&request.detail==='monthly'){
     task.timingRequest.detail='yearly';
     if(task.timingRequest.requested)task.timingRequest.requested={...task.timingRequest.requested,detail:'yearly'};
    }
    task.precision=task.timingRequest.detail;
    if(request.issue){issues.push(`${source.id}: ${request.issue}`);task.coverage={status:'unavailable',precision:task.precision,periods:0,reason:request.issue};}
   }else{
    // Excluded prediction tasks still use the existing answer boundaries; no invented time scan.
    task.queries=[{scope:'natal',date:solarISO(input.chart.solarDate),palaces:source.palaces,relations:true}];
    task.coverage={status:'partial',precision:'natal',periods:0,reason:'该问题未形成可执行时间查询，仅保留本命资料与既有回答边界'};
   }
  }
  tasks.push(task);
 }
 const body={version:1 as const,policyVersion:ANALYSIS_PLAN_VERSION,registryVersion:classified.registryVersion,question:input.question,referenceDate:input.today,chartVersion:version,
  ...(input.profileId?{profileId:input.profileId}:{}),...(input.profileRevision?{profileRevision:input.profileRevision}:{}),tasks,issues:[...new Set(issues)],assumptions:[...new Set(assumptions)],status:'planned' as const,classificationSource:input.classification?'semantic' as const:'rules' as const};
 return {...body,id:'plan:'+await digest(body)};
}

/** Small persistent task contract. Full engine facts stay in their own evidence store. */
export function compactAnalysisPlan(plan:AnalysisPlan):AnalysisPlan{
 return {...plan,tasks:plan.tasks.map(t=>({...t,orientation:t.orientation?{...t.orientation,natal:[],...(t.orientation.current?{current:{...t.orientation.current,layers:[]}}:{})}:undefined}))};
}

export const analysisInstructions='按 analysisPlan 中的独立任务依次作答，任务 ID 对应 question、palaces、precision、range 和 coverage。用户明确约束优先于默认范围与任何解释性假设。纯属性任务只解释本命，不从其他任务借入大限或流年。知识任务不推断个人经历。当前环境只用于定位背景，不替代历史目标年份。命盘所示可能关注点属于传统条件性解读，不是用户已经确认的想法。跨大限先解释各限背景，再比较该限目标区段；覆盖所有调查年份，重点区间可展开，其他年份可简述。不同问题的比较目标分别处理：关系启动、关系稳定、事业变化、资源积累等不混成同一吉凶总分。不为了选出唯一结果而继续扩展范围；允许并列或无明显差异。年度任务不得编造月份，月度任务不得编造吉日；区段边界是调查范围，不是事件发生日。实际 coverage 已齐的资料不能说成未计算或要求用户重新补盘。先直接回应问题，再给关键分层依据。';

/** No duplicate star arrays in a model's task contract; scoped facts are injected separately. */
export function analysisPlanContext(plan:AnalysisPlan){
 return {id:plan.id,version:plan.policyVersion,referenceDate:plan.referenceDate,issues:plan.issues,assumptions:plan.assumptions,tasks:plan.tasks.map(t=>({id:t.id,question:t.question,kind:t.kind,domains:t.domains,palaces:t.palaces,precision:t.precision,timeDirection:t.timeDirection,
  source:t.source,reasonCodes:t.reasonCodes,assumptions:t.assumptions,coverage:t.coverage,
  range:t.timingRequest?{start:t.timingRequest.start,end:t.timingRequest.end,source:t.timingRequest.plan?.rangeSource,backgroundEvents:t.timingRequest.plan?.backgroundEvents,constraints:t.timingRequest.plan?.constraints,focusEnd:t.timingRequest.plan?.focusEnd,assumptions:t.timingRequest.assumptions}:undefined,
  currentEnvironment:t.orientation?.current?{referenceDate:t.orientation.current.referenceDate,chronologicalAge:t.orientation.current.chronologicalAge,nominalAge:t.orientation.current.nominalAge,decade:t.orientation.current.decade}:undefined,
  queries:t.queries.map(q=>({scope:q.scope,date:q.date,palaces:q.palaces}))}))};
}
