import {frameworkDraftSchema,stripRetiredFields,frameworkAuditSchema,type FrameworkDraft,type FrameworkAudit,type AnswerContract,type GuardIssue} from './contracts';
import {factContractIssues,isolateFactDependencies,renderFact,type FactRegistry,type RequestBinding} from './fact-contract';
import {boundaryGuard,boundaryTextIssues,RULE_BOUNDARIES} from './boundary-guard';
import {referenceGuard,type SourceExcerpt} from './reference-guard';
import {answerContractIssues,independentAuditPassed} from './answer-contract';
import {normalizeFrameworkAnswer} from './normalize-answer';

/** Shared pre-review and final-delivery gate for the atomic framework branch. */
export async function checkFrameworkDraft(input:unknown,registry:FactRegistry,binding:RequestBinding,contract:AnswerContract,excerpts:SourceExcerpt[]=[]){
 const normalized=stripRetiredFields(input),parsed=frameworkDraftSchema.safeParse(normalized.value);
 if(!parsed.success)return {draft:null,issues:[{guard:'fact',code:'FRAMEWORK_SCHEMA',blockId:null}] as GuardIssue[],retiredFieldsRemoved:normalized.removed,references:[]};
 const d=normalizeFrameworkAnswer(parsed.data,contract,registry);
 const pre=[...factContractIssues(d,registry,binding),...boundaryGuard(d,contract),...answerContractIssues(d,contract,registry)];
 const references=await referenceGuard(d,excerpts);
 return {draft:references.draft,issues:[...pre,...references.issues,...boundaryGuard(references.draft,contract)],retiredFieldsRemoved:normalized.removed,references:references.references};
}
const stanceText={supports:'盘面参考倾向：支持。',conditional:'盘面参考倾向：有条件支持。',not_supported:'盘面参考倾向：暂不支持。',insufficient_coverage:'当前取数覆盖不足以形成盘面判断。'};
export function legacyBlocks(d:FrameworkDraft,r:FactRegistry){
 return d.blocks.map(b=>({kind:b.kind==='condition'?'reflection' as const:b.kind,text:b.kind==='chart_fact'?b.factRefs.map(id=>renderFact(r.get(id)!)).join('\n'):b.text.replace(/\{fact:([^{}]+)\}/gu,(_,id:string)=>renderFact(r.get(id)!)),evidenceIds:b.kind==='chart_fact'?b.factRefs.map(id=>r.get(id)!.evidenceId):b.kind==='traditional_interpretation'?b.subjectRefs.map(id=>r.get(id)!.evidenceId):[]}));
}
export async function prepareVerifiedDelivery(input:unknown,audit:unknown,registry:FactRegistry,binding:RequestBinding,contract:AnswerContract){
 const checked=await checkFrameworkDraft(input,registry,binding,contract),parsed=frameworkAuditSchema.safeParse(audit);
 if(!checked.draft||!parsed.success||!independentAuditPassed(parsed.data,checked.issues,checked.draft))return {ok:false as const,issues:checked.issues,content:null};
 const blocks=legacyBlocks(checked.draft,registry),windows=checked.draft.windowIds.map(id=>registry.window(id)!);
 const windowLead=windows.length?'候选窗口：'+windows.map(w=>`${w.start} 至 ${w.end}`).join('；'):'本轮计算未返回候选窗口。';
 const selection=contract.options.find(o=>o.id===checked.draft!.decision.preferredOptionId);
 const lead=contract.periodComparison?(selection?`传统盘面比较，${contract.periodComparison.topic}首选候选：${selection.label}。`:'传统盘面比较：候选大限未拉开明显差距。'):contract.targetId==='timing'?windowLead:contract.targetId==='explanation'?'':stanceText[checked.draft.decision.stance];
 const rendered=blocks.map((b,i)=>{const raw=checked.draft!.blocks[i];const option=contract.periodComparison&&raw.kind!=='chart_fact'?contract.options.find(o=>o.id===raw.optionId):null;return (option?option.label+'：':'')+(b.kind==='traditional_interpretation'?'传统解释｜':'')+b.text;});
 const content=(lead?lead+'\n':'')+rendered.join('\n\n')+(windows.length&&contract.targetId!=='timing'?'\n\n候选窗口：'+windows.map(w=>`${w.start} 至 ${w.end}`).join('；'):'');
 const finalIssues=boundaryTextIssues(content,null,contract);
 if(content.length>30000)finalIssues.push({guard:'boundary',code:'DELIVERY_LENGTH',blockId:null});
 return finalIssues.length?{ok:false as const,issues:finalIssues,content:null}:{ok:true as const,issues:[],content,blocks};
}
export function recoveryChoice(d:FrameworkDraft,issues:GuardIssue[],remainingCalls:number){
 const kept=isolateFactDependencies(d,issues);
 // T1 + repaired T1 + rejected T2 = 3. Isolation would be request 4: intentionally rules.
 // Never reuse the original audit verdict for an isolated candidate.
 if(remainingCalls<=0||!kept.draft)return {action:'rules' as const,draft:null};
 return {action:'independent_review' as const,draft:kept.draft};
}
export function boundaryFallback(issues:GuardIssue[]){return issues.some(i=>i.code.startsWith('HEALTH'))?RULE_BOUNDARIES.health:issues.some(i=>i.guard==='boundary')?RULE_BOUNDARIES.absolute:RULE_BOUNDARIES.facts;}
