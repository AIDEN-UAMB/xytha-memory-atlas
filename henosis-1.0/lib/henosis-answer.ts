import {henosisBriefAnswer,henosisDecisionTargets} from './henosis-intent';
import {z} from 'zod';
import {analysisInstructions} from './analysis-plan';
import type {HenosisEvidenceBundle,HenosisPlan} from './henosis-contracts';
import {henosisAnswerPacket} from './henosis-context';
import {parseModelJSON} from './providers/output';

export type HenosisPacket=ReturnType<typeof henosisAnswerPacket>;
const sectionKinds=['natal','current','trajectory','synthesis'] as const;
export const HENOSIS_SECTION_LABELS={natal:'本命基础与主题宫位',current:'当前大限与流年',trajectory:'前史变化与层次对照',synthesis:'综合判断与行动条件'};
// Reference IDs are compact pointers, not repeated evidence text. An otherwise
// valid long-range answer must not disappear at an arbitrary 24-ID boundary.
const citations=z.array(z.string().max(240)).max(2048).default([]);
const reportSchema=z.object({taskId:z.string().max(80),conclusion:z.string().trim().min(1).max(6000),
 sections:z.array(z.object({kind:z.enum(sectionKinds),text:z.string().trim().min(1).max(48000),citations})).max(64).default([]),
 comparison:z.array(z.object({candidateIds:z.array(z.string().regex(/^c\d+$/)).min(1).max(240),text:z.string().trim().min(1).max(12000),citations})).max(240).default([])});
export const henosisAnswerSchema=z.object({tasks:z.array(reportSchema).min(1).max(6)});
export type HenosisReport=z.infer<typeof reportSchema>;
export type HenosisDraft=z.infer<typeof henosisAnswerSchema>;

/** Lossless envelope/section normalization. No factual fields or IDs are guessed. */
export function normalizeHenosisDraft(raw:unknown):unknown{
 if(!raw||typeof raw!=='object')return raw;
 const obj=raw as any,items=Array.isArray(obj.tasks)?obj.tasks:typeof obj.taskId==='string'?[obj]:undefined;
 if(!items)return raw;
 return {tasks:items.map((task:any)=>{
  if(!task||typeof task!=='object')return task;
  const sections:any[]=[],byKind=new Map<string,any>();
  const clean=(refs:unknown)=>Array.isArray(refs)?[...new Set(refs.filter(id=>id!==null&&id!==undefined&&id!==''))]:refs;
  for(const section of Array.isArray(task.sections)?task.sections:[]){
   if(!section||typeof section.text!=='string'||!sectionKinds.includes(section.kind)){sections.push(section);continue;}
   const prior=byKind.get(section.kind);
   if(prior&&Array.isArray(prior.citations)&&Array.isArray(section.citations)){
    if(!prior.text.split('\n\n').includes(section.text))prior.text+='\n\n'+section.text;
    prior.citations=[...new Set([...prior.citations,...section.citations])];
   }else{const value={...section,...(Array.isArray(section.citations)?{citations:clean(section.citations)}:{})};sections.push(value);byKind.set(section.kind,value);}
  }
  for(const section of sections)if(Array.isArray(section?.citations))section.citations=clean(section.citations);
  return {...task,...(Array.isArray(task.sections)?{sections}:{}),...(Array.isArray(task.comparison)?{comparison:task.comparison.map((c:any)=>({...c,...(Array.isArray(c?.citations)?{citations:clean(c.citations)}:{})}))}:{})};
 })};
}

/** Style heuristics stay observable, but do not consume repair calls or veto an answer. */
export const henosisAdvisoryIssue=(code:string)=>['DEPTH_INSUFFICIENT','DEPTH_EXCESSIVE','CONCLUSION_SHALLOW','SECTION_SHALLOW','CANDIDATE_SHALLOW','LAYER_SCOPE'].includes(code);

/** Remove only unsupported fine-time sentences, never invent a replacement
 * date, rank or rationale. Empty slots remain incomplete and require repair. */
export function boundHenosisPrecision(draft:HenosisDraft,issues:HenosisDeliveryIssue[]){
 const result=structuredClone(draft);
 const bounded=(text:string)=>text.split(/(?<=[。！？；\n])/).filter(s=>!/(?:上半年|下半年|第?[一二三四1-4]季度)/.test(s)).join('').trim();
 for(const issue of issues.filter(i=>i.code==='PRECISION_OVERREACH')){
  const report=result.tasks.find(t=>t.taskId===issue.taskId);if(!report)continue;
  if(issue.detail.startsWith('conclusion ')){const text=bounded(report.conclusion);if(text)report.conclusion=text;}
  for(const section of report.sections)if(issue.detail.startsWith(section.kind+' ')){const text=bounded(section.text);if(text)section.text=text;}
  for(const comparison of report.comparison)if(comparison.candidateIds.some(id=>issue.detail.startsWith('comparison:'+id+' '))){const text=bounded(comparison.text);if(text)comparison.text=text;}
 }
 return result;
}

/** Repair only literal quotes/control characters inside completed prose fields.
 * Never synthesize a field, close a truncated response, or change chart content. */
