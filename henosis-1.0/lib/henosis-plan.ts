import {z} from 'zod';
import {buildAnalysisPlan,analysisPlanContext,type AnalysisPlan} from './analysis-plan';
import {analyzeQuestion,classifyAnalysisTask as classifySharedTask,type QuestionAnalysis,type QuestionTask} from './question-planner';
import {QUESTION_DOMAINS,PALACE_NAMES,explicitQuestionPalaces,requestedTopicText,type DomainId} from './question-domains';
import {parseTemporalIntent,temporalFollowup,type TemporalIntent} from './temporal-intent';
import {solarISO,type DatedQuery} from './query-dates';
import {digest} from './palace-memory-facts';
import {henosisRefinementBrief} from './henosis-context';
import {HENOSIS_VERSION,henosisSettingsSchema,type HenosisPlanningInput,type HenosisPlan,type HenosisEvidenceBundle,type HenosisDecision} from './henosis-contracts';
import {isHenosisResourceFailure} from './henosis-generation';
import {checkHenosisRequirements,henosisTemporalRequirements} from './henosis-requirements';
import {isHenosisMethodDirective,alignExplicitHenosisRanges,henosisQuestionContract} from './henosis-orchestration';
import {henosisNatalOnly,henosisDomains,henosisConnector,henosisAnalysisFacet,henosisFallbackSpans,henosisTargetText,henosisPresentationConstraint,henosisBackgroundRequirement} from './henosis-intent';

const domains=QUESTION_DOMAINS.map(d=>d.id) as [DomainId,...DomainId[]];
const kinds=['attribute','current_state','historical_compare','future_timing','decision','knowledge'] as const;
const scopes=['natal','decadal','yearly','monthly','daily'] as const;
// Parser-only wording equivalence. Source quotes and stored user text stay exact;
// Nous continues to use its existing parser unchanged.
const constraintSentence=(text:string)=>!/[？?]|分析|比较|适合|何时|什么时候|如何|怎样/.test(text)&&/^(?:注意[：:]?)?(?:\d{4}年只是[^。；;]*背景[^。；;]*|我的[^。；;]*(?:尚未提供|没有提供)[^。；;]*|请不要由命盘[^。；;]*|如果无法确定唯一最佳年份[，,]?请给出条件化选择)[。；;]?\s*$/.test(text.trim());
const temporalWording=(text:string)=>text.replace(/开始了?(一段|这段)感情/g,'开始$1恋爱')
 .split(/(?<=[。；;])/).filter(sentence=>!constraintSentence(sentence)).join('')
 .replace(/((?:我)?从)(?:19|20)\d{2}年(开始(?:想|考虑|打算)[^。！？]*?(?:但一直没有行动|尚未行动)[。])/g,'此前$2');
const classifyAnalysisTask=(text:string,today?:string)=>{
 const result=classifySharedTask(henosisTargetText(temporalWording(text)),today);
 if(henosisNatalOnly(text)){result.precision='natal';result.needsCurrentEnvironment=false;result.timeDirection='atemporal';result.temporalIntent={...result.temporalIntent,explicitYears:[],excludedYears:[],yearRange:undefined,spanYears:undefined,retrospective:false,targetText:'仅本命'};result.reasonCodes=['atemporal_natal_only'];}
 return result;
};
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>d>='1900-01-01'&&d<='2100-12-31'&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d);
const initialSchema=z.object({tasks:z.array(z.object({
 quote:z.string().min(1).max(3000),domains:z.array(z.enum(domains)).max(domains.length),kind:z.enum(kinds),precision:z.enum(['none',...scopes]),
 dependsOn:z.number().int().min(1).max(6).optional(),dependency:z.enum(['same_event','conditional']).optional(),role:z.enum(['goal','background','constraint']).optional(),
}).strict()).min(1).max(6)}).strict();
const querySchema=z.object({scope:z.enum(scopes),date:dateSchema,palaces:z.array(z.enum(PALACE_NAMES)).min(1).max(4),relations:z.boolean().default(true)}).strict();
const refineSchema=z.object({requests:z.array(z.object({
 taskId:z.string().max(80),reason:z.string().trim().min(4).max(600),evidenceIds:z.array(z.string().min(1).max(240)).min(1).max(8),
 queries:z.array(querySchema).max(4).optional(),range:z.object({start:dateSchema,end:dateSchema}).strict().optional(),
}).strict().refine(r=>!!r.range||!!r.queries?.length)).max(6)}).strict();
const unique=<T>(a:T[])=>[...new Set(a)];
const punctuation=/[\s，,。；;！？!?、]/g;
const propertyWords=/性格|本性|禀赋|天赋|擅长|优势|弱点|体质|婚恋观|感情观|爱情观|择偶观|金钱观|财富观|职业倾向|先天|本命|适合.{0,5}(?:职业|行业|做什么|干什么)/;
const timeWords=/今年|本年|明年|后年|去年|前年|当前|现在|目前|近期|最近|未来|过去|今天|明天|后天|何时|什么时候|多久|哪.{0,3}(?:年|月|天)|几月|几岁|多大|大限|流年|流月|流日/;
// Analysis-method instructions constrain a substantive task. They are not
// independent questions and must not consume chart queries or answer budget.
const planningDirectiveTerms=/(?:\u5206\u6790\u65f6\u95f4\u8303\u56f4|\u65f6\u95f4\u8303\u56f4\u4e0e\u65f6\u95f4\u7cbe\u5ea6|\u65f6\u95f4\u7cbe\u5ea6|\u65f6\u95f4\u9897\u7c92\u5ea6|\u7cbe\u786e\u5230\u6708\u4efd|\u5f3a\u884c\u7cbe\u786e\u5230\u6708\u4efd|\u7ec6\u5316\u5230\u6708\u4efd)/;
const planningDirectiveVerbs=/(?:\u8bf7|\u4e0d\u8981|\u65e0\u9700|\u81ea\u884c|\u81ea\u52a8|\u6839\u636e\u95ee\u9898|\u6309\u95ee\u9898)/;
const planningDirectiveOnly=(text:string)=>{
 if(isHenosisMethodDirective(text))return true;
 const remaining=text.split(/(?<=[。；;])/).filter(s=>!constraintSentence(s)).join('');
 if(text.trim()&&!remaining.trim())return true;
 const clauses=remaining.split(/[\uFF0C\u3002\uFF1B;\uFF01!\uFF1F?]+/).map(value=>value.trim()).filter(Boolean);
 return !!clauses.length&&clauses.every(value=>planningDirectiveTerms.test(value)&&planningDirectiveVerbs.test(value)||/^(?:请)?(?:保持|采用|使用)(?:大限|流年|流月|流日|年|月|日)精度$/.test(value)||/^(?:若|如果)(?:跨入|进入|跨过)下一大限$/.test(value)||/^(?:请)?(?:先)?(?:解释|说明)(?:下一)?大限背景变化$/.test(value)||/^(?:并)?(?:请)?明确每项判断的(?:关键宫位|成立条件|现实风险)(?:(?:、|和|及)(?:关键宫位|成立条件|现实风险))*$/.test(value));
};
const hardBounds=(i:TemporalIntent)=>!!(i.explicitYears.length||i.yearRange||i.spanYears||i.deadline||i.retrospectiveEndYear!==undefined||i.excludedYears.length);
const hardTime=(t:Pick<QuestionTask,'temporalIntent'|'reasonCodes'>)=>hardBounds(t.temporalIntent)||timeWords.test(t.temporalIntent.targetText)||t.reasonCodes.some(r=>/^explicit_(day|month|decade)_precision$/.test(r));
const plainProperty=(q:string)=>{const p=classifyAnalysisTask(q);return henosisNatalOnly(q)||p.kind==='attribute'&&propertyWords.test(requestedTopicText(q))&&!hardTime(p);};
const directSubject=/(?:他|她|朋友|父亲|母亲|伴侣|孩子)的(?:命盘|八字|出生|运势)|另一个命例|另一张命盘/;
const namedDomains:Partial<Record<DomainId,RegExp>>={career:/事业|官禄|职业/,wealth:/财运|财富|财帛/,education:/学业|学历|学位/,relationship:/婚姻|恋爱|结婚|夫妻/,health:/身体|健康|体质|疾厄/,self:/性格|命宫|禀赋/,siblings:/兄弟|姐妹/,children:/子女|育儿/,parents:/父母|父亲|母亲/,property:/房产|田宅|买房/,network:/交友|人际|合伙/,travel:/迁移|出国|迁居/,wellbeing:/福德|心境|情绪/};

