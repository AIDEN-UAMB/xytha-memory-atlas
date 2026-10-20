import {scopeOrder,type Scope,type TransformationSource} from './chart';
import {estimateTokens} from './context-capacity';
import {PALACE_NAMES} from './question-domains';
import type {HenosisEvidenceBundle,HenosisObservation,HenosisPlan} from './henosis-contracts';

export const HENOSIS_DEPTH_VERSION='henosis-depth.10';
const unique=<T>(items:T[])=>[...new Set(items)];
export function expandHenosisRegistry(raw:unknown):Record<string,any>{
 const input=(raw||{}) as Record<string,any>,strings=input.strings||{};
 const expand=(v:any):any=>typeof v==='string'?strings[v]||v:Array.isArray(v)?v.map(expand):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x)])):v;
 const value=expand(input);
 value.sourceRegistry=(value.sourceRegistry||[]).map((row:any)=>{if(!Array.isArray(row))return row;const s=Object.fromEntries(value.sourceColumns.map((k:string,i:number)=>[k,row[i]]));s.mutations=(s.mutations||[]).map((m:any[])=>Object.fromEntries(value.mutationColumns.map((k:string,i:number)=>[k,m[i]])));return s;});
 return value;
}

/** Reconstruct the answer-time snapshot; never recompute a past answer using today's chart. */
export function henosisEvidenceDetails(bundle:HenosisEvidenceBundle){
 const registry=expandHenosisRegistry(bundle.context),sources=registry.sourceRegistry as TransformationSource[];
 const natal=new Map(bundle.observations.filter(o=>o.scope==='natal').map(o=>[o.palaceIndex,o]));
 const facts=new Map((bundle.evidence as any[]).map(e=>[e.id,e]));
 return bundle.references.map((r,index)=>{
  const fact=facts.get(r.id),observation=bundle.observations.find(o=>o.evidenceIds.includes(r.id));
  const physical=Number(r.palaceIndex??fact?.index??observation?.palaceIndex),fixed=natal.get(physical);
  const applicable=sources.filter(s=>fact?.sourceIds?.includes(s.id));
  const transformations=applicable.flatMap(s=>s.mutations||[]).filter(t=>t.palaceIndex===physical);
  return {...r,taskIds:(Array.isArray(r.taskIds)?r.taskIds:[]) as string[],alias:'e'+(index+1),index:physical,label:fact?.label||`${r.scope}·${r.palace}`,scopePalace:r.palace,natalPalace:fixed?.palace||fact?.natalPalace,
   branch:fact?.natalPalaceStemBranch||'',stars:(fixed?.stars||[]).map(s=>({...s,transformations:transformations.filter(t=>t.star===s.name)})),
   flowingStars:observation?.scope==='natal'?[]:observation?.stars||[],sources:applicable.map(({mutations:_mutations,...s})=>s),
   roles:unique(bundle.observations.filter(o=>o.evidenceIds.includes(r.id)).map(o=>o.role))};
 }).filter(e=>Number.isInteger(e.index)&&e.index>=0&&e.index<12);
}

