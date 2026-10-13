import {z} from 'zod';
import {WorkflowContinuation} from '../workflow-phase';
import {chartDossier,focusedDialogue,selectStructuralEvidence} from '../focused-context';
import {CHART_CONFIG,type ChartData,type Scope} from '../chart';
import {MAIN_STARS} from '../knowledge-contract';
import {structuredCall,WorkflowOutputError} from '../structured';
import {CallLedger,WorkflowBudgetError,type StageId} from '../workflow-observation';
import type {TimingArgs} from '../timing-answer';
import {timingRecord,timingSnapshot,timingModelContext,type TimingAnalysis} from '../timing';
import type {Answer,Evidence} from '../workflow';
import {comparisonRequest} from '../decision';
import {buildDialogueContext,dialogueRecord,dialogueAnswerIssues} from '../dialogue';
import {answerContract as legacyAnswerContract,coverageIssues} from '../answer-quality';
import {frameworkDraftSchema,frameworkAuditSchema,isReviewSuggestion,type FrameworkDraft,type FrameworkAudit,type AnswerContract,type GuardIssue} from './contracts';
import {createFactRegistry,renderFact,blockFactRefs,rawFactTextIssues,type FactRegistry,type RequestBinding} from './fact-contract';
import {checkFrameworkEvidence} from '../evidence-check';
import {boundaryTextIssues} from './boundary-guard';
import {legacyBlocks,checkFrameworkDraft,prepareVerifiedDelivery,recoveryChoice,boundaryFallback} from './guarded-delivery';
import {packGeneralEvidence,packDecisionEvidence,packWindowFacts,outputShape,generationInstructions,auditInstructions} from './prompt-assembly';
import {directAnswer} from '../direct-answer';
import {analysisInstructions,analysisPlanContext} from '../analysis-plan';
import {fitAnalysisContext} from '../analysis-context';

export type FrameworkRuntimeArgs={retrievePersonalContext?:(plan:import('../analysis-plan').AnalysisPlan)=>Promise<import('../palace-memory').RetrievedMemory|undefined>;analysisPlan?:import('../analysis-plan').AnalysisPlan;timingRequest?:import('../timing-request').TimingRequest|null;personalContext?:import('../palace-memory').RetrievedMemory;frameworkV1?:boolean;adaptiveContext?:boolean;directOutput?:boolean;frameworkIdentity?:Pick<RequestBinding,'owner'|'profileId'|'profileRevision'|'requestId'>};
/** G1 clarification is a single-turn exit, but not an exception to output boundaries. */
export function frameworkClarificationIssues(text:string,args:TimingArgs){
 if(!args.frameworkIdentity)return ['FRAMEWORK_IDENTITY_REQUIRED'];
 const binding={...args.frameworkIdentity,engineVersion:args.chart.ruleVersion,config:CHART_CONFIG};
 const empty=createFactRegistry(binding,[],[args.chart]);
 return [...boundaryTextIssues(text,'clarification'),...rawFactTextIssues(text,'clarification',[],empty)].map(i=>i.code);
}
type Input={kind:'general'|'mixed'|'timing';args:TimingArgs;ledger:CallLedger;evidence:Evidence[];charts:ChartData[];analysis?:TimingAnalysis;context:Record<string,any>;steps:Answer['steps'];intent:string;queries?:Answer['queries']};

