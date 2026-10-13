import {createChartReader,referenceIds,scopeNames,scopeOrder,type ChartData,type Scope,type Transformation} from './chart';
import {addDays,daysBetween,type TimingRequest,type TimingRange} from './timing-request';
import type {DemandObservation} from './demand-observation';
import {splitTimingPeriods,splitMonthlyTimingPeriods,type ChartPeriod} from './timing-periods';
import {timingPalaces} from './timing-palaces';
import {temporalEvent} from './temporal-intent';
export {timingPalaces} from './timing-palaces';

type Evidence=ReturnType<typeof referenceIds>[number];
export type TimingHit=Transformation&{relation:'同宫'|'三合'|'对宫';focusPalace:string};
export type TimingLayer={scope:Scope;label:string;stemBranch:string;sourceId:string;focus:{palace:string;index:number;natalPalace:string}[];hits:TimingHit[]};
export type TimingDecade={ordinal:number|null;label:string;ageRange:number[];yearRange:number[];palace:string};
export type TimingSnapshot={date:string;lunar:string;nominalAge:number;decade:TimingDecade;layers:TimingLayer[];overlaps:{palaceIndex:number;natalPalace:string;hits:TimingHit[];mixed:boolean}[];supportLayers:Scope[];cautionLayers:Scope[]};
export type TimingPeriod={id:string;start:string;end:string;lunar:string;snapshot:TimingSnapshot};
export type TimingWindow=TimingPeriod&{days:TimingSnapshot[]};
export type TimingCoverage={version:1;requested:TimingRange;actual:{start:string|null;end:string|null;detail:TimingRange['detail'];days:number;periods:number};excludedYears:number[];stopReason:'complete'|'user_exclusions'|'deadline'|'birth_boundary'|'reference_boundary'|'granularity_coarsened'|'no_periods'};
export type TimingAnalysis={request:TimingRequest;palaces:string[];scannedDays:number;periods:TimingPeriod[];windows:TimingWindow[];evidence:Evidence[];method:string;coverage?:TimingCoverage;comparisonMode?:'descriptive';yearlyContext?:ReturnType<typeof buildYearlyContext>;monthlyContext?:ReturnType<typeof buildMonthlyContext>};
export type TimingRecord={version:1;goal:string;start:string;end:string;windows:{start:string;end:string}[];plan?:TimingRequest['plan'];palaces?:string[];coverage?:TimingCoverage;segments?:{start:string;end:string;date:string;year:number;scope:TimingRange['detail'];decadeOrdinal:number|null;palaces:string[]}[]};
export const timingRecord=(a:TimingAnalysis):TimingRecord=>({version:1,goal:a.request.goal,start:a.request.start,end:a.request.end,windows:a.windows.map(w=>({start:w.start,end:w.end})),plan:a.request.plan,palaces:a.palaces,coverage:a.coverage,segments:a.periods.flatMap(p=>{
 // A monthly window can span January 1 without an engine transition. Keep the
 // business window intact, but index its memory by each actual civil-year slice.
 return Array.from({length:Number(p.end.slice(0,4))-Number(p.start.slice(0,4))+1},(_,i)=>{const year=Number(p.start.slice(0,4))+i,start=p.start>`${year}-01-01`?p.start:`${year}-01-01`,end=p.end<`${year}-12-31`?p.end:`${year}-12-31`;return {start,end,date:start,year,scope:a.request.detail,decadeOrdinal:p.snapshot.decade.ordinal,palaces:a.palaces};});
})});

