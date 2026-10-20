import {encodeHenosisInvestigation} from './henosis-efficiency';

/** Storage keeps normalized facts. Model-facing facts resolve the state join in
 * code so the model cannot accidentally attach another year's mutations. No
 * source row, star, period or candidate is sampled or summarized. */
export function henosisReadableInvestigation(source:Record<string,any>){
 if(!Array.isArray(source.facts)||!Array.isArray(source.states))return encodeHenosisInvestigation(source);
 const states=new Map<string,any>(source.states.map((state:any)=>[state.id,state]));
 const natal=new Map((source.natalRegistry||[]).map((row:any)=>[row.id,row]));
 const facts=source.facts.map((fact:any)=>{
  const state=states.get(fact.state),fixed=natal.get(fact.natalRef) as any;
  const flowSource=(source.sources||[]).find((s:any)=>s.scope===fact.scope&&state?.sourceIds?.includes(s.id));
  return {...fact,...(flowSource?{flowStemBranch:flowSource.stemBranch}:{}),...(state?{transformations:state.transformations,sourceIds:state.sourceIds,...(state.flowingStars?{flowingStars:state.flowingStars}:{})}:{}),
   ...(fixed?{natalPalace:fixed.palace,mainStars:fixed.stars.filter((star:any[])=>/^(紫微|天机|太阳|武曲|天同|廉贞|天府|太阴|贪狼|巨门|天相|天梁|七杀|破军)$/.test(star[0]))}:{})};
 });
 // Column encoding only removes repeated field names. Each resulting fact row
 // contains its own resolved mutations; there is no state-table join to infer.
 // natalRegistry holds full fixed stars once for the chart.
 const {states:_states,facts:_facts,...rest}=source;
 return {...encodeHenosisInvestigation({...rest,facts}),
  encodingGuide:(source.encodingGuide||'')+'\n按 tableEncoding 还原各表字段。每条 facts 已由程序展开该期四化、流曜、固定主星及对应本命宫位，不需要关联 states 表。flowStemBranch 明确该事实属于哪个干支流年，date 只是取样公历日；例如公历2027年初的丙午事实不能写作丁未流年或2027整年。transformations 每一项为 [所属时间层级,星名,四化]，不得把 decadal 写成 yearly。natalRef 对应 natalRegistry 中完整固定星曜和 birthTransformations；本命只存一次。state 为存储追溯编号。sources 保留来源区段，periods 保留全部本命、当前、前史和候选范围。'};
}
