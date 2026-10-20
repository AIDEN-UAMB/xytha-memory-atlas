import type {HenosisPacket} from './henosis-answer';
import type {HenosisRepairSlot} from './henosis-efficiency';
import {henosisRepairInvestigation} from './henosis-efficiency';

/** Exact engine facts rendered into explicit layer-labelled cards for a small
 * factual correction. This is serialization, never model summary or inference. */
export function henosisGroundedRepair(packet:HenosisPacket,taskId:string,slots:HenosisRepairSlot[]){
 const source=henosisRepairInvestigation(packet,taskId,slots);
 const labels:Record<string,string>={natal:'本命',decadal:'大限',yearly:'流年',monthly:'流月',daily:'流日'};
 const cards=source.facts.map(f=>{
  const natal=source.natalRegistry.find(n=>n.id===f.natalRef),state=source.states.find(s=>s.id===f.state);
  const mutations=(state?.transformations||[]) as string[][];
  return {id:f.id,date:f.date,flowSource:source.sources.filter(s=>state?.sourceIds.includes(s.id)&&s.scope===f.scope).map(s=>({stemBranch:s.stemBranch,periodLabel:s.periodLabel})),validPeriods:source.periods.filter(p=>p.scope===f.scope&&p.citations.includes(f.id)).map(p=>({start:p.start,end:p.end})),scope:labels[f.scope||'']||f.scope,palace:f.palace,natalPalace:natal?.palace,
   fixedStars:natal?.stars.map(s=>s.filter(Boolean).join('')).join('、')||'',
   flowingStars:state?.flowingStars||[],
   birthMutations:natal?.birthTransformations.map(([star,value])=>star+'化'+value)||[],
   transitMutations:mutations.map(([scope,star,value])=>(labels[scope]||scope)+'：'+star+'化'+value)};
 });
 return {cards,periods:source.periods,candidates:source.candidates,palaceRelations:packet.palaceRelations,decadeTransitions:packet.decadeTransitions.filter(t=>t.taskId===taskId),
  rule:'禁止把公历年初旧流年尾段说成全年。说明每年主体干支和旧流年尾段差异；同时出现两种干支不代表两种结构全年同在。每张卡片的 scope/palace 是该时层宫名，natalPalace 是其物理落点。birthMutations 仅为生年四化；transitMutations 每项显式标明所属时层。只能逐字采用实际存在的星曜-四化-层级组合，不凭年份记忆重算。不需要修复的其他段落保持原样。'};
}