/** Henosis-only depth routing. These palaces add decision context before evidence
 * collection; they never change the shared Nous domain registry or chart rules. */
function depthPalaces(task:QuestionTask){
 const text=requestedTopicText(task.question),open=['current_state','historical_compare','future_timing','decision'].includes(task.kind),extra:string[]=[];
 if(!open)return extra;
 if(task.domains.includes('career')){
  if(/创业|单干|经商|自由职业|独立.{0,3}(?:做|经营|执业)|副业|项目/.test(text))extra.push('财帛','迁移','交友','福德');
  else if(/跳槽|转职|离职|换工作|选择|时机|何时|什么时候/.test(text))extra.push('财帛','迁移','福德');
 }
 if(task.domains.includes('relationship')&&/结婚|成家|长期|稳定|同居|婚期|何时|什么时候/.test(text))extra.push('田宅');
 if(task.domains.includes('wealth')&&/创业|投资|合伙|资产|积累|长期|选择|时机/.test(text))extra.push('田宅','交友');
 if(task.domains.includes('education')&&/留学|异地|出国|选择|申请/.test(text))extra.push('迁移');
 return unique(extra).filter(p=>!task.palaces.includes(p)&&!new RegExp('(?:不看|不分析|不用看|不要分析)(?:本命|大限|流年|流月|流日)?'+p).test(task.question));
}

const initialInstructions=`你是 Xytha-Henosis 的问题规划器。先按语义拆分所有本轮问题，再分类；规则结果仅作参考，可以纠正关键词误判。仅返回 JSON {"tasks":[{"quote":"连续逐字复制本轮原文","domains":["允许的领域ID"],"kind":"attribute|current_state|historical_compare|future_timing|decision|knowledge","precision":"none|natal|decadal|yearly|monthly|daily","dependsOn":1,"dependency":"same_event|conditional"}]}。依赖字段可省略，dependsOn 为从1开始的前置任务序号。所有原文必须被连续片段完整覆盖（标点除外），不得改写、遗漏否定、对象、日期和限定条件。背景事件与所属问题放在同一个片段；日期列表不是独立问题；不同领域和不同时间目标分别拆开。只在同一事件的省略追问用 same_event，跨主题的先后条件用 conditional。没有时间的明确本征属性只查本命，知识或闲聊不查盘。何时发生的开放事件通常先到年，只有用户明确要求月份或日期才细化。2024开始恋爱是背景，不限制结婚目标为2024。历史回顾的截止、排除年份不能改写。不要生成命理结论、用户经历或心理事实，也不要直接生成查盘日期。`;
 const planningConstraintInstructions='每段可以标注 role=goal（可独立回答的目标）、background（用户指定的历史背景取证）、constraint（精度、格式、排序、现实条件等要求）。约束附在其目标原文中，不单独创建任务；背景日期另存取证范围，不能变成未来候选。一个共同决策的多个目标如搬迁与购房共享调查，但必须分别给出结论。\n\nTreat range/precision choice, response format, natal basis, historical trajectory, current conditions and candidate comparison for ONE event as requirements inside that event quote, not standalone tasks. A method directive never authorizes omitting substantive clauses. Split independent goals, unrelated events or independent explicit target ranges. Preserve every original requirement in the quote. For a career choice over eight years, natal/current/history/candidate comparison are layers of ONE task, not five tasks with default horizons.';
const refineInstructions=`你是 Xytha-Henosis 的一次补充规划器。根据已执行的证据和标明为假设的倾向变化，判断是否存在影响回答的具体资料缺口。不要输出答案，不要把盘面解读当用户事实。仅返回 JSON {"requests":[{"taskId":"现有任务ID","reason":"此补查解决什么具体缺口","evidenceIds":["本任务已有真实引用ID"],"queries":[{"scope":"natal|decadal|yearly|monthly|daily","date":"YYYY-MM-DD","palaces":["允许宫位"],"relations":true}],"range":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}}]}。queries/range可择一，没有必要补查时requests=[]。最多6项请求、总共12组新增查询。只补尚未覆盖的宫位或资料，不重复已查的时间宫位组合。禁止引用不存在或其他任务的证据，禁止改写原问题、对象或明确时间边界，禁止提高用户未要求的时间精度。range仅允许无明确时间约束的开放默认区间向外扩展，不得缩小原调查范围；年份总跨度最多10年、月份总跨度最多2年、日期最多31天。只为找到唯一最优而扩大范围不成立，允许并列或无明显区别。历史前史不能混入截止后的现实结果；未来目标盘面必须作为预测性观察，不能用作已发生证据。`;

