import {createChartReader,referenceIds,scopeOrder,type ChartData,type Scope,type TransformationSource} from './chart';
import {analyzeTiming,timingRecord,timingAnalysisIssues,timingEnvironment,type TimingRecord,type TimingDecade} from './timing';
import {splitTimingPeriods} from './timing-periods';
import {addDays,daysBetween,type TimingRequest} from './timing-request';
import {solarISO,type DatedQuery} from './query-dates';
import {chartVersion} from './palace-memory-facts';
import {estimateTokens} from './context-capacity';
import {deriveHenosisHypotheses,HENOSIS_RULE_VERSION,henosisRuleCatalog} from './henosis-rules';
import type {HenosisEvidenceInput,HenosisEvidenceBundle,HenosisObservation,HenosisPlan} from './henosis-contracts';

type EngineEvidence=ReturnType<typeof referenceIds>[number];
type Range={start:string;end:string};
type DecadeRange=Range&{id:string;ordinal:number;ageRange:number[];yearRange:number[];palace:string;complete:boolean};
type ThinEvidence={id:string;index:number;scope:Scope;date:string;label:string;scopePalace:string;natalPalace:string;natalPalaceStemBranch:string;natalRef:string;sourceIds:string[];transformationIds:string[]};
type Reference=HenosisEvidenceBundle['references'][number]&{taskIds:string[];palaceIndex:number};
type Environment={taskId:string;referenceDate:string;chronologicalAge:number;nominalAge:number;decade:TimingDecade};
type HistoryBinding={taskId:string;targetDate:string;targetAnnualAge:number;parentDecade:string|null;palaces:string[];annualPolicy:'elapsed_before_target_year'|'not_requested';previousDecades:string[];previousAnnuals:string[];cutoff:string};
type StoredContext={decades?:DecadeRange[];sourceRegistry?:TransformationSource[];environments?:Environment[];historyBindings?:HistoryBinding[];strings?:Record<string,string>;sourceColumns?:string[];mutationColumns?:string[];observations?:{id:string;period:string;evidenceIds:string[]}[];periods?:{id:string;taskId:string;role:string;start:string}[]};
const validDate=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>='1900-01-01'&&date<='2100-12-31'&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const unique=<T>(items:T[])=>[...new Set(items)];
const historyKey=(h:Pick<HistoryBinding,'taskId'|'parentDecade'|'targetAnnualAge'|'palaces'|'annualPolicy'>)=>[h.taskId,h.parentDecade,h.targetAnnualAge,h.annualPolicy,[...h.palaces].sort().join(',')].join('|');
function subtractRanges(start:string,end:string,covered:Range[]){
 let ranges:Range[]=[{start,end}];
 for(const previous of covered)ranges=ranges.flatMap(r=>previous.end<r.start||previous.start>r.end?[r]:[...(r.start<previous.start?[{start:r.start,end:addDays(previous.start,-1)}]:[]),...(r.end>previous.end?[{start:addDays(previous.end,1),end:r.end}]:[])]);
 return ranges;
}
function mergeQueries(queries:DatedQuery[]){const map=new Map<string,DatedQuery>();for(const q of queries){const key=q.scope+'|'+q.date+'|'+q.relations,old=map.get(key);map.set(key,{...q,palaces:unique([...(old?.palaces||[]),...q.palaces])});}return [...map.values()];}
function expandStoredContext(raw:unknown):StoredContext{
 const input=(raw||{}) as StoredContext,strings=input.strings||{};
 const expand=(value:any):any=>typeof value==='string'?strings[value]||value:Array.isArray(value)?value.map(expand):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,expand(v)])):value;
 const result=expand(input) as StoredContext;
 if(result.sourceColumns&&result.mutationColumns)result.sourceRegistry=(result.sourceRegistry||[]).map((row:any)=>{if(!Array.isArray(row))return row;const source=Object.fromEntries(result.sourceColumns!.map((key,index)=>[key,row[index]]));source.mutations=source.mutations.map((m:any[])=>Object.fromEntries(result.mutationColumns!.map((key,index)=>[key,m[index]])));return source as TransformationSource;});
 const ids=new Map((result.observations||[]).flatMap(o=>{const p=result.periods?.find(p=>p.id===o.period);return p?[[o.id,`${p.taskId}|${p.role}|${o.evidenceIds[0]}|${p.start}`]]:[];}));
 if(result.historyBindings)result.historyBindings=result.historyBindings.map(h=>({...h,previousAnnuals:h.previousAnnuals.map(id=>ids.get(id)||id)}));
 return result;
}
/** Lossless dictionary/column encoding; facts and coverage are never sampled away. */
function compactEvidenceContext(raw:Record<string,any>){
 const sourceColumns=['id','scope','label','origin','heavenlyStem','stemBranch','fixed','observedOn','periodLabel','ageRange','yearRange','mutations'],mutationColumns=['id','sourceId','scope','value','star','palaceIndex','natalPalace','scopePalace'];
 const sourceRegistry=raw.sourceRegistry.map((s:any)=>sourceColumns.map(key=>key==='mutations'?s.mutations.map((m:any)=>mutationColumns.map(k=>m[k]??null)):s[key]??null));
 const periodMap=new Map<string,string>(),periods:any[]=[],observationIds=new Map<string,string>();
 const observations=raw.observations.map((o:any,index:number)=>{
  const period={taskId:o.taskId,role:o.role,scope:o.scope,date:o.date,start:o.start||o.date,end:o.end||o.date,parentDecade:o.parentDecade||null,temporalStatus:o.temporalStatus,sourceId:`${o.scope}@${o.date}`},key=JSON.stringify(period);let id=periodMap.get(key);
  if(!id){id='p'+(periods.length+1);periodMap.set(key,id);periods.push({id,...period});}
  const observationId='o'+(index+1);observationIds.set(o.id,observationId);
  return {id:observationId,period:id,palace:o.palace,natalRef:o.natalRef,flowingStars:o.flowingStars,transformationIds:o.transformationIds,evidenceIds:o.evidenceIds};
 });
 const referenceColumns=['id','taskIds','scope','date','palace','palaceIndex'],references=raw.references.map((r:any)=>referenceColumns.map(key=>r[key]));
 const rules={...raw.rules,rules:raw.rules.rules.map(({conditions,alternatives,...r}:any)=>r),conditions:raw.rules.rules[0]?.conditions,alternatives:'同宫和关系宫证据、各层四化及用户反馈可以反驳本候选；具体替代解释见 hypotheses.alternatives。'};
 const historyBindings=raw.historyBindings.map((h:any)=>({...h,previousAnnuals:h.previousAnnuals.map((id:string)=>observationIds.get(id)||id)}));
 const payload={...raw,encoding:'henosis-registry.1',sourceColumns,mutationColumns,referenceColumns,sourceRegistry,periods,observations,references,rules,historyBindings},counts=new Map<string,number>();
 const count=(v:any)=>{if(typeof v==='string'&&v.length>12)counts.set(v,(counts.get(v)||0)+1);else if(Array.isArray(v))v.forEach(count);else if(v&&typeof v==='object')Object.values(v).forEach(count);};count(payload);
 const aliases=new Map<string,string>(),strings:Record<string,string>={};for(const [value,count] of counts)if(count>1){const id='@h'+(aliases.size+1);aliases.set(value,id);strings[id]=value;}
 const encode=(v:any):any=>typeof v==='string'?aliases.get(v)||v:Array.isArray(v)?v.map(encode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,value])=>[k,encode(value)])):v;
 const context=encode(payload);
 // Keep caller-facing metadata directly readable. The dictionary applies to registry values.
 for(const key of ['version','referenceDate','asOf','perspective','chartVersion','ruleVersion','environments','semantics','stats','coverage','issues'])context[key]=raw[key];
 return {...context,strings,encodingGuide:'先以 strings 展开 @h 别名；sourceRegistry/mutations/references 的行按对应 Columns 还原。observations.period 关联 periods，natalRef 关联 natalRegistry；o序号是本上下文观察ID，引用命盘请使用展开后的 evidenceIds。原观察ID可由 taskId|role|evidenceIds[0]|start 还原。各观察、时间区段、流曜和四化均完整保留。'};
}

