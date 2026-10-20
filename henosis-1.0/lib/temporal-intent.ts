/** Shared interpretation of user-supplied times. It never invents chart facts or a user's intentions. */
export type TemporalEvent='marriage'|'relationship'|'job_change'|'career'|'application'|'relocation'|'travel'|'communication'|'health'|'general';
export type BackgroundEvent={text:string;year?:number;date?:string;relation?:'before'|'since'|'at'};
export type TemporalPlan={version:1;event:TemporalEvent;backgroundEvents:BackgroundEvent[];referenceDate:string;start:string;end:string;rangeSource:'explicit'|'inherited'|'default';chronologicalAge?:number;nominalAge?:number;focusEnd:string;retrospective:boolean;constraints:{deadline?:string;excludedYears:number[]}};
export type TemporalIntent={event:TemporalEvent;backgroundEvents:BackgroundEvent[];referenceDate:string;referenceExplicit:boolean;targetText:string;explicitYears:number[];excludedYears:number[];deadline?:string;retrospectiveEndYear?:number;yearRange?:{startYear:number;endYear:number};spanYears?:number;focusYears?:number;retrospective:boolean};
const yearToken='(?:19\\d{2}|20\\d{2}|2100)';
const dateToken=`(?:${yearToken}(?:年(?:[\\d一二三四五六七八九十]+月(?:[\\d一二三四五六七八九十]+[日号])?)?|[-/]\\d{1,2}[-/]\\d{1,2})|今年|去年|前年|明年|后年)`;
const countToken='[\\d零〇一二两三四五六七八九十百]+';
const tokenYear=(token:string,base:number)=>token.match(/\d{4}/)?Number(token.match(/\d{4}/)![0]):base+(/前年/.test(token)?-2:/去年/.test(token)?-1:/明年/.test(token)?1:/后年/.test(token)?2:0);
export const temporalNumber=(s:string):number=>{
 if(/^\d+$/.test(s))return Number(s);
 const digits='零一二三四五六七八九',value=(c:string)=>c==='两'?2:c==='〇'?0:digits.indexOf(c);
 if(s.includes('百')){const [a,b]=s.split('百');return Math.max(1,value(a))*100+(b?temporalNumber(b.replace(/^零/,'')):0);}
 if(s.includes('十')){const [a,b]=s.split('十');return (a?value(a):1)*10+(b?value(b):0);}
 return value(s);
};
export function temporalEvent(text:string):TemporalEvent{
 const clauses=text.split(/[，,。；;\n]/).filter(Boolean),target=clauses.at(-1)||text;
 if(/(?:什么时候|何时).{0,8}(?:沟通|商量|讨论|联系)/.test(target))return 'communication';
 const health=/身体|健康|体质|睡眠|作息|疾厄/;
 const action=(s:string):TemporalEvent=>/结婚|领证|婚礼|再婚|订婚/.test(s)?'marriage':/跳槽|换工作|转职/.test(s)?'job_change':/申请|升学|读研|读博|投递|考试|考研/.test(s)?'application':/恋爱|交往|伴侣|感情|婚姻|脱单/.test(s)?'relationship':/工作|入职|签约|事业|面试|上班|创业|副业|升职/.test(s)?'career':/搬家|迁居|买房/.test(s)?'relocation':/出行|旅行|旅游/.test(s)?'travel':/联系|沟通|和好/.test(s)?'communication':'general';
 const find=(s:string):TemporalEvent=>{
  if(!health.test(s))return action(s);
  const when=s.match(/什么时候|何时|哪(?:一|几|些)?年|哪.{0,2}月/);
  if(when){const asked=s.slice(when.index!+when[0].length),goal=action(asked);if(goal!=='general')return goal;if(health.test(asked))return 'health';}
  // Health can be a stated condition of an action; it does not override that action's event.
  const background=s.match(/(?:身体|健康|体质|睡眠|作息).{0,12}?(?:恢复后|稳定后|改善后|好转后|之后|以后|情况下|前提下)|(?:考虑|结合)(?:到)?(?:我的|当前的)?(?:身体|健康|体质|睡眠|作息).{0,6}?(?:情况|状况|条件)/);
  if(background){const goal=action(s.slice(background.index!+background[0].length));if(goal!=='general')return goal;}
  return 'health';
 };
 return find(target)==='general'?find(text):find(target);
}
export const temporalTask=(event:TemporalEvent):'application'|'career'|'relationship'|'general'=>event==='application'?'application':event==='career'||event==='job_change'?'career':event==='marriage'||event==='relationship'?'relationship':'general';
export const resetsTemporalContext=(text:string)=>/换个话题|另一个问题|新的问题|新申请|另外一个项目|另一段(?:关系|恋爱)|换一个(?:人|对象)/.test(text);
export const temporalFollowup=(text:string)=>/^(?:那(?:么)?|再看|改看|换成|继续|首选|备选|细化|精确|具体|下一个|下一年|再下一年|之后呢|往后呢)/.test(text)||/^(?:今年|明年|后年|近期|最近|\d{4}年|\d{1,2}月)(?:呢|怎么样|如何)?[？?。\s]*$/.test(text);

