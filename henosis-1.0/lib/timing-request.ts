import type {HistoryMessage} from './dialogue';
import {solarISO} from './query-dates';
import {createChart,lunarSolarDate,type ChartData} from './chart';
import {parseTemporalIntent,temporalEvent,temporalTask,temporalNumber,resetsTemporalContext,temporalFollowup,type TemporalPlan} from './temporal-intent';
import {matchQuestionDomains} from './question-domains';
export type {TemporalPlan} from './temporal-intent';

export type TimingRange={start:string;end:string;detail:'monthly'|'daily'|'yearly'};
export type TimingRequest={goal:string;start:string;end:string;today:string;detail:TimingRange['detail'];task:'application'|'career'|'relationship'|'general';assumptions:string[];deadline?:string;issue?:string;plan?:TemporalPlan;palaces?:string[];requested?:TimingRange;comparisonMode?:'descriptive'};
export type TimingResolveOptions={mode?:'action'|'descriptive';palaces?:string[]};
export const addDays=(date:string,n:number)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export const daysBetween=(start:string,end:string)=>Math.round((Date.parse(end)-Date.parse(start))/86400000);
const iso=(y:number,m:number,d:number)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='1900-01-01'&&s<='2100-12-31'&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const monthEnd=(y:number,m:number)=>iso(y,m,new Date(Date.UTC(y,m,0)).getUTCDate());
const number=temporalNumber;
const afterYears=(date:string,years:number)=>{const y=Number(date.slice(0,4))+years,m=Number(date.slice(5,7)),d=Math.min(Number(date.slice(8,10)),new Date(Date.UTC(y,m,0)).getUTCDate());return iso(y,m,d);};
const timingWords=/什么时候|何时|几月|哪(?:个|些)?月|哪(?:一|几|些)?年|哪(?:一|几)?天|哪段时间|具体.{0,6}时间|择[时日]|时间窗口|时机|细化到.{0,3}[日天]|具体.{0,3}日期/;
const periodWords=/今天|今日|明天|后天|上半年|下半年|季度|\bQ[1-4]\b|今年|明年|后年|去年|前年|本周|下周|本月|这个月|下个月|下月|未来|往后|接下来|最近|近期|\d{4}[-年]|[\d一二两三四五六七八九十]+月|流月|流日/i;
const actionWords=/申请|提交|投递|开始|面试|签约|入职|跳槽|考试|考研|升学|联系|沟通|结婚|领证|搬家|出行|适合|合适|选日/;
const excluded=/出生.{0,8}(什么时候|何时)|几点出生|时辰校准|发病|患病|得癌|死亡|车祸|手术/;
export const hasTimingIntent=(question:string)=>(timingWords.test(question)||(periodWords.test(question)&&actionWords.test(question))||(temporalEvent(question)!=='general'||/财运|财富/.test(question))&&/(?:未来|往后|接下来|过去|之后|以后|今后)(?:几|[\d一二两三四五六七八九十]+)年|逐年|每年/.test(question)&&/走势|比较|分析|如何|怎么样|运势|发展/.test(question))&&!excluded.test(question);

function dates(text:string,year:number){
 const found:{date:string;monthOnly:boolean}[]=[];
 const normalized=text.replace(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g,'$1年$2月$3日');
 for(const m of normalized.matchAll(/(?:(\d{4})年)?([\d一二两三四五六七八九十]+)月(?:([\d一二两三四五六七八九十]+)[日号])?/g))found.push({date:iso(m[1]?Number(m[1]):year,number(m[2]),m[3]?number(m[3]):1),monthOnly:!m[3]});
 return found;
}
function savedTiming(history:HistoryMessage[]){
 const last=history.filter(h=>h.role==='assistant').at(-1);try{
  const meta=typeof last?.meta==='string'?JSON.parse(last.meta):last?.meta,t=meta?.timing;
  if(t?.version===1&&valid(t.start)&&valid(t.end))return t as {start:string;end:string;goal:string;windows:{start:string;end:string}[];plan?:TemporalPlan};
 }catch{/* An old message without metadata remains ordinary context. */}
 return null;
}