function historyMeta(value:unknown):Record<string,any>{try{return typeof value==='string'?JSON.parse(value):value&&typeof value==='object'?value:{};}catch{return {};}}
function henosisHistory(input:HenosisPlanningInput){
 return input.history.map(h=>{
  const meta=historyMeta(h.meta),saved=meta.henosis?.plan;
  if(!saved||meta.henosis?.version!==HENOSIS_VERSION&&saved.henosis?.version!==HENOSIS_VERSION)return h;
  if(saved.profileId!==input.profileId||saved.profileRevision!==input.profileRevision||!Array.isArray(saved.tasks))return {...h,meta:{}};
  // The legacy selector reads analysisPlan. Do not synthesize a global timing
  // record: each selected task must retain its own year/month interval.
  return {...h,meta:{...meta,analysisPlan:saved}};
 });
}
function historyTimestamp(h:HenosisPlanningInput['history'][number]){
 const value=h as typeof h&{createdAt?:number;recordedAt?:string},meta=historyMeta(h.meta),date=value.createdAt??value.recordedAt??meta.recordedAt;
 return typeof date==='number'?date:typeof date==='string'?Date.parse(date):NaN;
}
function initialDialogue(input:HenosisPlanningInput,baseline:QuestionAnalysis){
 const selected=new Set(baseline.tasks.map(t=>t.inheritedTaskId).filter(Boolean));
 const prior=input.history.slice().reverse().flatMap(h=>historyMeta(h.meta).analysisPlan?.tasks||[]);
 const anchors=[...selected].map(id=>prior.find((t:any)=>t.id===id)).filter(t=>t?.temporalIntent?.referenceExplicit).map(t=>t.temporalIntent.referenceDate as string).filter(d=>d<input.today);
 const cutoff=anchors.length?Math.min(...anchors.map(d=>Date.parse(d+'T23:59:59+08:00'))):Infinity;
 return input.history.slice(-4).flatMap(h=>{
  const all=historyMeta(h.meta).analysisPlan?.tasks||[],tasks=all.slice(0,6).map((t:QuestionTask)=>({id:t.id,question:t.question,kind:t.kind,precision:t.precision,domains:t.domains})),at=historyTimestamp(h);
  if(cutoff!==Infinity&&(!Number.isFinite(at)||at>cutoff)){
   const indexed=tasks.filter((t:QuestionTask)=>selected.has(t.id));
   // A request made after the simulated date may identify the task being continued,
   // but its dialogue and outcomes cannot become knowledge available at that date.
   return indexed.length?[{role:h.role,content:'本轮指代的既有任务索引；不含当时已知事实或后来结果。',tasks:indexed.map(({question:_q,...t}:any)=>t)}]:[];
  }
  return [{role:h.role,content:h.content.slice(0,700),...(Number.isFinite(at)?{recordedAt:new Date(at).toISOString()}:{}),...(tasks.length?{tasks}:{})}];
 });
}