export type HenosisCandidate={id:string;taskId:string;label:string;start:string;end:string;parentDecades:string[];periods:{start:string;end:string;citations?:string[];stemBranch?:string}[];citations:string[]};
export function henosisAnswerPacket(bundle:HenosisEvidenceBundle){
 const plan=bundle.plan,registry=expandHenosisRegistry(bundle.context),details=henosisEvidenceDetails(bundle),aliases=new Map(details.map(e=>[e.id,e.alias]));
 const sources:any[]=[],sourceKeys=new Map<string,string>(),sourceAliases=new Map<string,string>();
 for(const e of details)for(const s of e.sources.filter(s=>s.scope!=='natal')){
  const value={scope:s.scope,stemBranch:s.stemBranch,ageRange:s.ageRange,yearRange:s.yearRange,periodLabel:s.periodLabel},key=JSON.stringify(value);
  let id=sourceKeys.get(key);if(!id){id='u'+(sources.length+1);sourceKeys.set(key,id);sources.push({id,...value});}sourceAliases.set(s.id,id);
 }
 const natal=unique(details.map(e=>e.index)).map(index=>{
  const e=details.find(e=>e.index===index)!;
  return {id:'n'+index,palace:e.natalPalace,branch:e.branch,stars:e.stars.map(s=>[s.name,s.brightness]),birthTransformations:e.stars.flatMap(s=>s.transformations.filter(t=>t.scope==='natal').map(t=>[s.name,t.value]))};
 });
 const facts=details.map(e=>({id:e.alias,taskIds:e.taskIds,scope:e.scope,date:e.date,palace:e.palace,natalRef:'n'+e.index,
  ...(e.flowingStars.length?{flowingStars:e.flowingStars.map(s=>[s.name,s.brightness])}:{}),
  transformations:e.stars.flatMap(s=>s.transformations.filter(t=>t.scope!=='natal').map(t=>[t.scope,s.name,t.value])),
  sourceIds:e.sources.filter(s=>s.scope!=='natal').map(s=>sourceAliases.get(s.id)!)}));
 const periodMap=new Map<string,any>();
 for(const o of bundle.observations){
  const key=[o.taskId,o.role,o.scope,o.start||o.date,o.end||o.date,o.parentDecade].join('|');
  const old=periodMap.get(key)||{taskId:o.taskId,role:o.role,scope:o.scope,start:o.start||o.date,end:o.end||o.date,parentDecade:o.parentDecade,temporalStatus:o.temporalStatus,citations:[]};
  old.citations=unique([...old.citations,...o.evidenceIds.map(id=>aliases.get(id)).filter(Boolean)]);periodMap.set(key,old);
 }
 // A shared natal fact may belong to several tasks even though its physical observation is stored once.
 for(const t of plan.tasks){const natalRefs=details.filter(e=>e.scope==='natal'&&Array.isArray(e.taskIds)&&e.taskIds.includes(t.id)).map(e=>e.alias);if(natalRefs.length)periodMap.set(t.id+'|natal',{taskId:t.id,role:'natal',scope:'natal',start:bundle.observations.find(o=>o.scope==='natal')?.date,end:bundle.observations.find(o=>o.scope==='natal')?.date,temporalStatus:'timeless',citations:natalRefs});}
 const periods=[...periodMap.values()].filter((p,i,all)=>p.scope!=='natal'||all.findLastIndex(x=>x.taskId===p.taskId&&x.scope==='natal')===i);
 const candidates=new Map<string,HenosisCandidate>();
 for(const t of plan.tasks)for(const p of periods.filter(p=>p.taskId===t.id&&p.role==='candidate'&&p.scope===t.precision)){
  const label=t.precision==='decadal'?p.parentDecade||p.start:t.precision==='yearly'?p.start.slice(0,4):t.precision==='monthly'?p.start+'—'+p.end:p.start;
  const key=t.id+'|'+label,old:HenosisCandidate=candidates.get(key)||{id:'c'+(candidates.size+1),taskId:t.id,label,start:p.start,end:p.end,parentDecades:[],periods:[],citations:[]};
  old.start=old.start<p.start?old.start:p.start;old.end=old.end>p.end?old.end:p.end;
  old.parentDecades=unique([...old.parentDecades,...(p.parentDecade?[p.parentDecade]:[])]);const source=details.filter(e=>p.citations.includes(e.alias)).flatMap(e=>e.sources).find(s=>s.scope===t.precision);old.periods.push({start:p.start,end:p.end,citations:[...p.citations],stemBranch:source?.stemBranch});old.citations=unique([...old.citations,...p.citations]);candidates.set(key,old);
 }
 const hypotheses=selectHenosisHypotheses(bundle,12).map(h=>({...h,evidenceIds:unique(h.evidenceIds.map(id=>aliases.get(id)).filter(Boolean)),alternatives:h.alternatives.slice(0,2)}));
 const states:{id:string;flowingStars?:unknown;transformations:unknown;sourceIds:string[]}[]=[],stateKeys=new Map<string,string>();
 const compactFacts=facts.map(({flowingStars,transformations,sourceIds,...fact})=>{const state={flowingStars,transformations,sourceIds},key=JSON.stringify(state);let id=stateKeys.get(key);if(!id){id='s'+(states.length+1);stateKeys.set(key,id);states.push({id,...state});}return {...fact,state:id};});
 // Geometry is invariant within each time layer; physical overlays still come
 // exclusively from facts. Do not ask the writer to reconstruct the ring.
 const palaceRelations=unique(plan.tasks.flatMap(t=>t.palaces)).flatMap(palace=>{
  const index=(PALACE_NAMES as readonly string[]).indexOf(palace);if(index<0)return [];
  return [{palace,trine:[PALACE_NAMES[(index+4)%12],PALACE_NAMES[(index+8)%12]],opposite:PALACE_NAMES[(index+6)%12]}];
 });
 const decadeTransitions:{taskId:string;at:string;from:string;to:string;citations:string[]}[]=[];
 for(const task of plan.tasks){
  const ordered=periods.filter(p=>p.taskId===task.id&&p.role==='candidate'&&p.scope==='decadal'&&p.parentDecade).sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<ordered.length;i++)if(ordered[i].parentDecade!==ordered[i-1].parentDecade)decadeTransitions.push({taskId:task.id,at:ordered[i].start,from:ordered[i-1].parentDecade,to:ordered[i].parentDecade,citations:unique([...ordered[i-1].citations,...ordered[i].citations])});
 }
 return {version:HENOSIS_DEPTH_VERSION,referenceDate:bundle.referenceDate,asOf:plan.henosis.asOf,perspective:plan.henosis.perspective,
  environments:registry.environments||[],natalRegistry:natal,facts:compactFacts,states,periods,candidates:[...candidates.values()],
  sources,palaceRelations,decadeTransitions,
  hypotheses,ruleVersion:registry.ruleVersion,ruleStatus:'traditional_candidates_not_verified_user_traits',coverage:bundle.coverage,issues:bundle.issues,
  encodingGuide:'facts.id 是本次输出使用的短引用 eN，服务端将其绑定原始引擎证据ID。先由 natalRef 读取固定星曜与生年四化，再由 facts.state 关联 states.id 展开分层四化、流曜及来源。状态字典仅去掉逐字相同的重复数据，不丢失任何调查期。periods 区分本命、当前、回顾和候选；未来的前序期仍是推演。candidates 的流年按公历年汇总；每个候选 periods 的 stemBranch、起止和 citations 标明实际流年归属。年初可能是上一个干支流年尾段，禁止据尾段断言全年。默认按覆盖时间最长的流年区段解释该年，并说明尾段差异；这是公历展示归属，不是命理权重。年份精度不等于可以抹去换年边界，边界说明也不等于月度择时。candidates 的流月按引擎实际运限区段列出公历起止，不能把农历/闰月区段误写成整个公历月；periods 保留运限边界，禁止把区段起点当推荐日期。全部调查期都已保留，hypotheses仅是有代表性的候选解释，不能取代完整星曜事实。'};
}