/** Keep requested and computed ranges separate; excluded dates never count as analysed. */
function withCoverage(a:TimingAnalysis):TimingAnalysis{
 const r=a.request,requested=r.requested||{start:r.start,end:r.end,detail:r.detail},excludedYears=[...new Set(r.plan?.constraints.excludedYears||[])].filter(y=>y>=+r.start.slice(0,4)&&y<=+r.end.slice(0,4));
 const actual={start:a.periods[0]?.start||null,end:a.periods.at(-1)?.end||null,detail:r.detail,days:a.periods.reduce((n,p)=>n+daysBetween(p.start,p.end)+1,0),periods:a.periods.length};
 const stopReason:TimingCoverage['stopReason']=!a.periods.length?'no_periods':requested.detail!==r.detail?'granularity_coarsened':r.deadline&&r.end<requested.end?'deadline':r.start>requested.start?(r.start===r.plan?.referenceDate?'reference_boundary':'birth_boundary'):excludedYears.length?'user_exclusions':'complete';
 a.coverage={version:1,requested,actual,excludedYears,stopReason};
 const issues=timingAnalysisIssues(a);if(issues.length)throw Error(issues.join(','));return a;
}
/** Structural validation only. Canonical chart and fact validation remain with the engine and registry. */
export function timingAnalysisIssues(a:TimingAnalysis):string[]{
 const r=a.request,issues:string[]=[],excluded=new Set(r.plan?.constraints.excludedYears||[]);
 const skipped=[...excluded].reduce((n,y)=>{const start=r.start>`${y}-01-01`?r.start:`${y}-01-01`,end=r.end<`${y}-12-31`?r.end:`${y}-12-31`;return n+(start<=end?daysBetween(start,end)+1:0);},0);
 let covered=0;for(const [i,p] of a.periods.entries()){
  if(p.start<r.start||p.end>r.end||p.end<p.start||p.snapshot.date<p.start||p.snapshot.date>p.end||i>0&&a.periods[i-1].end>=p.start)issues.push('TIMING_PERIOD_RANGE');
  for(let y=+p.start.slice(0,4);y<=+p.end.slice(0,4);y++)if(excluded.has(y))issues.push('TIMING_EXCLUDED_PERIOD');
  if(p.snapshot.layers.at(-1)?.scope!==(r.detail==='daily'?'monthly':r.detail))issues.push('TIMING_PERIOD_PRECISION');
  covered+=daysBetween(p.start,p.end)+1;
  if(r.detail!=='daily'&&!a.evidence.some(e=>e.scope===r.detail&&e.date===p.snapshot.date))issues.push('TIMING_PERIOD_EVIDENCE');
 }
 if(covered!==daysBetween(r.start,r.end)+1-skipped)issues.push('TIMING_COVERAGE_GAP');
 for(const w of a.windows){if(!a.periods.some(p=>p.id===w.id&&p.start===w.start&&p.end===w.end))issues.push('TIMING_WINDOW_RANGE');if(r.detail==='monthly'&&w.days.length)issues.push('TIMING_MONTHLY_DAILY_EXPANSION');}
 return [...new Set(issues)];
}

const good=(hit:TimingHit)=>hit.value!=='忌';
const descriptiveComparison=(request:TimingRequest)=>request.comparisonMode==='descriptive'||(request.plan?.event||temporalEvent(request.goal))==='health'||!!request.plan?.retrospective&&/哪(?:一|几|些)?年.{0,8}(?:最需要注意|最要注意|需要注意|要谨慎|压力最大|最不顺|是低谷)/.test(request.goal)&&!/什么时候|何时|适合|合适|择时|择日/.test(request.goal);
const descriptiveMethod='按实际起止范围和运限边界提供全部主题区段，按时间顺序对照本命、大限与相应流年，不使用有利行动窗口排序。支持与提醒是传统盘面分类，不是现实事件记录或个人健康风险高低；空 windows 表示本轮不选行动候选，不表示没有计算历史数据。';
function currentDecade(c:ChartData):TimingDecade{
 const index=c.decades.findIndex(d=>c.age>=d.ageRange[0]&&c.age<=d.ageRange[1]),d=c.decades[index];
 return {ordinal:d?index+1:null,label:d?`第 ${index+1} 大限`:c.layers.decadal.name,ageRange:d?.ageRange||[],yearRange:d?.yearRange||[],palace:d?.palaceName||c.palaces[c.layers.decadal.index]?.name||''};
}

/** Positions and source identities come from one observation, with no cross-date or cross-case cache. */
function snapshot(c:ChartData,depth:'monthly'|'daily'|'yearly',palaces:string[]):TimingSnapshot{
 const layers=scopeOrder.slice(0,scopeOrder.indexOf(depth)+1).map(scope=>{
  const source=c.transformationSources[scope],names=scope==='natal'?c.palaces.map(p=>p.name):c.layers[scope].palaceNames;
  const focus=palaces.map(palace=>({palace,index:names.indexOf(palace)})).filter(p=>p.index>=0).map(p=>({...p,natalPalace:c.palaces[p.index].name}));
  const hits:TimingHit[]=[];
  for(const mutation of source.mutations){
   const direct=focus.find(p=>p.index===mutation.palaceIndex),trine=focus.find(p=>[4,8].includes((mutation.palaceIndex-p.index+12)%12)),opposite=focus.find(p=>(mutation.palaceIndex-p.index+12)%12===6);
   const matched=direct||trine||opposite;if(matched)hits.push({...mutation,relation:direct?'同宫':trine?'三合':'对宫',focusPalace:matched.palace});
  }
  return {scope,label:source.label,sourceId:source.id,stemBranch:source.stemBranch,focus,hits};
 });
 const all=layers.flatMap(l=>l.hits),overlaps:TimingSnapshot['overlaps']=[];
 for(let index=0;index<12;index++){
  const hits=all.filter(h=>h.palaceIndex===index),scopes=new Set(hits.map(h=>h.scope));
  // A true long/short overlay must share a physical palace and include a decade/year plus the inspected short layer.
  if(scopes.has(depth)&&(scopes.has('decadal')||(depth!=='yearly'&&scopes.has('yearly')))){
   overlaps.push({palaceIndex:index,natalPalace:c.palaces[index].name,hits,mixed:hits.some(good)&&hits.some(h=>!good(h))});
  }
 }
 const supportLayers=layers.filter(l=>l.hits.some(h=>h.relation==='同宫'&&good(h))).map(l=>l.scope);
 const cautionLayers=layers.filter(l=>l.hits.some(h=>h.relation==='同宫'&&!good(h))).map(l=>l.scope);
 return {date:c.target,lunar:c.targetLunar,nominalAge:c.age,decade:currentDecade(c),layers,overlaps,supportLayers,cautionLayers};
}
function compare(a:TimingSnapshot,b:TimingSnapshot){
 // Transparent lexicographic comparison, not learned event probabilities or an invented weighted luck score.
 const joined=(s:TimingSnapshot)=>s.overlaps.filter(o=>o.hits.filter(good).some(h=>h.scope==='decadal'||(s.layers.at(-1)!.scope!=='yearly'&&h.scope==='yearly'))&&o.hits.filter(good).some(h=>h.scope===s.layers.at(-1)!.scope)).length;
 return joined(b)-joined(a)||a.cautionLayers.length-b.cautionLayers.length||b.supportLayers.length-a.supportLayers.length||a.date.localeCompare(b.date);
}
const signature=(s:TimingSnapshot)=>JSON.stringify(s.layers.map(l=>[l.scope,l.stemBranch,l.focus.map(f=>f.index),l.hits.map(h=>[h.star,h.value,h.palaceIndex]) ]));