export function repairHenosisEnvelope(raw:string):unknown|undefined{
 const field=/"(?:conclusion|text)"\s*:\s*"/g;let result='',cursor=0,match:RegExpExecArray|null,changed=false;
 while((match=field.exec(raw))){
  const start=field.lastIndex;result+=raw.slice(cursor,start);let end=-1;
  for(let i=start;i<raw.length;i++){
   const ch=raw[i];
   if(ch==='\\'){result+=ch;if(i+1<raw.length)result+=raw[++i];continue;}
   if(ch==='"'){
    const tail=raw.slice(i+1);
    if(/^\s*(?:}|,\s*"(?:citations|sections|comparison|taskId|candidateIds|kind|conclusion|text)"\s*:)/.test(tail)){result+=ch;end=i+1;break;}
    result+='\\"';changed=true;
   }else if(ch.charCodeAt(0)<32){result+=JSON.stringify(ch).slice(1,-1);changed=true;}else result+=ch;
  }
  if(end<0)return undefined;
  cursor=end;field.lastIndex=end;
 }
 if(!changed)return undefined;result+=raw.slice(cursor);
 try{return parseModelJSON(result);}catch{return undefined;}
}

export function henosisAnswerContract(plan:HenosisPlan,packet:HenosisPacket){
 const brief=henosisBriefAnswer(plan.question);
 return {version:1,depth:brief?'brief':'layered',instructions:analysisInstructions,
  tasks:plan.tasks.map(t=>{
   const periods=packet.periods.filter(p=>p.taskId===t.id),applicable=t.needsChart&&!['unavailable','not_applicable'].includes(t.coverage?.status||'');
   const requiredSections:typeof sectionKinds[number][]=brief||!applicable?[]:['natal',...(t.precision!=='natal'&&periods.some(p=>p.role==='current')?['current' as const]:[]),...(t.precision!=='natal'&&periods.some(p=>p.role==='retrospective')?['trajectory' as const]:[]),'synthesis'];
    const comparisonOwner=t.kind==='decision'?plan.tasks.find(other=>other.id!==t.id&&other.kind==='future_timing'&&other.timingRequest&&t.timingRequest&&other.timingRequest.start===t.timingRequest.start&&other.timingRequest.end===t.timingRequest.end&&other.domains.some(d=>t.domains.includes(d))):undefined;
    const candidates=packet.candidates.filter(c=>c.taskId===t.id),compare=applicable&&candidates.length>1&&!comparisonOwner;
   const minimumCharacters=brief||!applicable?0:t.precision==='natal'?500:compare?900:700;
    const maximumCharacters=brief?900:!applicable?1800:t.precision==='natal'?1800:compare?Math.min(5200,2600+candidates.length*180):2600;
    return {taskId:t.id,question:t.question,decisionTargets:henosisDecisionTargets(t.question),kind:t.kind,precision:t.precision,palaces:t.palaces,requiredPalaces:t.palaces,coverage:t.coverage,minimumCharacters,maximumCharacters,...(comparisonOwner?{comparisonOwner:comparisonOwner.id,comparisonNote:'逐年细节由此独立任务交付；本任务保留综合决策及条件，不重复同一候选列表。'}:{}),
    requiredSections,decadeTransitions:(packet.decadeTransitions||[]).filter(p=>p.taskId===t.id),comparisonTargets:compare?candidates.map(({citations,...c})=>({...c,citations})):[],
    suggestedCharacters:brief?'120–300字，逐项回应':!applicable?'按问题充分解释':t.precision==='natal'?'500–900字':compare?'900–1800字；每个年份/月份有具体差异，跨大限先解释背景':'700–1300字，解释本命、大限、流年及其相互作用',
    dependencies:plan.henosis.dependencies?.filter(d=>d.taskId===t.id)||[],
    interpretationGoal:t.kind==='decision'?'比较选择所需条件、支持与冲突；哪些现实条件会改变建议':t.kind==='historical_compare'?'在目标历史范围内横向比较，区分推测与用户确认的经历':t.kind==='future_timing'?'解释更匹配的时段及条件，说明其他候选为何不同，不强求唯一最优':t.kind==='attribute'?'将固定宫位结构联系到具体问题，不展开无关运限':'对齐用户当前疑问，不用通用星曜列表代替解说'};
  }),
  comparisonPolicy:'逐个比较目标；可合并真正相近的区段，但合并后须点出各年份/月份和跨限差异。相同天数不等于相同命理信号。大限定背景，流年修饰；禁止无依据的固定权重。现实用户陈述优先于推测。',
  precisionPolicy:'推荐的颗粒度不得细于实际调查精度。流年区段起止是覆盖边界，不代表年内优劣变化；仅有流年资料不能再挑出上半年、下半年或某个月更好。只有真实流月/流日证据支持时才能细化。',
  outputPolicy:'一次回答完成全部任务。结论先行，随后有针对性地解释关键宫位的星曜组合、亮度、四化、三方四正和层间支持/冲突。minimumCharacters 是该任务全部正文的最低有效信息量；不得以重复、套话或无关资料凑字数。每个比较候选单独成项，便于逐年或逐月核对。'};
}