function literalClassification(input:HenosisPlanningInput,raw:z.infer<typeof initialSchema>,baseline:QuestionAnalysis){
 // A faithful semantic split can arrive in dependency order rather than source
 // order. Normalize the order and remap dependencies without rewriting quotes.
 const located=raw.tasks.map((item,index)=>({item,index,start:input.question.indexOf(item.quote)}));
 if(located.every(t=>t.start>=0)&&new Set(located.map(t=>t.start)).size===located.length){
  if(raw.tasks.some((item,index)=>item.dependsOn===index+1))throw Error('HENOSIS_DEPENDENCY_INVALID');
  located.sort((a,b)=>a.start-b.start);
  const first=located[0],prefix=input.question.slice(0,first.start);
  if(first.start>0&&(henosisConnector(prefix)||/^(?:请)?(?:结合|根据|基于)(?:一下)?(?:我的|本人的|这个)?命盘[，,:：\s]*$/.test(prefix))){
   first.item={...first.item,quote:prefix+first.item.quote};first.start=0;
  }
  const groups:typeof located=[],indices=new Map<number,number>();
  for(const entry of located){
   const previous=groups.at(-1);
   const gap=previous?input.question.slice(previous.start+previous.item.quote.length,entry.start):'';
   const eventOwner=previous&&(['decision','future_timing'].includes(previous.item.kind)||groups.length===1&&previous.item.kind==='historical_compare');
   if(previous&&(planningDirectiveOnly(entry.item.quote)||henosisPresentationConstraint(entry.item.quote)||entry.item.role==='constraint'&&!hardTime(classifyAnalysisTask(entry.item.quote,input.today))||eventOwner&&henosisAnalysisFacet(entry.item.quote))&&henosisConnector(gap)){
    previous.item={...previous.item,quote:input.question.slice(previous.start,entry.start+entry.item.quote.length)};indices.set(entry.index+1,groups.length);
   }else{const connector=previous&&gap.replace(punctuation,'')&&henosisConnector(gap)?gap:'';groups.push({...entry,start:entry.start-connector.length,item:{...entry.item,quote:connector+entry.item.quote}});indices.set(entry.index+1,groups.length);}
  }
  raw={tasks:groups.map(({item},index)=>{const parent=item.dependsOn===undefined?undefined:indices.get(item.dependsOn)??item.dependsOn;if(parent===index+1){const {dependsOn:_parent,dependency:_relation,...rest}=item;return rest;}return {...item,...(parent===undefined?{}:{dependsOn:parent})};})};
 }
 const tasks:QuestionTask[]=[],dependencies:NonNullable<HenosisPlan['henosis']['dependencies']>=[];
 let cursor=0;
 for(const [index,item] of raw.tasks.entries()){
  const start=input.question.indexOf(item.quote,cursor),end=start+item.quote.length;
   const gap=input.question.slice(cursor,start);
   if(start<0||gap.replace(punctuation,'')&&!planningDirectiveOnly(gap)&&!henosisConnector(gap))throw Error('HENOSIS_SOURCE_COVERAGE');
   cursor=end;
   if(planningDirectiveOnly(item.quote))continue;
  // The shared rule planner can reconstruct non-contiguous clauses. Those are
  // routing hints, not literal source spans and cannot veto a faithful split.
  const originals=baseline.tasks.filter(t=>t.source.start<end&&t.source.end>start&&input.question.slice(t.source.start,t.source.end)===t.source.text);
  // A model may correct classes, but merging independent explicit ranges would turn
  // their union into a misleading single temporal request in the canonical resolver.
  const timedOriginals=originals.filter(t=>!planningDirectiveOnly(t.source.text)&&!henosisAnalysisFacet(t.source.text)).map(t=>classifyAnalysisTask(t.source.text,input.today)).filter(t=>t.temporalIntent.yearRange||t.temporalIntent.spanYears||t.temporalIntent.deadline||t.temporalIntent.explicitYears.length&&!/不包含|排除|不要/.test(t.temporalIntent.targetText));
  if(timedOriginals.length>1&&new Set(timedOriginals.map(t=>JSON.stringify([t.temporalIntent.explicitYears,t.temporalIntent.yearRange,t.temporalIntent.spanYears,t.temporalIntent.retrospective,t.timeDirection,t.precision]))).size>1)throw Error('HENOSIS_INDEPENDENT_RANGES_MERGED');
  if(!henosisNatalOnly(item.quote)&&originals.some(t=>plainProperty(t.question))&&originals.some(t=>hardTime(t)))throw Error('HENOSIS_ATTRIBUTE_TASK_MERGED');
  const parsed=classifyAnalysisTask(item.quote,input.today),positive=requestedTopicText(temporalWording(item.quote));
  if(!positive.replace(punctuation,'')||parsed.temporalIntent.backgroundEvents.length&&!/什么|何时|哪|如何|怎样|吗|呢|分析|比较|适合|想问/.test(positive))throw Error('HENOSIS_DETACHED_CONDITION');
  const local=analyzeQuestion(item.quote,[],input.chart,input.today);
  const required=domains.filter(d=>namedDomains[d]?.test(positive));
  if(item.kind!=='knowledge'&&required.some(d=>!item.domains.includes(d)))throw Error('HENOSIS_EXPLICIT_DOMAIN_CHANGED');
  // Strip negated topics before matching; they cannot become a positive model task.
  const removed=temporalWording(item.quote).replace(positive,'');
  if(item.domains.some(d=>namedDomains[d]?.test(removed)&&!namedDomains[d]?.test(positive)))throw Error('HENOSIS_NEGATED_DOMAIN');
  const timed=hardTime(parsed),property=plainProperty(item.quote);
  let kind=property?'attribute' as const:item.kind;
  if(timed&&(kind==='attribute'||kind==='knowledge'))kind=parsed.kind==='attribute'?'current_state':parsed.kind;
  let precision:QuestionTask['precision']=kind==='knowledge'?'none':property?'natal':timed?parsed.precision:item.precision;
  if(kind!=='knowledge'&&!property&&!timed&&['monthly','daily','decadal'].includes(precision))precision=kind==='attribute'?'natal':'yearly';
  if(kind==='attribute')precision='natal';
  if(kind!=='attribute'&&kind!=='knowledge'&&!henosisNatalOnly(item.quote)&&(precision==='none'||precision==='natal'))precision='yearly';
  const domainIds=unique([...item.domains,...henosisDomains(item.quote)]).filter(d=>d!=='health'||henosisDomains(item.quote).includes('health')||!/不适合|适不适合/.test(item.quote));
  const selected=QUESTION_DOMAINS.filter(d=>domainIds.includes(d.id));
  if(kind!=='knowledge'&&!selected.length)throw Error('HENOSIS_DOMAIN_UNRESOLVED');
  const needsChart=kind!=='knowledge',palaces=needsChart?unique([...explicitQuestionPalaces(positive),...selected.flatMap(d=>[...d.corePalaces,...d.conditionalPalaces.filter(c=>c.when.test(positive)).flatMap(c=>c.palaces)])]):[];
  const subject=directSubject.test(item.quote)||originals.some(t=>t.reasonCodes.includes('subject_identity_required'))||local.tasks.some(t=>t.reasonCodes.includes('subject_identity_required'));
  const prior=originals.length===1?originals[0]:undefined;
  const inherited=prior?.inheritedTaskId?input.history.slice().reverse().flatMap(h=>historyMeta(h.meta).analysisPlan?.tasks||[]).find((t:any)=>t.id===prior.inheritedTaskId):undefined;
  if(inherited&&!hardTime(parsed)&&prior&&prior.kind!=='mixed'){kind=prior.kind;precision=prior.precision;}
  const task:QuestionTask={...parsed,id:'task-'+(index+1),question:item.quote,source:{text:item.quote,start,end,origin:'current'},domains:needsChart?domainIds:[],palaces,corePalaces:needsChart?unique(selected.flatMap(d=>d.corePalaces)):[],kind,precision,needsChart,needsCurrentEnvironment:needsChart&&precision!=='natal',
   timeDirection:kind==='attribute'||kind==='knowledge'?'atemporal':timed?parsed.timeDirection:kind==='historical_compare'?'past':kind==='future_timing'?'future':'current',
   reasonCodes:unique([...parsed.reasonCodes.filter(r=>r!=='domain_unresolved'&&r!=='atemporal_natal_only'),...(subject?['subject_identity_required']:[]),'henosis_semantic_first',...(henosisBackgroundRequirement(item.quote)||item.role==='background'&&kind==='historical_compare'&&!/独立回答|另一个问题/.test(item.quote)?['henosis_background_requirement']:[])]),assumptions:[],...(prior?.inheritedTaskId?{inheritedTaskId:prior.inheritedTaskId}:{})};
  if(inherited&&!parsed.temporalIntent.referenceExplicit&&inherited.temporalIntent?.referenceExplicit){task.temporalIntent={...task.temporalIntent,referenceDate:inherited.temporalIntent.referenceDate,referenceExplicit:true};}
  if(property)task.reasonCodes.push('atemporal_natal_only');
  if(item.dependsOn!==undefined){
   const parent=tasks.find(t=>t.id==='task-'+item.dependsOn);
   if(item.dependsOn===index+1||item.dependsOn>raw.tasks.length||!item.dependency)throw Error('HENOSIS_DEPENDENCY_INVALID');
   if(item.dependency==='same_event'){
    // Related facets can have their own explicit time. Preserve their relation,
    // but inherit a parent's interval only for genuinely untimed ellipsis.
    const ownsTime=hardBounds(task.temporalIntent)||/今年|明年|去年|当前|现在|过去|未来|大限|流年|流月|流日|今天/.test(positive);
    const parentDomains=parent?.domains||raw.tasks[item.dependsOn-1]?.domains||[];
    if(!parentDomains.some(d=>task.domains.includes(d))||!parent&&!ownsTime)throw Error('HENOSIS_TIME_DEPENDENCY_INVALID');
    if(!ownsTime&&parent&&parent.precision!=='natal')task.dependsOnTaskId=parent.id;
    else task.reasonCodes.push('henosis_explicit_time_dependency_isolated');
   }
   dependencies.push({taskId:task.id,dependsOnTaskId:'task-'+item.dependsOn,relation:item.dependency});
  }else if(item.dependency)throw Error('HENOSIS_DEPENDENCY_INVALID');
  else if(prior?.dependsOnTaskId){
   const oldParent=baseline.tasks.find(t=>t.id===prior.dependsOnTaskId),parent=oldParent&&tasks.find(t=>t.source.start<=oldParent.source.start&&t.source.end>=oldParent.source.end);
   if(parent){task.dependsOnTaskId=parent.id;dependencies.push({taskId:task.id,dependsOnTaskId:parent.id,relation:'same_event'});}
  }
  tasks.push(task);
 }
 const tail=input.question.slice(cursor);
  if(tail.replace(punctuation,'')&&!planningDirectiveOnly(tail)&&!henosisConnector(tail))throw Error('HENOSIS_SOURCE_COVERAGE');
 if(!tasks.length)throw Error('HENOSIS_NO_SUBSTANTIVE_TASK');
 const taskIds=new Set(tasks.map(t=>t.id));
 if(dependencies.some(d=>!taskIds.has(d.dependsOnTaskId)))throw Error('HENOSIS_DEPENDENCY_INVALID');
 const visiting=new Set<string>(),visited=new Set<string>();
 const visit=(id:string)=>{if(visiting.has(id))throw Error('HENOSIS_DEPENDENCY_CYCLE');if(visited.has(id))return;visiting.add(id);for(const d of dependencies.filter(d=>d.taskId===id))visit(d.dependsOnTaskId);visiting.delete(id);visited.add(id);};
 tasks.forEach(t=>visit(t.id));
 const issues=baseline.issues.filter(i=>!['DOMAIN_UNRESOLVED','UNRESOLVED_SEMANTICS'].includes(i));
 if(tasks.some(t=>t.reasonCodes.includes('subject_identity_required'))&&!issues.includes('SUBJECT_IDENTITY_UNRESOLVED'))issues.push('SUBJECT_IDENTITY_UNRESOLVED');
 return {classification:{...baseline,tasks,kind:tasks.length===1?tasks[0].kind:'mixed',issues} as QuestionAnalysis,dependencies};
}

function coherentFallback(input:HenosisPlanningInput,baseline:QuestionAnalysis){
 const spans=henosisFallbackSpans(input.question);if(!spans)return undefined;
 const tasks=spans.map(({start,end})=>{const quote=input.question.slice(start,end),parsed=classifyAnalysisTask(quote,input.today);return {quote,domains:henosisDomains(quote),kind:parsed.kind,precision:parsed.precision};});
 if(tasks.some(t=>!t.domains.length&&t.kind!=='knowledge'))return undefined;
 try{return literalClassification(input,{tasks},baseline);}catch{return undefined;}
}

