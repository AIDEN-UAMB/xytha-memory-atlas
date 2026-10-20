import {createChartReader,type ChartData} from './chart';
import {futureYears,isRetrospective,retrospectiveYears} from './analysis-strategy';
import {parseTemporalIntent} from './temporal-intent';
import {solarISO} from './query-dates';
import {PALACE_NAMES,resolveQuestionPalaces} from './question-domains';
export const PALACES=PALACE_NAMES;
export type PalaceName=typeof PALACES[number];
export const topicPalaces=(q:string):PalaceName[]=>resolveQuestionPalaces(q,{fallback:false}).filter((p):p is PalaceName=>PALACES.includes(p as PalaceName));
export async function digest(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function chartVersion(c:ChartData){const {name,confirmed,...birth}=c.birth;return digest({birth,ruleVersion:c.ruleVersion});}
export type MemoryTarget={id:string;taskId?:string;taskQuestion?:string;taskKind?:string;date:string;year:number;precision:'natal'|'year'|'date'|'period';scope?:'natal'|'decadal'|'yearly'|'monthly'|'daily';atemporal?:boolean;basis:string;palaces:PalaceName[];start?:string;end?:string};
/** Allocate the fixed card budget to every primary-palace period first, then distribute secondary palaces over the horizon. */
export function budgetMemoryTargets(targets:MemoryTarget[],limit=32,windows:{start:string;end:string}[]=[]):MemoryTarget[]{
 // Compound tasks share a fixed budget. One long annual horizon must not consume the entire allowance.
 const groups=new Map<string,MemoryTarget[]>();for(const t of targets){const key=t.taskId||'legacy';groups.set(key,[...(groups.get(key)||[]),t]);}
 if(groups.size>1){const entries=[...groups.values()],allocations=entries.map(()=>0);let left=Math.max(0,limit);while(left){let changed=false;for(let i=0;i<entries.length&&left;i++)if(allocations[i]<entries[i].reduce((n,t)=>n+t.palaces.length,0)){allocations[i]++;left--;changed=true;}if(!changed)break;}const selected=entries.flatMap((group,i)=>budgetMemoryTargets(group,allocations[i],windows));return targets.flatMap(t=>{const found=selected.find(s=>s.id===t.id);return found?[found]:[];});}
 const chosen=new Map<string,Set<PalaceName>>(),add=(t:MemoryTarget,p:PalaceName)=>{if(!chosen.has(t.id))chosen.set(t.id,new Set());chosen.get(t.id)!.add(p);};
 const primary=targets.filter(t=>t.palaces.length),count=Math.min(limit,primary.length);
 for(let i=0;i<count;i++){const index=count===1?0:Math.floor(i*(primary.length-1)/(count-1));add(primary[index],primary[index].palaces[0]);}
 let remaining=limit-count;if(remaining<=0)return targets.map(t=>({...t,palaces:[...(chosen.get(t.id)||[])]})).filter(t=>t.palaces.length);
 const candidates=targets.filter(t=>windows.some(w=>(t.start||t.date)<=w.end&&(t.end||t.date)>=w.start));
 const spread:MemoryTarget[]=[];
 // Interleave both ends, midpoint and intermediate periods so the secondary budget cannot only retain the earliest years.
 const visit=(lo:number,hi:number)=>{if(lo>hi)return;const mid=Math.floor((lo+hi)/2);spread.push(targets[mid]);visit(lo,mid-1);visit(mid+1,hi);};
 if(targets.length){spread.push(targets[0]);if(targets.length>1)spread.push(targets.at(-1)!);visit(1,targets.length-2);}
 const order=[...new Map([...candidates,...spread].map(t=>[t.id,t])).values()];
 for(let depth=1;depth<12&&remaining>0;depth++)for(const t of order){const p=t.palaces[depth];if(p&&!chosen.get(t.id)?.has(p)){add(t,p);if(--remaining===0)break;}}
 return targets.map(t=>({...t,palaces:[...(chosen.get(t.id)||[])]})).filter(t=>t.palaces.length);
}
const validDate=(d:unknown):d is string=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='1900-01-01'&&d<='2100-12-31'&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const knownPalaces=(values:unknown):PalaceName[]=>Array.isArray(values)?[...new Set(values.filter((p:any):p is PalaceName=>PALACES.includes(p)))]:[];
/** Dates belong to the question/actual computed queries, never the storage timestamp. */
export function memoryTargets(question:string,meta:any,referenceDate:string,mode:'archive'|'retrieval'='archive'):MemoryTarget[]{
 if(meta?.analysisPlan){
  if(mode==='archive'&&meta.analysisPlan.status==='planned')return [];
  const tasks=Array.isArray(meta.analysisPlan.tasks)?meta.analysisPlan.tasks:[];
  return tasks.slice(0,8).flatMap((task:any,i:number):MemoryTarget[]=>{
   const taskId=typeof task.id==='string'?task.id:'task'+i,ps=knownPalaces(task.palaces),prefix='a'+i+'-';
   if(task.needsChart===false||task.coverage?.status==='unavailable'||task.reasonCodes?.includes('subject_identity_required'))return [];
   if(task.precision==='none'||task.kind==='knowledge'||!ps.length)return [];
   if(task.precision==='natal')return [{id:prefix+'n',taskId,taskQuestion:String(task.question||'').slice(0,600),taskKind:task.kind,date:'',year:0,precision:'natal',scope:'natal',atemporal:true,basis:'本命属性，无事件年份；持久层年份 0 仅为无时间标记',palaces:ps}];
   const timing=task.timing||(mode==='retrieval'?task.timingRequest:null),plan=timing?.plan;
   if(plan?.version===1&&validDate(plan.start)&&validDate(plan.end)){
    // Only executed segments can become archive evidence. A retrieval plan may use civil-year bounds.
    if(mode==='archive'&&(!Array.isArray(timing.segments)||!timing.segments.length))return queryTargets(task,prefix,taskId,ps);
    const targets=memoryTargets(task.question||'',{timing:{...timing,palaces:ps}},referenceDate,mode);
    return targets.flatMap(t=>{const segment=timing.segments?.find((s:any)=>s.start===t.start&&s.end===t.end&&s.date===t.date);if(mode==='archive'&&!segment)return [];return [{...t,id:prefix+t.id,taskId,taskQuestion:String(task.question||'').slice(0,600),taskKind:task.kind,scope:segment?.scope||'yearly'}];});
   }
   return queryTargets(task,prefix,taskId,ps);
  });
 }
 const timing=meta?.timing,plan=timing?.plan,recordPalaces=knownPalaces(timing?.palaces),ps=recordPalaces.length?recordPalaces:topicPalaces(question);
 if(plan?.version===1&&validDate(plan.start)&&validDate(plan.end)&&plan.start<=plan.end){
  const segments=Array.isArray(timing.segments)?timing.segments:[];
  const periods=segments.filter((s:any)=>validDate(s.start)&&validDate(s.end)&&validDate(s.date)&&s.start<=s.date&&s.date<=s.end&&s.start>=plan.start&&s.end<=plan.end&&!plan.constraints?.excludedYears?.includes(+s.date.slice(0,4)));
  if(periods.length)return periods.map((s:any,i:number)=>({id:'t'+i,date:s.date,year:+s.date.slice(0,4),precision:'period' as const,start:s.start,end:s.end,basis:'本轮时间计划内由排盘引擎划分的实际流年／大限区段；date 为区段观测日',palaces:knownPalaces(s.palaces).length?knownPalaces(s.palaces):ps})).filter((t:MemoryTarget)=>t.palaces.length);
  // A request used for retrieval has a range but no computed periods yet. Do not claim an annual sample covers its whole year.
  return Array.from({length:+plan.end.slice(0,4)-+plan.start.slice(0,4)+1},(_,i)=>{
   const year=+plan.start.slice(0,4)+i,start=year+'-01-01'>plan.start?year+'-01-01':plan.start,end=year+'-12-31'<plan.end?year+'-12-31':plan.end;
   return {id:'t'+i,date:start,year,precision:'period' as const,start,end,basis:'时间计划的公历检索覆盖段；尚未划分实际运限边界',palaces:ps};
  }).filter(t=>t.palaces.length&&!plan.constraints?.excludedYears?.includes(t.year));
 }
 // Legacy records have no shared plan. Prefer actual computed dates, and remove background event years before parsing the question.
 const computed=(meta?.queries||[]).filter((q:any)=>q.scope!=='natal'&&validDate(q.date));
 if(computed.length)return [...new Set<string>(computed.map((q:any)=>q.date))].slice(0,48).map((date,i)=>({id:'t'+i,date,year:+date.slice(0,4),precision:'date' as const,basis:'旧记录中本轮实际排盘日期；不等同于全年覆盖',palaces:ps.length?ps:knownPalaces(computed.filter((q:any)=>q.date===date).flatMap((q:any)=>q.palaces||[]))})).filter(t=>t.palaces.length);
 question=parseTemporalIntent(question,referenceDate).targetText;
 const dateMatches=[...question.matchAll(/\b((?:19\d{2}|20\d{2}|2100))[-年](\d{1,2})[-月](\d{1,2})[日号]?/g)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
 let years=[...new Set([...question.matchAll(/\b(19\d{2}|20\d{2}|2100)年?/g)].map(m=>m[1]))];
 const range=question.match(/(19\d{2}|20\d{2}|2100)年?\s*(?:至|到|[-—~～])\s*(19\d{2}|20\d{2}|2100)年?/);
 if(range&&+range[2]>=+range[1])years=Array.from({length:Math.min(20,+range[2]-+range[1]+1)},(_,i)=>String(+range[1]+i));
 if(isRetrospective(question))years=retrospectiveYears(question,referenceDate);
 else if(!years.length){years=futureYears(question,referenceDate);if(!years.length&&/今年|明年|后年|去年|前年/.test(question))years=[String(+referenceDate.slice(0,4)+(/后年/.test(question)?2:/明年/.test(question)?1:/前年/.test(question)?-2:/去年/.test(question)?-1:0))];}
 const dates=(dateMatches.length?dateMatches:years.length?years.slice(0,20).map(y=>y+'-07-01'):[referenceDate]).filter(validDate);
 return dates.map<MemoryTarget>((date,i)=>({id:'t'+i,date,year:+date.slice(0,4),precision:years.length&&!dateMatches.length?'year':'date',basis:years.length&&!dateMatches.length?'旧记录公历所问年份；07-01 为年度排盘代表日，非全年逐日结论':'旧记录问题日期或本轮排盘参考日；无完整时间计划',palaces:ps})).filter(t=>t.palaces.length);
}
function queryTargets(task:any,prefix:string,taskId:string,ps:PalaceName[]):MemoryTarget[]{
 const queries=Array.isArray(task.queries)?task.queries:[];
 const combined=new Map<string,any>(),levels=['decadal','yearly','monthly','daily'];
 for(const q of queries.filter((q:any)=>q.scope!=='natal'&&validDate(q.date)).slice(0,48)){const existing=combined.get(q.date),palaces=knownPalaces(q.palaces).length?knownPalaces(q.palaces).filter(p=>ps.includes(p)):ps;combined.set(q.date,{date:q.date,scope:existing&&levels.indexOf(existing.scope)>levels.indexOf(q.scope)?existing.scope:q.scope,palaces:[...new Set([...(existing?.palaces||[]),...palaces])]});}
 return [...combined.values()].map((q:any,i:number)=>({id:prefix+'q'+i,taskId,taskQuestion:String(task.question||'').slice(0,600),taskKind:task.kind,date:q.date,year:+q.date.slice(0,4),precision:'date' as const,scope:levels.includes(q.scope)?q.scope:'yearly',basis:'该子任务实际执行的排盘观测日；不自动代表完整月份或年份',palaces:q.palaces})).filter((t:MemoryTarget)=>t.palaces.length);
}
export type FactRow={id:string;scope:string;palace:string;periodKey:string;data:any};
export type PalaceBinding={targetId:string;taskId?:string;palace:PalaceName;date:string;year:number;precision:string;atemporal?:boolean;basis:string;start?:string;end?:string;decade?:{ordinal:number|null;ageRange:number[];yearRange:number[];label:string};natalRef:string;decadalRef?:string;yearlyRef?:string;monthlyRef?:string;dailyRef?:string};
export async function buildPalaceFacts(chart:ChartData,targets:MemoryTarget[],profileId?:string,existingNatalRefs:Record<number,string>={}){
 const version=await chartVersion(chart),facts=new Map<string,FactRow>();
 const namespace=profileId?'p:'+await digest(profileId)+':':'';
 // Physical natal palaces are canonical. Transit palaces reference these stars rather than duplicating them.
 const natalIds=chart.palaces.map(p=>existingNatalRefs[p.index]||namespace+'n:'+version+':'+p.index);
 chart.palaces.forEach(p=>facts.set(natalIds[p.index],{id:natalIds[p.index],scope:'natal',palace:p.name,periodKey:'natal',data:{kind:'chart_calculation',chartVersion:version,scope:'natal',palace:p.name,index:p.index,heavenlyStem:p.heavenlyStem,earthlyBranch:p.earthlyBranch,isBodyPalace:p.isBodyPalace,majorStars:p.majorStars,minorStars:p.minorStars,adjectiveStars:p.adjectiveStars,ruleVersion:chart.ruleVersion}}));
 const bindings:PalaceBinding[]=[],read=createChartReader(chart.birth);
 for(const t of targets){
  if(t.atemporal||t.precision==='natal'){for(const palace of t.palaces){const natal=chart.palaces.find(p=>p.name===palace);if(natal)bindings.push({targetId:t.id,taskId:t.taskId,palace,date:solarISO(chart.solarDate),year:0,precision:'natal',atemporal:true,basis:t.basis+'；date 为出生日期存储锚点，不是分析事件时间',natalRef:natalIds[natal.index]});}continue;}
  if(t.date<solarISO(chart.solarDate))continue;const c=read(t.date),decadeIndex=c.decades.findIndex(d=>c.age>=d.ageRange[0]&&c.age<=d.ageRange[1]),decade=c.decades[decadeIndex];
  for(const palace of t.palaces){const refs:any={};
   const scopes:('decadal'|'yearly'|'monthly'|'daily')[]=t.scope==='decadal'?['decadal']:t.scope==='monthly'?['decadal','yearly','monthly']:t.scope==='daily'?['decadal','yearly','monthly','daily']:['decadal','yearly'];
   for(const scope of scopes){const o=c.layers[scope],index=o.palaceNames.indexOf(palace);if(index<0)continue;
    const source=c.transformationSources[scope],periodKey=scope==='decadal'?JSON.stringify({ages:decade?.ageRange||[],years:decade?.yearRange||[],name:o.name,stem:o.heavenlyStem,branch:o.earthlyBranch}):JSON.stringify({lunarYear:c.targetLunar.split(/[年-]/)[0],stem:o.heavenlyStem,branch:o.earthlyBranch});
    const precisePeriod=scope==='monthly'?periodKey+':'+c.targetLunar.split('月')[0]:scope==='daily'?periodKey+':'+t.date:periodKey;
    const data={kind:'chart_calculation',chartVersion:version,scope,scopePalace:palace,natalPalaceRef:natalIds[index],index,heavenlyStem:o.heavenlyStem,earthlyBranch:o.earthlyBranch,periodKey:precisePeriod,flowingStars:o.stars[index]||[],transformations:source.mutations.filter(m=>m.palaceIndex===index).map(({star,value,natalPalace,scopePalace})=>({star,value,natalPalace,scopePalace})),ruleVersion:c.ruleVersion};
    const id=namespace+scope+':'+await digest({version,data});facts.set(id,{id,scope,palace,periodKey:precisePeriod,data});refs[scope]=id;
   }
   const natal=chart.palaces.find(p=>p.name===palace);if(natal&&refs.decadal)bindings.push({targetId:t.id,taskId:t.taskId,palace,date:t.date,year:t.year,precision:t.precision,basis:t.basis,...(t.start&&t.end?{start:t.start,end:t.end}:{}),decade:{ordinal:decadeIndex<0?null:decadeIndex+1,ageRange:decade?.ageRange||[],yearRange:decade?.yearRange||[],label:decade?'第 '+(decadeIndex+1)+' 大限':'童限或未确定大限'},natalRef:natalIds[natal.index],decadalRef:refs.decadal,...(refs.yearly?{yearlyRef:refs.yearly}:{}),...(refs.monthly?{monthlyRef:refs.monthly}:{}),...(refs.daily?{dailyRef:refs.daily}:{})});
  }
 }
 return {version,facts:[...facts.values()],bindings};
}