export const HENOSIS_DELIVERY_INSTRUCTIONS=`以 Nous 已有的分层解说要求为基础，生成可追溯的深入回答。answerContract 是本轮交付要求，不是额外审查。不要把复杂问题缩成几句泛泛建议；也不要把全部星曜机械罗列。
questionContract.requirements 保存用户原始要求，共享交付时仍逐项回应。围绕同一决策只完整说明一次本命和前史，候选逐项比较支持、反向证据、所属大限、成立条件和改变判断的现实信息。没有足够差异允许并列。globalCoverage 是全局事实覆盖，局部资料未附带不等于整轮未查询；只有查过并完成比较的候选才能进入优先级。
输出 JSON {"tasks":[{"taskId":"task-1","conclusion":"直接回应这一子问题的结论与适用条件","sections":[{"kind":"natal|current|trajectory|synthesis","text":"自然中文分析，可分段","citations":["e1"]}],"comparison":[{"candidateIds":["c1"],"text":"该实际候选的支持、矛盾、父大限背景及与其他候选的差异","citations":["e2"]}]}]}。
每个 taskId 恰好一次，包括资料不足或不需要命盘的任务。满足各任务 requiredSections，comparison 覆盖 comparisonTargets 的全部候选。没有候选比较时 comparison=[]；不需要的章节不要硬加。用户要求简短时精简文字，仍不漏子问题和明确的比较目标。
非简短任务不得低于 minimumCharacters，并且每个 requiredPalaces 都要在正文中明确解释且附上该宫位实际依据。结论不是摘要标签：要直接回答问题、给出主次判断与成立条件。每个必需章节都要说明该层相对于上一层带来的变化，不用通用星曜释义凑段落。
citations 仅使用本次 investigation.facts 中的 eN 短引用，每个 citations 数组去重后最多24项；程序将其还原为原始依据。不得伪造引用、跨任务借用或用回顾资料支持候选推荐。本命章节用本命引用，当前章节包含当前运限引用，前史章节包含回顾引用，比较引用属于该候选的实际区段。引用只放 citations 字段，不在正文写 eN/cN、调度JSON或内部过程。
必须先展开 natalRegistry，再结合该时层的 transformations、flowingStars 和关系宫位解释，不能只照抄 hypotheses。本命固定星曜与流动宫位名称不可混同。主要宫位是核心，三方四正是关系背景。大限变化需对照本命，流年变化需对照所属大限；同时解释支持与相反信号。不能由单颗星认定用户实际想法、现实事件或确定未来。
palaceRelations 是程序给出的同一时层宫位几何关系，trine 为另外两个三合宫、opposite 为对宫；不可把叠到的本命宫位当成这一时层的三合宫。decadeTransitions 是引擎在目标范围内实际找到的跨大限边界，非空时必须解释新旧大限背景，不能仅凭当前年龄声称整个范围不跨限。边界日期是换限信息，不是择日推荐。
decisionTargets 为同一调查内需要分别回答的决策目标，例如试住与购房可有不同优先年。共享分层和逐年比较，只在结论与综合中形成一套条件一致的建议，不另起重复排名。历史段要求简要不影响未来候选的充分比较。
每次写星曜化禄/权/科/忌，核对具体星名、所属层级和物理宫位。文曲化忌不得省写成同宫巨门化忌；太阳化权不得写成天马化权；不同宫位的两个化科只能解释为关联支持，不能写成同宫叠加。结论与综合段同样必须遵循这些事实。年内精细时机须有对应流月证据，不能由单一流年资料发明“下半年最佳”。
同一轮条件依赖用条件分支回应，例如A成立时B如何、A不成立时B如何；未确认的A不能写成已发生。历史和未来任务各自遵守时间边界。文字是真正面向用户的解说，不输出思维链。`;

