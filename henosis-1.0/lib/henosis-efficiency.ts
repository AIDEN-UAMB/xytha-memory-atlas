import type {HenosisPlan} from './henosis-contracts';
import type {HenosisPacket,HenosisDraft,HenosisDeliveryIssue} from './henosis-answer';

/** JSON column encoding only; no model summaries, sampling, or missing periods. */
export function encodeHenosisInvestigation(source:Record<string,any>){
 const result={...source},tables:Record<string,{columns:string[];rows:unknown[][]}>={};
 for(const key of ['facts','states','periods','candidates','sources']){
  const items=source[key];if(!Array.isArray(items)||items.length<4)continue;
  const columns=Object.keys(items[0]).filter(k=>items.every(item=>item[k]!==undefined));
  if(columns.length<3)continue;
  const rows=items.map(item=>[...columns.map(k=>item[k]),Object.fromEntries(Object.entries(item).filter(([k])=>!columns.includes(k)))]);
  const table={columns,rows};if(JSON.stringify(table).length>=JSON.stringify(items).length)continue;
  tables[key]=table;delete result[key];
 }
 if(Object.keys(tables).length){result.tables=tables;result.tableEncoding='For each tables[key], reconstruct key as rows.map(row => ({...Object.fromEntries(columns.map((name,i)=>[name,row[i]])),...row[columns.length]})). All rows and aliases are retained. Apply this before reading facts, states, periods, candidates or sources.';}
 return result;
}

/** Reserve one small correction/synthesis before admitting another large call.
 * Input is an estimate; returned cap bounds output, not a provider billing promise. */
export function henosisOutputAllowance(spent:number,inputEstimate:number,outputCap:number,phase:string,maximum=300000){
 const finishing=/repair|synthesis|decision/.test(phase);
 const reserve=finishing?0:phase.startsWith('refine')?64000:32768;
 const remaining=maximum-spent-Math.ceil(inputEstimate*1.1)-reserve;
 return Math.max(0,Math.min(outputCap,Math.floor(remaining)));
}

/** This is factual coverage shared by task writers, not another task's opinion. */
export function henosisGlobalCoverage(plan:HenosisPlan,packet:HenosisPacket){
 return plan.tasks.map(task=>({taskId:task.id,question:task.question,kind:task.kind,precision:task.precision,
  status:task.coverage?.status,range:task.timingRequest?{start:task.timingRequest.start,end:task.timingRequest.end}:null,
  candidates:packet.candidates.filter(c=>c.taskId===task.id).map(c=>({id:c.id,start:c.start,end:c.end}))}));
}

export type HenosisRepairSlot={id:string;kind:'conclusion'|'section'|'comparison';index?:number;value:unknown};
/** Restrict repairs to named prose slots. Missing structure still uses the existing
 * task repair. An unrecognized issue must never silently bypass validation. */
export function henosisRepairSlots(report:HenosisDraft['tasks'][number],issues:HenosisDeliveryIssue[]):HenosisRepairSlot[]|null{
 const slots=new Map<string,HenosisRepairSlot>();
 for(const issue of issues){
  if(!['STAR_MUTAGEN_MISMATCH','PALACE_STAR_MISMATCH','PRECISION_OVERREACH','LAYER_REFERENCE','LAYER_SCOPE','NATAL_ONLY','SECTION_SHALLOW','CANDIDATE_SHALLOW','CANDIDATE_REFERENCE','CONCLUSION_SHALLOW'].includes(issue.code))return null;
  if(issue.code==='CONCLUSION_SHALLOW'||issue.detail.startsWith('conclusion'))slots.set('conclusion',{id:'conclusion',kind:'conclusion',value:report.conclusion});
  else if(issue.detail.startsWith('comparison:')){
   const id=issue.detail.match(/^comparison:(c\d+)/)?.[1],index=report.comparison.findIndex(c=>c.candidateIds.includes(id||''));
   if(index<0)return null;slots.set('comparison:'+index,{id:'comparison:'+index,kind:'comparison',index,value:report.comparison[index]});
  }else{
   const kind=issue.detail.match(/^(natal|current|trajectory|synthesis)\b/)?.[1],index=report.sections.findIndex(s=>s.kind===kind);
   if(index<0)return null;slots.set('section:'+index,{id:'section:'+index,kind:'section',index,value:report.sections[index]});
  }
 }
 if(issues.some(i=>['STAR_MUTAGEN_MISMATCH','PALACE_STAR_MISMATCH','CANDIDATE_REFERENCE'].includes(i.code))){
  slots.set('conclusion',{id:'conclusion',kind:'conclusion',value:report.conclusion});
  report.sections.forEach((section,index)=>{if(section.kind==='synthesis')slots.set('section:'+index,{id:'section:'+index,kind:'section',index,value:section});});
 }
 return [...slots.values()];
}