/** Resolve a single event-local plan before scanning or summarising; the model does not choose dates. */
export function resolveTimingRequest(question:string,history:HistoryMessage[],today:string,birthSolar:string,force=false,currentChart?:ChartData,options:TimingResolveOptions={}):TimingRequest|null{
 const refinement=/具体|细化|精确|哪几天|哪一天|首选|备选|那个月/.test(question),lastSaved=savedTiming(history);
 if(!force&&!hasTimingIntent(question)&&!(lastSaved&&(refinement||temporalFollowup(question))))return null;
 if(excluded.test(question))return null;
 const userHistory=history.filter(h=>h.role==='user'&&h.content!==question).slice(-8).map(h=>h.content),currentEvent=temporalEvent(question),reset=resetsTemporalContext(question);
 let related='';
 if(!reset)for(const text of [...userHistory].reverse()){
  const event=temporalEvent(text);
  if(event!=='general'){if(currentEvent===event||currentEvent==='general'&&temporalFollowup(question))related=text;break;}
  if(resetsTemporalContext(text))break;
 }
 const savedEvent=lastSaved?.plan?.event||temporalEvent(lastSaved?.goal||'');
 const event=currentEvent==='general'&&related?temporalEvent(related):currentEvent==='general'&&!reset&&(refinement||temporalFollowup(question))?savedEvent:currentEvent;
 const saved=!reset&&lastSaved&&(savedEvent===event||event==='general'&&temporalFollowup(question))?lastSaved:null;
 const useContext=!!related,goal=useContext?`${related.slice(0,350)}；本轮：${question}`:question,task=temporalTask(event);
 const intent=parseTemporalIntent(question,today),contextIntent=related?parseTemporalIntent(related,today):null;
 const referenceDate=intent.referenceExplicit?intent.referenceDate:saved?.plan?.referenceDate&&temporalFollowup(question)?saved.plan.referenceDate:today;
 const currentYear=Number(referenceDate.slice(0,4)),assumptions:string[]=[];
 const target=/^(?:继续|那呢|然后呢)[？?。\s]*$/.test(question)&&contextIntent?contextIntent.targetText+'；'+question:intent.targetText;
 const born=solarISO(birthSolar),chronologicalAge=valid(born)&&valid(referenceDate)?currentYear-Number(born.slice(0,4))-(referenceDate.slice(5)<born.slice(5)?1:0):undefined;
 const referenceChart=currentChart&&(currentChart.target===referenceDate?currentChart:valid(referenceDate)&&referenceDate>=born?createChart(currentChart.birth,referenceDate):undefined);
 const nominalAge=referenceChart?.age;
 if(intent.backgroundEvents.length)assumptions.push('问题中的事件开始或已发生时间作为背景保留，不用它限定目标事件的查询范围。');
 if(intent.referenceExplicit)assumptions.push(`按你指定的 ${referenceDate} 作为分析基准；仅指定基准年份时使用该年 1 月 1 日。`);
 const explicitYear=intent.explicitYears[0],relativeYear=/前年/.test(target)?-2:/后年/.test(target)?2:/明年/.test(target)?1:/去年/.test(target)?-1:/今年|本年/.test(target)?0:null;
 const rollingPeriod=target.match(/(未来|接下来|最近|近期|近)(?:的)?([\d一二两三四五六七八九十]+)(?:个)?(天|周|月)/);
 const freshPeriod=intent.explicitYears.length>0||periodWords.test(target)||!!rollingPeriod||intent.spanYears!==undefined||!!intent.yearRange;
 const newYearConstraint=explicitYear!==undefined||relativeYear!==null||!!rollingPeriod||intent.spanYears!==undefined||!!intent.yearRange||/未来|接下来|最近|近期|本月|这个月|下个月|下月|本周|下周|今天|明天|后天/.test(target);
 const canInherit=useContext&&!newYearConstraint&&!intent.backgroundEvents.length;
 const contextYear=canInherit?contextIntent?.explicitYears[0]:undefined;
 let year=explicitYear??(relativeYear!==null?currentYear+relativeYear:contextYear??(saved&&refinement?Number((saved.windows?.[0]?.start||saved.start).slice(0,4)):currentYear));
 if(saved&&/下一年|再下一年/.test(target))year=Number((saved.windows?.[0]?.start||saved.start).slice(0,4))+(/再下一年/.test(target)?2:1);
 const yearlyIntent=/哪(?:一|几|些)?年|逐年|每年|(?:最近|近|未来|接下来|往后|这|过去)(?:几|[一二两三四五六七八九十\d]+)?年/.test(target)||intent.spanYears!==undefined||!!intent.yearRange;
 const shortPeriod=!!rollingPeriod||/近期|最近(?!.{0,3}年)|本月|这个月|下个月|下月|本周|下周|今天|明天|后天|几月|哪(?:个|些)?月|哪(?:一|几)?天|\d月|[一二两三四五六七八九十]+月/.test(target);
 const longDomain=matchQuestionDomains(target).some(d=>d.id==='property'||d.id==='children'||d.id==='wealth');
 const openLong=!freshPeriod&&!shortPeriod&&!refinement&&!(saved&&temporalFollowup(question))&&(yearlyIntent||event==='marriage'||event==='relationship'||event==='job_change'||event==='career'||event==='relocation'||longDomain)&&contextYear===undefined;
 let rollingRetrospective=false,start='',end='',detail:TimingRequest['detail']=yearlyIntent||openLong?'yearly':/哪(?:一|几)?天|哪.{0,2}日|流日|细化到.{0,3}[日天]|具体.{0,3}日期/.test(target)?'daily':'monthly';
 let rangeSource:TemporalPlan['rangeSource']=newYearConstraint||intent.deadline?'explicit':contextYear!==undefined?'inherited':freshPeriod?'explicit':'default',focusYears:number|undefined;
 const dateQuestion=target.split(/[，,。；;\n]/).filter(clause=>!(/截止|最晚.{0,4}提交/.test(clause)&&!timingWords.test(clause))).join('，'),parsed=dates(dateQuestion,year);
 const quarterText=target.replace(/第?\s*([一二三四1-4])\s*(至|到|[~～—–-])\s*第?\s*([一二三四1-4])\s*季度/g,'第$1季度$2第$3季度');
 const quarterMatches=[...quarterText.matchAll(/第?\s*([一二三四五六七八九十\d]+)\s*季度|\bQ(\d+)\b/gi)],quarters=quarterMatches.map(m=>number(m[1]||m[2]));
 const quarterList=quarterMatches.length>1&&!/^\s*(?:至|到|[~～—–-])\s*$/.test(quarterText.slice(quarterMatches[0].index!+quarterMatches[0][0].length,quarterMatches.at(-1)!.index));
 const selectedYears=!intent.yearRange&&!parsed.length&&intent.explicitYears.length>1?[...intent.explicitYears].sort((a,b)=>a-b):[];
 const excludedYears=[...intent.excludedYears];
 if(intent.yearRange){start=iso(intent.yearRange.startYear,1,1);end=iso(intent.retrospectiveEndYear!==undefined?Math.min(intent.yearRange.endYear,intent.retrospectiveEndYear):intent.yearRange.endYear,12,31);detail='yearly';
 }else if(intent.retrospectiveEndYear!==undefined){
  const years=intent.spanYears??10;
  start=iso(intent.retrospectiveEndYear-years+1,1,1);end=iso(intent.retrospectiveEndYear,12,31);detail='yearly';rangeSource='explicit';
  assumptions.push(`${intent.spanYears!==undefined?'按明确跨度':'未指定回顾跨度，默认最近 10 个完整公历年'}比较 ${start} 至 ${end}；${intent.retrospectiveEndYear+1} 年及之后不在本次回顾范围内。`);
 }else if(selectedYears.length){
  start=iso(selectedYears[0],1,1);end=iso(selectedYears.at(-1)!,12,31);detail='yearly';rangeSource='explicit';
  for(let y=selectedYears[0];y<=selectedYears.at(-1)!;y++)if(!selectedYears.includes(y)&&!excludedYears.includes(y))excludedYears.push(y);
  assumptions.push(`只比较明确列出的 ${selectedYears.join('、')} 年；中间未列出的年份不在本轮调查范围内。`);
 }else if(quarters.length&&!parsed.length){
  start=iso(year,(quarters[0]-1)*3+1,1);end=monthEnd(year,quarters.at(-1)!*3);detail='monthly';rangeSource='explicit';
 }else if(intent.spanYears!==undefined||openLong||yearlyIntent&&!parsed.length&&explicitYear===undefined&&relativeYear===null){
  const defaultYears=event==='marriage'&&chronologicalAge!==undefined&&chronologicalAge>=18&&chronologicalAge<40?10:5,years=intent.spanYears??defaultYears;
  focusYears=intent.focusYears??(intent.spanYears!==undefined?years:chronologicalAge!==undefined&&chronologicalAge>=60?3:5);
  start=explicitYear!==undefined?iso(explicitYear,1,1):referenceDate;
  const past=/过去|回顾|复盘/.test(target)&&!intent.referenceExplicit;
  if(Number.isFinite(years)&&years>0&&years<=20){if(past){end=referenceDate;start=addDays(afterYears(referenceDate,-years),1);}else end=addDays(afterYears(start,years),-1);}
  detail='yearly';
  assumptions.push(intent.spanYears!==undefined?`按明确跨度比较 ${start} 至 ${end}，首尾不足完整公历年的部分按实际日期覆盖。`:`未限定目标时间，默认比较 ${start} 至 ${end}（${years} 年），前 ${Math.min(focusYears,years)} 年重点解释，其余年份逐年简要比较；这是分析范围，不代表用户愿意等待这么久。`);
 }else if(parsed.length){
  start=parsed[0].date;const last=parsed.at(-1)!;end=last.monthOnly?monthEnd(Number(last.date.slice(0,4)),Number(last.date.slice(5,7))):last.date;
  if(!parsed[0].monthOnly)detail='daily';
  const shortEnd=target.match(/(?:至|到|[~～—–])\s*([\d一二两三四五六七八九十]+)[日号]/);
  if(shortEnd)end=start.slice(0,8)+String(number(shortEnd[1])).padStart(2,'0');
  if(parsed.length===1&&parsed[0].monthOnly){if(/上旬|月初/.test(target))end=start.slice(0,8)+'10';else if(/中旬/.test(target)){start=start.slice(0,8)+'11';end=start.slice(0,8)+'20';}else if(/下旬|月底|月末/.test(target))start=start.slice(0,8)+'21';}
  if(parsed.length===1&&!parsed[0].monthOnly&&/[日号](?:之)?前/.test(dateQuestion)){end=parsed[0].date;start=referenceDate;}
 }else if(/下半年|上半年/.test(target)){const second=/下半年/.test(target);start=iso(year,second?7:1,1);end=iso(year,second?12:6,second?31:30);
 }else if(/本月|这个月|下个月|下月/.test(target)){
  const offset=/下个月|下月/.test(target)?1:0,d=new Date(Date.UTC(currentYear,Number(referenceDate.slice(5,7))-1+offset,1));start=iso(d.getUTCFullYear(),d.getUTCMonth()+1,1);end=monthEnd(d.getUTCFullYear(),d.getUTCMonth()+1);
 }else if(/今天|今日|明天|后天/.test(target)){start=end=addDays(referenceDate,/后天/.test(target)?2:/明天/.test(target)?1:0);detail='daily';
 }else if(/本周|这周|下周/.test(target)){const weekday=(new Date(referenceDate+'T12:00:00Z').getUTCDay()+6)%7;start=addDays(referenceDate,-weekday+(/下周/.test(target)?7:0));end=addDays(start,6);detail='daily';
 }else if(saved&&refinement&&!freshPeriod){
  const selected=saved.windows?.[/第二|备选/.test(target)?1:0];start=selected?.start||saved.start;end=selected?.end||saved.end;detail=daysBetween(start,end)>45?'monthly':'daily';rangeSource='inherited';assumptions.push('沿用同一事件上一轮候选窗口继续细化。');
 }else if(explicitYear!==undefined||relativeYear!==null||contextYear!==undefined||saved&&/下一年|再下一年/.test(target)){start=iso(year,1,1);end=iso(year,12,31);if(saved&&/下一年|再下一年/.test(target))rangeSource='inherited';
 }else if(saved&&temporalFollowup(question)&&!freshPeriod){start=saved.start;end=saved.end;detail=daysBetween(start,end)>365?'yearly':'monthly';rangeSource='inherited';
 }else{
  start=referenceDate;const count=rollingPeriod,length=count?number(count[2])*(count[3]==='天'?1:count[3]==='周'?7:30):90;
  const recent=count&&/最近|近期|近/.test(count[1]),future=/未来|接下来|往后|今后|将会|会发生|会出现/.test(target);
  const past=/回顾|复盘|过去|已经|发生了|发生过|经历了|经历过|出现了|出现过/.test(target),action=timingWords.test(target)||/适合|合适|计划|打算|准备|安排|能不能|能否|可不可以|要不要|该不该|应该/.test(target);
  rollingRetrospective=!!recent&&!future&&(past||!action&&(options.mode==='descriptive'||/发生|经历|出现|怎么样|怎样|如何|表现|变化|状态/.test(target)));
  if(Number.isFinite(length)&&length>0&&length<=366*20){if(rollingRetrospective){start=addDays(referenceDate,1-length);end=referenceDate;}else end=addDays(start,length-1);}
  if(length<=45&&count?.[3]!=='月')detail='daily';
  assumptions.push(count?`按${rollingRetrospective?'截至分析基准日的回顾':'从分析基准日起的'}滚动区间计算；“月”未指定历月时按 30 天折算。`:'未指定区间，此类行动安排先比较从分析基准日起 90 天。');
 }
 const plan:TemporalPlan={version:1,event,backgroundEvents:[...(contextIntent?.backgroundEvents||[]),...intent.backgroundEvents].slice(-12),referenceDate,start,end,rangeSource,...(chronologicalAge!==undefined?{chronologicalAge}:{}),...(nominalAge!==undefined?{nominalAge}:{}),focusEnd:end,retrospective:false,constraints:{excludedYears:excludedYears.sort((a,b)=>a-b)}};
 const request:TimingRequest={goal,start,end,today,detail,task,assumptions,plan,...(options.palaces?.length?{palaces:options.palaces}:{}),...(options.mode==='descriptive'?{comparisonMode:'descriptive' as const}:{})};
 const finish=()=>{plan.start=start;plan.end=end;plan.focusEnd=focusYears&&Number.isFinite(focusYears)&&focusYears<=20&&valid(start)?[end,addDays(afterYears(start,focusYears),-1)].sort()[0]:end;plan.constraints.deadline=request.deadline;return {...request,start,end,detail};};
 if(!parsed.length&&(quarters.some(q=>q<1||q>4)||quarterList||selectedYears.length&&quarters.length)){
  request.issue=quarters.some(q=>q<1||q>4)?'公历季度应为第一至第四季度，请核对季度编号；不会改用全年替代。':'请将分散的季度与其对应年份分别写成独立问题；本轮不会把未指定的季度作为已请求范围。';return finish();
 }
 if(intent.deadline&&!valid(intent.deadline)){request.issue='你指定的截止日期不存在，请核对具体日期；不会忽略这一时间约束继续选择窗口。';return finish();}
 if(intent.spanYears!==undefined&&(!Number.isFinite(intent.spanYears)||intent.spanYears<=0||intent.spanYears>20)){request.issue='本轮逐年比较支持 1 至 20 年的明确跨度，请指定这一范围内的起止时间；不会静默缩短你要求的区间。';return finish();}
 // A generated retrospective decade can start before the engine's earliest supported year;
 // clip its pre-birth part before date validation, without rewriting explicitly supplied dates.
 if(intent.retrospectiveEndYear!==undefined&&!intent.yearRange&&valid(born)&&start<born&&end>=born){start=born;assumptions.push(`仅比较公历出生日期 ${born} 之后的部分。`);}
 if(/农历|阴历|闰月|闰[\d一二两三四五六七八九十]+月/.test(target)){
  if(!parsed.length){request.issue='你指定的是农历时间，请补充想比较的农历月份或日期；我会沿用已有年份和命例，不把它直接当成公历月份。';return finish();}
  const leap=/闰/.test(target);try{start=lunarSolarDate(start,leap);const last=parsed.at(-1)!;if(last.monthOnly&&!/上旬|中旬|月初/.test(target)){try{end=lunarSolarDate(last.date.slice(0,8)+'30',leap);}catch{end=lunarSolarDate(last.date.slice(0,8)+'29',leap);}}else end=lunarSolarDate(end,leap);assumptions.push(`已将指定的农历${leap?'闰月':''}区间换算为公历展示，未混用两种日历。`);}catch{request.issue='这个农历日期或闰月不存在，请核对月份、日期或闰月标记；不会用其他月份静默替代。';return finish();}
 }
 if(!valid(start)||!valid(end)||end<start){request.issue='这段日期范围无法对应有效的公历起止日，请更正具体日期；已有出生资料和事件背景会继续沿用。';return finish();}
 request.requested={start,end,detail};
 if(daysBetween(start,end)>366*20){request.issue='本轮逐年比较支持最多 20 年，请指定本轮的明确区间；不会静默截断目标年份。';return finish();}
 const explicitPast=intent.explicitYears.some(y=>y<currentYear)||relativeYear!==null&&relativeYear<0||!!intent.yearRange&&intent.yearRange.startYear<currentYear;
 const retrospective=intent.retrospective||rollingRetrospective||!!explicitPast||(rangeSource==='inherited'&&!!saved?.plan?.retrospective)||options.mode==='descriptive'&&start<referenceDate;plan.retrospective=retrospective;
 if(!retrospective&&start<referenceDate&&end>=referenceDate){start=referenceDate;assumptions.push('开始行动的候选窗口已排除分析基准日之前的日期。');}
 // Deadlines belong to an event, and newer explicit periods/cancellations replace stale constraints.
 const deadlineHistory:string[]=[];
 for(const text of [...userHistory,question]){
  const textEvent=temporalEvent(text);
  if(resetsTemporalContext(text)||(textEvent!=='general'&&textEvent!==event)||/截止.{0,10}(?:取消|作废)|不再.{0,6}(?:截止|期限)|不受.{0,6}(?:截止|期限)/.test(text)){deadlineHistory.length=0;if(textEvent!=='general'&&textEvent!==event)continue;}
  if(text===question&&newYearConstraint&&!intent.deadline&&!/截止|最晚|之前|以内/.test(target))deadlineHistory.length=0;
  deadlineHistory.push(text);
 }
 for(const text of deadlineHistory){
  const parsedDeadline=parseTemporalIntent(text,referenceDate).deadline;if(parsedDeadline&&valid(parsedDeadline))request.deadline=parsedDeadline;
  for(const clause of text.split(/[，,。；;\n]/)){
  if(!/截止|最晚.{0,8}(?:提交|结婚|领证|完成|入职)/.test(clause)||/如果|假如|可能|不知道|不确定|是否|取消|作废/.test(clause))continue;
  // The shared parser already owns dated constraints; this only resolves a deadline without a year.
  const date=!parsedDeadline?dates(clause,year).find(d=>!d.monthOnly)?.date:undefined;
  if(date&&valid(date))request.deadline=date;
 }}
 if(request.deadline&&end>request.deadline){end=request.deadline;assumptions.push(`已按你提供的 ${request.deadline} 截止日期截断候选窗口。`);}
 if(valid(born)&&start<born&&end>=born){start=born;assumptions.push(`仅比较公历出生日期 ${born} 之后的部分。`);}
 if(valid(born)&&end<born)request.issue=`所问区间确实早于当前命例的公历出生日期 ${born}，不能用其他年份代替计算。`;
 else if(end<start)request.issue=`你提供的截止日期 ${request.deadline} 已不在可开始行动的窗口内，应先核实延期或下一批次；不会推荐截止后的日期。`;
 else if(!retrospective&&end<referenceDate)request.issue='这个时间窗口已经过去；可复盘其中的运限，但不能再把过去的日期推荐为开始行动的日期。';
 if(detail!=='yearly'&&daysBetween(start,end)>365){detail='yearly';assumptions.push('完整保留多年范围，先逐年比较；选定年份后再细化月份和日期。');}
 assumptions.push(detail==='yearly'?'结果日期为公历；逐年覆盖实际运限区段，跨入下一大限时重新解释该限背景，再比较该限内流年。':'结果日期为公历；运限按命盘采用的农历与换限规则计算。');
 if(intent.excludedYears.length)assumptions.push(`按用户要求排除 ${intent.excludedYears.join('、')} 年。`);
 return finish();
}
