import type {ChartData,Scope} from './chart-model';
export const solarISO=(date:string)=>date.split('-').map((s,i)=>i?s.padStart(2,'0'):s).join('-');
export type DatedQuery={scope:Scope;date:string;palaces:string[];relations:boolean};
export function requestsCurrentDate(question:string){return /最近|近期|现在|目前|今天|今日/.test(question)&&!/最近[一二三四五六七八九十\d]+(?:年|个?月|天|周)|\b(?:19\d{2}|20\d{2}|2100)(?:年|[-/]|\b)|去年|明年|前年|后年|上个?月|下个?月|昨天|明天|前天|后天|上周|下周|过去|未来/.test(question);}
/** A model's tool arguments are proposals; birth dates and relative dates are resolved by code. */
export function resolveQueryDates<T extends DatedQuery>(question:string,chart:ChartData,queries:T[],today:string){
 const born=solarISO(chart.solarDate),reference=solarISO(chart.target);
 const years=[...question.matchAll(/\b(19\d{2}|20\d{2}|2100)(?:年|[-/]|\b)/g)].map(m=>m[1]);
 const recent=requestsCurrentDate(question);
 let corrected=0;let clarification='';
 const resolved=queries.map(query=>{
  let date=solarISO(query.date);
  if(query.scope==='natal')date=born;
  else{
   // Yearly scope switches by LUNAR year. A model that fills "2022年" as 2022-01-01
   // still lands in the previous lunar year (辛丑), so the 流年 palace is wrong.
   // When the user names only a year (no month/day), pin the representative date to
   // mid-year 07-01, after Lunar New Year, matching the engine's existing convention.
   if(query.scope==='yearly'&&/-01-01$/.test(date)&&!yearMentionHasMonthDay(question,date.slice(0,4)))date=date.slice(0,5)+'07-01';
   if(recent&&!years.includes(date.slice(0,4)))date=today;
   if(date<born){
    if(years.includes(date.slice(0,4))){clarification=`当前命例的公历出生日期是 ${born}。你想查看出生后的哪个时段，还是在询问另一个命例？`;}
    else date=(recent?today:reference)>=born?(recent?today:reference):born;
   }
  }
  if(date!==query.date)corrected++;
  return {...query,date};
 });
 return {queries:resolved,corrected,clarification};
}
/** True when "YYYY年" is followed by an explicit month/day, so 01-01 is a real date. */
function yearMentionHasMonthDay(question:string,year:string):boolean{
 return new RegExp(year+'年\\s*(?:[\\d一二三四五六七八九十]+\\s*月|[\\d一二三四五六七八九十]+\\s*[日号])').test(question);
}
export function conversationalOpening(question:string){
 const q=question.trim().replace(/[，,。.!！?？\s]/g,'');
 if(/^(你好|您好|嗨|哈喽|在吗|hello|hi)$/i.test(q))return {intent:'问候',content:'你好，我在。',clarify:false};
 if(/^(我|命主)?(最近|近期|现在)?(身体)?健康(上)?(要|需要|应该)?注意(些|一些)?什么[呢吗]?$/.test(q)||/^(我)?最近(身体|健康)(上)?(有|会有)什么问题$/.test(q))return {intent:'健康与日常状态',content:'你目前有具体不适吗？我会根据实际情况讨论，命盘不能用来判断疾病。',clarify:true};
 return null;
}