function contractFor(input:Input,registry:FactRegistry):AnswerContract{
 const {context,kind,args}=input,goal=context.dialogue?.goal||args.question,comparison=comparisonRequest(goal);
 const ranking=context.decadeComparison;
 if(ranking)return {targetId:'decade_ranking',targetLabel:goal,question:args.question,mustAnswerDecisionFirst:true,options:ranking.options.map((o:any)=>({id:o.id,label:o.label})),conditions:[{id:'a1',text:'仅比较传统盘面中的'+ranking.topic+'倾向，不代表实际收益或确定结果',origin:'assumption',critical:true}],requiredScopes:['natal','decadal'],scopeDateSignature:JSON.stringify(ranking.options.map((o:any)=>o.date)),periodComparison:ranking};
 const explanation=kind==='timing'&&input.analysis?.comparisonMode==='descriptive'||kind==='general'&&!comparison&&!/适合|合适|该不该|要不要|能不能|能否|是否|值得|哪.{0,6}(好|强|旺)|选择|建议/.test(goal);
 const conditions:AnswerContract['conditions']=[{id:'a1',text:'传统解读用于条件性讨论，现实结果取决于实际条件与行动',origin:'assumption',critical:!explanation}];
 // Known conditions refer to already-present dialogue data, never to a model-inferred biography.
 const statements=context.dialogue?.userStatements||[];
 for(const [i,text] of (args.adaptiveContext?statements.slice(-8):statements).entries())conditions.push({id:'u'+i,text,origin:'user',critical:false});
 return {targetId:comparison?'path':explanation?'explanation':kind==='timing'?'timing':'decision',targetLabel:goal,question:args.question,mustAnswerDecisionFirst:kind!=='timing'&&!context.answerContract?.chartLookup,options:comparison?comparison.choices.map((c,i)=>({id:'o'+i,label:c.label})):[{id:'o0',label:goal}],conditions,requiredScopes:[...new Set(registry.all().map(f=>f.queryScope))],scopeDateSignature:JSON.stringify([...new Set(registry.all().map(f=>f.queryScope+':'+f.date))])};
}
function removeOptionalFollowup(d:FrameworkDraft):FrameworkDraft{
 const last=d.blocks.findLast(b=>b.kind!=='chart_fact');if(!last)return d;
 const match=last.text.match(/(?:需要我继续(?:分析|解释|展开)?吗|要我继续(?:分析|解释|展开)?吗|是否需要我(?:继续)?(?:分析|解释|展开))[？?]\s*$/u);
 if(!match)return d;
 const text=last.text.slice(0,match.index).trim(),substantive=d.blocks.filter(b=>b.kind!=='chart_fact').map(b=>b.id===last.id?text:b.text).join('');
 if(substantive.length<80)return d;
 return {...d,blocks:text?d.blocks.map(b=>b.id===last.id?{...last,text}:b):d.blocks.filter(b=>b.id!==last.id)};
}
function compactContract(c:AnswerContract){
 return {targetId:c.targetId,requiredConditionIds:c.conditions.filter(x=>x.critical).map(x=>x.id),options:c.options.map(x=>[x.id,x.label]),conditions:c.conditions.map(x=>[x.id,x.origin,x.origin==='user'?`dialogue.userStatements[${x.id.slice(1)}]`:x.text]),requiredScopes:c.requiredScopes};
}
/** All snapshot hits are rejoined to trusted iztro sources before they may become prompt data.
 * Source scope and query scope are independent; no model supplied IDs enter this registry.
 */
