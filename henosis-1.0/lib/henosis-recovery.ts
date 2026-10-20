import type {HenosisPlan} from './henosis-contracts';
import type {HenosisDeliveryIssue,HenosisReport} from './henosis-answer';

export type HenosisTaskOutcome={
 version:1;taskId:string;status:'verified'|'partial';conclusion:string;conclusionTruncated:boolean;
 conditions:string[];evidenceIds:string[];candidateIds:string[];unresolved:{code:string;detail:string}[];
};

/** Pass bounded, inspectable decisions between tasks instead of a blind prose prefix. */
export function henosisTaskOutcome(report:HenosisReport,issues:HenosisDeliveryIssue[]=[]):HenosisTaskOutcome{
 const prose=[report.conclusion,...report.sections.map(s=>s.text),...report.comparison.map(c=>c.text)].join('\n');
 const conditions=prose.split(/(?<=[。！？；\n])/).map(s=>s.trim()).filter(s=>s&&/(?:如果|若|只有|除非|前提|条件|需要|取决于|否则|尚未|不足)/.test(s));
 const unique=<T>(items:T[])=>[...new Set(items)];
 return {version:1,taskId:report.taskId,status:issues.length?'partial':'verified',conclusion:report.conclusion.slice(0,2400),conclusionTruncated:report.conclusion.length>2400,
  conditions:unique(conditions).slice(0,8).map(s=>s.slice(0,500)),
  evidenceIds:unique([...report.sections.flatMap(s=>s.citations),...report.comparison.flatMap(c=>c.citations)]),
  candidateIds:unique(report.comparison.flatMap(c=>c.candidateIds)),unresolved:issues.slice(0,12).map(({code,detail})=>({code,detail}))};
}

/** Choose the existing lossless partition path before an avoidable oversized call. */
export function shouldPartitionHenosisTask(input:{inputTokensEstimate:number;inputBudget:number;maximumCharacters:number;candidateCount:number}){
 if(input.candidateCount<=0)return false;
 const inputPressure=input.inputTokensEstimate>Math.max(1024,Math.floor(input.inputBudget*.82));
 const candidatePressure=input.candidateCount>8;
 const combinedPressure=input.candidateCount>4&&input.maximumCharacters>4200;
 return inputPressure||candidatePressure||combinedPressure;
}

/** Keep only a task's facts and their transitive factual registries. */
export function henosisTaskInvestigation(source:Record<string,any>,taskId:string){
 const facts=(source.facts||[]).filter((f:any)=>!Array.isArray(f.taskIds)||f.taskIds.includes(taskId));
 const stateIds=new Set(facts.map((f:any)=>f.state)),natalIds=new Set(facts.map((f:any)=>f.natalRef));
 const states=(source.states||[]).filter((s:any)=>stateIds.has(s.id)),sourceIds=new Set(states.flatMap((s:any)=>s.sourceIds||[]));
 const result:Record<string,any>={...source,facts,states,natalRegistry:(source.natalRegistry||[]).filter((n:any)=>natalIds.has(n.id)),sources:(source.sources||[]).filter((s:any)=>sourceIds.has(s.id))};
 for(const key of ['periods','candidates','hypotheses','coverage','findings','decadeTransitions'])if(Array.isArray(source[key]))result[key]=source[key].filter((x:any)=>x.taskId===taskId);
 result.environments=(source.environments||[]).filter((x:any)=>!x.taskId||x.taskId===taskId);
 return result;
}

/** Execution order may differ from display order. Preserve source task IDs. */
export function henosisExecutionOrder(plan:HenosisPlan){
 const ordered:HenosisPlan['tasks']=[],visited=new Set<string>(),visiting=new Set<string>();
 const visit=(task:HenosisPlan['tasks'][number])=>{
  if(visited.has(task.id))return;
  if(visiting.has(task.id))throw Error('HENOSIS_DEPENDENCY_CYCLE');
  visiting.add(task.id);
  for(const link of plan.henosis.dependencies||[])if(link.taskId===task.id){const parent=plan.tasks.find(t=>t.id===link.dependsOnTaskId);if(parent)visit(parent);}
  visiting.delete(task.id);visited.add(task.id);ordered.push(task);
 };
 plan.tasks.forEach(visit);return ordered;
}