/** Background dates stay in raw dialogue; only their date tokens are removed from targetText. */
export function parseTemporalIntent(question:string,today:string):TemporalIntent{
 const event=temporalEvent(question),backgroundEvents:BackgroundEvent[]=[],excludedYears:number[]=[];
 let targetText=question,referenceDate=today,referenceExplicit=false,deadline:string|undefined;
 const anchor=new RegExp(`(?:站在|回到|以|从)\\s*(${dateToken})(?:当时)?(?:的)?(?:时间点|视角|角度)?(?:为基准|为起点|来看|看|出发|起(?=.{0,5}(?:之后|以后|往后|未来))|(?=[，,。；;]|$))`);
 const reference=targetText.match(anchor);
 if(reference){
  const y=tokenYear(reference[1],Number(today.slice(0,4))),full=reference[1].match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  referenceDate=full?`${full[1]}-${full[2].padStart(2,'0')}-${full[3].padStart(2,'0')}`:`${y}-01-01`;referenceExplicit=true;targetText=targetText.replace(reference[0],'分析基准');
 }
 // Record exclusions separately so their years cannot accidentally become the search interval.
 targetText=targetText.replace(new RegExp(`(?:不要|别|不想)(?:只|仅)(?:看|分析|比较)\\s*${yearToken}年?`,'g'),whole=>whole.replace(/\d{4}/g,'指定'));
 const excludedList=`${yearToken}年?(?:\\s*(?:和|、|及|与|至|到|[-~～—–])\\s*${yearToken}年?)*`;
 const recordExcluded=(whole:string,list:string)=>{const years=[...list.matchAll(/\d{4}/g)].map(m=>Number(m[0]));if(years.length===2&&/至|到|[-~～—–]/.test(list)&&years[1]>=years[0])for(let y=years[0];y<=years[1];y++)excludedYears.push(y);else excludedYears.push(...years);return whole.replace(/\d{4}/g,'指定');};
 targetText=targetText.replace(new RegExp(`(?:不看|不考虑|排除|除去|不要|除了)\\s*(${excludedList})`,'g'),recordExcluded);
 targetText=targetText.replace(new RegExp(`(${excludedList})\\s*(?:不考虑|排除|不看)`,'g'),recordExcluded);
 const baseYear=Number(referenceDate.slice(0,4));
 const tokens=[...targetText.matchAll(new RegExp(dateToken,'g'))];
 for(const token of tokens.reverse()){
  const at=token.index!,after=targetText.slice(at+token[0].length,at+token[0].length+35),before=targetText.slice(Math.max(0,at-12),at);
  // "今年 27 岁" dates the age statement, not the requested event.
  if(/^(?:我)?\s*[\d一二两三四五六七八九十百]+\s*(?:周岁|虚岁|岁)/.test(after)){targetText=targetText.slice(0,at)+targetText.slice(at+token[0].length);continue;}
  const reverseStart=/(?:恋爱|关系|交往|工作|创业).{0,3}(?:从|于|在)$/.test(before)&&/^(?:开始|起)/.test(after);
  const background=/^(?:的时候|时)?(?:开始(?:的|了)?(?:一段|这段)?(?:谈)?(?:恋爱|交往|工作|创业|关系)|谈(?:的|了)?(?:恋爱|对象)|在一起(?:的|了)?|(?:确立|确定)(?:的|了)?关系|认识(?:的|了)?|入职(?:的|了)?|毕业(?:的|了)?|分手(?:的|了)?|离婚(?:的|了)?|结婚了|结婚的我|参加过|已经|曾经)/.test(after)
   ||/^(?:以来|之前就|就已经)/.test(after)
   ||/^(?:之前|以前)(?:就)?(?:认识|开始恋爱|在一起)/.test(after)
   ||reverseStart
   ||/出生(?:于|在)?$/.test(before);
  const backgroundText=after.split(/[，,。；;？?]|什么时候|何时|哪(?:一|几|些)?年|几月|哪.{0,2}月/)[0],datedEvent=temporalEvent(backgroundText),distinct=datedEvent!=='general'&&event!=='general'&&datedEvent!==event;
  // A date attached to an action is background only when an actual start/completion is stated,
  // or the question explicitly asks about a different subsequent event.
  const targetWhen=/什么时候|何时|哪(?:一|几|些)?年|几月|哪.{0,2}月/.test(after);
  if(background&&(!targetWhen||distinct||reverseStart||/开始(?:的|了)?(?:一段|这段)?(?:谈)?(?:恋爱|交往)|谈(?:的|了)?恋爱|在一起|(?:之前|以前)(?:就)?认识|以来|结婚了|出生/.test(after+before))){
   const explicit=token[0].match(/\d{4}/),offset=/前年/.test(token[0])?-2:/去年/.test(token[0])?-1:/明年/.test(token[0])?1:/后年/.test(token[0])?2:0,year=explicit?Number(explicit[0]):baseYear+offset;
   const full=token[0].match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
   backgroundEvents.unshift({text:(token[0]+backgroundText).slice(0,100),year,relation:/^(?:之前|以前)/.test(after)?'before':/^以来/.test(after)||reverseStart?'since':'at',...(full?{date:`${full[1]}-${full[2].padStart(2,'0')}-${full[3].padStart(2,'0')}`}:{})});
   targetText=targetText.slice(0,at)+targetText.slice(at+token[0].length);
   continue;
  }
  const actionTarget=/结婚|领证|提交|完成|入职|申请|跳槽|搬家/.test(question)&&event!=='health'&&!/回顾|复盘|历史|过去/.test(question);
  const cutoff=/截止(?:日期)?(?:是|为|到)?\s*$|最晚(?:在|到)?\s*$|不晚于\s*$/.test(before)||actionTarget&&(/截至\s*$/.test(before)||/^(?:底)?(?:之前|以前|前)/.test(after));
  if(cutoff&&!/如果|假如|可能|不知道|不确定|是否/.test(before)){
   const y=tokenYear(token[0],baseYear),parts=token[0].match(/(\d{4})[-/年]([\d一二两三四五六七八九十]+)[-/月]([\d一二两三四五六七八九十]+)/);
   const date=parts?`${parts[1]}-${String(temporalNumber(parts[2])).padStart(2,'0')}-${String(temporalNumber(parts[3])).padStart(2,'0')}`:after.startsWith('底')||!/^(?:之前|以前|前)/.test(after)?`${y}-12-31`:`${y-1}-12-31`;
   if(deadline===undefined)deadline=date;targetText=targetText.slice(0,at)+targetText.slice(at+token[0].length);
  }
 }
 // Shared year suffixes in a list still select every named year ("2027和2029哪年").
 // Require a year marker or an explicit year comparison so ordinary amounts stay ordinary amounts.
 const listedYears=[...targetText.matchAll(new RegExp(`(?:${yearToken})年?(?:\\s*(?:和|与|及|、|，|,)\\s*(?:${yearToken})年?)+`,'g'))]
  .filter(m=>/年/.test(m[0])||/哪(?:一|几|些)?年|逐年|每年/.test(targetText)).flatMap(m=>[...m[0].matchAll(new RegExp(yearToken,'g'))].map(y=>Number(y[0])));
 const bareYearTopic='(?:财运|财富|事业|职业|学业|婚姻|婚恋|感情|健康|身体|运势|流年|命宫|官禄|财帛|夫妻|疾厄|田宅|子女|父母|福德|迁移|兄弟|交友)';
 // A year directly qualifying a chart topic may omit 年. The word boundary and
 // topic lookahead exclude identifiers such as A2027 and amounts such as 2027元.
 const explicitYears=[...new Set([...targetText.matchAll(new RegExp(`\\b(${yearToken})(?=年|[-/]|\\s*(?:至|到|[~～—–]|${bareYearTopic}))`,'g'))].map(m=>Number(m[1])).concat(listedYears))];
 const range=targetText.match(new RegExp(`(${yearToken})年?\\s*(?:至|到|[-~～—–])\\s*(${yearToken})年?`));
 const span=targetText.match(new RegExp(`(?:未来|接下来|往后|之后|以后|今后|过去|最近|近|之前|以前|前)(?:的)?\\s*(${countToken})(?:\\s*(?:至|到|[-~～—–])\\s*(${countToken}))?\\s*年`));
 // This upper bound is distinct from an action deadline. Background/deadline tokens were
 // already removed above; "2026 年之前" excludes all of 2026, "截至 2025 年底" includes 2025.
 const beforeYear=targetText.match(new RegExp(`(${yearToken})年(?:之前|以前|前)`)),throughYear=targetText.match(new RegExp(`截至\\s*(${yearToken})年(?:底|末)`));
 const retrospectiveEndYear=beforeYear?Number(beforeYear[1])-1:throughYear?Number(throughYear[1]):undefined;
 const retrospective=retrospectiveEndYear!==undefined||/回顾|过去|当时|历史|复盘|已经发生|去年|前年/.test(targetText)||referenceExplicit&&referenceDate<today;
 return {event,backgroundEvents,referenceDate,referenceExplicit,targetText,explicitYears,excludedYears,...(deadline?{deadline}:{}),...(retrospectiveEndYear!==undefined?{retrospectiveEndYear}:{}),...(range?{yearRange:{startYear:Number(range[1]),endYear:Number(range[2])}}:{}),...(span?{spanYears:temporalNumber(span[2]||span[1]),...(span[2]?{focusYears:temporalNumber(span[1])}:{})}:{}),retrospective};
}
