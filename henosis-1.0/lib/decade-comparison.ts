import type {ChartData} from './chart-model';
import type {DatedQuery} from './query-dates';

/** Query coverage only: no star meanings, luck scores or rule-selected winner. */
export function decadeComparisonRequest(question:string){
 if(!/大限/.test(question)||!/(?:哪(?:一|个|段|步|些)|最(?:好|佳|旺|强)|排名|排序|对比|比较)/.test(question))return null;
 if(/不是问|不问|不要比较|举例|例如|什么时候|哪天|哪个月|流月|流日/.test(question))return null;
 const topic=/财|收入|赚钱|积累|财富/.test(question)?'财运':/事业|工作|职业/.test(question)?'事业':/感情|婚姻|恋爱/.test(question)?'感情':null;
 if(!topic)return null;
 // Explicit subsets need the existing semantic planner, never silently expand their scope.
 if(/\d|[一二三四五六七八九十]+(?:岁|年|步)/.test(question))return null;
 return {topic,primaryPalace:topic==='财运'?'财帛':topic==='事业'?'官禄':'夫妻',futureOnly:/今后|以后|未来|接下来/.test(question)};
}
export function decadeComparisonPlan(question:string,chart:ChartData){
 const request=decadeComparisonRequest(question);if(!request)return null;
 const periods=chart.decades.filter(d=>!request.futureOnly||d.ageRange[1]>=chart.age).sort((a,b)=>a.ageRange[0]-b.ageRange[0]);
 const omitted:string[]=[],options:{id:string;label:string;date:string;ageRange:number[];yearRange:number[]}[]=[];
 for(const d of periods){
  const label=`${d.ageRange.join('–')}虚岁大限（农历年${d.yearRange.join('–')}）`;
  const start=Math.max(1900,d.yearRange[0]),end=Math.min(2100,d.yearRange[1]);
  if(start>end){omitted.push(label);continue;}
  // July lies after Lunar New Year; verify the actual iztro age range again after retrieval.
  const date=`${Math.floor((start+end)/2)}-07-01`;
  if(date<chart.solarDate.split('-').map((s,i)=>i?s.padStart(2,'0'):s).join('-')){omitted.push(label);continue;}
  options.push({id:`decade_${d.ageRange[0]}`,label,date,ageRange:d.ageRange,yearRange:d.yearRange});
 }
 const queries:DatedQuery[]=[{scope:'natal',date:chart.solarDate,palaces:[request.primaryPalace],relations:true},...options.map(o=>({scope:'decadal' as const,date:o.date,palaces:[request.primaryPalace],relations:true}))];
 return {...request,options,omitted,queries,coverage:'比较引擎1900–2100年范围内可计算的大限；童限不作为大限；每限按主题宫位及三方四正取数。代表日只用于取得大限，不是财运应期；不以某一流年代表整个大限。'};
}
export type DecadeComparison=NonNullable<ReturnType<typeof decadeComparisonPlan>>;