/** Deterministic observations only. This module never invokes a model or changes chart rules. */
export async function collectHenosisEvidence(input:HenosisEvidenceInput):Promise<HenosisEvidenceBundle>{
 const {signal,settings}=input,plan=structuredClone(input.plan),version=await chartVersion(input.chart),asOf=solarISO(plan.henosis.asOf),born=solarISO(input.chart.solarDate);
 if(version!==plan.chartVersion)throw Error('HENOSIS_CHART_VERSION_MISMATCH');
 if(!validDate(asOf))throw Error('HENOSIS_AS_OF_DATE_INVALID');
 const previous=input.previous;
 if(previous&&(previous.chartVersion!==version||previous.plan.profileId!==plan.profileId||previous.plan.profileRevision!==plan.profileRevision||previous.plan.henosis.asOf!==plan.henosis.asOf||previous.plan.henosis.perspective!==plan.henosis.perspective||!same(previous.plan.henosis.settings,settings)||(plan.id!==previous.plan.id&&plan.parentPlanId!==previous.plan.id)||plan.tasks.some(t=>{const old=previous.plan.tasks.find(p=>p.id===t.id);return old&&old.question!==t.question;})))throw Error('HENOSIS_PREVIOUS_CONTEXT_MISMATCH');
 const oldContext=expandStoredContext(previous?.context),taskIds=new Set(plan.tasks.map(t=>t.id));
 const observations=new Map((previous?.observations||[]).filter(o=>taskIds.has(o.taskId)).map(o=>[o.id,structuredClone(o)]));
 const evidence=new Map((previous?.evidence||[]).map(e=>{const item=structuredClone(e) as ThinEvidence;return [item.id,item];}));
 const references=new Map((previous?.references||[]).map(r=>[r.id,{...structuredClone(r),taskIds:((r.taskIds||[]) as string[]).filter(id=>taskIds.has(id))} as Reference]));
 const sources=new Map((oldContext.sourceRegistry||[]).map(s=>[s.id,structuredClone(s)]));
 const decades=new Map((oldContext.decades||[]).map(d=>[d.id,structuredClone(d)]));
 const environments=new Map((oldContext.environments||[]).filter(e=>taskIds.has(e.taskId)).map(e=>[e.taskId,structuredClone(e)]));
 const historyBindings=new Map((oldContext.historyBindings||[]).filter(h=>taskIds.has(h.taskId)).map(h=>[historyKey(h),structuredClone(h)]));
 const executedQueries=(previous?.executedQueries||[]).filter(q=>taskIds.has(q.taskId)).map(q=>structuredClone(q));
 const coverage:HenosisEvidenceBundle['coverage']=[],issues:string[]=[];
 const reader=createChartReader(input.chart.birth),charts=new Map<string,ChartData>([[solarISO(input.chart.target),input.chart]]),stats={chartReads:0,reusedQueries:0,newQueries:0};
 const read=(date:string)=>{signal?.throwIfAborted();date=solarISO(date);let chart=charts.get(date);if(!chart){chart=reader(date);charts.set(date,chart);stats.chartReads++;}return chart;};
 const temporalStatus=(date:string,end?:string,start?:string):HenosisObservation['temporalStatus']=>(start||date)>asOf?'projection':(end||date)<asOf?'past':'current';
 const natalId=(index:number)=>`${input.chart.solarDate}/natal:P${index}`;
 const bindReference=(fact:ThinEvidence,taskId:string)=>{const old=references.get(fact.id);references.set(fact.id,{id:fact.id,scope:fact.scope,date:fact.date,palace:fact.scopePalace,palaceIndex:fact.index,taskIds:unique([...(old?.taskIds||[]),taskId])});};
 function keepFact(raw:EngineEvidence,taskId:string){
  const id=`${raw.date}/${raw.id}`,fact:ThinEvidence={id,index:raw.index,scope:raw.scope,date:raw.date,label:raw.label,scopePalace:raw.scopePalace,natalPalace:raw.natalPalace,natalPalaceStemBranch:raw.natalPalaceStemBranch,natalRef:natalId(raw.index),sourceIds:raw.sources.map(s=>s.id),transformationIds:unique(raw.stars.flatMap(s=>s.transformations.map(t=>t.id)))};
  evidence.set(id,fact);bindReference(fact,taskId);return fact;
 }
 function ensureNatal(index:number,taskId:string){
  const id=natalId(index),old=evidence.get(id);if(old&&observations.has(id)){bindReference(old,taskId);return id;}
  const c=input.chart,raw=referenceIds(c,'natal',[index])[0],fact=keepFact(raw,taskId);sources.set(c.transformationSources.natal.id,c.transformationSources.natal);
  observations.set(id,{id,taskId,role:'natal',scope:'natal',date:born,palace:raw.scopePalace,natalPalace:raw.natalPalace,palaceIndex:index,temporalStatus:'timeless',stars:raw.stars.map(s=>({name:s.name,brightness:s.brightness||null})),transformations:c.transformationSources.natal.mutations.filter(t=>t.palaceIndex===index).map(t=>({star:t.star,value:t.value,sourceId:t.sourceId,scope:t.scope})),evidenceIds:[fact.id]});return id;
 }
 function observation(fact:ThinEvidence,taskId:string,role:HenosisObservation['role'],range:Range|undefined,c?:ChartData){
  if(fact.scope==='natal'){ensureNatal(fact.index,taskId);return natalId(fact.index);}
  ensureNatal(fact.index,taskId);bindReference(fact,taskId);
  const date=solarISO(fact.date),id=`${taskId}|${role}|${fact.id}|${range?.start||date}`,existing=observations.get(id);
  if(existing){if(range){existing.start=range.start;existing.end=range.end;existing.temporalStatus=temporalStatus(date,range.end,range.start);}return id;}
  const source=sources.get(`${fact.scope}@${fact.date}`),prior=[...observations.values()].find(o=>o.scope===fact.scope&&o.date===date&&o.palaceIndex===fact.index);
  const ageRange=c?.transformationSources.decadal.ageRange||sources.get(`decadal@${fact.date}`)?.ageRange;
  observations.set(id,{id,taskId,role,scope:fact.scope,date,...(range?{start:range.start,end:range.end}:{}),palace:fact.scopePalace,natalPalace:fact.natalPalace,palaceIndex:fact.index,...(ageRange?{parentDecade:'decade:'+ageRange.join('-')}:{}),temporalStatus:temporalStatus(date,range?.end,range?.start),stars:c?c.layers[fact.scope].stars[fact.index].map(s=>({name:s.name,brightness:s.brightness||null})):prior?.stars||[],transformations:(source?.mutations||[]).filter(t=>t.palaceIndex===fact.index).map(t=>({star:t.star,value:t.value,sourceId:t.sourceId,scope:t.scope})),evidenceIds:[fact.id]});return id;
 }
 function query(taskId:string,q:DatedQuery,role:HenosisObservation['role'],range?:Range){
  signal?.throwIfAborted();const date=q.scope==='natal'?born:solarISO(q.date),queryValue={...q,date,palaces:unique(q.palaces)};
  const previousQuery=executedQueries.find(e=>e.query.scope===q.scope&&solarISO(e.query.date)===date&&(e.query.relations||!q.relations)&&q.palaces.every(p=>e.query.palaces.includes(p)));
  if(previousQuery){
   const direct=[...evidence.values()].filter(e=>e.scope===q.scope&&(q.scope==='natal'||solarISO(e.date)===date)&&q.palaces.includes(e.scopePalace)),indices=unique(direct.flatMap(e=>q.relations?[e.index,(e.index+4)%12,(e.index+8)%12,(e.index+6)%12]:[e.index]));
   const kept=[...evidence.values()].filter(e=>e.scope===q.scope&&(q.scope==='natal'||solarISO(e.date)===date)&&indices.includes(e.index));
   if(direct.length===q.palaces.length&&kept.length===indices.length){stats.reusedQueries++;if(previousQuery.taskId===taskId){if(role==='candidate')previousQuery.role='candidate';}else executedQueries.push({taskId,query:queryValue,role});return kept.map(f=>observation(f,taskId,role,range));}
  }
  const c=q.scope==='natal'?input.chart:read(date),names=q.scope==='natal'?c.palaces.map(p=>p.name):c.layers[q.scope].palaceNames;
  const missing=q.palaces.filter(p=>!names.includes(p));if(missing.length)throw Error('HENOSIS_PALACE_MISSING:'+missing.join(','));
  const primary=q.palaces.map(p=>names.indexOf(p)),indices=unique(primary.flatMap(i=>q.relations?[i,(i+4)%12,(i+8)%12,(i+6)%12]:[i]));
  for(const scope of scopeOrder.slice(0,scopeOrder.indexOf(q.scope)+1))sources.set(c.transformationSources[scope].id,c.transformationSources[scope]);
  const ids=referenceIds(c,q.scope,indices).map(raw=>observation(keepFact(raw,taskId),taskId,role,range,c));
  if(!previousQuery){executedQueries.push({taskId,query:queryValue,role});stats.newQueries++;}
  return ids;
 }
 /** Engine age is monotonic under the existing normal lunar-year boundary policy. */
 function firstAge(age:number,upper='2100-12-31'){
  if(read(upper).age<age)return null;if(read(born).age>=age)return born;
  let low=0,high=daysBetween(born,upper);while(high-low>1){signal?.throwIfAborted();const mid=Math.floor((low+high)/2);if(read(addDays(born,mid)).age<age)low=mid;else high=mid;}return addDays(born,high);
 }
 function decadeRange(index:number){
  const d=input.chart.decades[index];if(!d)return null;const id='decade:'+d.ageRange.join('-'),saved=decades.get(id);if(saved)return saved;
  const start=firstAge(d.ageRange[0]);if(!start)return null;const after=firstAge(d.ageRange[1]+1),end=after?addDays(after,-1):'2100-12-31';
  if(!same(read(start).transformationSources.decadal.ageRange,d.ageRange)||!same(read(end).transformationSources.decadal.ageRange,d.ageRange))throw Error('HENOSIS_DECADE_BOUNDARY_MISMATCH');
  const result={id,ordinal:index+1,start,end,ageRange:d.ageRange,yearRange:d.yearRange,palace:d.palaceName,complete:!!after};decades.set(id,result);return result;
 }
 const previousAnnuals=new Map<string,string[]>();
 function history(taskId:string,targetDate:string,palaces:string[],includeAnnuals=true){
  const annualPolicy=includeAnnuals?'elapsed_before_target_year' as const:'not_requested' as const;
  const c=read(targetDate),index=c.decades.findIndex(d=>same(d.ageRange,c.transformationSources.decadal.ageRange));
  if(index<0){const binding={taskId,targetDate,targetAnnualAge:c.age,parentDecade:null,palaces,annualPolicy,previousDecades:[],previousAnnuals:[],cutoff:asOf};historyBindings.set(historyKey(binding),binding);return;}
  const d=decadeRange(index);if(!d)return;const bindingKey=historyKey({taskId,parentDecade:d.id,targetAnnualAge:c.age,palaces,annualPolicy});
  if(historyBindings.has(bindingKey))return;
  const previousDecades:string[]=[];
  for(let i=Math.max(0,index-settings.historyDecades);i<index;i++){
   const old=decadeRange(i);if(!old)continue;previousDecades.push(old.id);
   query(taskId,{scope:'decadal',date:old.start,palaces,relations:true},'retrospective',old);
  }
  const currentAnnualStart=firstAge(c.age,targetDate),priorEnd=currentAnnualStart?addDays(currentAnnualStart,-1):null,annuals:string[]=[];
  if(includeAnnuals&&priorEnd&&priorEnd>=d.start){
   for(const period of splitTimingPeriods(read,d.start,priorEnd,signal)){
    const key=taskId+'|'+period.start+'|'+period.end+'|'+palaces.join(','),cached=previousAnnuals.get(key);
    const ids=cached||query(taskId,{scope:'yearly',date:period.start,palaces,relations:true},'retrospective',period);previousAnnuals.set(key,ids);annuals.push(...ids);
   }
  }
  historyBindings.set(bindingKey,{taskId,targetDate,targetAnnualAge:c.age,parentDecade:d.id,palaces,annualPolicy,previousDecades,previousAnnuals:unique(annuals),cutoff:asOf});
 }
 function inspectTarget(taskId:string,q:DatedQuery,role:HenosisObservation['role']='candidate',range?:Range){
  if(q.scope==='decadal'&&!range){const c=read(q.date),index=c.decades.findIndex(d=>same(d.ageRange,c.transformationSources.decadal.ageRange));const d=decadeRange(index);if(d)range={start:d.start,end:d.end};}
  const ids:string[]=[];
  for(const scope of scopeOrder.slice(0,scopeOrder.indexOf(q.scope)+1))ids.push(...query(taskId,{...q,scope,date:scope==='natal'?born:q.date},scope==='natal'?'natal':role,scope==='natal'?undefined:range));
  if(q.scope!=='natal')history(taskId,q.date,q.palaces,q.scope!=='decadal');return ids;
 }
 async function investigateTiming(taskId:string,request:TimingRequest,palaces:string[]){
  const prior=previous?.plan.tasks.find(t=>t.id===taskId),compatible=prior?.timingRequest?.detail===request.detail&&same(prior.timingRequest.plan?.constraints?.excludedYears||[],request.plan?.constraints?.excludedYears||[]);
  let segments=(compatible?prior?.timing?.segments||[]:[]).filter(s=>s.start>=request.start&&s.end<=request.end);
  const newRanges=subtractRanges(request.start,request.end,segments);
  for(const r of newRanges){
   signal?.throwIfAborted();input.onProgress?.(`${taskId} · 补取 ${r.start} 至 ${r.end} 的${request.detail==='yearly'?'流年':request.detail==='monthly'?'流月':'流日'}依据`);
   const a=await analyzeTiming(read(asOf>=born?asOf:born),{...request,...r,palaces,comparisonMode:'descriptive'},signal,undefined,read);
   const errors=timingAnalysisIssues(a);if(errors.length)throw Error('HENOSIS_TIMING_COVERAGE:'+errors.join(','));
   segments.push(...(timingRecord(a).segments||[]));
  }
  segments=segments.sort((a,b)=>a.start.localeCompare(b.start));
  const exclusions=new Set(request.plan?.constraints.excludedYears||[]);
  let periods=0;
  for(const segment of segments){
   if(request.detail==='daily'){
    for(let date=segment.start;date<=segment.end;date=addDays(date,1)){if(exclusions.has(+date.slice(0,4)))continue;inspectTarget(taskId,{scope:'daily',date,palaces,relations:true},'candidate',{start:date,end:date});periods++;}
   }else{inspectTarget(taskId,{scope:request.detail,date:segment.date,palaces,relations:true},'candidate',segment);periods++;}
  }
  const missing=subtractRanges(request.start,request.end,[...segments,...[...exclusions].map(y=>({start:`${y}-01-01`,end:`${y}-12-31`}))]);
  const record:TimingRecord={version:1,goal:request.goal,start:request.start,end:request.end,windows:[],plan:request.plan,palaces,segments,coverage:{version:1,requested:request.requested||{start:request.start,end:request.end,detail:request.detail},actual:{start:segments[0]?.start||null,end:segments.at(-1)?.end||null,detail:request.detail,days:segments.reduce((n,s)=>n+daysBetween(s.start,s.end)+1,0),periods},excludedYears:[...exclusions],stopReason:segments.length?exclusions.size?'user_exclusions':'complete':'no_periods'}};
  return {record,missing:missing.map(r=>r.start+'..'+r.end),periods};
 }

 for(const task of plan.tasks){
  signal?.throwIfAborted();const failures:string[]=[];
  if(task.reasonCodes.includes('subject_identity_required')||task.coverage?.status==='unavailable'&&!task.timingRequest){coverage.push({taskId:task.id,status:'unavailable',reason:task.coverage?.reason||'缺少该任务需要的命例身份',missing:['subject_or_scope']});continue;}
  if(!task.needsChart||task.precision==='none'){coverage.push({taskId:task.id,status:'not_applicable',reason:'本任务无需个人命盘',missing:[]});continue;}
  if(task.coverage?.status==='partial'&&!task.timingRequest)failures.push(task.coverage.reason);
  try{
   query(task.id,{scope:'natal',date:born,palaces:task.palaces,relations:true},'natal');
   if(task.precision!=='natal'){
    if(asOf<born)failures.push('当前观察截止点早于命例出生');
    else{
     const current=timingEnvironment(read(asOf),task.palaces);environments.set(task.id,{taskId:task.id,referenceDate:asOf,chronologicalAge:current.chronologicalAge,nominalAge:current.nominalAge,decade:current.decade});
     inspectTarget(task.id,{scope:'yearly',date:asOf,palaces:task.palaces,relations:true},'current',{start:asOf,end:asOf});
    }
   }
   if(task.timingRequest){
    if(task.timingRequest.issue)failures.push(task.timingRequest.issue);
    else{const result=await investigateTiming(task.id,task.timingRequest,task.palaces);task.timing=result.record;failures.push(...result.missing);task.coverage={status:result.missing.length?'partial':'complete',precision:task.precision,periods:result.periods,reason:'按实际运限边界保留全部候选区段；没有缩减为初筛窗口'};}
   }else for(const q of task.queries){if(task.precision==='natal'?q.scope==='natal':q.scope!=='natal')inspectTarget(task.id,q);}
   for(const added of plan.henosis.additions.filter(a=>a.taskId===task.id))inspectTarget(task.id,added.query);
  }catch(error){if(signal?.aborted)throw error;failures.push(error instanceof Error?error.message:'HENOSIS_EVIDENCE_FAILED');}
  const completed=[...references.values()].some(r=>r.taskIds.includes(task.id));
  const result={taskId:task.id,status:failures.length?completed?'partial' as const:'unavailable' as const:'complete' as const,reason:failures.length?'仍有明确未取得的范围，不能把已有材料当成全部覆盖':task.precision==='natal'?'仅本命属性资料；未注入运限历史':'本命、观察时点、真实运限历史及候选范围已分别取数',missing:unique(failures)};
  coverage.push(result);issues.push(...failures.map(f=>task.id+': '+f));
  task.coverage={status:result.status,precision:task.precision,periods:task.timing?.coverage?.actual.periods||executedQueries.filter(q=>q.taskId===task.id&&q.role==='candidate').length||Number(completed),reason:result.reason,missing:result.missing};
  task.queries=mergeQueries(executedQueries.filter(q=>q.taskId===task.id&&(q.role==='candidate'||q.query.scope==='natal')).map(q=>q.query));
 }
 plan.status='executed';
 const allObservations=[...observations.values()].sort((a,b)=>a.date.localeCompare(b.date)||scopeOrder.indexOf(a.scope)-scopeOrder.indexOf(b.scope)||a.id.localeCompare(b.id));
 const hypotheses=deriveHenosisHypotheses(allObservations,plan,[...references.values()]);
 const natalRegistry=allObservations.filter(o=>o.scope==='natal').map(o=>({id:o.id,index:o.palaceIndex,palace:o.palace,stars:o.stars,transformationIds:evidence.get(o.evidenceIds[0])?.transformationIds||[]}));
 const context={version:1,referenceDate:plan.referenceDate,asOf,perspective:plan.henosis.perspective,chartVersion:version,ruleVersion:HENOSIS_RULE_VERSION,environments:[...environments.values()],natalRegistry,sourceRegistry:[...sources.values()],decades:[...decades.values()].sort((a,b)=>a.start.localeCompare(b.start)),observations:allObservations.filter(o=>o.scope!=='natal').map(({stars,transformations,...o})=>({...o,natalRef:natalId(o.palaceIndex),flowingStars:stars,transformationIds:(sources.get(`${o.scope}@${o.date}`)?.mutations||[]).filter(t=>t.palaceIndex===o.palaceIndex).map(t=>t.id)})),historyBindings:[...historyBindings.values()],hypotheses,references:[...references.values()],coverage,rules:henosisRuleCatalog,issues,semantics:{natal:'星曜固定信息仅保存在natalRegistry；运限宫位通过natalRef引用其落入的物理宫位',projection:'相对asOf尚未到达的盘面是推演，不能作为用户已经历事实；retrospective角色仅表示相对目标期更早',history:'历史取数不是经历记录；只比较同一维度的条件性解释',candidate:'全部区段用于比较；边界不是推荐行动日期'},stats};
 const compact=compactEvidenceContext(context);
 return {version:1,chartVersion:version,referenceDate:plan.referenceDate,plan,observations:allObservations,hypotheses,evidence:[...evidence.values()],references:[...references.values()],coverage,issues,executedQueries,context:{...compact,contextTokensEstimate:estimateTokens(JSON.stringify(compact))}};
}
