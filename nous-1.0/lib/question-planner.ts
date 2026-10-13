import type {ChartData,Scope} from './chart-model';
import {buildDialogueContext,type HistoryMessage} from './dialogue';
import {comparisonRequest} from './decision';
import {parseTemporalIntent,resetsTemporalContext,temporalFollowup,temporalNumber,type TemporalIntent,type TemporalEvent} from './temporal-intent';
import {QUESTION_DOMAIN_VERSION,matchQuestionDomains,resolveQuestionPalaces,requestedTopicText,type DomainId} from './question-domains';

export const QUESTION_ANALYSIS_VERSION='question-analysis.1';
export const MAX_QUESTION_TASKS=6;
export type AnalysisTaskKind='attribute'|'current_state'|'historical_compare'|'future_timing'|'decision'|'knowledge'|'mixed';
export type TimeDirection='atemporal'|'current'|'past'|'future'|'mixed';
export type QuestionSource={text:string;start:number;end:number;origin:'current'|'history'};
export type QuestionCondition={text:string;source:QuestionSource;kind:'background'|'constraint'|'user_statement';domainIds:DomainId[]};
export type QuestionTask={id:string;question:string;source:QuestionSource;domains:DomainId[];palaces:string[];corePalaces:string[];kind:AnalysisTaskKind;precision:Scope|'none';needsChart:boolean;needsCurrentEnvironment:boolean;timeDirection:TimeDirection;temporalIntent:TemporalIntent;reasonCodes:string[];assumptions:string[];inheritedTaskId?:string;dependsOnTaskId?:string};
export type QuestionAnalysis={version:string;registryVersion:string;question:string;effectiveQuestion:string;kind:AnalysisTaskKind;tasks:QuestionTask[];sharedConditions:QuestionCondition[];issues:string[];assumptions:string[];unresolved?:{reason:string;source:QuestionSource}[]};

const WHEN=/什么时候|何时|哪(?:一|几|些)?年|哪(?:一|几|些)?个?月|几月|哪(?:一|几)?天|哪段时间|哪个阶段|哪.{0,4}大限|几年后|多久|几岁|多大|时间窗口|择[时日]|选日子|时机/;
const CURRENT=/现在|目前|当下|当前|近期|最近(?![一二两三四五六七八九十\d]+年)|今年|本年|本月|这(?:一)?个?月|今天|本周|这步大限|当前大限/;
const FUTURE=/未来|今后|接下来|往后|以后|之后|明年|后年|明天|后天|下个?月|下周/;
const PAST=/回顾|过去|历史|复盘|当时|去年|前年|以前|之前|前几年/;
const MONTH_PRECISION=/哪(?:一|几|些)?个?月|几月|流月|按月|逐月|本月|这个月|下个?月|上个?月|[\d一二两三四五六七八九十]+个?月|第?[一二三四1234]季度|[本这上下]季度|\bQ[1-4]\b|上半年|下半年/i;
const PERIOD=/大限|流年|流月|流日|每年|逐年|上半年|下半年|上个?月|上周|\b(?:19\d{2}|20\d{2}|2100)(?:年|[-/])|[\d一二两三四五六七八九十]+(?:年|个月|月|日|号|周)/;
const REQUEST=/什么|何时|哪|如何|怎样|怎么样|是否|能否|会不会|该不该|应不应该|要不要|能不能|可不可以|吗|呢|分析|看看|看一下|比较|解释|说说|解读|评估|适不适合|适合|想问|想知道|想了解/;
const ATTRIBUTE=/性格|本性|禀赋|天赋|擅长|优势|弱点|体质|感情观|婚恋观|爱情观|择偶观|金钱观|财富观|职业倾向|适合.{0,6}(?:职业|行业|工作|做什么|干什么)|本命|先天|长期特征|整体特点/;
const DECISION=/该不该|应不应该|要不要|该.{1,12}吗|是否.{0,5}(?:适合|应该|可行)|能不能|能否|可不可以|值不值得|值得(?!关注|注意|留意)|适不适合|适合|合适|怎么选|如何选择|还是/;
const KNOWLEDGE=/什么意思|是什么(?:意思)?|什么是|含义|定义|原理|怎么(?:算|排|理解)|如何(?:计算|排盘|理解)|区别|科普|解释|介绍|为什么.{0,8}(?:叫|称为)/;
const PERSONAL=/我(?:的|是|在|今年|现在|目前|会|能|适合)|本人|这张|此盘|命主|用户|他(?:的|今年)|她(?:的|今年)|对我|适合/;
const timePresent=(intent:TemporalIntent)=>intent.explicitYears.length>0||!!intent.yearRange||intent.spanYears!==undefined||PERIOD.test(intent.targetText)||MONTH_PRECISION.test(intent.targetText)||CURRENT.test(intent.targetText)||FUTURE.test(intent.targetText)||PAST.test(intent.targetText)||WHEN.test(intent.targetText)||intent.deadline!==undefined;
const unique=<T>(values:T[])=>[...new Set(values)];
const EVENT_LABELS:Record<TemporalEvent,string>={marriage:'结婚',relationship:'恋爱关系',job_change:'跳槽',career:'事业',application:'申请',relocation:'迁居',travel:'出行',communication:'沟通',health:'身体状态',general:''};