async function identify(plan:HenosisPlan,parent?:string){const {id:_id,parentPlanId:_parent,...body}=plan;return {...body,...(parent?{parentPlanId:parent}:{}),id:'henosis-plan:'+await digest(body)} as HenosisPlan;}

function safePlanningHistory(input:HenosisPlanningInput){
 const intent=parseTemporalIntent(input.question,input.today);
 if(!intent.referenceExplicit||intent.referenceDate>=input.today)return input.history;
 const cutoff=Date.parse(intent.referenceDate+'T23:59:59+08:00');
 return input.history.filter(h=>{const at=historyTimestamp(h);return Number.isFinite(at)&&at<=cutoff;});
}

/** Conservative fallback only for explicitly requested analysis facets. Keep
 * exact source spans; a provider failure cannot turn future comparison into history. */
function explicitFacetFallback(input:HenosisPlanningInput,baseline:QuestionAnalysis){
 const markers=[...input.question.matchAll(/(?:请)?(?:先|首先)?(?:说明|解释|分析|查看|看)(?:一下)?(?:我的)?本命|(?:再|然后)?(?:回顾|对照|结合)(?:一下)?(?:过去|历史|前面)|(?:再|然后)?(?:结合|说明|解释|分析|查看)(?:当前|现在|今年)|(?:如果[^。；;！？]{1,24}[，,])?(?:请)?(?:然后|最后|再)?(?:逐年|逐月)?(?:比较|分析|对比)(?:一下)?(?:未来|接下来|往后|(?:19|20)\d{2}[—–至到-](?:19|20)\d{2}年)/g)];
 const futureMarker=(text:string)=>/未来|接下来|往后|(?:19|20)\d{2}[—–至到-](?:19|20)\d{2}年/.test(text);
 const hasFuture=markers.some(m=>futureMarker(m[0])),hasHistory=markers.some(m=>/过去|历史|前面/.test(m[0])),hasNatal=markers.some(m=>m[0].includes('本命'));
 if(!hasFuture||!(markers.length>=3&&hasNatal||markers.length>=2&&hasHistory))return;
 const starts=unique([0,...markers.map(m=>m.index!)]),shared=unique(baseline.tasks.flatMap(t=>t.domains));
 if(starts.length>6||!shared.length)return;
 const tasks=starts.map((start,i)=>{
  const quote=input.question.slice(start,starts[i+1]??input.question.length),parsed=classifyAnalysisTask(quote,input.today),localDomains=unique(analyzeQuestion(quote,[],input.chart,input.today).tasks.flatMap(t=>t.domains));
  const marker=markers.find(m=>m.index===start)?.[0]||'';
  const kind=marker.includes('本命')?'attribute' as const:/过去|历史|前面/.test(marker)?'historical_compare' as const:futureMarker(marker)?'future_timing' as const:/当前|现在|今年/.test(marker)?'current_state' as const:/判断|是否|还是/.test(quote)?'decision' as const:parsed.kind;
  const explicitlyNamed=domains.filter(d=>namedDomains[d]?.test(requestedTopicText(temporalWording(quote))));
  return {quote,domains:explicitlyNamed.length&&localDomains.length?unique([...localDomains,...explicitlyNamed]):unique([...shared,...localDomains,...explicitlyNamed]),kind,precision:parsed.precision,...(i>1?{dependsOn:i,dependency:'conditional' as const}:{})};
 });
 if(tasks[0].kind==='decision'&&tasks.at(-1)?.kind==='future_timing'){tasks[0].dependsOn=tasks.length;tasks[0].dependency='conditional';}
 const parsed=initialSchema.safeParse({tasks});if(!parsed.success)return;
 try{return literalClassification(input,parsed.data,baseline);}catch{return;}
}

/** A decision and its dependent timing/condition facets describe one decision
 * horizon. Reuse the explicit candidate horizon before evidence collection so
 * the top-level decision is not evaluated from a default current-only slice. */
function alignDecisionHorizons(plan:AnalysisPlan,dependencies:HenosisPlan['henosis']['dependencies'],decisions:HenosisDecision[]){
 for(const root of plan.tasks.filter(task=>task.kind==='decision'||task.kind==='future_timing')){
  const related=new Set([root.id]);
  let changed=true;while(changed){changed=false;for(const link of dependencies||[]){if(related.has(link.dependsOnTaskId)&&!related.has(link.taskId)){related.add(link.taskId);changed=true;}if(related.has(link.taskId)&&!related.has(link.dependsOnTaskId)){related.add(link.dependsOnTaskId);changed=true;}}}
  const compatible=(task:AnalysisPlan['tasks'][number])=>task.temporalIntent.referenceDate===root.temporalIntent.referenceDate&&task.domains.some(d=>root.domains.includes(d))&&!task.reasonCodes.includes('subject_identity_required')&&!root.reasonCodes.includes('subject_identity_required');
  // An explicit five-year facet is a constraint on the same open question even
  // when the semantic planner omitted a dependency. Never merge ambiguous spans.
  const explicit=plan.tasks.filter(task=>compatible(task)&&task.kind==='future_timing'&&task.timingRequest&&hardBounds(task.temporalIntent));
  const ranges=new Set(explicit.map(t=>JSON.stringify([t.precision,t.timingRequest!.start,t.timingRequest!.end])));
  if(ranges.size===1)explicit.forEach(t=>related.add(t.id));
  const candidates=plan.tasks.filter(task=>related.has(task.id)&&compatible(task)&&task.kind==='future_timing'&&task.timingRequest);
  if(!candidates.length)continue;
  if(new Set(candidates.filter(t=>hardBounds(t.temporalIntent)).map(t=>JSON.stringify([t.precision,t.timingRequest!.start,t.timingRequest!.end]))).size>1)continue;
  const span=(task:AnalysisPlan['tasks'][number])=>Date.parse(task.timingRequest!.end)-Date.parse(task.timingRequest!.start);
  const horizon=candidates.sort((a,b)=>span(b)-span(a))[0];
  for(const task of plan.tasks.filter(task=>(related.has(task.id)||ranges.size===1&&compatible(task))&&compatible(task)&&['decision','future_timing'].includes(task.kind)&&!hardBounds(task.temporalIntent)&&!task.temporalIntent.retrospective&&!(task.kind==='future_timing'&&/今年|明年|当前|现在|本月|今天/.test(task.temporalIntent.targetText))&&!task.reasonCodes.some(r=>/^explicit_(day|month|decade)_precision$/.test(r)))){
   if(task.id===horizon.id||task.reasonCodes.includes('henosis_shared_decision_horizon'))continue;
   const request=structuredClone(horizon.timingRequest!);
   task.timingRequest={...request,goal:task.question,palaces:task.palaces,assumptions:unique([...request.assumptions,'Decision horizon inherited from its explicit timing comparison.'])};
   task.precision=horizon.precision;
   task.queries=horizon.queries.map(query=>({...query,palaces:task.palaces}));
   task.coverage=undefined;
   task.reasonCodes=unique([...task.reasonCodes,'henosis_shared_decision_horizon']);
   decisions.push({phase:'initial_plan',taskId:task.id,action:'decision_horizon_aligned',reason:`Aligned with dependent timing task ${horizon.id}; the decision, turning points, and conditions now use one explicit horizon.`});
  }
 }
}

