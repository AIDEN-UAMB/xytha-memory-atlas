import {CHART_CONFIG,type ChartData} from './chart';
import {addDays,daysBetween} from './timing-request';

export type ChartPeriod={start:string;end:string;chart:ChartData};
const yearKey=(c:ChartData)=>JSON.stringify([c.age,...(['decadal','yearly'] as const).map(scope=>{const o=c.layers[scope];return [o.index,o.name,o.heavenlyStem,o.earthlyBranch,o.palaceNames,o.mutagen,o.stars];})]);
const monthKey=(c:ChartData)=>JSON.stringify([yearKey(c),c.layers.monthly]);

/** Normal-mode lunar months last 29/30 days; a leap month may change on day 16.
 * Consecutive month/annual/decade transitions are therefore at least 14 days apart.
 * Probe in 14-day steps and bisect an observed transition: no daily chart scan,
 * no assumed Gregorian month, and no daily horoscope participates in the result.
 * This invariant is covered against every engine day in ordinary and leap years. */
export function splitMonthlyTimingPeriods(read:(date:string)=>ChartData,start:string,end:string,signal?:AbortSignal):ChartPeriod[]{
 if(CHART_CONFIG.horoscopeDivide!=='normal'||CHART_CONFIG.ageDivide!=='normal')throw Error('TIMING_BOUNDARY_RULE_UNSUPPORTED');
 const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='1900-01-01'&&d<='2100-12-31'&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 if(!valid(start)||!valid(end)||end<start||daysBetween(start,end)>20*366)throw Error('TIMING_BOUNDARY_RANGE');
 signal?.throwIfAborted();
 const periods:ChartPeriod[]=[];let from=start,cursor=start,current=read(start),key=monthKey(current);
 while(cursor<end){
  signal?.throwIfAborted();const next=addDays(cursor,Math.min(14,daysBetween(cursor,end))),observed=read(next);
  if(monthKey(observed)===key){cursor=next;continue;}
  let low=0,high=daysBetween(cursor,next);
  while(high-low>1){signal?.throwIfAborted();const mid=Math.floor((low+high)/2);if(monthKey(read(addDays(cursor,mid)))===key)low=mid;else high=mid;}
  const boundary=addDays(cursor,high);periods.push({start:from,end:addDays(boundary,-1),chart:current});
  from=cursor=boundary;current=boundary===next?observed:read(boundary);key=monthKey(current);
 }
 periods.push({start:from,end,chart:current});return periods;
}

/** The configured normal horoscope and age rules change at the same lunar New Year.
 * Within one civil year there is exactly one such boundary. Locate it from actual
 * engine observations, without extrapolating July 1 or scanning every day of ten years.
 * Fail explicitly if that engine rule changes: a different rule needs its own boundary proof. */
export function splitTimingPeriods(read:(date:string)=>ChartData,start:string,end:string,signal?:AbortSignal):ChartPeriod[]{
 if(CHART_CONFIG.horoscopeDivide!=='normal'||CHART_CONFIG.ageDivide!=='normal')throw Error('TIMING_BOUNDARY_RULE_UNSUPPORTED');
 const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='1900-01-01'&&d<='2100-12-31'&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 if(!valid(start)||!valid(end)||end<start||daysBetween(start,end)>20*366)throw Error('TIMING_BOUNDARY_RANGE');
 const periods:ChartPeriod[]=[];
 for(let y=Number(start.slice(0,4));y<=Number(end.slice(0,4));y++){
  signal?.throwIfAborted();
  const from=start>`${y}-01-01`?start:`${y}-01-01`,to=end<`${y}-12-31`?end:`${y}-12-31`;
  const first=read(from),firstKey=yearKey(first),last=from===to?first:read(to);
  if(firstKey===yearKey(last)){periods.push({start:from,end:to,chart:first});continue;}
  let low=0,high=daysBetween(from,to);
  while(high-low>1){signal?.throwIfAborted();const mid=Math.floor((low+high)/2);if(yearKey(read(addDays(from,mid)))===firstKey)low=mid;else high=mid;}
  const boundary=addDays(from,high);
  periods.push({start:from,end:addDays(boundary,-1),chart:first},{start:boundary,end:to,chart:read(boundary)});
 }
 return periods;
}