function direction(intent:TemporalIntent,today:string):TimeDirection{
 const text=intent.targetText,base=Number(today.slice(0,4));
 if(intent.retrospectiveEndYear!==undefined)return 'past';
 if(intent.yearRange){const r=intent.yearRange;return r.endYear<base?'past':r.startYear>base?'future':r.startYear===base&&r.endYear===base?'current':'mixed';}
 const years=intent.explicitYears;
 if(years.length){if(years.every(y=>y<base))return 'past';if(years.every(y=>y>base))return 'future';if(years.some(y=>y!==base))return 'mixed';return 'current';}
 if(PAST.test(text)&&FUTURE.test(text))return 'mixed';
 if(intent.retrospective||PAST.test(text))return 'past';
 if(FUTURE.test(text))return 'future';
 if(CURRENT.test(text))return 'current';
 return WHEN.test(text)?'future':'atemporal';
}

/** Classifies one task only. Timeline choice belongs to the shared range resolver. */
export function classifyAnalysisTask(question:string,today=new Date().toISOString().slice(0,10)){
 const text=requestedTopicText(question),intent=parseTemporalIntent(question,today),target=requestedTopicText(intent.targetText);
 const domains=matchQuestionDomains(text),reasonCodes:string[]=[],assumptions:string[]=[];
 let kind:AnalysisTaskKind,precision:Scope|'none',timeDirection=direction(intent,today);
 const casual=/^(?:你好|您好|嗨|哈喽|在吗|谢谢|谢谢你|好的|明白了|再见|hello|hi)[，,。！!？?\s]*$/i.test(text);
 const knowledge=casual||KNOWLEDGE.test(text)&&!PERSONAL.test(text)&&!WHEN.test(text)&&!DECISION.test(text);
 const attribute=ATTRIBUTE.test(target)&&!timePresent(intent)&&(!DECISION.test(target)||/适合.{0,6}(?:职业|行业|什么工作|做什么|干什么)/.test(target));
 if(knowledge){kind='knowledge';precision='none';timeDirection='atemporal';reasonCodes.push(casual?'conversational_no_chart':'conceptual_question_no_chart');}
 else if(attribute||!timePresent(intent)&&!DECISION.test(text)){
  kind='attribute';precision='natal';timeDirection='atemporal';reasonCodes.push('atemporal_natal_only');
 }else{
  if(timeDirection==='past')kind='historical_compare';
  else if(DECISION.test(target)&&(!WHEN.test(target)||/该不该|应不应该|要不要|是否适合|还是/.test(target)))kind='decision';
  else if(WHEN.test(target)||timeDirection==='future'||timeDirection==='mixed')kind='future_timing';
  else if(timeDirection==='current')kind='current_state';
  else kind='decision';
  const explicitDay=/哪(?:一|几)?天|几号|具体日期|择日|选日子|流日|按天|逐日|今天|明天|后天|(?:\d{4}[-/]\d{1,2}[-/]\d{1,2})|(?:\d|[一二三四五六七八九十]){1,3}[日号]/.test(target);
  const explicitMonth=MONTH_PRECISION.test(target);
  const contextualDecade=/大限(?:中|内|里|期间|之中|之内)?(?:的)?[^，,。；;]{0,8}\b(?:19\d{2}|20\d{2}|2100)年/.test(target);
  const explicitDecade=/大限|十年阶段/.test(target)&&!contextualDecade&&!/哪(?:一|几|些)?年|流年|逐年|每年/.test(target);
  precision=explicitDay?'daily':explicitMonth?'monthly':explicitDecade?'decadal':timePresent(intent)||WHEN.test(target)?'yearly':'natal';
  if(kind==='decision'&&!timePresent(intent)){precision='yearly';timeDirection='current';reasonCodes.push('decision_current_environment');}
  reasonCodes.push(explicitDay?'explicit_day_precision':explicitMonth?'explicit_month_precision':explicitDecade?'explicit_decade_precision':precision==='yearly'?'year_precision_sufficient':'decision_natal_basis');
  if(contextualDecade)reasonCodes.push('contextual_decade_not_target_precision');
 }
 if(!domains.length&&!knowledge){reasonCodes.push('domain_unresolved');assumptions.push('问题主题未能确定，通用命宫资料不能替代主题识别。');}
 if(intent.backgroundEvents.length)reasonCodes.push('background_time_separated');
 if(intent.yearRange||intent.explicitYears.length||intent.spanYears||intent.deadline||intent.retrospectiveEndYear!==undefined)reasonCodes.push('explicit_time_constraints');
 if(intent.excludedYears.length)reasonCodes.push('excluded_years_preserved');
 const needsChart=kind!=='knowledge';
 const needsCurrentEnvironment=needsChart&&kind!=='attribute'&&precision!=='natal';
 return {kind,precision,timeDirection,needsChart,needsCurrentEnvironment,temporalIntent:intent,reasonCodes,assumptions};
}