export function timingEnvironment(c:ChartData,palaces:string[]){
 const [by,bm,bd]=c.solarDate.split('-').map(Number),[ty,tm,td]=c.target.split('-').map(Number),s=snapshot(c,'yearly',palaces);
 return {referenceDate:c.target,lunar:c.targetLunar,chronologicalAge:ty-by-Number(tm<bm||tm===bm&&td<bd),nominalAge:c.age,ageBasis:'周岁按公历生日；命盘虚岁与换限按引擎农历年规则',decade:s.decade,layers:s.layers.map(l=>({...l,focus:l.focus.map(f=>({...f,natalRef:`natal:P${f.index}`,flowingStars:l.scope==='natal'?[]:c.layers[l.scope].stars[f.index]}))}))};
}
function buildYearlyContext(current:ChartData,charts:ChartPeriod[],palaces:string[]){
 const currentEnvironment=timingEnvironment(current,palaces),natalIndices=new Set(currentEnvironment.layers.flatMap(l=>l.focus.map(f=>f.index)));
 const decades:{id:string;start:string;end:string;decade:TimingDecade;layer:ReturnType<typeof timingEnvironment>['layers'][number]}[]=[];
 const yearlyPeriods=charts.map(p=>{
  const environment=timingEnvironment(p.chart,palaces),s=snapshot(p.chart,'yearly',palaces),decadal=environment.layers.find(l=>l.scope==='decadal')!,yearly=environment.layers.find(l=>l.scope==='yearly')!;
  for(const l of environment.layers)for(const f of l.focus)natalIndices.add(f.index);
  const key=JSON.stringify([environment.decade.ordinal,environment.decade.ageRange,decadal.stemBranch,decadal.focus.map(f=>f.index)]);
  let d=decades.at(-1);
  if(!d||d.id!==key){d={id:key,start:p.start,end:p.end,decade:environment.decade,layer:decadal};decades.push(d);}else d.end=p.end;
  return {id:`year:${p.start}`,year:Number(p.start.slice(0,4)),start:p.start,end:p.end,observedOn:p.chart.target,nominalAge:p.chart.age,decadeId:key,yearlyLayer:yearly,supportLayers:s.supportLayers,cautionLayers:s.cautionLayers,overlaps:s.overlaps};
 });
 const natalPalaces=current.palaces.filter(p=>natalIndices.has(p.index)).map(p=>({id:`natal:P${p.index}`,index:p.index,palace:p.name,stemBranch:p.heavenlyStem+p.earthlyBranch,majorStars:p.majorStars,minorStars:p.minorStars,adjectiveStars:p.adjectiveStars}));
 return {currentEnvironment,natalPalaces,decades,yearlyPeriods,instructions:'先说明背景事件时间与目标搜索范围、当前周岁和命盘虚岁，再解释本命主题及当前大限/流年。按decades顺序先解释每一大限的主题环境，再覆盖该限全部yearlyPeriods，交界年分别说明实际区段；重点区间遵循request.plan.focusEnd。natalRef引用本命物理宫位星曜，flowingStars和hits属于注明的运限层，不混写。宫位解读只能说明可能倾向，不能当作用户实际想法或已发生事实。候选排序仅作同一标准的初筛，允许并列或无明显优势；不得凭支持层数量直接断定适合结婚。区段起止日仅是换年换限与查询边界，没有计算月日吉凶，不得宣称这些日期最适合行动。'};
}
function buildMonthlyContext(current:ChartData,charts:ChartPeriod[],palaces:string[]){
 const parents:ChartPeriod[]=[];let previous='';
 for(const p of charts){const key=signature(snapshot(p.chart,'yearly',palaces));if(parents.length&&key===previous&&addDays(parents.at(-1)!.end,1)===p.start)parents.at(-1)!.end=p.end;else parents.push({...p});previous=key;}
 const parent=buildYearlyContext(current,parents,palaces),natalIndices=new Set(parent.natalPalaces.map(p=>p.index));
 const monthlyPeriods=charts.map(p=>{
  const s=snapshot(p.chart,'monthly',palaces),layer=s.layers.at(-1)!,monthlyLayer={...layer,focus:layer.focus.map(f=>{natalIndices.add(f.index);return {...f,natalRef:`natal:P${f.index}`,flowingStars:p.chart.layers.monthly.stars[f.index]};})};
  return {id:`month:${p.start}`,start:p.start,end:p.end,observedOn:p.chart.target,nominalAge:p.chart.age,yearlyPeriodId:parent.yearlyPeriods.find(y=>y.start<=p.start&&y.end>=p.end)?.id,monthlyLayer,supportLayers:s.supportLayers,cautionLayers:s.cautionLayers,overlaps:s.overlaps};
 });
 return {...parent,natalPalaces:current.palaces.filter(p=>natalIndices.has(p.index)).map(p=>({id:`natal:P${p.index}`,index:p.index,palace:p.name,stemBranch:p.heavenlyStem+p.earthlyBranch,majorStars:p.majorStars,minorStars:p.minorStars,adjectiveStars:p.adjectiveStars})),monthlyPeriods,instructions:'先解释本命及相关大限、流年背景，再按monthlyPeriods的真实流月区段比较。每个monthlyLayer仅含流月事实，按yearlyPeriodId引用所属流年及大限；跨年换限先更新父层。观察日期和区段边界不是吉日，没有执行逐日比较，不得据此推荐具体日期。未选为候选的月段也有完整事实依据。'};
}

