import { astro } from 'iztro';
import {Birth,Scope,Star,Palace,Overlay,ChartData,birthSchema,scopeNames} from './chart-model';
import {transformationSources,evidenceSources} from './transformations';
export * from './chart-model';
export const CHART_CONFIG=Object.freeze({algorithm:'default',yearDivide:'normal',horoscopeDivide:'normal',ageDivide:'normal',dayDivide:'forward'} as const);
astro.config({...CHART_CONFIG});
const star=(s: {name:string;brightness?:string;mutagen?:string;type?:string}):Star=>({name:s.name,brightness:s.brightness||'',mutagen:s.mutagen||'',type:s.type||''});
const palaceName=(name:string)=>name==='仆役'||name==='奴仆'?'交友':name;
export function hourIndex(time:string){return Math.floor((Number(time.slice(0,2))+1)/2);}
function validSolar(date:string){const [y,m,d]=date.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d;}
export function createChartReader(input:Birth){
 const b=birthSchema.parse(input); const [y,m,d]=b.date.split('-').map(Number);
 if(y<1900||y>2100||m<1||m>12||d<1||d>31)throw Error('出生日期须在 1900–2100 年范围内。');
 if(b.calendar==='solar'&&!validSolar(b.date))throw Error('公历日期不存在，请检查日期。');
 const a=b.calendar==='lunar'?astro.byLunar(`${y}-${m}-${d}`,hourIndex(b.time),b.gender,b.leap,true,'zh-CN'):astro.bySolar(`${y}-${m}-${d}`,hourIndex(b.time),b.gender,true,'zh-CN');
 if(b.calendar==='lunar'){
  // Validate calendar round-trip independently of late-Zi day rollover.
  const raw=(hourIndex(b.time)===12?astro.byLunar(`${y}-${m}-${d}`,6,b.gender,b.leap,true,'zh-CN'):a).rawDates.lunarDate;
  if(raw.lunarYear!==y||raw.lunarMonth!==m||raw.lunarDay!==d||raw.isLeap!==b.leap)throw Error('该农历日期或闰月不存在，请核对。');
 }
 const birthSolar=a.solarDate.split('-').map(Number);
 const overlay=(o:ReturnType<typeof a.horoscope>['daily']):Overlay=>({index:o.index,name:o.name,heavenlyStem:o.heavenlyStem,earthlyBranch:o.earthlyBranch,palaceNames:o.palaceNames.map(palaceName),mutagen:[...o.mutagen],stars:(o.stars||Array.from({length:12},()=>[])).map(ss=>ss.map(star))});
 const natalPalaces=a.palaces.map(p=>({index:p.index,name:palaceName(p.name),heavenlyStem:p.heavenlyStem,earthlyBranch:p.earthlyBranch,isBodyPalace:p.isBodyPalace,majorStars:p.majorStars.map(star),minorStars:p.minorStars.map(star),adjectiveStars:p.adjectiveStars.map(star),decadal:{range:[...p.decadal.range]}}));
 const natalDecades=a.decadalList().map(o=>({...overlay(o),ageRange:o.ageRange,yearRange:o.yearRange,palaceName:palaceName(o.palaceName)}));
 // Reuse the confirmed natal chart for a bounded interval scan; never share across requests/cases.
 return (target:string):ChartData=>{
 if(!/^\d{4}-\d{1,2}-\d{1,2}$/.test(target)||!validSolar(target))throw Error('请选择有效的推演日期。');
 const ty=Number(target.slice(0,4));if(ty<1900||ty>2100)throw Error('推演日期须在 1900–2100 年范围内。');
 const tar=target.split('-').map(Number);
 if(Date.UTC(tar[0],tar[1]-1,tar[2])<Date.UTC(birthSolar[0],birthSolar[1]-1,birthSolar[2]))throw Error('推演日期不能早于出生日期。');
 const h=a.horoscope(target,6);

 const chart:Omit<ChartData,'transformationSources'>={birth:b,solarDate:a.solarDate,lunarDate:a.lunarDate,chineseDate:a.chineseDate,time:a.time,timeRange:a.timeRange,fiveElementsClass:a.fiveElementsClass,soul:a.soul,body:a.body,palaces:natalPalaces,target,targetLunar:h.lunarDate,age:h.age.nominalAge,layers:{decadal:overlay(h.decadal),yearly:overlay(h.yearly),monthly:overlay(h.monthly),daily:overlay(h.daily)},decades:natalDecades,ruleVersion:'iztro 2.6.1 · 通行天盘 · 四化来源 v1'};
 return {...chart,transformationSources:transformationSources(chart,a.rawDates.chineseDate.yearly.join(''))};
 };
}
export function createChart(input:Birth,target:string):ChartData{return createChartReader(input)(target);}
/** Calendar-only conversion, with a round-trip guard for nonexistent lunar days/leap months. */
export function lunarSolarDate(date:string,leap=false){
 const [y,m,d]=date.split('-').map(Number),a=astro.byLunar(date,6,'男',leap,true,'zh-CN'),raw=a.rawDates.lunarDate;
 if(raw.lunarYear!==y||raw.lunarMonth!==m||raw.lunarDay!==d||raw.isLeap!==leap)throw Error('该农历日期或闰月不存在。');
 return a.solarDate.split('-').map((s,i)=>i?s.padStart(2,'0'):s).join('-');
}
export function referenceIds(c:ChartData,scope:Scope,indices:number[]){
 const sources=evidenceSources(c,scope);
 return indices.map(index=>{
  const p=c.palaces[index],o=scope==='natal'?null:c.layers[scope];
  return {id:`${scope}:P${index}`,index,scope,date:scope==='natal'?c.solarDate:c.target,label:`${scopeNames[scope]}·${o?o.palaceNames[index]:p.name}`,natalPalace:p.name,branch:p.heavenlyStem+p.earthlyBranch,
   natalPalaceStemBranch:p.heavenlyStem+p.earthlyBranch,scopePalace:o?o.palaceNames[index]:p.name,
   sources:sources.map(({mutations,...source})=>source),
   stars:[...p.majorStars,...p.minorStars,...p.adjectiveStars].map(s=>({...s,natalMutagen:s.mutagen,layerMutagen:o?(['禄','权','科','忌'][o.mutagen.indexOf(s.name)]||''):'',transformations:sources.flatMap(source=>source.mutations.filter(t=>t.star===s.name&&t.palaceIndex===index))})),
   flowingStars:o?.stars[index]||[]};
 });
}
export function todayShanghai(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