/** Round-robin across anchored palaces and temporal roles, instead of taking the first four. */
export function selectHenosisHypotheses(bundle:HenosisEvidenceBundle,perTask=12){
 const selected:HenosisEvidenceBundle['hypotheses']=[];
 for(const t of bundle.plan.tasks){
  const groups=new Map<string,typeof selected>();
  for(const h of bundle.hypotheses.filter(h=>h.taskId===t.id)){
   const palace=t.palaces.find(p=>h.claim.startsWith(p))||'other',role=/\/current\//.test(h.claim)?'current':/\/candidate\//.test(h.claim)?'candidate':/\/retrospective\//.test(h.claim)?'retrospective':'natal';
   const key=palace+'|'+role;groups.set(key,[...(groups.get(key)||[]),h]);
  }
  let count=0;for(let round=0;count<perTask;round++){let added=0;for(const values of groups.values()){if(values[round]&&count<perTask){selected.push(values[round]);count++;added++;}}if(!added)break;}
 }
 return selected;
}

export function henosisRefinementBrief(bundle:HenosisEvidenceBundle){
 const packet=henosisAnswerPacket(bundle),selected=new Set<string>();
 const roles=['natal','current','retrospective','candidate'];
 for(const t of bundle.plan.tasks)for(const palace of t.palaces)for(const role of roles){
  const periods=packet.periods.filter(p=>p.taskId===t.id&&p.role===role&&p.citations.some((id:string)=>packet.facts.some(f=>f.id===id&&f.palace===palace))).sort((a,b)=>a.start.localeCompare(b.start));
  for(const p of unique([periods[0],periods.at(-1)].filter(Boolean)))for(const id of p.citations){const f=packet.facts.find(f=>f.id===id);if(f?.palace===palace)selected.add(id);}
 }
 const refs=new Map(bundle.references.map((r,i)=>['e'+(i+1),r.id]));
 const hypotheses=selectHenosisHypotheses(bundle,8);
 const facts=packet.facts.filter(f=>selected.has(f.id)).map(f=>({...f,...packet.states.find(s=>s.id===f.state),id:refs.get(f.id)!}));
 const natalRefs=new Set(facts.map(f=>f.natalRef));
 const brief={hypotheses,references:facts,natalRegistry:packet.natalRegistry.filter(n=>natalRefs.has(n.id)),sources:packet.sources.filter(s=>facts.some(f=>f.sourceIds?.includes(s.id))),
  coverage:bundle.coverage,issues:bundle.issues,summary:{environments:packet.environments,candidateRanges:packet.candidates.map(({citations,...c})=>c)},
  selection:{hypothesisCount:bundle.hypotheses.length,includedHypotheses:hypotheses.length,referenceCount:bundle.references.length,includedReferences:facts.length,note:'按每个主题宫位的本命、当前、前史首尾、候选首尾选取真实星曜结构。全量调查证据独立保留。'}};
 // The planner gets a compact representative brief. Candidate ranges and core facts take priority over interpretations.
 while(estimateTokens(JSON.stringify(brief))>12000&&brief.hypotheses.length)brief.hypotheses.pop();
 brief.selection.includedHypotheses=brief.hypotheses.length;
 return brief;
}

export function needsHenosisRefinement(plan:HenosisPlan,bundle:HenosisEvidenceBundle){
 if(!plan.henosis.settings.maxSupplementRounds||plan.henosis.clarification)return false;
 const timed=plan.tasks.filter(t=>t.needsChart&&t.precision!=='natal'&&t.coverage?.status!=='unavailable');
 return timed.length>0&&(plan.tasks.length>1||bundle.issues.length>0||timed.some(t=>t.kind==='decision'||t.kind==='historical_compare'||t.timingRequest?.plan?.rangeSource==='default'||t.palaces.length>2||/比较|最好|最适合|哪年|何时|什么时候|为什么|原因|变化|详细|深入/.test(t.question)));
}