/** Monthly resolution stops at the monthly layer. Observe boundaries, not every day. */
async function analyzeMonths(c:ChartData,request:TimingRequest,read:ReturnType<typeof createChartReader>,palaces:string[],signal:AbortSignal|undefined,onScan:((done:number,total:number)=>void)|undefined,onChart:((chart:ChartData)=>void)|undefined,observer:DemandObservation|undefined):Promise<TimingAnalysis>{
 const excluded=new Set(request.plan?.constraints.excludedYears||[]),charts:ChartPeriod[]=[],periods:TimingPeriod[]=[];
 const intervals:{start:string;end:string}[]=[];
 // Preserve contiguous months across civil New Year unless that year is explicitly excluded.
 let from=request.start;
 for(let y=+request.start.slice(0,4);y<=+request.end.slice(0,4);y++)if(excluded.has(y)){const before=`${y}-01-01`;if(from<before)intervals.push({start:from,end:addDays(before,-1)});from=`${y+1}-01-01`;}
 if(from<=request.end)intervals.push({start:from,end:request.end});
 for(const interval of intervals)charts.push(...splitMonthlyTimingPeriods(read,interval.start,interval.end,signal));
 for(const [i,p] of charts.entries()){
  signal?.throwIfAborted();const snap=snapshot(p.chart,'monthly',palaces);onChart?.(p.chart);observer?.timing(p.chart,snap);
  periods.push({id:`month:${p.start}`,start:p.start,end:p.end,lunar:p.chart.targetLunar,snapshot:snap});onScan?.(i+1,charts.length);
  if(i%4===3)await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 const descriptive=descriptiveComparison(request),windows=(descriptive?[]:periods.slice().sort((a,b)=>compare(a.snapshot,b.snapshot)).slice(0,2)).map(p=>({...p,days:[] as TimingSnapshot[]}));
 if(onChart)for(const w of windows)if(w.start!==w.end)onChart(read(w.end));
 const registry=new Map<string,Evidence>();
 const collect=(chart:ChartData,scope:'natal'|'decadal'|'yearly'|'monthly')=>{
  const names=scope==='natal'?chart.palaces.map(p=>p.name):chart.layers[scope].palaceNames,indices=palaces.map(p=>names.indexOf(p)).filter(i=>i>=0),items=referenceIds(chart,scope,indices);
  observer?.record(chart,items,'timing_scan',palaces);for(const e of items){const id=`${scope==='natal'?chart.solarDate:chart.target}/${e.id}`;registry.set(id,{...e,id});}
 };
 const current=read(request.plan?.referenceDate||request.today);onChart?.(current);
 for(const scope of ['natal','decadal','yearly'] as const)collect(current,scope);
 let previousDecade='',previousYear='';
 for(const p of charts){
  // Current orientation and each target parent have scoped refs even when a compound
  // answer uses the shared fact registry instead of the full monthly context object.
  const d=currentDecade(p.chart),decadeKey=JSON.stringify([d.ordinal,d.ageRange,p.chart.layers.decadal.index,p.chart.layers.decadal.heavenlyStem]),yearKey=signature(snapshot(p.chart,'yearly',palaces));
  if(decadeKey!==previousDecade){collect(p.chart,'decadal');previousDecade=decadeKey;}
  if(yearKey!==previousYear){collect(p.chart,'yearly');previousYear=yearKey;}
  collect(p.chart,'monthly');
 }
 observer?.end();
 return withCoverage({request,palaces,scannedDays:periods.reduce((n,p)=>n+daysBetween(p.start,p.end)+1,0),periods,windows,evidence:[...registry.values()],monthlyContext:buildMonthlyContext(current,charts,palaces),...(descriptive?{comparisonMode:'descriptive' as const}:{}),method:descriptive?descriptiveMethod+'本轮仅比较至流月层，没有选取流日。':'按本命、大限、流年与流月的实际结构比较，按真实换月、闰月及换年换限边界分段；保留各区段事实并按相同规则初筛候选月份。仅观察边界以确认月层结构，不逐日扫描、不选择吉日。排序为传统象意参考，不是现实事件概率。'});
}

/** Cover the exact requested interval, splitting both civil years and actual lunar-year/decade boundaries.
 * Uses natal+decadal+yearly layers only; period boundary dates are not recommended action dates. */
async function analyzeYears(c:ChartData,request:TimingRequest,read:ReturnType<typeof createChartReader>,palaces:string[],signal:AbortSignal|undefined,onScan:((done:number,total:number)=>void)|undefined,onChart:((chart:ChartData)=>void)|undefined,observer:DemandObservation|undefined):Promise<TimingAnalysis>{
 const startYear=Number(request.start.slice(0,4)),endYear=Number(request.end.slice(0,4));
 const excluded=new Set(request.plan?.constraints.excludedYears||[]),periods:TimingPeriod[]=[],charts:ChartPeriod[]=[];const total=endYear-startYear+1-[...excluded].filter(y=>y>=startYear&&y<=endYear).length;let done=0;
 for(let y=startYear;y<=endYear;y++){
  signal?.throwIfAborted();
  if(excluded.has(y))continue;
  const from=request.start>`${y}-01-01`?request.start:`${y}-01-01`,to=request.end<`${y}-12-31`?request.end:`${y}-12-31`;
  for(const p of splitTimingPeriods(read,from,to,signal)){
   const chart=p.chart,snap=snapshot(chart,'yearly',palaces);charts.push(p);onChart?.(chart);observer?.timing(chart,snap);
   periods.push({id:`year:${p.start}`,start:p.start,end:p.end,lunar:chart.targetLunar,snapshot:snap});
  }
  done++;onScan?.(done,total);if(done%4===0||done===total)await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 // Keep the existing ranking, but two civil-year segments of one year are not two alternative years.
 const descriptive=descriptiveComparison(request),ranked=descriptive?[]:periods.slice().sort((a,b)=>compare(a.snapshot,b.snapshot)),selected=ranked.filter((p,i)=>ranked.findIndex(other=>other.start.slice(0,4)===p.start.slice(0,4))===i).slice(0,2);
 const windows=selected.map(p=>({...p,days:[p.snapshot]}));
 // The existing fact registry checks both interval endpoints against observed charts.
 // These endpoint reads establish the range, not an additional day-level recommendation.
 if(onChart)for(const w of windows)if(w.end!==w.start)onChart(read(w.end));
 const registry=new Map<string,Evidence>();
 const collect=(chart:ChartData,scope:'natal'|'decadal'|'yearly')=>{
  const names=scope==='natal'?chart.palaces.map(p=>p.name):chart.layers[scope].palaceNames,indices=palaces.map(p=>names.indexOf(p)).filter(i=>i>=0);
  const items=referenceIds(chart,scope,indices);observer?.record(chart,items,'timing_scan',palaces);
  for(const e of items){const id=`${scope==='natal'?chart.solarDate:chart.target}/${e.id}`;registry.set(id,{...e,id});}
 };
 const current=read(request.plan?.referenceDate||request.today);onChart?.(current);
 for(const scope of ['natal','decadal','yearly'] as const)collect(current,scope);
 let previousDecade='';
 for(const p of charts){
  // Every compared year has scoped fact references. Natal stars and unchanged decade evidence are reused.
  const d=currentDecade(p.chart),key=JSON.stringify([d.ordinal,d.ageRange,p.chart.layers.decadal.index,p.chart.layers.decadal.heavenlyStem]);
  if(key!==previousDecade){collect(p.chart,'decadal');previousDecade=key;}
  collect(p.chart,'yearly');
 }
 observer?.end();
 return withCoverage({request,palaces,scannedDays:total,periods,windows,evidence:[...registry.values()],yearlyContext:buildYearlyContext(current,charts,palaces),...(descriptive?{comparisonMode:'descriptive' as const}:{}),method:descriptive?descriptiveMethod:'按主题宫位及三方四正逐年比较，公历年内依据引擎实际农历换年及大限边界分段，完整覆盖指定起止日。保留原有透明初筛：先比较同宫长短层四化呼应，再比较提醒与支持层，条件相近时先列较早年份；模型须结合各层主题星曜结构和现实条件解释，可并列或无明显优势。化忌不等于一定不利，重复来源只算一次；排序不是事件概率，也不直接代表适合结婚。'});
}

/** Scan every included day, grouping only when ALL enclosing layers actually remain identical. */
export async function analyzeTiming(c:ChartData,request:TimingRequest,signal?:AbortSignal,onScan?:(done:number,total:number)=>void,reader?:ReturnType<typeof createChartReader>,onChart?:(chart:ChartData)=>void,observer?:DemandObservation):Promise<TimingAnalysis>{
 if(request.issue)throw Error('Invalid timing request');
 observer?.begin();
 const read=reader||createChartReader(c.birth),palaces=timingPalaces(request);
 if(request.detail==='yearly')return analyzeYears(c,request,read,palaces,signal,onScan,onChart,observer);
 if(request.detail==='monthly')return analyzeMonths(c,request,read,palaces,signal,onScan,onChart,observer);
 const count=daysBetween(request.start,request.end)+1;
 if(count<1||count>366)throw Error('Timing interval must contain 1–366 days');
 const periods:TimingPeriod[]=[],daily=new Map<string,TimingSnapshot[]>();
 let previousSignature='';
 for(let i=0;i<count;i++){
  signal?.throwIfAborted();const date=addDays(request.start,i);if(request.plan?.constraints?.excludedYears?.includes(+date.slice(0,4))){previousSignature='';continue;}const chart=read(date),month=snapshot(chart,'monthly',palaces),key=signature(month);
  onChart?.(chart);
  let period=periods.at(-1);
  if(!period||key!==previousSignature){period={id:`month:${date}`,start:date,end:date,lunar:chart.targetLunar,snapshot:month};periods.push(period);daily.set(period.id,[]);previousSignature=key;}
  const day=snapshot(chart,'daily',palaces);observer?.timing(chart,day);
  period.end=date;daily.get(period.id)!.push(day);
  if(i%16===15||i===count-1){onScan?.(i+1,count);await new Promise<void>(resolve=>setTimeout(resolve,0));}
 }
 const descriptive=descriptiveComparison(request);
 const windows=(descriptive?[]:periods.slice().sort((a,b)=>compare(a.snapshot,b.snapshot)).slice(0,2)).map(p=>{
  // Every day inside this month segment was evaluated, not a single day extrapolated to a month.
  const ordered=daily.get(p.id)!.slice().sort(compare),picked:TimingSnapshot[]=[];
  for(const d of ordered){if(picked.every(other=>Math.abs(daysBetween(other.date,d.date))>=3))picked.push(d);if(picked.length===2)break;}
  return {...p,days:picked};
 });
 const registry=new Map<string,Evidence>();
 for(const w of descriptive?periods.map(p=>({...p,days:[] as TimingSnapshot[]})):windows)for(const d of [w.snapshot,...w.days]){
  const observed=read(d.date),depth=d.layers.at(-1)!.scope;
  // Evidence carries all parent sources; chips remain limited to the physical palaces actually discussed.
  const indices=[...new Set([...d.overlaps.slice(0,1).map(o=>o.palaceIndex),...d.layers.map(l=>l.hits.find(h=>h.relation==='同宫')||l.hits[0]).filter((h):h is TimingHit=>!!h).map(h=>h.palaceIndex),...d.layers.at(-1)!.focus.map(f=>f.index)])];
  const items=referenceIds(observed,depth,indices);observer?.record(observed,items,'timing_scan',palaces);
  for(const e of items){const id=`${d.date}/${e.id}`;registry.set(id,{...e,id});}
 }
 observer?.end();
 return withCoverage({request,palaces,scannedDays:periods.reduce((n,p)=>n+daysBetween(p.start,p.end)+1,0),periods,windows,evidence:[...registry.values()],...(descriptive?{comparisonMode:'descriptive' as const}:{}),method:descriptive?descriptiveMethod:'按主题宫位及三方四正比较：先看大限/流年与流月（或流日）在同一物理宫位的禄权科呼应，再比较同宫化忌提醒与支持层；条件相近时取较早日期。化忌不等于一定不利，重复来源只算一次；该排序是透明的传统象意筛选，不是录取率或事件概率。'});
}

const range=(start:string,end:string)=>start===end?start:`${start} 至 ${end}`;
function layerLine(s:TimingSnapshot){
 return s.layers.map(l=>{
  const hit=l.hits.find(h=>h.relation==='同宫')||l.hits[0];
  return `${l.label}（${l.stemBranch}）${hit?`：${hit.star}化${hit.value}，${hit.relation}参照${hit.focusPalace}宫`:'：主题宫位及三方四正无本层四化落入'}`;
 }).join('；');
}
function overlayLine(s:TimingSnapshot){
 const o=s.overlaps[0];
 if(!o)return '这一观察日没有检出大限/流年与短期层在主题相关同一宫位的四化呼应，不把单层信号说成多层叠加。';
 return `叠加位置为本命${o.natalPalace}宫：${o.hits.map(h=>`${scopeNames[h.scope]}${h.star}化${h.value}`).join('、')}${o.mixed?'；支持与提醒同时存在，需要一起看':'；这些来源分别保留，不改写生年四化'}。`;
}
export const timingActions=(a:TimingAnalysis)=>a.comparisonMode==='descriptive'?'本轮按时间顺序提供传统主题对照；用户未陈述的经历和身体情况仍属未知，不能从盘面补造。':a.request.task==='application'?'材料准备可以现在开始；候选窗口用于资料齐备后的联系、复核或正式投递。若项目开放时间、官方截止日期或材料进度冲突，以实际安排为准，不要为了择日延误申请。':a.request.task==='career'?'先完成简历、沟通或合同核查，再用候选窗口安排行动；已确认的面试、入职或签约安排优先。':a.request.task==='relationship'?'候选日期用于安排沟通或共同准备，尊重双方意愿与已经约定的时间，不用命盘替代对方的真实态度。':'可以先推进不依赖择日的准备事项，具体行动以真实条件和已约定的时间为准。';
export type TimingAdvice={windowId:string;interpretation:string;action:string;caution:string};
export function ruleWindowExplanation(w:TimingWindow){
 const yearly=w.snapshot.layers.at(-1)!.scope==='yearly';
 const shortName=yearly?'流年':'流月';
 const supportive=w.snapshot.supportLayers.map(s=>scopeNames[s]).join('、'),cautions=w.snapshot.cautionLayers.map(s=>scopeNames[s]).join('、');
 return `${supportive?`${shortName}比较中，主题宫位的支持象意见于${supportive}`:`这段${shortName}没有检出主题宫位同宫的禄权科支持，不应把它描述成明显有利`}${cautions?`；${cautions}另有同宫提醒，行动前宜增加材料和沟通复核`:'；仍需检查实际准备是否到位'}。${w.snapshot.overlaps.length?`该${yearly?'年份':'窗口'}存在长周期与${shortName}的同宫呼应，可作为安排推进节奏的传统参考。`:`没有检出长周期与${shortName}的同宫呼应，采用此${yearly?'年份':'窗口'}时不应赋予额外的“叠加加成”。`}`;
}
export function renderTiming(a:TimingAnalysis,advice:TimingAdvice[]=[]){
 if(a.request.detail==='yearly')return renderYearlyTiming(a,advice);
 if(a.request.detail==='monthly')return renderMonthlyTiming(a,advice);
 if(a.comparisonMode==='descriptive')return [`实际对照范围：${range(a.request.start,a.request.end)}。${a.request.assumptions.join(' ')}`,timingActions(a),...a.periods.map(p=>`${range(p.start,p.end)}｜主题：${a.palaces.join('、')}\n分层依据：${layerLine(p.snapshot)}。`),a.method].join('\n\n');
 if(!a.windows.length)return `本轮扫描范围内无明显优势行动窗口。已比较 ${a.request.start} 至 ${a.request.end}，共 ${a.scannedDays} 天。\n${a.request.assumptions.join(' ')}\n${a.method}`;
 const first=a.windows[0],lead=a.request.detail==='daily'?`可先参考 ${first.days.map(d=>d.date).join('、')}${a.windows[1]?`；备选 ${a.windows[1].days.map(d=>d.date).join('、')}`:''}。`:`可先参考 ${range(first.start,first.end)}${a.windows[1]?`，备选 ${range(a.windows[1].start,a.windows[1].end)}`:''}。`;
 const parts=[`按本轮传统象意筛选，${lead}${timingActions(a)}`,a.request.assumptions.join(' ')];
 for(const [index,w] of a.windows.entries()){
  const n=advice.find(t=>t.windowId===w.id),d=w.days[0];
  parts.push(`${index===0?'优先参考':'备选窗口'}｜${range(w.start,w.end)}\n${n?`${n.interpretation}\n${n.action}\n${n.caution}`:ruleWindowExplanation(w)}\n可细化到：${w.days.map(day=>`${day.date}（${day.lunar}）`).join('、')}。\n${d.date} 的五层依据：${layerLine(d)}。\n${overlayLine(d)}`);
 }
 parts.push(`已逐日比较 ${a.request.start} 至 ${a.request.end}，共 ${a.scannedDays} 天、${a.periods.length} 段实际运限区间。公历月份不直接等于流月，农历换月、闰月分段以及年/大限切换均按排盘结果重新比较。\n${a.method}`);
 return parts.filter(Boolean).join('\n\n');
}
function renderMonthlyTiming(a:TimingAnalysis,advice:TimingAdvice[]=[]){
 const lead=a.comparisonMode==='descriptive'?'已按本轮主题完成流月对照。':a.windows.length?`可先参考 ${a.windows.map(w=>range(w.start,w.end)).join('；')} 所在的流月区段。`:'本轮按排除条件没有可比较的流月区段。';
 const parts=[`${lead}${timingActions(a)}`,`实际比较范围：${range(a.request.start,a.request.end)}。${a.request.assumptions.join(' ')}`];
 for(const p of a.periods){const w=a.windows.find(w=>w.id===p.id),n=advice.find(item=>item.windowId===p.id);parts.push(`${range(p.start,p.end)}｜${p.lunar}${w?'（候选月段）':''}\n${n?`${n.interpretation}\n${n.action}\n${n.caution}`:a.comparisonMode==='descriptive'?`本段主题：${a.palaces.join('、')}。`:ruleWindowExplanation({...p,days:[]})}\n四层依据：${layerLine(p.snapshot)}。`);}
 parts.push(`已覆盖 ${a.coverage?.actual.days??a.scannedDays} 天对应的 ${a.periods.length} 段实际流月区间。通过边界定位比较本命、大限、流年和流月；未逐日扫描，区段边界不是推荐吉日。\n${a.method}`);return parts.filter(Boolean).join('\n\n');
}
function renderYearlyTiming(a:TimingAnalysis,advice:TimingAdvice[]=[]){
 const lead=a.comparisonMode==='descriptive'?'已按本轮主题完成逐年对照。':a.windows.length?`本轮程序初筛列出 ${a.windows.map(w=>w.start.slice(0,4)+' 年').join('、')}，需结合全年分段和现实条件判断。`:'本轮未选出候选年份。';
 const excluded=a.request.plan?.constraints.excludedYears||[];
 const parts=[`${lead}${timingActions(a)}`,`实际比较范围：${range(a.request.start,a.request.end)}。${excluded.length?`按用户要求排除 ${excluded.join('、')} 年。`:''}${a.request.assumptions.join(' ')}`];
 const current=a.yearlyContext?.currentEnvironment;
 if(current)parts.push(`分析基准 ${current.referenceDate}：周岁 ${current.chronologicalAge} 岁、命盘虚岁 ${current.nominalAge} 岁，处于${current.decade.label}${current.decade.ageRange.length?`（${current.decade.ageRange.join('–')} 虚岁）`:''}。\n${current.layers.map(l=>`${scopeNames[l.scope]}主题：${l.focus.map(f=>`${f.palace}对应本命${f.natalPalace}`).join('、')}`).join('；')}。宫位象意属于条件性解读，不能据此确认用户实际想法。`);
 let previousDecade='';
 for(const p of a.periods){
  const s=p.snapshot,key=JSON.stringify([s.decade.ordinal,s.decade.ageRange,s.layers.find(l=>l.scope==='decadal')!.stemBranch]);
  if(previousDecade!==key){
   const l=s.layers.find(l=>l.scope==='decadal')!;
   parts.push(`${s.decade.label}${s.decade.ageRange.length?`（${s.decade.ageRange.join('–')} 虚岁）`:''}：${l.stemBranch}，${l.focus.map(f=>`大限${f.palace}对应本命${f.natalPalace}`).join('、')}。${previousDecade?'进入此限后重新比较该限背景与后续流年。':'先在这一阶段环境下比较相关流年。'}`);previousDecade=key;
  }
  const w=a.windows.find(w=>w.id===p.id),n=advice.find(t=>t.windowId===p.id);
  parts.push(`${p.start.slice(0,4)} 年｜实际区段 ${range(p.start,p.end)}${w?'（程序初筛候选）':''}\n${n?`${n.interpretation}\n${n.action}\n${n.caution}`:a.comparisonMode==='descriptive'?`本区段主题：${a.palaces.join('、')}，以下为传统盘面事实。`:ruleWindowExplanation({...p,days:[s]})}\n三层依据：${layerLine(s)}。\n${overlayLine(s)}`);
 }
 parts.push(`已覆盖 ${a.scannedDays} 个公历年份、${a.periods.length} 段实际运限区间。首尾年份仅覆盖上述起止日，区段日期是查询和换年换限边界，未据此推荐具体月日。\n${a.method}`);
 return parts.filter(Boolean).join('\n\n');
}

export function timingModelContext(a:TimingAnalysis){
 return {request:a.request,palaces:a.palaces,method:a.method,...(a.comparisonMode?{comparisonMode:a.comparisonMode}:{}),coverage:{...a.coverage,days:a.periods.reduce((n,p)=>n+daysBetween(p.start,p.end)+1,0),...(a.request.detail==='yearly'?{years:a.scannedDays,excludedYears:a.request.plan?.constraints.excludedYears||[]}:{}),periods:a.periods.map(p=>({id:p.id,start:p.start,end:p.end,nominalAge:p.snapshot.nominalAge,decade:p.snapshot.decade.ordinal,stemBranch:p.snapshot.layers.at(-1)!.stemBranch,supportLayers:p.snapshot.supportLayers,cautionLayers:p.snapshot.cautionLayers}))},...a.yearlyContext,...a.monthlyContext,windows:a.windows.map(w=>({id:w.id,start:w.start,end:w.end,monthly:w.snapshot,days:w.days})),practicalAdvice:timingActions(a)};
}

// Read-only reconstruction for the B′-2 fact guard; no additional iztro call or rescan.
export {snapshot as timingSnapshot};