export type HenosisDeliveryIssue={taskId:string;code:string;detail:string};
function claimYear(text:string,index:number,defaultYear?:string){
 // A candidate paragraph has an explicit investigation year. Comparisons with
 // another year inside it must not silently change that subject.
 if(defaultYear)return defaultYear;
 const prefix=text.slice(0,index).split(/[。！？\n]/).at(-1)||'';
 const years=[...prefix.matchAll(/((?:19|20)\d{2})年?/g)];
 // A multi-year joint assertion needs structured citations rather than guessing.
 if(/(?:19|20)\d{2}年?\s*[、至—–~-]\s*(?:19|20)\d{2}/.test(prefix))return undefined;
 if(new Set(years.map(m=>m[1])).size>1||/(?:相比|相较|相对于|不同于|对比|相近|类似|配置与|延续|同源)/.test(prefix))return undefined;
 const inherited=[...text.slice(0,index).split(/\n\s*\n/).at(-1)!.matchAll(/((?:19|20)\d{2})(?=年|[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]|[：:])/g)].at(-1)?.[1];
 if(defaultYear&&/(?:上段|下段|前段|后段|换年后|换年前)/.test(prefix))return defaultYear;
 return years.at(-1)?.[1]||inherited||defaultYear;
}
function factsAtYear(packet:HenosisPacket,ids:string[],year?:string,claimScope?:string,qualifier=''){
 // A candidate's overall conclusion returns to its principal interval. A tail
 // discussed immediately beforehand is not the implicit frame of that summary.
 qualifier=qualifier.split(/(?:综合[：:]|综合看[：:，]?|综上[：:，]?|整体来看[：:，]?)/).at(-1)||'';
 // The default annual reading describes the principal flow year, not its
 // preceding carry-over tail. Explicit boundary prose may select that tail.
 const relevant=packet.periods.filter(p=>p.scope==='yearly'&&p.start?.startsWith(year||'NO_YEAR')&&p.citations.some((id:string)=>ids.includes(id)));
 const intervalKeys=new Map<string,typeof relevant[number]>();for(const p of relevant)intervalKeys.set(p.start+'|'+p.end,p);
 const intervals=[...intervalKeys.values()].sort((a,b)=>a.start.localeCompare(b.start));
 const scopedQualifier=qualifier.replace(/[（(][^）)]*[\/、][^）)]*[）)]/g,'');
 const frames=[...scopedQualifier.matchAll(/([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])(?:流年|尾段|段|年|：|:)/g)];
 const lastStem=frames.at(-1)?.[1];
 const mentioned=packet.sources.filter(s=>s.scope==='yearly'&&s.stemBranch===lastStem);
 const named=lastStem?mentioned.filter(s=>s.stemBranch===lastStem):[];
 const tail=/年初|换年前|换年之前|上一流年|上个流年|旧流年|旧年尾段|尾段|同源/.test(qualifier);
 const explicitDate=qualifier.match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0];
 const principal=intervals.slice().sort((a,b)=>(Date.parse(b.end)-Date.parse(b.start))-(Date.parse(a.end)-Date.parse(a.start)))[0];
 const interval=explicitDate?intervals.find(p=>p.start<=explicitDate&&p.end>=explicitDate):tail?intervals[0]:principal;
 return packet.facts.filter(f=>{
  if(year&&f.scope==='yearly'&&claimScope!=='decadal'){
   if(named.length){const state=packet.states.find(s=>s.id===f.state);if(!state?.sourceIds.some(id=>named.some(s=>s.id===id)))return false;}
   else if(interval&&!interval.citations.includes(f.id)&&!packet.periods.some(p=>p.scope==='yearly'&&p.start===interval.start&&p.end===interval.end&&p.citations.includes(f.id)))return false;
  }
  return true;
 }).filter(f=>ids.includes(f.id)&&(!year||f.scope==='natal'||f.date?.startsWith(year)||packet.periods.some(p=>p.scope===f.scope&&p.citations.includes(f.id)&&(p.start?.startsWith(year)||f.scope==='decadal'&&p.start?.slice(0,4)<=year&&p.end?.slice(0,4)>=year))||
  // A current decade observation may describe its start year. Its observation
  // date is not the decade's validity interval; use the engine source bounds.
  (f.scope==='decadal'||claimScope==='decadal')&&(packet.states.find(s=>s.id===f.state)?.sourceIds||[]).some(id=>{const source=packet.sources.find(s=>s.id===id);return source?.scope==='decadal'&&Array.isArray(source.yearRange)&&source.yearRange[0]<=Number(year)&&source.yearRange[1]>=Number(year);}))); 
}
// A narrow fact check, not an interpretation reviewer: explicit star/mutagen pairs
// must exist in the task/layer snapshot. It does not claim to validate all prose.
export function checkHenosisStarClaims(text:string,factIds:string[],packet:HenosisPacket,defaultYear?:string){
 const selected=packet.facts.filter(f=>factIds.includes(f.id)),pairs=new Set<string>();
 // The fixed natal registry is shared factual context for this same chart.
 for(const n of packet.natalRegistry)for(const [star,value] of n.birthTransformations)pairs.add(star+'化'+value);
 for(const fact of selected){const natal=packet.natalRegistry.find(n=>n.id===fact.natalRef);for(const [star,value] of natal?.birthTransformations||[])pairs.add(star+'化'+value);for(const [_scope,star,value] of (packet.states.find(s=>s.id===fact.state)?.transformations||[]) as string[][])pairs.add(star+'化'+value);}
 const stars=[...new Set(packet.natalRegistry.flatMap(n=>n.stars.map(s=>String(s[0]))))].sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 if(!stars.length)return [];
  const pattern=new RegExp('('+stars.join('|')+')(?:[（(]?[庙旺得利平陷不]{1,2}[）)]?)?化?([禄权科忌])','g'),unsupported=new Set<string>();
 for(const match of text.matchAll(pattern)){
  if(/(?:并非|不是|没有|而非|非|不能写成|不代表|不等于)[“"「]?$/.test(text.slice(Math.max(0,match.index!-8),match.index)))continue;
   const before=text.slice(Math.max(0,match.index!-24),match.index),scopeMatch=before.match(/(本命|大限|流年|流月|流日)[^。！？；，、本命大限流年流月流日]{0,12}$/);
   let scope=scopeMatch?({本命:'natal',大限:'decadal',流年:'yearly',流月:'monthly',流日:'daily'} as Record<string,string>)[scopeMatch[1]]:undefined;
   // In "大限命宫落本命夫妻太阴科", 本命 labels a physical palace,
   // not the mutation's temporal source. Resolve only an explicit outer layer.
   if(scope==='natal'){
    const outer=before.match(/(大限|流年|流月|流日)[^。！？；]*?(?:落|叠|对应|把)[^。！？；]*本命/);
    if(outer)scope=({大限:'decadal',流年:'yearly',流月:'monthly',流日:'daily'} as Record<string,string>)[outer[1]];
   }
   const year=claimYear(text,match.index!,defaultYear);
   const paragraph=text.slice(0,match.index!).split(/\n\s*\n/).at(-1)||'';
   if(!scope&&/^(?:先看)?本命(?:底盘|基础|层面|命盘|结构)/.test(paragraph)&&!/(?:大限|流年|流月|流日)/.test(paragraph))scope='natal';
   let supported=pairs.has(match[1]+'化'+match[2]);
   if(scope==='natal')supported=packet.natalRegistry.some(n=>n.birthTransformations.some(([star,value])=>star===match[1]&&value===match[2]));
   else if(scope||year){
    const facts=factsAtYear(packet,factIds,year,scope,text.slice(0,match.index!).split(/\n\s*\n/).at(-1)||'');
    const palace=before.match(/(?:本命|大限|流年|流月|流日)(命宫|兄弟|夫妻|子女|财帛|疾厄|迁移|交友|官禄|田宅|福德|父母)(?:宫)?(?:由|为|见|坐守|坐|以)?$/)?.[1];
    const destination=text.slice(match.index!+match[0].length).match(/^(?:落|在|入)(?:在|于)?(本命|大限|流年)?(命宫|兄弟|夫妻|子女|财帛|疾厄|迁移|交友|官禄|田宅|福德|父母)(?:宫)?/);
    const bound=scope&&palace?facts.filter(f=>f.scope===scope&&f.palace===palace):scope&&destination?
     facts.filter(f=>f.scope===scope&&(destination[1]==='本命'?packet.natalRegistry.find(n=>n.id===f.natalRef)?.palace===destination[2]:f.palace===destination[2])):facts;
    supported=bound.some(f=>{
     const birth=packet.natalRegistry.find(n=>n.id===f.natalRef)?.birthTransformations||[];
     const trans=(packet.states.find(s=>s.id===f.state)?.transformations||[]) as string[][];
     return (!scope||scope==='natal')&&birth.some(([star,value])=>star===match[1]&&value===match[2])||trans.some(([layer,star,value])=>(!scope||layer===scope)&&star===match[1]&&value===match[2]);
    });
   }
   if(!supported)unsupported.add((year?year+'年':'')+(scopeMatch?.[1]||'')+match[1]+'化'+match[2]);
 }
 // A blanket absence claim about a natal palace AND its triad is a factual
 // assertion, not a discretionary interpretation. Check the exact geometry.
 const absent=/(命宫|兄弟|夫妻|子女|财帛|疾厄|迁移|交友|官禄|田宅|福德|父母)(?:宫)?(?:本身|本宫)?(?:与|及|和)(?:其)?三合(?:诸宫|宫位)?(?:均|皆|并|都)?(?:无|没有|不见)(?:生年|本命)(?:四化|禄权科忌)/g;
 for(const m of text.matchAll(absent)){
  const palaces=[m[1],...(packet.palaceRelations.find(r=>r.palace===m[1])?.trine||[])];
  const actual=packet.natalRegistry.filter(n=>palaces.includes(n.palace)).flatMap(n=>n.birthTransformations.map(([star,value])=>`${n.palace}${star}化${value}`));
  if(actual.length)unsupported.add(`本命${m[1]}三合无四化的断言与实际${actual.join('、')}矛盾`);
 }
 return [...unsupported];
}
/** Narrow, deterministic check of explicit palace/main-star assertions. This is
 * not an interpretation judge. Ambiguous cross-year/negated sentences are skipped. */
export function checkHenosisPalaceClaims(text:string,factIds:string[],packet:HenosisPacket,defaultYear?:string){
 const primary='紫微|天机|太阳|武曲|天同|廉贞|天府|太阴|贪狼|巨门|天相|天梁|七杀|破军';
  const pattern=new RegExp('(本命|大限|流年|流月|流日)?(命|兄弟|夫妻|子女|财帛|疾厄|迁移|交友|官禄|田宅|福德|父母)(?:宫)?(?:[（(][^）)]{0,16}[）)])?[，、：:\\s]*(?:(?:主星|坐守|借入|叠到|落到|到|借|坐|见|为|是|以|由)(?:为|是)?[：:\\s]*)?(?:本命)?('+primary+')','g');
 const scopes:Record<string,string>={本命:'natal',大限:'decadal',流年:'yearly',流月:'monthly',流日:'daily'},issues:string[]=[];
 for(const m of text.matchAll(pattern)){
  const before=text.slice(Math.max(0,m.index!-12),m.index);
  if(/并非|不是|不代表|没有|而非|不能|如果|假设/.test(before))continue;
  if(/化[禄权科忌](?:落|在|入)(?:到)?$/.test(before))continue;
  // "天机化权落流年田宅、天同化禄落…" is a list of two
  // placements, not an assertion that 田宅 contains 天同.
  if(m[0].includes('、'))continue;
  if(!m[1]&&/^所在之宫/.test(text.slice(m.index!+m[0].length)))continue;
   const year=claimYear(text,m.index!,defaultYear),scope=scopes[m[1]]||(/(?:叠|落)(?:到|于)?$/.test(before)?'natal':(year&&m[0].includes('宫'))?'yearly':undefined);
   if(!scope)continue;
   const palace=m[2]==='命'?'命宫':m[2],facts=factsAtYear(packet,factIds,year,scope,text.slice(0,m.index!).split(/\n\s*\n/).at(-1)||'').filter(f=>f.scope===scope&&f.palace===palace);
  if(!facts.length)continue;
   if(!facts.some(f=>packet.natalRegistry.find(n=>n.id===f.natalRef)?.stars.some(s=>s[0]===m[3])))issues.push((year?year+'年':'')+(m[1]||'流年')+m[2]+'宫'+m[3]);
 }
 return [...new Set(issues)];
}
export function checkHenosisDraft(raw:unknown,plan:HenosisPlan,packet:HenosisPacket){
 const normalized=normalizeHenosisDraft(raw) as any,issues:HenosisDeliveryIssue[]=[];
 // Validate each task independently: a malformed sibling cannot erase a valid answer.
 const items=Array.isArray(normalized?.tasks)?normalized.tasks:[];
 const validItems=items.flatMap((item:any)=>{const result=reportSchema.safeParse(item);if(result.success)return [result.data];issues.push({taskId:typeof item?.taskId==='string'?item.taskId:'all',code:'ANSWER_FORMAT',detail:result.error.issues.slice(0,10).map(i=>i.path.join('.')+': '+i.code).join('; ')});return [];});
 const parsed=henosisAnswerSchema.safeParse({tasks:validItems});
 if(!parsed.success)return {draft:null,issues:issues.length?issues:[{taskId:'all',code:'ANSWER_FORMAT',detail:'未取得可读取的任务报告'}]};
 const draft=parsed.data,contract=henosisAnswerContract(plan,packet),seen=new Set<string>();
 for(const report of draft.tasks){
  const task=contract.tasks.find(t=>t.taskId===report.taskId);
  const add=(code:string,detail:string)=>issues.push({taskId:report.taskId,code,detail});
  if(!task||seen.has(report.taskId)){add('TASK_ID','任务ID不存在或重复');continue;}seen.add(report.taskId);
  const periods=packet.periods.filter(p=>p.taskId===task.taskId),allowed=new Set(periods.flatMap(p=>p.citations));
  const valid=(ids:string[])=>ids.every(id=>allowed.has(id));
  const prose=[report.conclusion,...report.sections.map(s=>s.text),...report.comparison.map(c=>c.text)].join('\n'),characters=prose.replace(/\s/g,'').length;
  if(task.minimumCharacters&&characters<task.minimumCharacters)add('DEPTH_INSUFFICIENT',`有效正文 ${characters} 字，低于本任务 ${task.minimumCharacters} 字的分层解说基线`);
  if(task.maximumCharacters&&characters>task.maximumCharacters)add('DEPTH_EXCESSIVE',`Task prose has ${characters} non-space characters; maximum is ${task.maximumCharacters}. Preserve the conclusion, layer contrasts, candidate differences, and conditions while removing repetition.`);
  if(task.minimumCharacters&&report.conclusion.replace(/\s/g,'').length<70)add('CONCLUSION_SHALLOW','结论未充分回应主次判断、适用条件和问题颗粒度');
  if(task.coverage?.status==='complete'&&/(?:无法|未能|没有).{0,10}(?:计算|覆盖|取得|跨年比较)|(?:需要|需).{0,8}(?:补充|重新提供).{0,8}(?:盘面|数据)|(?:运限|盘面|年份).{0,16}(?:数据|资料).{0,12}(?:尚不|不在|未在).{0,12}(?:范围|覆盖)|后续年份.{0,12}(?:尚无|没有).{0,8}(?:数据|资料)/.test(prose))add('COVERAGE_CONTRADICTION','正文声称缺少已经完整取得的调查资料');
  const factCheck=(location:string,text:string,ids:string[],defaultYear?:string)=>{if(task.precision==='yearly'&&!periods.some(p=>p.scope==='monthly'||p.scope==='daily')&&/(?:上半年|下半年|第?[一二三四1-4]季度)/.test(text))add('PRECISION_OVERREACH',location+' 只有流年证据，不得细分上半年、下半年或季度；用真实调查区段说明范围。');
   for(const claim of checkHenosisStarClaims(text,ids,packet,defaultYear))add('STAR_MUTAGEN_MISMATCH',location+' 中的 '+claim+' 缺少对应层级与宫位的盘面支持；删除或按该位置实际引用改写，不能把其他时期或同宫另一颗星的四化移过来。');
   for(const claim of checkHenosisPalaceClaims(text,ids,packet,defaultYear))add('PALACE_STAR_MISMATCH',location+' 中的 '+claim+' 与该期宫位绑定不符；按该宫 natalRef 的固定主星改写，不能借用其他宫位的主星。');};
  factCheck('conclusion',report.conclusion,[...allowed]);
  for(const kind of task.requiredSections)if(!report.sections.some(s=>s.kind===kind))add('MISSING_SECTION',kind);
  for(const section of report.sections){
   if(!valid(section.citations))add('EVIDENCE_ID',section.kind+' 引用了不存在或其他任务的依据');
   const role=section.kind==='natal'?'natal':section.kind==='current'?'current':section.kind==='trajectory'?'retrospective':null;
   if(role&&task.requiredSections.includes(section.kind)&&!periods.some(p=>p.role===role&&p.citations.some((id:string)=>section.citations.includes(id))))add('LAYER_REFERENCE',section.kind+' 缺少该层实际依据');
   if(section.kind==='natal'&&section.citations.some(id=>packet.facts.find(f=>f.id===id)?.scope!=='natal'))add('NATAL_ONLY','本命章节不可混入运限引用');
   if(task.requiredSections.includes(section.kind)&&section.text.replace(/\s/g,'').length<90)add('SECTION_SHALLOW',section.kind+' 未形成可核对的分层解释');
   const scopes=task.precision==='decadal'?['decadal']:['decadal','yearly'];
   if(section.kind==='current')for(const scope of scopes)if(periods.some(p=>p.role==='current'&&p.scope===scope)&&!section.citations.some(id=>packet.facts.find(f=>f.id===id)?.scope===scope))add('LAYER_SCOPE','current 缺少 '+scope+' 层依据');
   if(section.kind==='trajectory')for(const scope of scopes)if(periods.some(p=>p.role==='retrospective'&&p.scope===scope)&&!section.citations.some(id=>packet.facts.find(f=>f.id===id)?.scope===scope))add('LAYER_SCOPE','trajectory 缺少 '+scope+' 层前史依据');
   // Cross-period prose may mention both prior and current years. Only the natal
   // section excludes transit mutations; the separate citation checks bind its layer.
   // Natal and current claims bind to their displayed citations. A trajectory
   // may summarize many candidate periods whose detailed comparisons carry the
   // period-specific citations, so validate its pairs against the task corpus;
   // each candidate comparison is checked separately below.
   const claimIds=section.kind==='natal'?periods.filter(p=>p.role==='natal').flatMap(p=>p.citations):section.kind==='current'?periods.filter(p=>p.role==='current').flatMap(p=>p.citations):[...allowed];
   factCheck(section.kind,section.text,claimIds);
  }
  const cited=new Set([...report.sections.flatMap(s=>s.citations),...report.comparison.flatMap(c=>c.citations)]);
  for(const palace of task.requiredPalaces){const bound=[...cited].some(id=>packet.facts.find(f=>f.id===id)?.palace===palace);if(!prose.includes(palace)||!bound)add('PALACE_COVERAGE',palace+' 未同时出现在解释正文和本任务实际引用中');}
  const covered=new Set<string>();
  for(const comparison of report.comparison){
   if(!valid(comparison.citations))add('EVIDENCE_ID','候选比较引用不属于当前任务');
   // Check assertions against the evidence actually supplied for this candidate,
   // not only its illustrative citation subset. Unknown IDs remain errors above.
   const candidateFacts=packet.candidates.filter(c=>c.taskId===report.taskId&&comparison.candidateIds.includes(c.id)).flatMap(c=>c.citations);
   const comparisonYear=comparison.candidateIds.length===1?packet.candidates.find(c=>c.id===comparison.candidateIds[0])?.label:undefined;
   factCheck('comparison:'+comparison.candidateIds.join(','),comparison.text,[...new Set([...comparison.citations,...candidateFacts])],comparisonYear&&/^\d{4}$/.test(comparisonYear)?comparisonYear:undefined);
   if(task.comparisonTargets.length&&comparison.candidateIds.length!==1)add('CANDIDATE_GROUPED','每个候选时间必须单独比较，不能把不同年份或月份合成一项');
   if(task.comparisonTargets.length&&comparison.text.replace(/\s/g,'').length<55)add('CANDIDATE_SHALLOW','候选比较缺少支持、冲突或与其他候选的具体差异');
   for(const id of comparison.candidateIds){
    const candidate=task.comparisonTargets.find(c=>c.id===id)||(!task.comparisonTargets.length?packet.candidates.find(c=>c.taskId===task.taskId&&c.id===id):undefined);
    if(!candidate||covered.has(id)){add('CANDIDATE_ID','候选不存在或重复：'+id);continue;}covered.add(id);
    if(!candidate.citations.some(e=>comparison.citations.includes(e)))add('CANDIDATE_REFERENCE','候选 '+id+' 缺少该期依据');
   }
  }
  for(const c of task.comparisonTargets)if(!covered.has(c.id))add('CANDIDATE_MISSING',c.id+' '+c.label);
 }
 for(const task of plan.tasks)if(!seen.has(task.id))issues.push({taskId:task.id,code:'TASK_MISSING',detail:'子问题尚未回答'});
 const blocking=new Set(issues.filter(i=>/^(?:TASK_MISSING|EVIDENCE_ID|STAR_MUTAGEN_MISMATCH|PALACE_STAR_MISMATCH|CANDIDATE_MISSING|CANDIDATE_REFERENCE|COVERAGE_CONTRADICTION)$/.test(i.code)).map(i=>i.taskId));
 for(let n=0;n<plan.tasks.length;n++)for(const d of plan.henosis.dependencies||[]){
  if(!plan.tasks.some(t=>t.id===d.dependsOnTaskId)||!blocking.has(d.dependsOnTaskId)||blocking.has(d.taskId))continue;
  blocking.add(d.taskId);issues.push({taskId:d.taskId,code:'DEPENDENCY_UNRESOLVED',detail:`前置分析 ${d.dependsOnTaskId} 的关键依据或比较未完成，依赖它的结论需重新核对`});
 }
 return {draft,issues};
}

/** Merge a one-shot task repair without allowing it to rewrite tasks that passed. */
export function mergeHenosisRepair(original:HenosisDraft,raw:unknown,taskIds:string[]){
 // Citation overflow is a transport/schema formatting defect, not a reason to
 // discard a complete repair. Deduplicate without discarding valid reference IDs;
 // semantic citation checks still run immediately after this merge.
 const normalized=normalizeHenosisDraft(raw) as any;
 const candidate={tasks:Array.isArray(normalized?.tasks)?normalized.tasks.filter((t:any)=>taskIds.includes(t?.taskId)):[]};
 const parsed=henosisAnswerSchema.safeParse(candidate);if(!parsed.success)return original;
 const allowed=new Set(taskIds),replacements=new Map(parsed.data.tasks.map(t=>[t.taskId,t]));
 if(replacements.size!==parsed.data.tasks.length||parsed.data.tasks.some(t=>!allowed.has(t.taskId))||taskIds.some(id=>!replacements.has(id)))return original;
 return {tasks:[...original.tasks.map(t=>replacements.get(t.taskId)||t),...parsed.data.tasks.filter(t=>!original.tasks.some(old=>old.taskId===t.taskId))]};
}

/** This is a delivery/reference check, not a second model judging permitted content. */
export function renderHenosisDraft(draft:HenosisDraft,plan:HenosisPlan,packet:HenosisPacket,issues:HenosisDeliveryIssue[]=[]){
 const sections:string[]=[],citations=new Set<string>(),safeDelivery:HenosisDraft={tasks:[]};
 for(const task of plan.tasks){const original=draft.tasks.find(r=>r.taskId===task.id);if(!original)continue;
  const r=structuredClone(original),conflicts=issues.filter(i=>i.taskId===task.id&&['STAR_MUTAGEN_MISMATCH','PALACE_STAR_MISMATCH','COVERAGE_CONTRADICTION','PRECISION_OVERREACH','EVIDENCE_ID','CANDIDATE_MISSING','CANDIDATE_REFERENCE','DEPENDENCY_UNRESOLVED','SYNTHESIS_PENDING'].includes(i.code));
  if(conflicts.length){
   // Preserve the raw draft in metadata for inspection, but do not display a
   // known contradictory claim as a conclusion merely because repair timed out.
   const fallback=(ids:string[])=>{
    const facts=packet.facts.filter(f=>ids.includes(f.id)&&task.palaces.includes(f.palace||'')).slice(0,8);
    return '这部分解释的宫位、时间或引用对应尚待核对，暂不采用原判断。已取得的盘面事实（节选）：'+facts.map(f=>{const n=packet.natalRegistry.find(n=>n.id===f.natalRef),scope={natal:'本命',decadal:'大限',yearly:'流年',monthly:'流月',daily:'流日'}[f.scope||''];return `${f.date} ${scope||''}·${f.palace}对应本命${n?.palace||'宫位待核对'}，固定星曜${n?.stars.map(s=>s.join('')).join('、')||'未列出'}`;}).join('；')+'。盘面事实不等于现实事件预测。';
   };
   const unlocated=conflicts.some(i=>i.code==='COVERAGE_CONTRADICTION'||i.code==='PRECISION_OVERREACH'&&!/^(conclusion|natal|current|trajectory|synthesis|comparison:)/.test(i.detail));
   const hasPrecision=conflicts.some(i=>i.code==='PRECISION_OVERREACH');
   const local=(text:string,ids:string[])=>text.split(/(?<=[。！？；\n])/).map(sentence=>checkHenosisStarClaims(sentence,ids,packet).length||checkHenosisPalaceClaims(sentence,ids,packet).length||hasPrecision&&/(?:上半年|下半年|第?[一二三四1-4]季度)/.test(sentence)?'此处盘面或时间对应尚待核对，该句判断暂不采用。':sentence).join('');
   const allIds=packet.facts.filter(f=>f.taskIds.includes(task.id)).map(f=>f.id);
   r.conclusion='本子问题的关键依据或候选比较尚待完整核对，暂不据此确定最终选择或年份优先级；已完成的分层分析保留如下。';
   for(const s of r.sections)if(unlocated||conflicts.some(i=>i.detail.startsWith(s.kind+' ')))s.text=unlocated?fallback(s.citations):local(s.text,s.kind==='current'||s.kind==='natal'?s.citations:allIds);
   for(const c of r.comparison)if(unlocated||conflicts.some(i=>c.candidateIds.some(id=>i.detail.startsWith('comparison:'+id+' '))))c.text=unlocated?fallback(c.citations):local(c.text,c.citations);
   // A recommendation cannot survive invalidation of its supporting analysis.
   r.sections=r.sections.filter(s=>s.kind!=='synthesis');
  }
  safeDelivery.tasks.push(r);
  const body=[...(plan.tasks.length>1?[task.question]:[]),r.conclusion];
  for(const s of r.sections.filter(s=>s.kind!=='synthesis')){body.push(HENOSIS_SECTION_LABELS[s.kind]+'\n'+s.text);s.citations.forEach(id=>citations.add(id));}
  if(r.comparison.length)body.push('候选时间逐项比较\n'+r.comparison.map(c=>{c.citations.forEach(id=>citations.add(id));const labels=c.candidateIds.map(id=>packet.candidates.find(p=>p.id===id)?.label||id);return labels.join('、')+'\n'+c.text;}).join('\n\n'));
  for(const s of r.sections.filter(s=>s.kind==='synthesis')){body.push(HENOSIS_SECTION_LABELS[s.kind]+'\n'+s.text);s.citations.forEach(id=>citations.add(id));}
  sections.push(body.join('\n\n'));
 }
 return {content:sections.join('\n\n'),citedAliases:[...citations],delivery:safeDelivery};
}