export function mergeHenosisPatch(original:HenosisDraft,taskId:string,slots:HenosisRepairSlot[],raw:unknown):HenosisDraft{
 const value=raw as any;
 // A missing repair slot leaves that slot unchanged. It must not discard the
 // valid fixes of other slots; the full factual check still runs after merge.
 if(!value||!Array.isArray(value.patches)||!value.patches.length||value.patches.length>256)return original;
 const allowed=new Map(slots.map(s=>[s.id,s])),seen=new Set<string>(),draft=structuredClone(original),report=draft.tasks.find(t=>t.taskId===taskId);
 if(!report)return original;
 const requested=value.patches.filter((p:any)=>allowed.has(p?.id));
 for(const item of requested){
  // Some providers echo the supplied slot shape {id,kind,index,value}. It is
  // equivalent only when text/citations are present; never invent a repair.
  const patch=typeof item?.text==='string'?item:{...item,...(item?.value&&typeof item.value==='object'?item.value:{}),id:item?.id};
  const slot=allowed.get(patch?.id);if(!slot||requested.filter((p:any)=>p?.id===slot.id).length!==1||typeof patch.text!=='string'||!patch.text.trim()||patch.text.length>12000)continue;
  if(slot.kind==='conclusion'){if(patch.text.length>6000)continue;report.conclusion=patch.text;seen.add(slot.id);continue;}
  if(Array.isArray(patch.citations))patch.citations=patch.citations.filter((id:unknown)=>id!==null&&id!==undefined&&id!=='');
  if(!Array.isArray(patch.citations)||patch.citations.length>2048||patch.citations.some((id:unknown)=>typeof id!=='string'||!/^e\d+$/.test(id)))continue;
  const target=slot.kind==='section'?report.sections[slot.index!]:report.comparison[slot.index!];
  target.text=patch.text;target.citations=[...new Set(patch.citations)] as string[];
  seen.add(slot.id);
 }
 return seen.size?draft:original;
}

/** Keep all local fields necessary to fix the cited layer, including facts the
 * erroneous text never cited. Preserve parent layers for yearly comparisons. */
export function henosisRepairInvestigation(packet:HenosisPacket,taskId:string,slots:HenosisRepairSlot[]){
 const roles=new Set<string>(),candidateIds=new Set<string>();let all=false;
 for(const slot of slots){if(slot.kind==='conclusion')all=true;
  else if(slot.kind==='section'){const kind=(slot.value as any).kind;const role={natal:'natal',current:'current',trajectory:'retrospective'}[kind as string];if(role)roles.add(role);else all=true;}
  else for(const id of (slot.value as any).candidateIds)candidateIds.add(id);
 }
 const candidates=packet.candidates.filter(c=>c.taskId===taskId&&(all||candidateIds.has(c.id)));
 const periods=packet.periods.filter(p=>p.taskId===taskId&&(all||roles.has(p.role)||p.role==='natal'||p.role==='candidate'&&candidates.some(c=>p.start<=c.end&&p.end>=c.start)));
 const ids=new Set(periods.flatMap(p=>p.citations)),facts=packet.facts.filter(f=>ids.has(f.id)),stateIds=new Set(facts.map(f=>f.state));
 const states=packet.states.filter(s=>stateIds.has(s.id)),natalIds=new Set(facts.map(f=>f.natalRef)),sourceIds=new Set(states.flatMap(s=>s.sourceIds));
 return {...packet,periods,candidates,facts,states,natalRegistry:packet.natalRegistry.filter(n=>natalIds.has(n.id)),sources:packet.sources.filter(s=>sourceIds.has(s.id)),hypotheses:[],environments:packet.environments.filter((e:any)=>!e.taskId||e.taskId===taskId),coverage:packet.coverage.filter(c=>c.taskId===taskId)};
}