type Segment=QuestionSource;
function trimSource(question:string,start:number,end:number):Segment{
 const raw=question.slice(start,end),left=raw.length-raw.trimStart().length,right=raw.length-raw.trimEnd().length;
 return {text:question.slice(start+left,end-right),start:start+left,end:end-right,origin:'current'};
}
/** Punctuation is a candidate boundary, never a date separator or a conjunction inside a noun list. */
function clauses(question:string):Segment[]{
 const out:Segment[]=[],separator=/[，,；;。？！?!\n]+|(?:另外|还有|同时|以及|并且|顺便|再问)(?=.{0,80}(?:什么|何时|哪|如何|是否|吗|分析|看看|适合))/g;
 let start=0;
 for(const match of question.matchAll(separator)){const item=trimSource(question,start,match.index!);if(item.text)out.push(item);start=match.index!+match[0].length;}
 const last=trimSource(question,start,question.length);if(last.text)out.push(last);
 return out;
}
function condition(source:Segment,today:string):QuestionCondition{
 const temporal=parseTemporalIntent(source.text,today);
 return {text:source.text,source,kind:temporal.backgroundEvents.length?'background':/只(?:看|分析|比较)|不要|不考虑|排除|截至|最晚|不晚于|必须|限定|为基准|为起点/.test(source.text)?'constraint':'user_statement',domainIds:matchQuestionDomains(source.text).map(d=>d.id)};
}
const overlaps=(a:DomainId[],b:DomainId[])=>a.some(id=>b.includes(id));
function isConstraint(text:string){return /^(?:但|而且|并且|请|我)?(?:只(?:看|分析|比较)|不要|不考虑|排除|截至|最晚|不晚于|必须|限定|站在|回到|以\d{4})/.test(text);}

function priorTaskSelection(question:string,history:HistoryMessage[]){
 const last=history.filter(m=>m.role==='assistant').at(-1);
 let meta:any;try{meta=typeof last?.meta==='string'?JSON.parse(last.meta):last?.meta;}catch{return undefined;}
 const prior=meta?.analysisPlan?.tasks;
 if(!Array.isArray(prior)||!prior.length||resetsTemporalContext(question))return undefined;
 const ordinal=question.match(/第([一二两三四五六\d]+)个(?:问题|方面|任务)?/);
 const follow=!!ordinal||temporalFollowup(question)||/那个(?:问题)?呢|那一项|继续.{0,5}(?:事业|婚|财运|健康|学业)/.test(question);
 if(!follow)return undefined;
 if(ordinal){const task=prior[temporalNumber(ordinal[1])-1];return task?{task:task as {id:string;question:string;kind:AnalysisTaskKind;precision:Scope|'none'}}:{ambiguous:true};}
 const domains=matchQuestionDomains(question).map(d=>d.id);
 const candidates=prior.filter((t:any)=>typeof t?.question==='string'&&(!domains.length||overlaps(domains,matchQuestionDomains(t.question).map(d=>d.id))));
 return candidates.length===1?{task:candidates[0] as {id:string;question:string;kind:AnalysisTaskKind;precision:Scope|'none'}}:candidates.length>1?{ambiguous:true}:undefined;
}

