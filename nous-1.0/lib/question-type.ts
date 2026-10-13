import {comparisonRequest} from './decision';
import type {DialogueContext} from './dialogue';
import {temporalEvent,temporalTask,resetsTemporalContext,temporalFollowup} from './temporal-intent';
import {matchQuestionDomains} from './question-domains';
import {classifyAnalysisTask} from './question-planner';

export const QUESTION_TYPE_VERSION='question-type-analysis.3';
export type QuestionType='general'|'timing'|'decision_with_timing';
export type EventType='career'|'application'|'relationship'|'general';
export type QuestionRoute={questionType:QuestionType;eventType:EventType;reasonCode:string;version:string;effectiveQuestion:string;answerContract:{mustAnswerDecisionFirst:boolean}};
const timing=/什么时候|何时|几月|哪个月|哪些月|哪(?:一|几|些)?年|哪(?:一|几)?天|哪段时间|几号|择[时日]|选日子|时间窗口|时机|具体.{0,6}时间|具体.{0,3}日期/;
const annualComparison=/(?:未来|往后|接下来|过去|之后|以后|今后)(?:几|[\d一二两三四五六七八九十]+)(?:[~～至到—-][\d一二两三四五六七八九十]+)?年|\d{4}年?\s*(?:至|到|[-~～—–])\s*\d{4}年|逐年|每年/;
const period=/今年|本年|明年|后年|去年|前年|近期|最近|现在|当下|今天|明天|后天|本周|下周|本月|这个月|下个?月|下个月|上半年|下半年|未来|接下来|流年|流月|流日|\b(?:19\d{2}|20\d{2}|2100)(?:年|[-/])|[\d一二三四五六七八九十]+月/;
const judgment=/适合|合适|该不该|应不应该|要不要|能不能|能否|是否(?:应该|应当|适宜)|值得(?!关注|注意|留意)|有利吗|可不可|可行吗|建议.{0,8}吗/;
const event=(s:string):EventType=>temporalTask(temporalEvent(s));
const clean=(s:string)=>s.replace(/[“「『][^”」』]*[”」』]|"[^"]*"/g,'').trim();

/** Only unambiguous surface forms are routed here. No LLM classifier and no cross-case state. */
export function classifyQuestionType(question:string,dialogue?:DialogueContext):QuestionRoute{
 const current=clean(question);let text=current,reasonCode='general_default';
 const result=(questionType:QuestionType,reason:string):QuestionRoute=>({questionType,eventType:event(text),reasonCode:reason,version:QUESTION_TYPE_VERSION,effectiveQuestion:text||question,answerContract:{mustAnswerDecisionFirst:questionType==='decision_with_timing'}});
 if(classifyAnalysisTask(current).kind==='knowledge')return result('general','conceptual_question_no_timing');
 if(/不问|别问|不是问|不(?:是)?择日|不需要.{0,4}择时|什么时候都|哪天都|只是举例|例如|举个例子/.test(current))return result('general','negated_or_example');
 if(/出生.{0,8}(什么时候|何时)|(?:什么时候|何时).{0,8}出生|几点出生|时辰校准|发病|患病|得癌|死亡|车祸|手术/.test(current))return result('general','excluded_domain');
 // Explicitly preserve the existing two-path comparison contract and its independent recovery.
 if(comparisonRequest(current)||dialogue&&dialogue.turnKind!=='new_question'&&comparisonRequest(dialogue.goal))return result('general','path_comparison');
 const currentDomains=matchQuestionDomains(current),priorDomains=dialogue?matchQuestionDomains(dialogue.goal):[];
 const sameDomain=!currentDomains.length||!priorDomains.length||currentDomains.some(d=>priorDomains.some(p=>p.id===d.id));
 const sameEvent=dialogue&&sameDomain&&!resetsTemporalContext(current)&&(temporalEvent(current)==='general'||temporalEvent(current)===temporalEvent(dialogue.goal));
 if(sameEvent&&dialogue&&(timing.test(clean(dialogue.goal))||annualComparison.test(dialogue.goal))&&/^(?:首选|备选|细化|精确|那个月)/.test(current))return result('timing','window_refinement');
 const follow=temporalFollowup(current);
 if(sameEvent&&dialogue&&clean(dialogue.goal)!==current&&(follow||dialogue.turnKind==='direct_answer')){
  // Keep background years intact. The shared resolver applies current constraints to raw user input.
  const goal=clean(dialogue.goal);
  text=goal+'；本轮：'+current;
  reasonCode='context_continuation';
 }
 if(/不适合|不合适|不值得/.test(text)&&!/[吗么？?]|是否|该不该|要不要/.test(text))return result('general','statement_not_question');
 const clauses=text.split(/[，,。；;！!？?]/).map(s=>s.trim()).filter(Boolean);
 const explicit=clauses.some(s=>timing.test(s))||((event(text)!=='general'||temporalEvent(text)==='health'||/财运|财富/.test(text))&&annualComparison.test(text)&&/走势|比较|分析|如何|怎么样|运势|发展/.test(text));
 // “适合什么时候提交” asks when, while “该不该跳，什么时候合适” asks both.
 const decision=clauses.some(s=>judgment.test(s)&&(!timing.test(s)||/该不该|应不应该|要不要|能不能|能否|值得|是否适合/.test(s)||/适合.{1,12}(?:跳槽|读博|创业|工作|申请|结婚).*(?:什么时候|哪天)/.test(s)));
 const sameClause=clauses.some(s=>judgment.test(s)&&period.test(s));
 const sharedPeriod=/^(?:回顾|复盘|过去)?(?:我)?(?:今年|明年|近期|最近|\d{4}年)[，,；;、\s]/.test(text)||reasonCode==='context_continuation';
 if(decision&&(explicit||sameClause||sharedPeriod&&period.test(text)))return result('decision_with_timing',reasonCode==='context_continuation'?reasonCode:explicit?'decision_and_when':'decision_in_period');
 if(explicit&&!decision)return result('timing','explicit_when');
 return result('general',decision?'decision_without_period':reasonCode);
}