/** Split only delivery work: no change to the investigation horizon or facts. */
export function henosisDeliveryParts(contract:any){
 const candidates=contract.comparisonTargets||[],sections=contract.requiredSections||[];
 const parts=[{...contract,requiredSections:sections.filter((s:string)=>s!=='synthesis'),comparisonTargets:[],minimumCharacters:0,maximumCharacters:2600}];
 const batchSize=contract.decisionTargets?.length>1?2:4;
 for(let i=0;i<candidates.length;i+=batchSize)parts.push({...contract,requiredSections:[],comparisonTargets:candidates.slice(i,i+batchSize),minimumCharacters:0,maximumCharacters:1800});
 return parts;
}

export function henosisPartInvestigation(source:Record<string,any>,candidateIds:string[]){
 const selected=new Set(candidateIds),candidates=(source.candidates||[]).filter((c:any)=>selected.has(c.id));
 const overlaps=(p:any)=>candidates.some((c:any)=>p.start<=c.end&&p.end>=c.start);
 const parents=new Set(candidates.flatMap((c:any)=>c.parentDecades||[]));
 const periods=(source.periods||[]).filter((p:any)=>candidateIds.length?
  p.role==='natal'||p.role==='candidate'&&overlaps(p)||p.scope==='decadal'&&(parents.has(p.parentDecade)||overlaps(p)):
  p.role==='natal'||p.role==='current'||p.role==='retrospective'&&(!source.asOf||p.end<source.asOf));
 const evidenceIds=new Set(periods.flatMap((p:any)=>p.citations||[]));
 const facts=(source.facts||[]).filter((f:any)=>evidenceIds.has(f.id)),stateIds=new Set(facts.map((f:any)=>f.state));
 const states=(source.states||[]).filter((s:any)=>stateIds.has(s.id)),natalIds=new Set(facts.map((f:any)=>f.natalRef)),sourceIds=new Set(states.flatMap((s:any)=>s.sourceIds||[]));
 return {...source,candidates,periods,facts,states,hypotheses:[],natalRegistry:(source.natalRegistry||[]).filter((n:any)=>natalIds.has(n.id)),sources:(source.sources||[]).filter((s:any)=>sourceIds.has(s.id)),...(Array.isArray(source.findings)?{findings:source.findings.filter((f:any)=>f.role!=='candidate'||overlaps(f))}:{})};
}

/** Synthesis reads completed comparisons plus their exact factual dependencies,
 * not the entire history for a second time. Never truncate a comparison row. */
export function henosisSynthesisInvestigation(source:Record<string,any>,report:HenosisReport){
 const ids=new Set(report.sections.flatMap(s=>s.citations));
 const facts=(source.facts||[]).filter((f:any)=>ids.has(f.id)),statesWanted=new Set(facts.map((f:any)=>f.state));
 const states=(source.states||[]).filter((s:any)=>statesWanted.has(s.id)),natalWanted=new Set(facts.map((f:any)=>f.natalRef));
 const sourcesWanted=new Set(states.flatMap((s:any)=>s.sourceIds||[]));
 return {...source,facts,states,natalRegistry:(source.natalRegistry||[]).filter((n:any)=>natalWanted.has(n.id)),
  sources:(source.sources||[]).filter((s:any)=>sourcesWanted.has(s.id)),hypotheses:[],
  comparisonEvidence:report.comparison.map(c=>({candidateIds:c.candidateIds,evidenceIds:c.citations})),
  evidencePolicy:'候选原始事实已在分段处理并独立保存。综合只比较 candidateComparisons 的已有判断与条件，不重新生成星曜断言；引用沿用 comparisonEvidence。',
  periods:(source.periods||[]).filter((p:any)=>p.citations?.some((id:string)=>ids.has(id))).map((p:any)=>({...p,citations:p.citations.filter((id:string)=>ids.has(id))}))};
}
