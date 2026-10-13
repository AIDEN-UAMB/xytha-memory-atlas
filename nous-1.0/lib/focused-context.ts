import type {ChartData,Scope} from './chart-model';
import type {DialogueContext} from './dialogue';
import {comparisonRequest,comparisonQueries} from './decision';
import type {DatedQuery} from './query-dates';
import {MAIN_STARS} from './knowledge-contract';
import type {Evidence} from './workflow';
import {precisionTier,TIER_SCOPES,starSignal,isRetrospective,retrospectiveYears,futureYears,matchedTopics} from './analysis-strategy';

export function chartDossier(chart:ChartData,selectedPalaces?:string[]){
 const natal=chart.transformationSources.natal;
 const sig=(type:string|undefined,name:string)=>starSignal(type,name);
 return {kind:'computed_structure_not_biography',version:chart.ruleVersion,
  signalKey:'分层分析方法：纯属性问题只分析本命；涉及时间时按本轮analysisPlan实际提供层级依次解释。需要三层时，第一层本命相关宫位定整体基调与长期趋势；第二层大限相关宫位说明如何影响该基调（加强或削弱、变好或变差）；第三层流年相关宫位说明进一步体现与命中年份/时点。吉凶信号：吉星、禄存、四化禄/权/科、亮度庙/旺 = 有利；六煞、四化忌、亮度陷 = 不利；得/利/平、中性星 = 中性。信号只用于传统视角的条件性倾向与提醒，不生成确定性结论。健康类问题：只做体质/作息提醒，不推断病名、疾病概率、住院或手术应期。',
  columns:['palace','bodyPalace','stars(name,brightness,signal)','natalTransformations(star,value)'],
  palaces:chart.palaces.filter(p=>!selectedPalaces||selectedPalaces.includes(p.name)).map(p=>[p.name,p.isBodyPalace,
   [...p.majorStars,...p.minorStars,...p.adjectiveStars].map(s=>[s.name,s.brightness||null,sig(s.type,s.name)]),
   natal.mutations.filter(t=>t.palaceIndex===p.index).map(t=>[t.star,t.value])]),
  use:'全盘定位索引，非性格定论或用户自述；实际解释仅引用本轮精选factRefs。缺细节不补造。'};
}
/** Recognized tasks skip semantic planning; unfamiliar/date-sensitive tasks retain G1. */
export function focusedPlan(question:string,dialogue:DialogueContext,chart:ChartData,scope:Scope,today:string){
 const goal=dialogue.goal||question,themes=matchedTopics(goal);
 const pair=comparisonRequest(goal);
 if(pair)return {intent:'路径比较',mode:'answer' as const,questions:[],subquestions:pair.requirements.slice(0,3),outline:[],queries:comparisonQueries(chart,pair,today),missingFact:'',clarificationImpact:''};
 // Only bail to G1 when there is NO recognized topic, or when a month/day/age/timing
 // refinement needs the semantic planner. Multiple named years (2022…2024) stay here so
 // every year is queried deterministically instead of leaving the choice to the model.
 if(!themes.length||(!isRetrospective(goal)&&/哪.{0,5}大限|\d{1,2}月|\d{1,2}[日号]|[一二三四五六七八九十]+月|岁|流月|流日|去年|前年|后年|过去|两年|[上下前后第].{0,4}大限/.test(goal)))return null;
 const namedYears=[...goal.matchAll(/\b(19\d{2}|20\d{2}|2100)(?:年|\b)/g)].map(m=>m[1]);
 const range=goal.match(/(19\d{2}|20\d{2}|2100)年?\s*(?:至|到|[-—~～])\s*(19\d{2}|20\d{2}|2100)年?/);
 const expanded=range&&Number(range[2])>=Number(range[1])?Array.from({length:Math.min(20,Number(range[2])-Number(range[1])+1)},(_,i)=>String(Number(range[1])+i)):namedYears;
 const allYears=[...new Set(expanded)].slice(0,20);
 const tier=precisionTier(goal);
 const layers:Scope[]=tier==='natal'?['natal']:TIER_SCOPES[tier];
 const selected=[...new Set(themes.flatMap(t=>t.palaces))];
 const retrospective=isRetrospective(goal);
 const future=futureYears(goal,today);
 const yearDates=retrospective?retrospectiveYears(goal,today):future.length?future:allYears.length?allYears:[today.slice(0,4)];
 const multiYear=yearDates.length>1;
 const queries:DatedQuery[]=[];
 const push=(scope:Scope,date:string)=>{for(let i=0;i<Math.ceil(selected.length/5);i++)queries.push({scope,date,palaces:selected.slice(i*5,i*5+5),relations:true});};
 for(const s of layers){
  if(s==='natal'){push('natal',chart.solarDate);continue;}
  if(multiYear){if(s==='decadal')for(const y of yearDates){if(y+'-07-01'<chart.solarDate||Number(y)>2100)continue;push('decadal',y+'-07-01');push('yearly',y+'-07-01');}continue;}
  else if(retrospective){
   if(s==='decadal')for(const y of yearDates)push('decadal',y+'-07-01');
   if(s==='yearly')for(const y of yearDates)push('yearly',y+'-07-01');
  }else{
   const d=yearDates.length===1&&(retrospective||future.length>0)?yearDates[0]+'-07-01':s==='yearly'&&allYears.length===1?allYears[0]+'-07-01':s==='decadal'&&allYears.length===1?allYears[0]+'-07-01':/明年/.test(goal)?String(Number(today.slice(0,4))+1)+'-07-01':today;
   push(s,d);
  }
 }
 return {intent:themes.map(t=>t.id).join('+'),mode:'answer' as const,questions:[],subquestions:themes.length>1?themes.map(t=>'分别回应'+t.id):[],outline:[],queries,missingFact:'',clarificationImpact:yearDates.length>1?`本轮按公历 ${yearDates[0]} 至 ${yearDates.at(-1)} 年逐年比较（最多 20 年）；未指定数量的未来几年按 3 年、过去几年按 10 年。`:''};
}
export function selectStructuralEvidence(evidence:Evidence[],question:string,targets:string[]){
 const support=['文昌','文曲','禄存','左辅','右弼','天魁','天钺'];
 return evidence.map(e=>({...e,stars:e.stars.filter(s=>MAIN_STARS.has(s.name)||s.transformations.length>0||question.includes(s.name)||(targets.includes(e.scopePalace)&&support.includes(s.name)))}));
}
export function focusedDialogue(d:any,history:any[]=[],memories:string[]=[]){
 return {goal:d?.goal,turnKind:d?.turnKind,clarificationAllowed:false,
  userStatements:(d?.userStatements||[]).slice(-8).map((s:string)=>s.slice(0,350)),
  recent:history.slice(-8).map(m=>({role:m.role,content:clipContext(m.content,1400)})),
  confirmedMemories:[...new Set(memories)].slice(0,20).map(s=>clipContext(s,400)),
  retention:{availableHistory:history.length,retainedHistory:Math.min(8,history.length),availableMemories:memories.length,retainedMemories:Math.min(20,new Set(memories).size)}};
}

function clipContext(text:string,limit:number){return text.length<=limit?text:text.slice(0,Math.floor(limit*.7))+'（中段已截取）'+text.slice(-Math.floor(limit*.3));}