function validateWindows(analysis:TimingAnalysis|undefined,charts:ChartData[]){
 if(!analysis)return;
 for(const w of analysis.windows)for(const snap of [w.snapshot,...w.days]){
  const c=charts.find(c=>c.target===snap.date);if(!c)throw Error('WINDOW_CHART_MISSING');
  const depth=snap.layers.at(-1)?.scope;if(depth!=='monthly'&&depth!=='daily'&&depth!=='yearly')throw Error('WINDOW_DEPTH');
  if(JSON.stringify(snap)!==JSON.stringify(timingSnapshot(c,depth,analysis.palaces)))throw Error('WINDOW_SNAPSHOT_CONFLICT');
  for(const layer of snap.layers){
   const source=c.transformationSources[layer.scope];
   if(!source||layer.stemBranch!==source.stemBranch)throw Error('WINDOW_SOURCE_SCOPE');
   for(const h of layer.hits)if(h.scope!==layer.scope||h.sourceId!==source.id||!source.mutations.some(t=>t.id===h.id&&t.star===h.star&&t.value===h.value&&t.palaceIndex===h.palaceIndex&&t.natalPalace===h.natalPalace&&t.scopePalace===h.scopePalace))throw Error('WINDOW_FACT_CONFLICT');
  }
 }
}
/** Neutral output for computed dates only. Never call legacy ruleWindowExplanation in this branch. */
function windowFacts(a:TimingAnalysis|undefined){
 if(!a)return '';
 if(a.comparisonMode==='descriptive')return `已按本轮主题对照 ${a.request.start} 至 ${a.request.end}，共 ${a.periods.length} 段实际运限区间。\n${a.request.assumptions.join(' ')}\n${a.method}`;
 if(a.request.detail==='yearly')return (a.windows.length?'程序候选年份：'+a.windows.map(w=>`${w.start.slice(0,4)} 年`).join('、'):'本轮计算未返回候选年份。')+`\n已逐年比较 ${a.request.start.slice(0,4)} 至 ${a.request.end.slice(0,4)}，共 ${a.scannedDays} 年。`+'\n'+a.request.assumptions.join(' ')+'\n'+a.method;
 if(a.request.detail==='monthly')return (a.windows.length?'程序候选流月区段：'+a.windows.map(w=>`${w.start} 至 ${w.end}`).join('、'):'本轮计算未返回候选流月区段。')+`\n已覆盖 ${a.request.start} 至 ${a.request.end}，共 ${a.periods.length} 个实际区段；未择日。`+'\n'+a.request.assumptions.join(' ')+'\n'+a.method;
 return (a.windows.length?'程序候选范围：'+a.windows.map(w=>`${w.start} 至 ${w.end}；已计算候选日 ${w.days.map(d=>d.date).join('、')}`).join('。\n'):'本轮计算未返回候选窗口。')+`\n已逐日比较 ${a.request.start} 至 ${a.request.end}，共 ${a.scannedDays} 天。`+'\n'+a.request.assumptions.join(' ')+'\n'+a.method;
}
function packedFacts(input:Input,evidence:Evidence[],registry:FactRegistry){
 const sources=[...new Map(evidence.flatMap(e=>e.sources.map(s=>[s.id,s] as const))).values()];
 const byStar=new Map(registry.all().map(f=>[f.evidenceId+'|'+f.star,f.ref]));
 if(input.kind==='mixed'||input.context.decadeComparison||input.args.adaptiveContext){
  const model=evidence.map(e=>({id:e.id,scope:e.scope,date:e.date,palace:e.scopePalace,natalPalace:e.natalPalace,relations:((e as any).relations||[]).map((r:any)=>[r.focusPalace,r.relation]),sourceIds:e.sources.map(s=>s.id),stars:e.stars.map(s=>({name:s.name,brightness:s.brightness,transformations:s.transformations.map(t=>t.id)}))}));
  const packed=packDecisionEvidence(model,sources,evidence.flatMap(e=>e.stars.flatMap(s=>s.transformations)));
  // MAIN_STARS filtering occurs ONCE upstream, shared by registry and serializer. Never renumber a second set.
  packed.data.rows.forEach((row,i)=>{(row[7] as any[]).forEach((s,j)=>{const ref=byStar.get(evidence[i].id+'|'+evidence[i].stars[j].name);if(input.context.decadeComparison||input.args.adaptiveContext)s[0]=ref;else if(s[0]!==ref)throw Error('FACT_ALIAS_MISMATCH');});});
  return {sourceCatalog:packed.sourceCatalog,decisionEvidence:packed.data};
 }
 const model=evidence.map(({branch,sources,stars,...e})=>({...e,sourceIds:sources.map(s=>s.id),stars:stars.map(s=>({name:s.name,brightness:s.brightness||null,transformations:s.transformations.map(({id,sourceId,scope,value,scopePalace})=>({id,sourceId,scope,value,scopePalace})),ref:byStar.get(e.id+'|'+s.name)}))}));
 return {sourceCatalog:sources,evidence:packGeneralEvidence(model)};
}