/** Bounded semantic decomposition. Unresolved text is retained and reported, never silently dropped. */
export function analyzeQuestion(question:string,history:HistoryMessage[]=[],_chart?:ChartData,today=new Date().toISOString().slice(0,10)):QuestionAnalysis{
 const original=question.trim(),parts=clauses(question),dialogue=buildDialogueContext(original,history),selection=priorTaskSelection(original,history),selectedPrior=selection?.task;
 if(selectedPrior)dialogue.goal=selectedPrior.question;
 const issues:string[]=[],assumptions:string[]=[],unresolved:{reason:string;source:QuestionSource}[]=[];
 const currentDomains=matchQuestionDomains(original),previousDomains=matchQuestionDomains(dialogue.goal);
 const follow=!selection?.ambiguous&&dialogue.goal!==original&&!resetsTemporalContext(original)&&(!!selectedPrior||temporalFollowup(original)||dialogue.turnKind==='direct_answer'||dialogue.turnKind==='context_reply')
  &&(!currentDomains.length||overlaps(currentDomains.map(d=>d.id),previousDomains.map(d=>d.id)));
 let requestParts=parts.filter(p=>REQUEST.test(p.text)&&!isConstraint(p.text));
 // A path comparison has a single decision contract; do not separate its alternatives.
 if(comparisonRequest(original))requestParts=[trimSource(question,0,question.length)];
 if(!requestParts.length)requestParts=[trimSource(question,0,question.length)];
 const sharedConditions=parts.filter(p=>!requestParts.some(r=>p.start>=r.start&&p.end<=r.end)).map(p=>condition(p,today));
 const conditionApplies=(c:QuestionCondition,source:Segment,ids:DomainId[])=>{
  if(c.domainIds.length){
   if(!overlaps(c.domainIds,ids))return false;
   const related=requestParts.filter(p=>overlaps(matchQuestionDomains(p.text).map(d=>d.id),c.domainIds));
   const nearest=related.find(p=>p.start>=c.source.end)||related.filter(p=>p.end<=c.source.start).at(-1);
   return !nearest||nearest===source;
  }
  if(c.source.end<=requestParts[0].start||/所有问题|以上都|全部都|两项都|分别都/.test(c.text))return true;
  const next=requestParts.find(p=>p.start>=c.source.end),previous=requestParts.filter(p=>p.end<=c.source.start).at(-1);
  const constraint=/不要|不考虑|排除|截至|最晚|不晚于/.test(c.text);
  const selected=constraint?(previous||next):(next||previous);
  return selected===source;
 };
 // A leading shared time phrase ("未来五年，...") applies to parallel questions. Dated
 // background events are attached only to a related task, never to another topic's range.
 const tasks:QuestionTask[]=requestParts.map((source,index)=>{
  const localDomains=matchQuestionDomains(source.text);
  const previousPart=index>0&&/^(?:那|具体|什么时候|何时|哪|几月|多久|是否|要不要|该不该)/.test(source.text)?requestParts[index-1]:undefined;
  const domains=localDomains.length?localDomains:follow?previousDomains:previousPart?matchQuestionDomains(previousPart.text):requestParts.length===1?currentDomains:[];
  const ids=domains.map(d=>d.id);
  const applicable=sharedConditions.filter(c=>conditionApplies(c,source,ids));
  const before=applicable.filter(c=>c.source.end<=source.start),after=applicable.filter(c=>c.source.start>=source.end);
  let text=[...before.map(c=>c.text),source.text,...after.map(c=>c.text)].join('；');
  // Only carry the topic on an elliptical follow-up. Old target years must be resolved by
  // the existing temporal resolver, not copied into the latest question by this parser.
  const inheritedGoal=follow?dialogue.goal:!localDomains.length&&previousPart?previousPart.text:undefined;
  if(inheritedGoal&&domains.length){
   const event=EVENT_LABELS[parseTemporalIntent(inheritedGoal,today).event];
   text+='（承接主题：'+domains.map(d=>d.label).join('、')+(event?'；目标事件：'+event:'')+'）';
  }
  const classified=classifyAnalysisTask(text,today);
  const localIntent=parseTemporalIntent(source.text,today),hasLocalBounds=!!(localIntent.yearRange||localIntent.explicitYears.length||localIntent.spanYears||localIntent.deadline||localIntent.referenceExplicit||localIntent.retrospectiveEndYear!==undefined)||/今年|明年|后年|去年|前年|本年|本月|下个?月|上个?月|今天|明天|后天/.test(source.text);
  const dependsOnTaskId=previousPart&&!localDomains.length&&!hasLocalBounds&&WHEN.test(source.text)?'task-'+index:undefined;
  if(dependsOnTaskId)classified.reasonCodes.push('local_task_time_dependency');
  if(follow){classified.reasonCodes.push('explicit_same_topic_followup');
   const previous=classifyAnalysisTask(dialogue.goal,today);
   if(!timePresent(classified.temporalIntent)&&previous.kind!=='attribute'&&previous.kind!=='knowledge'){
    classified.kind=previous.kind;classified.precision=previous.precision;classified.timeDirection=previous.timeDirection;classified.needsCurrentEnvironment=previous.needsCurrentEnvironment;
    classified.reasonCodes.push('followup_plan_inheritance_required');
   }else if(previous.kind==='future_timing'&&classified.kind==='current_state')classified.kind='future_timing';
  }
  if(!domains.length&&classified.kind!=='knowledge')unresolved.push({reason:'domain_unresolved',source});
  if(/(?:他|她|朋友|父亲|母亲|伴侣|孩子)的(?:命盘|八字|出生|运势)|另一个命例|另一张命盘/.test(text)){
   classified.reasonCodes.push('subject_identity_required');unresolved.push({reason:'subject_identity_required',source});
  }
  return {id:'task-'+(index+1),question:text,source,domains:ids,palaces:classified.needsChart?resolveQuestionPalaces(text,{fallback:false}):[],corePalaces:classified.needsChart?unique(domains.flatMap(d=>d.corePalaces)):[],...classified,...(selectedPrior?{inheritedTaskId:selectedPrior.id}:{}),...(dependsOnTaskId?{dependsOnTaskId}:{})};
 });
 if(tasks.length>MAX_QUESTION_TASKS){
  const overflow=tasks.splice(MAX_QUESTION_TASKS-1),start=overflow[0].source.start,end=overflow.at(-1)!.source.end,source=trimSource(question,start,end);
  tasks.push({id:'task-'+MAX_QUESTION_TASKS,question:overflow.map(t=>t.question).join('；'),source,domains:unique(overflow.flatMap(t=>t.domains)),palaces:unique(overflow.flatMap(t=>t.palaces)),corePalaces:unique(overflow.flatMap(t=>t.corePalaces)),kind:'mixed',precision:'none',needsChart:false,needsCurrentEnvironment:false,timeDirection:'mixed',temporalIntent:parseTemporalIntent(source.text,today),reasonCodes:['task_limit_requires_bounded_planning'],assumptions:['超过单轮独立调查任务上限，未执行部分保留在此任务中。']});
  issues.push('TASK_LIMIT_EXCEEDED');unresolved.push({reason:'task_limit_requires_bounded_planning',source});
 }
 if(unresolved.some(x=>x.reason==='domain_unresolved'))issues.push('DOMAIN_UNRESOLVED','UNRESOLVED_SEMANTICS');
 if(selection?.ambiguous){issues.push('FOLLOWUP_TASK_UNRESOLVED','UNRESOLVED_SEMANTICS');unresolved.push({reason:'followup_task_unresolved',source:trimSource(question,0,question.length)});}
 if(unresolved.some(x=>x.reason==='subject_identity_required'))issues.push('SUBJECT_IDENTITY_UNRESOLVED');
 const effectiveQuestion=tasks.map(t=>t.question).join('；');
 return {version:QUESTION_ANALYSIS_VERSION,registryVersion:QUESTION_DOMAIN_VERSION,question:original,effectiveQuestion,kind:tasks.length===1?tasks[0].kind:'mixed',tasks,sharedConditions,issues:unique(issues),assumptions,...(unresolved.length?{unresolved}:{})};
}