/** Semantic-first for substantive tasks; explicit properties and chart-free questions
 * have a hard fast path. Models never calculate chart dates or canonical palace facts. */
export async function planHenosisQuestion(input:HenosisPlanningInput):Promise<HenosisPlan>{
 input.signal?.throwIfAborted();
 input={...input,history:safePlanningHistory(input)};
 input={...input,history:henosisHistory(input)};
 const settings=henosisSettingsSchema.parse(input.settings),baseline=analyzeQuestion(input.question,input.history,input.chart,input.today),decisions:HenosisDecision[]=[];
 let classification:QuestionAnalysis|undefined,dependencies:HenosisPlan['henosis']['dependencies'],facetFallback=false;
 const fast=baseline.tasks.every(t=>t.kind==='knowledge'||t.kind==='attribute'&&plainProperty(t.question));
 const explicitFacets=fast?undefined:explicitFacetFallback(input,baseline);
 if(!fast&&input.callModel){
  const followup=temporalFollowup(input.question)||baseline.tasks.some(t=>t.inheritedTaskId);
  const data={question:input.question,today:input.today,allowedDomains:QUESTION_DOMAINS.map(d=>({id:d.id,label:d.label})),history:followup?initialDialogue(input,baseline):[],ruleProposal:(explicitFacets?.classification||baseline).tasks.filter(t=>input.question.includes(t.source.text)).map(t=>({quote:t.source.text,kind:t.kind,precision:t.precision,domains:t.domains})),maxTasks:6};
  let rejectedReason='',previousProposal:unknown;
  const dependencyRules='dependsOn 与 dependency 必须成对出现；独立任务两者都省略。dependsOn 是从1开始的任务序号，不能指向自身；dependency 必须显式写 same_event 或 conditional，不能只输出 dependsOn。';
  const dependencyIssues=()=>{
   const tasks=(previousProposal as {tasks?:unknown[]}|undefined)?.tasks;
   return Array.isArray(tasks)?tasks.slice(0,6).flatMap((value:any,index)=>value&&typeof value==='object'&&((value.dependsOn!==undefined)!==(value.dependency!==undefined))?[{task:index+1,field:value.dependsOn!==undefined?'dependency':'dependsOn',reason:'依赖字段缺少成对的另一项；补全有依据的关系，或同时删除两项。'}]:[]):[];
  };
  for(let attempt=0;attempt<2;attempt++){
   let raw:unknown;
   try{raw=await input.callModel(initialInstructions+planningConstraintInstructions+'\n'+dependencyRules+'\n最多6个任务；domains 可包含所有明确相关的 allowedDomains，去重。conditional 可引用后列任务，依赖必须无环；same_event 只能引用前列任务。不输出解释或分析正文。'+(attempt?'\n上次提案未通过校验。以 repair.previousProposal 为基础，只改 issue 和 dependencyIssues 指出的字段，其余原文片段及条件保留；只返回完整 tasks JSON。':''),{...data,...(attempt?{repair:{issue:rejectedReason,previousProposal,dependencyIssues:dependencyIssues()}}:{})},attempt?'initial_plan_repair':'initial_plan');}
   catch(error){input.signal?.throwIfAborted();if(!isHenosisResourceFailure(error))throw error;rejectedReason='HENOSIS_PLANNING_RESOURCE_LIMIT';decisions.push({phase:attempt?'initial_plan_repair':'initial_plan',action:'planning_unavailable',reason:'语义规划未完整返回，使用保留原文与时间约束的规则计划继续；未确认的意图仍需澄清。'});break;}
   previousProposal=JSON.stringify(raw).length<=16000?raw:undefined;
   input.signal?.throwIfAborted();const result=initialSchema.safeParse(raw);
   if(result.success){try{const proposed=literalClassification(input,result.data,baseline);
    // Literal source coverage already protects every requested layer. A single
    // event may carry its layers as requirements instead of separate answers.
    ({classification,dependencies}=proposed);decisions.push({phase:'initial_plan',action:attempt?'semantic_plan_repaired':'semantic_plan',reason:attempt?'一次定向修复后，语义拆分通过原文、对象和时间边界核对。':'模型逐字拆分并分类，时间与对象保护由程序校验。'});break;}catch(e){rejectedReason=e instanceof Error?e.message:'HENOSIS_SEMANTIC_REJECTED';}}
   else rejectedReason='HENOSIS_INITIAL_SCHEMA: '+result.error.issues.slice(0,6).map(i=>i.path.join('.')+' '+i.code).join('; ');
  }
  if(!classification)decisions.push({phase:'initial_plan',action:'rejected',reason:rejectedReason});
 }
 if(!classification)decisions.push({phase:'initial_plan',action:fast?'deterministic_fast_path':'deterministic_fallback',reason:fast?'明确本征属性只查本命；知识与闲聊不查盘。':input.callModel?'语义提案未通过校验，保留规则计划和未解决事项。':'未提供模型连接，保留可验证的规则计划。'});
 if(!classification){const coherent=coherentFallback(input,baseline);if(coherent){({classification,dependencies}=coherent);decisions.push({phase:'initial_plan',action:'coherent_event_fallback',reason:'保留完整事件原文、共同主题和时间约束；分析方法归属原问题，不另建空证据任务。'});}}
 if(!classification&&explicitFacets){({classification,dependencies}=explicitFacets);facetFallback=true;decisions.push({phase:'initial_plan',action:'deterministic_facet_fallback',reason:'语义规划未通过，本次按原文明示的本命、回顾、当前与未来层次拆分，保留各自时间；未核实的意图不作额外推断。'});}
  const originals=classification||baseline;
   const normalized={...originals,tasks:originals.tasks.map(t=>{
    let question=henosisTargetText(temporalWording(t.question));
    const stop=question.search(/[。？?]/),head=stop<0?question:question.slice(0,stop+1);
    // Background/history instructions after the actual future event cannot turn
    // marriage timing into a retrospective request. Keep all original prose in
    // task.question for evidence/answer; only the resolver sees this target text.
    if(/什么时候|何时/.test(head)&&/结婚|恋爱|创业|转行|迁|搬/.test(head)&&!/(?:过去|此前)\S{0,6}年|\d{4}年之前/.test(head)&&stop>=0){
     const constraints=question.slice(stop+1).match(/(?:排除|截至|最晚|不晚于)\d{4}年/g)||[];question=head+constraints.join('；');
    }
    if(henosisNatalOnly(t.question))return {...t,...classifyAnalysisTask(t.question,input.today),question};
    const directions=henosisTemporalRequirements(question);
    // In a still-combined facet, a historical-background word must not reverse
    // an explicit future target. Preserve the original question/source afterwards.
    if(directions.some(r=>r.direction==='future')&&!directions.some(r=>r.direction==='past'))question=question.replace(/回顾|过去|历史|前面/g,'背景');
    return question===t.question?t:{...t,question,temporalIntent:classifyAnalysisTask(question,input.today).temporalIntent};
   })};
  const base=await buildAnalysisPlan({...input,classification:normalized});
  if(!classification||decisions.some(d=>d.action==='coherent_event_fallback'))base.classificationSource='rules';
  for(const task of base.tasks){const original=originals.tasks.find(t=>t.id===task.id);if(original){task.question=original.question;task.source=original.source;}}
  if(facetFallback){base.classificationSource='rules';for(const task of base.tasks)task.reasonCodes=task.reasonCodes.map(r=>r==='henosis_semantic_first'?'henosis_explicit_rule_facets':r);}
   alignExplicitHenosisRanges(base,decisions);
   alignDecisionHorizons(base,dependencies,decisions);
   // Explicit analysis facets are evidence prerequisites for the decision,
   // not facts caused by it. Answer the facets before synthesizing the choice.
   if(base.tasks.some(t=>t.kind==='attribute')&&base.tasks.some(t=>['historical_compare','current_state'].includes(t.kind))&&base.tasks.some(t=>t.kind==='future_timing')){
    for(const root of base.tasks.filter(t=>t.kind==='decision')){
     const peers=base.tasks.filter(t=>t.id!==root.id&&['attribute','current_state','historical_compare','future_timing'].includes(t.kind)&&t.domains.some(d=>root.domains.includes(d)));
     const ids=new Set([root.id,...peers.map(t=>t.id)]);
     dependencies=(dependencies||[]).filter(d=>!ids.has(d.taskId)||!ids.has(d.dependsOnTaskId));
     dependencies.push(...peers.map(t=>({taskId:root.id,dependsOnTaskId:t.id,relation:'conditional' as const})));
     decisions.push({phase:'initial_plan',taskId:root.id,action:'facet_prerequisites',reason:'先完成本命、前史和未来比较，再据已完成的分层结论形成综合选择；保持原文显示顺序。'});
    }
   }
  for(const task of base.tasks){
   const added=depthPalaces(task);if(!added.length)continue;
   task.palaces=unique([...task.palaces,...added]);
   decisions.push({phase:'initial_plan',taskId:task.id,action:'depth_palaces_added',reason:`为回答“${task.question.slice(0,80)}”的现实选择条件，补充 ${added.join('、')}；仅扩展 Henosis 取证，不改变问题、时间范围或 Nous。`});
  }
 const rejected=decisions.filter(d=>d.action==='rejected').map(d=>d.reason);
 if(rejected.length)base.issues=unique([...base.issues,...rejected]);
 const anchors=unique(base.tasks.filter(t=>t.temporalIntent.referenceExplicit).map(t=>t.temporalIntent.referenceDate));
 const mixedPresent=anchors.some(d=>d<input.today)&&base.tasks.some(t=>!t.temporalIntent.referenceExplicit&&t.precision!=='natal'&&/现在|目前|当前|今年|本月|今天/.test(t.source.text));
 const asOf=anchors.length===1&&!mixedPresent?anchors[0]:input.today,perspective=anchors.length===1&&!mixedPresent&&asOf<input.today?'historical_as_of' as const:'present_retrospective' as const;
 let clarification:string|undefined;
 if(anchors.length>1||mixedPresent){clarification='这些问题使用了不同的历史分析基准，需要分别确认当时视角；其他独立任务可先回答。';base.issues.push('HENOSIS_MULTIPLE_AS_OF');
  for(const task of base.tasks.filter(t=>t.temporalIntent.referenceExplicit)){task.needsChart=false;task.queries=[];task.timingRequest=undefined;task.coverage={status:'unavailable',precision:task.precision,periods:0,reason:clarification};}
 }
 for(const task of base.tasks.filter(t=>t.reasonCodes.includes('domain_unresolved'))){task.needsChart=false;task.queries=[];task.timingRequest=undefined;task.coverage={status:'unavailable',precision:task.precision,periods:0,reason:'主题尚未确定，未用通用宫位替代所问问题。'};}
  const result=await identify({...base,policyVersion:base.policyVersion+'/'+HENOSIS_VERSION,henosis:{version:HENOSIS_VERSION,revision:0,settings,decisions,additions:[],perspective,asOf,...(dependencies?.length?{dependencies}:{}),...(clarification?{clarification}:{})}});
  for(const issue of checkHenosisRequirements(result)){
   result.issues=unique([...result.issues,issue.code]);
   result.henosis.decisions.push({phase:'initial_plan',taskId:issue.taskId,action:'requirement_gap',reason:`原问题时间要求“${issue.requirement.quote}”尚未正确绑定，不能声明已完整调查。`});
   const task=result.tasks.find(t=>t.id===issue.taskId);
   if(task){task.needsChart=false;task.queries=[];task.timingRequest=undefined;task.coverage={status:'unavailable',precision:task.precision,periods:0,reason:'时间要求尚未正确绑定；不使用错误区间替代。'};}
  }
  result.henosis.questionContract=henosisQuestionContract(result);
  return identify(result);
}