export async function runFramework(input:Input):Promise<Answer>{
 const {args,kind,ledger,analysis,steps}=input;
 if(!args.frameworkIdentity)throw Error('FRAMEWORK_IDENTITY_REQUIRED');
 const binding:RequestBinding={...args.frameworkIdentity,engineVersion:args.chart.ruleVersion,config:CHART_CONFIG};
 const evidence=args.adaptiveContext?selectStructuralEvidence(input.evidence,args.question,input.queries?.flatMap(q=>q.palaces)||[]):input.context.decadeComparison?input.evidence.map(e=>({...e,stars:e.stars.filter(s=>e.scopePalace===input.context.decadeComparison.primaryPalace||MAIN_STARS.has(s.name)||s.transformations.length>0)})):kind==='mixed'?input.evidence.map(e=>({...e,stars:e.stars.filter(s=>MAIN_STARS.has(s.name))})):input.evidence;
 validateWindows(analysis,input.charts);
 // The legacy registry requires an observed anchor inside each window. A monthly
 // snapshot is that validated observation, not a selected action day. Keep the
 // original monthly days=[] for prompt packing, delivery and saved metadata.
 const registeredWindows=analysis?.request.detail==='monthly'?analysis.windows.map(w=>({id:w.id,start:w.start,end:w.end,days:[{date:w.snapshot.date}]})):analysis?.windows||[];
 const registry=createFactRegistry(binding,evidence,input.charts,registeredWindows,input.charts.map(c=>c.target));
 const contract=contractFor(input,registry);
 // Never carry both the original evidence graph and its compact projection (ranking used to).
 const {evidence:_raw,sourceCatalog:_sources,decisionEvidence:_decision,...taskContext}=input.context;
 const context:Record<string,any>={...taskContext,...packedFacts(input,evidence,registry),frameworkContract:compactContract(contract)};
 if(args.adaptiveContext){
  if(!args.analysisPlan||evidence.length)context.chartDossier=chartDossier(args.chart,args.analysisPlan?[...new Set(evidence.map(e=>e.natalPalace))]:undefined);
  context.dialogue=focusedDialogue(context.dialogue,context.history??args.history,context.confirmedMemories??args.memories);
  delete context.history;delete context.confirmedMemories;delete context.outline;
  context.feedback=(context.feedback||[]).slice(0,2).map((x:any)=>({...x,content:x.content.slice(0,400)}));
 }
 if(analysis)context.timing={...context.timing,...(analysis.request.detail!=='daily'||analysis.comparisonMode==='descriptive'?timingModelContext(analysis):{}),windows:packWindowFacts(analysis).data};
 if(analysis?.request.plan&&analysis.request.detail!=='yearly'){
  const p=analysis.request.plan;
  // Dates already occur in request; full plans remain in checkpoints and saved metadata.
  context.timing.request={...context.timing.request,goal:[context.question,context.dialogue?.goal].includes(analysis.request.goal)?undefined:analysis.request.goal,plan:{version:p.version,event:p.event,rangeSource:p.rangeSource,
   ...(p.referenceDate!==analysis.request.today?{referenceDate:p.referenceDate}:{}),
   ...(p.backgroundEvents.length?{backgroundEvents:p.backgroundEvents}:{}),
   ...(p.constraints.excludedYears.length?{excludedYears:p.constraints.excludedYears}:{})}};
 }
 if(contract.periodComparison)context.decadeComparison={...context.decadeComparison,queries:undefined,instructions:'比较全部options的主题宫位及三方四正，先选出最有利候选。首段traditional_interpretation的optionId必须等于preferredOptionId，并绑定该限主题宫位的subjectRefs；每个候选独立解释段绑定对应optionId及该限主题宫位subjectRefs。同一标准比较收入机会、积累与波动（财运主题），不编造评分或概率；可明确并列且preferredOptionId=null，但不能用行动准备代替排名。不改写星曜事实，使用fact槽位。用一个chart_fact段补本命依据。所有年龄区间由程序显示。'};
 if(args.personalContext)context.personalMemory={...args.personalContext,use:'历史解读不是现实事实；userFacts 为用户陈述引句。按 binding 的宫位、时间和命盘版本使用；当前计算结果优先。facts 按 ID 引用，本命物理宫位只出现一次。'};
 if(args.analysisPlan)context.analysisPlan=analysisPlanContext(args.analysisPlan);
 const fitted=args.analysisPlan?fitAnalysisContext(context,args.connection,9000):{context};
 const fullContext={...fitted.context,outputShape};
 const timeInstructions=(args.analysisPlan?'\n'+analysisInstructions:'')+(analysis?.request.detail==='monthly'?'\n本轮按实际流月及年限边界比较，使用monthlyPeriods与已提供四层资料，不曾进行流日择日。窗口起止仅表示调查区段，不能称为最佳行动日。':'')+(analysis?.request.detail==='yearly'?'\n本轮为逐年时间比较。先明确目标事件、背景事件时间、分析基准日及实际起止范围，解释默认范围不代表用户愿意等待。根据 currentEnvironment 和本命主题宫位说明长期背景、当前实际大限和今年环境；心理取向只作有依据的条件性解读，不能冒充用户自述。按大限分组、按实际时间顺序覆盖 yearlyPeriods 中全部年份及年内换限区段，进入新大限先解释该限主题变化，再解释流年。每年有简短比较，候选年份重点展开；没有明显优势须如实说明，不保证事件发生。范围外的背景年份不得变成目标窗口，首尾不足一年按实际日期标明；年度分析不能声称已择出具体月份或日期。早于分析基准日的区段仅作回顾，不作为尚可执行的行动日期。非候选年份同样使用已提供的事实依据，不仅解释 windows。实际覆盖以本轮 timing.request 起止及 yearlyPeriods 为准；currentEnvironment 是基准定位，不会把历史比较范围改成今年。历史回复中的旧范围不是本轮计算结果；已经提供的历史区段不要求用户另行补盘。':'')+(analysis?.comparisonMode==='descriptive'?'\n本轮是主题时间对照，comparisonMode=descriptive，按 coverage.periods 或 yearlyPeriods 的全部区段解释；windows 为空是有意不选择行动候选，不是缺少历史数据或没有明显优势。无需给首选行动年，不能套用有利行动窗口排序来回答“需要注意”。健康主题沿用既有 health-non-diagnostic 契约，说明传统宫位主题变化，不将支持或提醒层换算成现实疾病或个人健康风险排名。':'');
 if(args.analysisPlan||analysis?.request.detail==='yearly'||analysis?.request.detail==='monthly'||analysis?.comparisonMode==='descriptive'){
  // The bounded multi-year evidence replaces a single-year baseline; reserve draft/format-repair input, retaining the existing call ceiling.
  const perCall=generationInstructions.length+timeInstructions.length+JSON.stringify(fullContext).length+48000;
  ledger.setInputLimits(perCall,perCall*ledger.observation.maxCalls);
 }
 const progress=(name:string,detail:string,done=false)=>{args.onProgress?.({stage:name,detail,status:done?'done':'running'});if(done)steps.push({name,detail});};
 const base={dialogue:dialogueRecord({...buildDialogueContext(args.question,args.history),goal:context.dialogue?.goal||args.question,clarificationAllowed:false}),intent:kind==='mixed'?'判断与时机':kind==='timing'?(analysis?.comparisonMode==='descriptive'?'主题时间对照':'行动窗口'):'个性化解读',workflow:'xytha-flow-4.8-bprime.2-helpful.1'+(args.adaptiveContext?'-adaptive.1':''),responseType:'answer' as const,steps,...(analysis?{timing:timingRecord(analysis)}:{}),queries:input.queries||[],...(contract.options.length>1?{decision:{choices:contract.options.map(x=>x.label)}}:{})};
 const fallback=(issues:GuardIssue[]=[],reason='evidence_recovery'):Answer=>{
  args.signal?.throwIfAborted();
  console.info(JSON.stringify({event:'framework_fallback',requestId:ledger.observation.requestId,route:kind,reason,guards:[...new Set(issues.map(i=>i.guard))],codes:[...new Set(issues.map(i=>/^[A-Z][A-Z_]{2,60}$/.test(i.code)?i.code:'REVIEW_REJECTED'))]}));
  const first=issues.some(i=>i.guard==='boundary')?boundaryFallback(issues):contract.periodComparison?`本轮尚未得到通过核对的${contract.periodComparison.topic}排名，因此不能指定哪个大限最好。已对 ${contract.options.length} 个大限使用相同主题宫位及三方四正取数，问题无需重新确认。${contract.periodComparison.omitted.length?'有 '+contract.periodComparison.omitted.length+' 个大限超出引擎可计算范围，未纳入比较。':''}`:analysis?analysis.comparisonMode==='descriptive'?`本轮模型解释未完成；以下显示已计算的主题范围与部分盘面事实。`:`本轮模型判断未完成；以下仅显示程序候选范围，不能据此判断是否适合行动。`:`本轮尚未形成通过核对的直接回答；以下事实不能代替对「${contract.targetLabel}」的判断。`;
  const relevant=contract.periodComparison?registry.all().filter(f=>f.scopePalace===contract.periodComparison!.primaryPalace):registry.all();
  const representatives=relevant.filter((f,i,a)=>a.findIndex(x=>x.queryScope===f.queryScope&&x.date===f.date)===i).slice(0,contract.periodComparison?13:5);
  let content=[first,representatives.map(renderFact).join('\n'),windowFacts(analysis)].filter(Boolean).join('\n\n');
  if(boundaryTextIssues(content,null,contract).length||content.length>30000)content=boundaryFallback(issues);
  progress('呈现可核对内容','本轮采用规则说明，保留计算事实与条件；未把它记为模型成功',true);
  return {...base,content,evidence:evidence.filter(e=>representatives.some(f=>f.evidenceId===e.id)),model:null,mode:'rules',completion:'limited',recovery:{reason:reason==='format_recovery'?'format_recovery':'evidence_recovery'},observation:ledger.finish('rules',{fallbackReason:reason,factsConditional:true})};
 };
 if(!args.connection)return fallback([],'no_connection');
 // Direct-output mode: bypass the JSON schema + evidence audit contract and return the
 // model's natural-language explanation verbatim. Opt-in only; default keeps the contract.
 if(args.directOutput){
  try{
   progress('正在生成说明','按当前命盘依据直接生成说明，不经过格式与证据契约核对');
   const directInstruction=generationInstructions.replace('输出decision、blocks与references的结构化结果。decision只使用frameworkContract允许的目标、选项和结论域；每个解释段绑定subjectRefs。chart_fact仅含factRefs，无自由text；事实指代仅用{fact:f0}槽位；解释窗口须绑定windowId。','直接以自然语言回答，不输出JSON、decision、blocks、references或任何槽位标记。');
   const text=await directAnswer({connection:args.connection,instructions:directInstruction+timeInstructions,data:fitted.context,signal:args.signal,tokens:kind==='general'||analysis?.request.detail==='yearly'?9000:5000,ledger,stageId:kind==='general'?'G2':'T1',onActivity:a=>progress('正在生成说明',`正在接收模型说明 · ${Math.round(a.elapsedMs/1000)} 秒`)});
   progress('呈现说明','已直接返回模型说明，未经过格式与证据契约核对',true);
   return {...base,content:text,verification:'direct',mode:'llm',model:args.connection!.model,evidence,completion:'answered',observation:ledger.finish('model',{factsConditional:true})};
  }catch(e){
   if(e instanceof WorkflowContinuation)throw e;
   args.signal?.throwIfAborted();
   if(e instanceof WorkflowOutputError||e instanceof WorkflowBudgetError)return fallback([],e instanceof WorkflowBudgetError?e.dimension+'_budget':'format_recovery');
   ledger.finish('failed');throw e;
  }
 }
 let repairs=ledger.observation.attempts.filter(a=>a.formatAttempt>1).length;
 const call=<T,>(id:StageId,data:unknown,schema:z.ZodType<T,z.ZodTypeDef,any>,isolated=false)=>{
  const audit=id==='G3'||id==='G5'||id==='T2',repair=id==='G4'||id==='T3';
  return structuredCall({schema,stage:audit?'audit':repair?'repair':'answer',stageId:id,label:audit?'核对事实与回答':repair?'定向修订':'组织模型判断',model:audit?args.reviewConnection||args.connection!:args.connection!,instructions:(audit?auditInstructions:generationInstructions+timeInstructions)+(isolated?'\n删除不合格段落后重新独立复核，不继承原稿通过。':repair?'\n只定向修正requiredCorrections，保留成立的条件比较。':''),data,tokens:audit?3000:kind==='general'||analysis?.request.detail==='yearly'?9000:5000,signal:args.signal,ledger,observer:args.observer,reserveCalls:kind==='mixed'&&!audit?1:0,reserveRepair:()=>repairs++<2,onRepair:()=>progress('修复返回格式','使用现有格式修复预算，保留独立复核约束'),onActivity:a=>progress(audit?'正在核对依据':'正在生成草稿',`正在接收服务响应 · ${Math.round(a.elapsedMs/1000)} 秒`),requiredFields:audit?{pass:'boolean',checks:'facts,boundaries,references,relevance:pass|fail|na',issues:'[{code,blockId}]'}:outputShape});
 };
 const checks=async(d:FrameworkDraft)=>{
  let checked=await checkFrameworkDraft(d,registry,binding,contract);
  // A removable closing question must never erase forged refs, options or dependencies.
  if(checked.draft&&!checked.issues.some(i=>i.code!=='ANSWER_REASK')){
   const candidate=removeOptionalFollowup(checked.draft);
   if(candidate!==checked.draft)checked=await checkFrameworkDraft(candidate,registry,binding,contract);
  }
  const issues=[...checked.issues];
  // Same fact contract also exported from the existing evidence-check boundary.
  for(const issue of checkFrameworkEvidence(checked.draft||d,registry,binding))if(!issues.some(x=>x.code===issue.code&&x.blockId===issue.blockId))issues.push(issue);
  if(analysis&&(d.windowIds.length!==analysis.windows.length||analysis.windows.some(w=>!d.windowIds.includes(w.id))))issues.push({guard:'fact',code:'WINDOW_COVERAGE',blockId:null});
  if(!issues.length&&checked.draft){
   const blocks=legacyBlocks(checked.draft,registry),dialogue={...buildDialogueContext(args.question,args.history),clarificationAllowed:false};
   const existing=legacyAnswerContract(args.question,dialogue);
   for(const code of [...dialogueAnswerIssues(blocks.map(b=>b.text).join('\n\n'),args.question,dialogue),...coverageIssues(blocks,existing)])issues.push({guard:'answer',code,blockId:null});
  }
  return {...checked,issues};
 };
 const auditContext=(d:FrameworkDraft,isolated=false)=>{
  if(args.adaptiveContext){
   const cited=new Set(d.blocks.flatMap(blockFactRefs));
   const subset=evidence.map(e=>({...e,stars:e.stars.filter(s=>registry.all().some(f=>f.evidenceId===e.id&&f.star===s.name&&cited.has(f.ref)))})).filter(e=>e.stars.length);
   return {...(args.analysisPlan?{analysisPlan:context.analysisPlan,taskComparisons:context.taskComparisons}:{}),question:args.question,goal:context.dialogue?.goal,frameworkContract:context.frameworkContract,dialogue:{userStatements:context.dialogue?.userStatements||[],confirmedMemories:context.dialogue?.confirmedMemories||[]},draft:d,...packedFacts(input,subset,registry),...(context.timing?{timing:context.timing}:{}),...(context.decadeComparison?{decadeComparison:context.decadeComparison}:{}),isolated};
  }
  if(kind!=='general')return {...context,draft:d,isolated};
  if(isolated)return {...context,draft:d,isolated:true,removedSectionCount:(lastDraft?.blocks.length||d.blocks.length)-d.blocks.length,isolatedIssues:lastIssues};
  const cited=new Set(d.blocks.flatMap(blockFactRefs).flatMap(ref=>registry.get(ref)?.evidenceId||[]));
  const facts=packedFacts(input,evidence.filter(e=>cited.has(e.id)),registry);
  // Preserve the old review context responsibilities; no P1 history/memory compression.
  return {...(context.decadeComparison?{decadeComparison:context.decadeComparison}:{}),question:context.question,dialogue:context.dialogue,answerContract:context.answerContract,frameworkContract:context.frameworkContract,draft:d,...facts,queries:context.queries,memories:context.confirmedMemories,history:context.history,subquestions:context.subquestions,...(isolated?{isolated:true}:{})};
 };
 const review=async(d:FrameworkDraft,isolated=false)=>{
  const first=kind!=='general'&&!isolated&&ledger.observation.firstT2==='not_attempted',before=ledger.observation.actualCalls;
  if(first)ledger.observation.firstT2='failed';
  progress(isolated?'独立复核保留段落':'正在复核','检查核心判断、事实引用、健康边界与层级来源');
  let a:FrameworkAudit;
  try{a=await call(kind==='general'?isolated?'G5':'G3':'T2',auditContext(d,isolated),frameworkAuditSchema,isolated);}catch(e){if(first&&ledger.observation.actualCalls===before)ledger.observation.firstT2='not_attempted';throw e;}
  const delivery=await prepareVerifiedDelivery(d,a,registry,binding,contract);
  // A false raw review with editorial-only suggestions may be usable, but is not a raw first-pass.
  if(first&&a.pass&&delivery.ok&&ledger.observation.actualCalls-before===1)ledger.observation.firstT2='passed';
  return {audit:a,delivery};
 };
 const result=(d:FrameworkDraft,delivery:Awaited<ReturnType<typeof prepareVerifiedDelivery>>,isolated=false):Answer=>{
  args.signal?.throwIfAborted();if(!delivery.ok)return fallback(delivery.issues);
  // No extra model-authored text may be appended after this final concatenation guard.
  const content=delivery.content+(contract.periodComparison?'\n\n比较范围：'+contract.options.map(o=>o.label).join('、')+(contract.periodComparison.omitted.length?'。未纳入：'+contract.periodComparison.omitted.join('、')+'（超出引擎日期范围）':'')+'。仅比较大限趋势，未据此推断具体流年。':'')+(analysis?'\n\n'+windowFacts(analysis):'');
  const finalIssues=boundaryTextIssues(content,null,contract);
  if(content.length>30000)finalIssues.push({guard:'boundary',code:'DELIVERY_LENGTH',blockId:null});
  if(finalIssues.length)return fallback(finalIssues);
  const cited=new Set(delivery.blocks.flatMap(b=>b.evidenceIds));
  progress('复核完成','已核对事实与核心回答，保留成立的解读和条件说明',true);
  return {...base,content,blocks:delivery.blocks,verification:'reviewed',mode:'llm',model:args.connection!.model,reviewModel:(args.reviewConnection||args.connection)!.model,evidence:evidence.filter(e=>cited.has(e.id)),completion:isolated?'limited':'answered',...(isolated?{recovery:{reason:'evidence_recovery' as const}}:{}),observation:ledger.finish(isolated?'isolated_model':'model',{factsConditional:!d.blocks.some(b=>b.kind==='traditional_interpretation')})};
 };
 let lastDraft:FrameworkDraft|undefined,lastIssues:GuardIssue[]=[];
 try{
  progress('正在生成草稿',kind==='mixed'?'先给适配性判断，再解释程序候选窗口':'按本轮事实和已知条件组织回答');
  let draft=await call(kind==='general'?'G2':'T1',fullContext,frameworkDraftSchema);
  for(let attempt=0;attempt<(kind==='mixed'?1:2);attempt++){
   args.signal?.throwIfAborted();const checked=await checks(draft);lastDraft=checked.draft||draft;lastIssues=checked.issues;
   if(!lastIssues.length){
    const verified=await review(lastDraft);
    if(verified.delivery.ok)return result(lastDraft,verified.delivery);
    // Audit issues carry block IDs for dependency isolation; an explicit reviewer reject never becomes pass.
    lastIssues=verified.audit.issues.filter(i=>!isReviewSuggestion(i)).map(i=>({guard:/^(?:FACT|WINDOW|SCOPE|SOURCE|BRIGHTNESS)|四化|星曜|宫位|亮度/.test(i.code)?'fact':/^(?:HEALTH|ABSOLUTE|BOUNDARY)/.test(i.code)?'boundary':'answer',...i}));
    if(!lastIssues.length)lastIssues=[{guard:'answer',code:'INDEPENDENT_REVIEW_REJECTED',blockId:null}];
   }
   if(kind==='mixed')break;
   if(attempt===0){progress('正在修订','根据复核意见修正，继续使用原有依据集');draft=await call(kind==='general'?'G4':'T3',{...fullContext,previousDraft:lastDraft,requiredCorrections:lastIssues},frameworkDraftSchema);}
  }
  if(lastDraft){
   // T1 + repaired T1 + rejected T2 = 3: fresh isolation would be #4 and is deliberately skipped.
   // Isolation always receives the original graph and issues; never erase rejected IDs.
   const recovery=recoveryChoice(lastDraft,lastIssues,ledger.remaining);
   if(recovery.draft&&!(await checks(recovery.draft)).issues.length){
    const verified=await review(recovery.draft,true);if(verified.delivery.ok)return result(recovery.draft,verified.delivery,true);
   }
  }
  return fallback(lastIssues);
 }catch(e){
  if(e instanceof WorkflowContinuation)throw e;
  args.signal?.throwIfAborted();
  if(e instanceof WorkflowOutputError||e instanceof WorkflowBudgetError)return fallback([],e instanceof WorkflowBudgetError?e.dimension+'_budget':'format_recovery');
  ledger.finish('failed');throw e;
 }
}
