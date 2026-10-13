import {normalizeGuardText,uniqueIssues,isReviewSuggestion,type FrameworkDraft,type FrameworkAudit,type AnswerContract,type GuardIssue} from './contracts';
import {blockFactRefs,type FactRegistry} from './fact-contract';

export function answerContractIssues(d:FrameworkDraft,c:AnswerContract,r:FactRegistry){
 const issues:GuardIssue[]=[],add=(code:string,blockId:string|null=null)=>issues.push({guard:'answer',code,blockId});
 const allowed=c.options.map(x=>x.id),known=c.conditions.filter(x=>x.origin==='user').map(x=>x.id),assumptions=c.conditions.filter(x=>x.origin==='assumption').map(x=>x.id);
 if(d.decision.targetId!==c.targetId||d.decision.preferredOptionId!==null&&!allowed.includes(d.decision.preferredOptionId))add('ANSWER_TARGET');
 const checkConditions=(actual:string[],permitted:string[])=>new Set(actual).size===actual.length&&actual.every(x=>permitted.includes(x));
 if(!checkConditions(d.decision.conditionIds,known)||!checkConditions(d.decision.assumptionIds,assumptions))add('ANSWER_CONDITION_ORIGIN');
 const chosen=[...d.decision.conditionIds,...d.decision.assumptionIds];
 if(c.conditions.some(x=>x.critical&&!chosen.includes(x.id)))add('ANSWER_CRITICAL_CONDITION');
 if(d.decision.stance==='conditional'&&!chosen.length)add('ANSWER_EMPTY_CONDITIONAL');
 if(d.decision.stance==='insufficient_coverage'&&c.requiredScopes.every(s=>r.all().some(f=>f.queryScope===s)))add('ANSWER_FALSE_INSUFFICIENT');
 const first=d.blocks[0];
 if(c.mustAnswerDecisionFirst&&(!first||first.kind==='chart_fact'))add('ANSWER_DECISION_FIRST',first?.id??null);
 const scopes=new Set(d.blocks.flatMap(blockFactRefs).map(ref=>r.get(ref)?.queryScope));
 if(d.decision.stance!=='insufficient_coverage'&&c.requiredScopes.some(s=>!scopes.has(s)))add('ANSWER_SCOPE_COVERAGE');
 for(const b of d.blocks){
  if(b.kind==='chart_fact')continue;
  if(b.optionId!==null&&!allowed.includes(b.optionId))add('ANSWER_OPTION',b.id);
  if(b.kind==='condition'&&(!checkConditions(b.conditionIds,known)||!checkConditions(b.assumptionIds,assumptions)))add('ANSWER_CONDITION_ORIGIN',b.id);
  const s=normalizeGuardText(b.text);
  if(/你(?:认为|觉得|想选|想走).*[？?]|(?:请|能否).{0,6}(?:再|重新)确认|是否(?:开始|继续)(?:分析|解盘)/u.test(s)||s.replace(/[\s？?]/g,'')===c.question.replace(/[\s？?]/g,''))add('ANSWER_REASK',b.id);
  if(b.id===first.id){
   if(d.decision.stance==='supports'&&/(?:不建议|不支持|不适合|应当放弃)/u.test(s)||d.decision.stance==='not_supported'&&/(?<!不)(?:建议|支持|适合)(?:你)?(?:立即|直接|马上)/u.test(s))add('ANSWER_STANCE_CONFLICT',b.id);
  }
 }
 if(allowed.length>1&&allowed.some(id=>!d.blocks.some(b=>b.kind!=='chart_fact'&&b.optionId===id)))add('ANSWER_COMPARISON_COVERAGE');
 if(c.periodComparison){
  const p=c.periodComparison,chosen=d.decision.preferredOptionId;
  if(first.kind!=='traditional_interpretation'||first.optionId!==chosen)add('ANSWER_RANKING_FIRST',first.id);
  if(chosen===null&&(first.kind==='chart_fact'||!/(?:并列|难分|未拉开|无法区分)/.test(first.text)))add('ANSWER_RANKING_MISSING_CHOICE',first.id);
  for(const option of p.options){
   const blocks=d.blocks.filter(b=>b.kind==='traditional_interpretation'&&b.optionId===option.id);
   if(!blocks.length||!blocks.some(b=>blockFactRefs(b).some(ref=>{const f=r.get(ref);return f?.queryScope==='decadal'&&f.date===option.date&&f.scopePalace===p.primaryPalace;})))add('ANSWER_PERIOD_EVIDENCE');
   for(const b of blocks)if(blockFactRefs(b).some(ref=>{const f=r.get(ref);return f?.queryScope==='decadal'&&f.date!==option.date;}))add('ANSWER_PERIOD_CROSS_REFERENCE',b.id);
  }
  if(first.kind!=='chart_fact'&&/(?:可逆准备|候选日期|先做准备)/.test(first.text))add('ANSWER_RANKING_OFF_TOPIC',first.id);
 }
 return uniqueIssues(issues);
}
export function independentAuditPassed(a:FrameworkAudit,issues:GuardIssue[],d:FrameworkDraft){
 const suggestions=a.issues.filter(isReviewSuggestion);
 if(issues.length||a.issues.some(i=>!isReviewSuggestion(i))||!a.pass&&!suggestions.length)return false;
 const needsFacts=d.blocks.some(b=>blockFactRefs(b).length>0)||d.windowIds.length>0;
 return a.checks.boundaries==='pass'&&a.checks.relevance==='pass'&&(needsFacts?a.checks.facts==='pass':a.checks.facts!=='fail')&&(d.references.length?a.checks.references==='pass':a.checks.references!=='fail');
}
export function conclusionFingerprint(d:FrameworkDraft,c:AnswerContract,r:FactRegistry){
 if(answerContractIssues(d,c,r).length)return null;
 return JSON.stringify([c.targetId,d.decision.preferredOptionId,d.decision.stance,c.conditions.filter(x=>x.critical).map(x=>x.id).sort(),c.scopeDateSignature]);
}