const days=(a:string,b:string)=>(Date.parse(b)-Date.parse(a))/86400000+1;
const queryKey=(taskId:string,q:DatedQuery,palace:string)=>[taskId,q.scope,q.date,palace].join('|');
function referenceBelongs(ref:HenosisEvidenceBundle['references'][number],taskId:string,bundle:HenosisEvidenceBundle){
 return ref.taskId===taskId||Array.isArray(ref.taskIds)&&ref.taskIds.includes(taskId)||bundle.observations.some(o=>o.taskId===taskId&&o.evidenceIds.includes(ref.id));
}

/** One evidence-driven revision. A rejected request is recorded without changing
 * the canonical task. Existing periods and their original constraints are retained. */
export async function reviseHenosisPlan(input:HenosisPlanningInput&{plan:HenosisPlan;bundle:HenosisEvidenceBundle}):Promise<HenosisPlan>{
 const {plan,bundle}=input;
 if(!input.callModel||plan.henosis.revision>=1||!plan.henosis.settings.maxSupplementRounds||!plan.tasks.some(t=>t.needsChart&&t.precision!=='natal'))return plan;
 if(bundle.plan.id!==plan.id||bundle.chartVersion!==plan.chartVersion||plan.question!==input.question||plan.profileId!==input.profileId||plan.profileRevision!==input.profileRevision)throw Error('HENOSIS_PLAN_BINDING_MISMATCH');
 input.signal?.throwIfAborted();
 const data={question:input.question,plan:analysisPlanContext(plan),perspective:plan.henosis.perspective,asOf:plan.henosis.asOf,...henosisRefinementBrief(bundle),allowedPalaces:PALACE_NAMES};
 const next:HenosisPlan=structuredClone(plan),decisions=next.henosis.decisions;
 next.henosis.revision=1;next.status='planned';
 let response:z.SafeParseReturnType<unknown,z.infer<typeof refineSchema>>;
 const constraints='\n协议限制：最多6项请求，每项queries最多4组，每组宫位最多4个，总共12组新增查询；每项evidenceIds必须为1至8个本任务已有真实ID。';
 let raw:unknown=await input.callModel(refineInstructions+constraints,data,'refine_plan');
 // Split overlong query groups losslessly, then validate requests individually. Never invent evidence IDs.
 const normalize=(value:any)=>{
  if(!value||!Array.isArray(value.requests)||Object.keys(value).some(k=>k!=='requests'))return value;
  const requests=value.requests.flatMap((r:any)=>Array.isArray(r?.queries)&&r.queries.length>4&&r.queries.length<=12?Array.from({length:Math.ceil(r.queries.length/4)},(_,i)=>({...r,queries:r.queries.slice(i*4,i*4+4)})):[r]);
  return requests.length<=6?{requests}:value;
 };
 raw=normalize(raw);response=refineSchema.safeParse(raw);
 if(!response.success){
  const problems=response.error.issues.slice(0,8).map(i=>i.path.join('.')+': '+i.code);
  const repair=await input.callModel(refineInstructions+constraints+'\n仅定向修复 repair.previousProposal 的格式错误；证据引用必须从本任务已有references中选择，不足以支持补查的请求应删除。', {...data,repair:{issues:problems,previousProposal:JSON.stringify(raw).length<=16000?raw:undefined}},'refine_plan_repair');
  raw=normalize(repair);response=refineSchema.safeParse(raw);
  if(response.success)decisions.push({phase:'refine_plan',action:'format_repaired',reason:'补查协议经一次定向修复通过；仍逐项核对真实引用与时间边界。'});
 }
 input.signal?.throwIfAborted();
 if(!response.success){
  decisions.push({phase:'refine_plan',action:'rejected',reason:'HENOSIS_REFINE_SCHEMA: '+response.error.issues.slice(0,6).map(i=>i.path.join('.')+' '+i.code).join('; ')});
  // Keep independently valid requests; invalid entries cannot discard useful siblings.
  const valid=raw&&typeof raw==='object'&&Array.isArray((raw as any).requests)?(raw as any).requests.slice(0,6).filter((r:any)=>refineSchema.shape.requests.element.safeParse(r).success):[];
  if(!valid.length)return identify(next,plan.id);
  response=refineSchema.safeParse({requests:valid});
  if(!response.success)return identify(next,plan.id);
 }
 const existing=new Set(bundle.executedQueries.flatMap(x=>x.query.palaces.map(p=>queryKey(x.taskId,x.query,p))));
 const born=solarISO(input.chart.solarDate);
 for(const request of response.data.requests){
  const reject=(reason:string)=>decisions.push({phase:'refine_plan',taskId:request.taskId,action:'rejected',reason,evidenceIds:request.evidenceIds});
  const task=next.tasks.find(t=>t.id===request.taskId);
  if(!task||!task.needsChart||task.precision==='none'||task.reasonCodes.includes('subject_identity_required')){reject('HENOSIS_TASK_UNAVAILABLE');continue;}
  if(request.evidenceIds.some(id=>!bundle.references.some(r=>r.id===id&&referenceBelongs(r,task.id,bundle)))){reject('HENOSIS_EVIDENCE_REFERENCE');continue;}
  const original=task.timingRequest;
  if(request.range){
   const r=request.range;
   if(!original?.plan||original.plan.rangeSource!=='default'||hardBounds(task.temporalIntent)){reject('HENOSIS_EXPLICIT_RANGE_LOCKED');continue;}
   const maxDays=task.precision==='yearly'?3660:task.precision==='monthly'?732:31;
   if(r.start>original.start||r.end<original.end||r.start>r.end||r.start<born||days(r.start,r.end)>maxDays||task.timeDirection==='past'&&r.end>original.end||task.timeDirection==='future'&&r.start<original.start){reject('HENOSIS_OPEN_RANGE_BOUNDARY');continue;}
   if(r.start===original.start&&r.end===original.end&&!request.queries?.length){reject('HENOSIS_DUPLICATE_REQUEST');continue;}
  }
  const accepted:DatedQuery[]=[],range=request.range||original,pending=new Set(existing);
  let invalid:string|undefined;
  for(const q of request.queries||[]){
   if(scopes.indexOf(q.scope)>scopes.indexOf(task.precision as typeof scopes[number])){invalid='HENOSIS_PRECISION_ESCALATION';break;}
   if(q.date<born&&q.scope!=='natal'){invalid='HENOSIS_BIRTH_BOUNDARY';break;}
   if(q.scope!=='natal'&&original?.plan?.constraints.excludedYears.includes(Number(q.date.slice(0,4)))){invalid='HENOSIS_EXCLUDED_YEAR';break;}
   if(q.palaces.some(p=>new RegExp('(?:不看|不分析|不用看|不要分析)(?:本命|大限|流年|流月|流日)?'+p).test(task.question))){invalid='HENOSIS_EXCLUDED_PALACE';break;}
   const inTarget=range&&q.date>=range.start&&q.date<=range.end;
   const inHistory=bundle.observations.some(o=>o.taskId===task.id&&o.role==='retrospective'&&q.date>=(o.start||o.date)&&q.date<=(o.end||o.date));
   const existingDate=task.queries.some(x=>x.scope===q.scope&&x.date===q.date);
   if(q.scope!=='natal'&&!inTarget&&!inHistory&&!existingDate){invalid='HENOSIS_QUERY_OUTSIDE_RANGE';break;}
   if(q.scope!=='natal'&&task.timeDirection==='past'&&q.date>(original?.end||task.temporalIntent.referenceDate)){invalid='HENOSIS_HISTORICAL_CUTOFF';break;}
   const date=q.scope==='natal'?born:q.date;
   const palaces=unique(q.palaces).filter(p=>!pending.has(queryKey(task.id,{...q,date},p))&&!bundle.observations.some(o=>o.taskId===task.id&&o.scope===q.scope&&o.palace===p&&(q.scope==='natal'||date>=(o.start||o.date)&&date<=(o.end||o.date))));
   if(palaces.length){accepted.push({...q,date,palaces});palaces.forEach(p=>pending.add(queryKey(task.id,{...q,date},p)));}
  }
  if(invalid){reject(invalid);continue;}
  if(next.henosis.additions.length+accepted.length>12){reject('HENOSIS_QUERY_BUDGET');continue;}
  if(!accepted.length&&(!request.range||request.range.start===original?.start&&request.range.end===original?.end)){reject('HENOSIS_DUPLICATE_REQUEST');continue;}
  if(request.range&&original?.plan){
   task.timingRequest={...original,...request.range,requested:{...request.range,detail:original.detail},plan:{...original.plan,...request.range},assumptions:[...original.assumptions,`Henosis 根据 ${request.evidenceIds.join('、')} 补充调查范围：${request.reason}；该范围不是用户等待意愿。`]};
   task.timing=undefined;task.coverage=undefined;
   decisions.push({phase:'refine_plan',taskId:task.id,action:'range_extended',reason:`${original.start}—${original.end} → ${request.range.start}—${request.range.end}；${request.reason}`,evidenceIds:request.evidenceIds});
  }
  for(const query of accepted){
   next.henosis.additions.push({taskId:task.id,query,reason:request.reason,evidenceIds:request.evidenceIds});
   query.palaces.forEach(p=>existing.add(queryKey(task.id,query,p)));
   decisions.push({phase:'refine_plan',taskId:task.id,action:'query_added',reason:request.reason,evidenceIds:request.evidenceIds});
  }
 }
 if(!response.data.requests.length)decisions.push({phase:'refine_plan',action:'no_supplement',reason:'根据当前证据未提出必要的新调查，结束二次规划。'});
 return identify(next,plan.id);
}
