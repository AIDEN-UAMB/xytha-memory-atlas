import type {AnalysisPlan} from './analysis-plan';
import type {HenosisPlan,HenosisEvidenceBundle,HenosisDecision} from './henosis-contracts';
import {expandHenosisRegistry} from './henosis-context';
import {henosisBackgroundRequirement} from './henosis-intent';

const unique=<T>(values:T[])=>[...new Set(values)];

/** Presentation constraints are not independently answerable chart questions. */
export function isHenosisMethodDirective(text:string){
 const clauses=text.split(/[，,。；;！？!?]+/).map(s=>s.trim()).filter(Boolean);
 return clauses.length>0&&clauses.every(s=>
  /^(?:另外|而且|并且|并|但)?(?:请|务必)?(?:展示|显示|列出|给出|保留|说明)(?:完整的?|清晰的?)?(?:分层)?(?:分析)?(?:依据|证据|引用|层次)(?:即可)?$/.test(s)||
  /^(?:并|但)?(?:请)?(?:不要|不用|不必|无需)(?:再|强行)?(?:分析|细化|精确|展开)(?:到|至)?(?:流月|流日|月份|日期|小时)(?:层面|级别|精度)?$/.test(s)||
  /^(?:请)?(?:简短|简要|详细|深入|分层)(?:地)?(?:回答|说明|解说|分析)(?:即可)?$/.test(s));
}

export function henosisQuestionContract(plan:AnalysisPlan){
 return {version:1 as const,question:plan.question,referenceDate:plan.referenceDate,
  presentation:{layered:/分层|依据|证据/.test(plan.question),noMonthly:/(?:不要|不用|无需|不必)[^。；;]{0,16}(?:流月|月份)/.test(plan.question)},
  requirements:plan.tasks.map(t=>({taskId:t.id,quote:t.source.text,kind:t.kind,domains:t.domains,precision:t.precision,
   source:t.source,range:t.timingRequest?{start:t.timingRequest.start,end:t.timingRequest.end}:null,
   backgroundEvents:t.temporalIntent.backgroundEvents,retrospective:!!t.temporalIntent.retrospective}))};
}

/** A deictic "these five years" inherits the concrete interval, never a new rolling span. */
export function alignExplicitHenosisRanges(plan:AnalysisPlan,decisions:HenosisDecision[]){
 const donors=plan.tasks.filter(t=>t.needsChart&&t.timingRequest&&t.temporalIntent.yearRange&&!t.temporalIntent.retrospective);
 if(!donors.length||new Set(donors.map(t=>`${t.precision}|${t.timingRequest!.start}|${t.timingRequest!.end}`)).size!==1)return;
 const donor=donors[0];
 for(const task of plan.tasks){
  if(task.id===donor.id||!task.needsChart||!['decision','future_timing'].includes(task.kind)||task.reasonCodes.includes('subject_identity_required'))continue;
  if(!task.domains.some(d=>donor.domains.includes(d))||task.temporalIntent.referenceDate!==donor.temporalIntent.referenceDate)continue;
  const explicit=task.temporalIntent;
  if(explicit.yearRange||explicit.explicitYears.length||explicit.deadline||explicit.retrospective||explicit.excludedYears.length)continue;
  if(!/(?:这|上述|以上|期间|最后明确回答|最后.*(?:年份|选择|条件))/.test(task.question))continue;
  if(/(?:未来|过去|往后|接下来|今年|明年|去年|本月|今天)/.test(task.question))continue;
  const range=structuredClone(donor.timingRequest!);
  task.timingRequest={...range,goal:task.question,palaces:task.palaces};task.precision=donor.precision;
  task.queries=donor.queries.map(q=>({...q,palaces:task.palaces}));task.coverage=undefined;
  task.reasonCodes=unique([...task.reasonCodes,'henosis_explicit_shared_horizon']);
  decisions.push({phase:'initial_plan',taskId:task.id,action:'explicit_horizon_inherited',reason:`沿用 ${donor.id} 的明确候选区间 ${range.start}—${range.end}，背景与前史仍独立保留。`});
 }
}

/** Merge presentation of one decision's facets AFTER collecting all their evidence.
 * Independent goals, independent ranges, identities and historical viewpoints stay separate.
 * This is a lossless task-id projection; no chart facts or requested periods are removed. */
