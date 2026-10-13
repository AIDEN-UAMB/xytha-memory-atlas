import type {HistoryMessage} from './dialogue';
import {compactAnalysisPlan} from './analysis-plan';

const clip=(s:unknown,n:number)=>typeof s==='string'?(s.length<=n?s:s.slice(0,Math.floor(n*.7))+'（中段已截取，原文保留）'+s.slice(-Math.floor(n*.3))):'';
export function historyMetadata(value:unknown){
 let m:any;try{m=typeof value==='string'?JSON.parse(value):value;}catch{return {};}
 if(!m||typeof m!=='object')return {};
 const out:any={};
 if(m.responseType==='answer'||m.responseType==='clarification')out.responseType=m.responseType;
 if(m.dialogue?.version===1)out.dialogue={version:1,goal:clip(m.dialogue.goal,3000),questionPolicy:m.dialogue.questionPolicy,comparisonYear:m.dialogue.comparisonYear};
 if(m.analysisPlan?.version===1)out.analysisPlan={version:1,id:m.analysisPlan.id,referenceDate:m.analysisPlan.referenceDate,chartVersion:m.analysisPlan.chartVersion,tasks:(m.analysisPlan.tasks||[]).slice(0,6).map((t:any)=>({id:t.id,question:clip(t.question,3000),kind:t.kind,precision:t.precision,palaces:(t.palaces||[]).slice(0,12),domains:(t.domains||[]).slice(0,13),timingRequest:t.timingRequest?{goal:clip(t.timingRequest.goal,3000),start:t.timingRequest.start,end:t.timingRequest.end,today:t.timingRequest.today,detail:t.timingRequest.detail,task:t.timingRequest.task,comparisonMode:t.timingRequest.comparisonMode,issue:clip(t.timingRequest.issue,1200)||undefined,deadline:t.timingRequest.deadline,requested:t.timingRequest.requested?{start:t.timingRequest.requested.start,end:t.timingRequest.requested.end,detail:t.timingRequest.requested.detail}:undefined,palaces:(t.timingRequest.palaces||[]).slice(0,12),plan:historyMetadata({timing:{version:1,plan:t.timingRequest.plan}}).timing?.plan,assumptions:(t.timingRequest.assumptions||[]).slice(0,12).map((s:unknown)=>clip(s,400))}:undefined,timing:t.timing?historyMetadata({timing:t.timing}).timing:undefined}))};
 if(m.timing?.version===1){
  out.timing={version:1,start:m.timing.start,end:m.timing.end,goal:clip(m.timing.goal,1200),windows:(m.timing.windows||[]).slice(0,8).map((w:any)=>({start:w.start,end:w.end}))};
  const p=m.timing.plan;
  if(p?.version===1){
   // Carry the resolved event/range through follow-ups, never the historic evidence graph.
   out.timing.plan={version:1,event:p.event,referenceDate:p.referenceDate,start:p.start,end:p.end,rangeSource:p.rangeSource,chronologicalAge:p.chronologicalAge,nominalAge:p.nominalAge,focusEnd:p.focusEnd,retrospective:p.retrospective,
    backgroundEvents:(p.backgroundEvents||[]).slice(0,12).map((e:any)=>({text:clip(e.text,160),year:e.year,date:e.date,relation:e.relation})),
    constraints:{deadline:p.constraints?.deadline,excludedYears:(p.constraints?.excludedYears||[]).slice(0,20)}};
   out.timing.palaces=(m.timing.palaces||[]).slice(0,12);
  }
 }
 return out;
}
/** Freeze the same bounded input for first execution and replay; never copy historical evidence graphs. */
export function compactSnapshot(value:any){
 const history:HistoryMessage[]=(value.history||[]).slice(-32).map((m:any)=>({role:m.role,content:clip(m.content,2400),meta:historyMetadata(m.meta)}));
 return {...value,...(value.analysisPlan?{analysisPlan:compactAnalysisPlan(value.analysisPlan)}:{}),history,memories:(value.memories||[]).slice(0,30).map((m:any)=>({content:clip(m.content,400)})),feedback:(value.feedback||[]).slice(0,6).map((f:any)=>({content:clip(f.content,1000),feedback:f.feedback}))};
}