export function unifyHenosisInvestigation(bundle:HenosisEvidenceBundle):HenosisEvidenceBundle{
 const source=bundle.plan,tasks=source.tasks;
 const background=(t:typeof tasks[number])=>henosisBackgroundRequirement(t.question)||t.reasonCodes.includes('henosis_background_requirement');
 if(tasks.length<2||source.henosis.clarification||tasks.some(t=>!t.needsChart||t.reasonCodes.includes('subject_identity_required')))return bundle;
 const timed=tasks.filter(t=>['decision','future_timing'].includes(t.kind)&&t.timingRequest);
 const root=timed.find(t=>/是否|还是|更适合|适不适合/.test(t.question));
 if(!root||root!==tasks[0]||!['yearly','monthly'].includes(root.precision))return bundle;
 const range=root.timingRequest!;
 if(timed.some(t=>t.precision!==root.precision||t.timingRequest!.start!==range.start||t.timingRequest!.end!==range.end))return bundle;
 const rootDomains=new Set(root.domains.filter(d=>!['self','wellbeing'].includes(d)));
 const facetStart=/^(?:请)?(?:先|首先|再|然后|以及|最后|并|如果|若)/;
 if(tasks.slice(1).some(t=>(!facetStart.test(t.question.trim())&&!background(t))||!t.domains.some(d=>rootDomains.has(d))||t.temporalIntent.referenceDate!==root.temporalIntent.referenceDate))return bundle;
 // Explicit historical targets and separately requested decades remain independent goals.
 if(tasks.some(t=>t.kind==='historical_compare'&&!background(t)&&(t.temporalIntent.yearRange||t.temporalIntent.explicitYears.length||/第[一二三四五六七八九十\d]+.{0,2}大限/.test(t.question))))return bundle;
 const taskIds=new Set(tasks.map(t=>t.id)),targetId=root.id;
 const remap=(value:any):any=>Array.isArray(value)?value.map(remap):value&&typeof value==='object'?
  Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==='taskId'&&typeof v==='string'&&taskIds.has(v)?targetId:key==='taskIds'&&Array.isArray(v)?unique(v.map(id=>taskIds.has(id)?targetId:id)):remap(v)])):value;
 const result=structuredClone(bundle),plan=result.plan;
 const contract=henosisQuestionContract(source);
 const missing=unique(bundle.coverage.flatMap(c=>c.missing)),complete=bundle.coverage.length===tasks.length&&bundle.coverage.every(c=>c.status==='complete');
 const coverage={taskId:targetId,status:complete?'complete' as const:'partial' as const,reason:'共享全部分层调查；原始问题要求和取证范围逐项保留',missing};
 const unionTask={...structuredClone(root),question:source.question,source:{text:source.question,start:0,end:source.question.length,origin:'current' as const},
  palaces:unique(tasks.flatMap(t=>t.palaces)),corePalaces:unique(tasks.flatMap(t=>t.corePalaces)),domains:unique(tasks.flatMap(t=>t.domains)),
  kind:'decision' as const,queries:tasks.flatMap(t=>t.queries),coverage:{...root.coverage,status:coverage.status,precision:root.precision,periods:root.coverage?.periods||0,reason:coverage.reason,missing}};
 plan.tasks=[unionTask];plan.henosis.dependencies=[];plan.henosis.questionContract=contract;
 plan.henosis.deliveryGroups=[{taskId:targetId,sourceTaskIds:[...taskIds]}];
 plan.henosis.decisions.push({phase:'delivery',taskId:targetId,action:'shared_investigation',reason:`${tasks.length} 个同一决策的分析层次共享事实并统一交付；原始要求全部保留。`});
 const backgroundIds=new Set(tasks.filter(background).map(t=>t.id));
 result.observations=result.observations.map(o=>backgroundIds.has(o.taskId)&&o.role==='candidate'?{...o,role:'retrospective' as const}:o);
 result.observations=remap(result.observations);result.references=remap(result.references);result.hypotheses=remap(result.hypotheses);
 result.executedQueries=remap(result.executedQueries);result.context=remap(expandHenosisRegistry(result.context));
 // The registry is already expanded; leaving its dictionary could expand literal text twice.
 delete (result.context as any).strings;
 result.coverage=[coverage];
 return result;
}

/** Separate historical diagnostics from the actual deliverable state. */
export function henosisCompletion(answered:number,expected:number,issueCount:number,coverage:HenosisEvidenceBundle['coverage']){
 return answered===expected&&expected>0&&issueCount===0&&coverage.every(c=>c.status==='complete'||c.status==='not_applicable')?'complete' as const:answered?'partial' as const:'unanswered' as const;
}
