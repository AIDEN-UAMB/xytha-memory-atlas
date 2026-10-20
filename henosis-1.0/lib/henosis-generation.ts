import {generateJSON,generateText,ProviderConnectionError,supportsGLMReasoningEffort,type CallOptions} from './providers/client';
import {completionMetadata,type ProviderCompletion,type ProviderUsage} from './providers/transport';
import type {Connection} from './providers/config';
import {estimateTokens} from './context-capacity';
import {ModelOutputError} from './providers/output';
import {henosisModelCapacity} from './henosis-capabilities';

// These are application ceilings, not claims about every provider's output limit.
// GLM 5.2: https://docs.bigmodel.cn/cn/guide/start/concept-param
// Retry whole structured responses only on an explicit output-token stop reason:
// https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
// A task writer has a smaller contract than whole-answer synthesis. Let it try
// with a bounded first budget; length recovery switches strategy and retains
// the full evidence rather than spending another long reasoning-only response.
const stageCaps=(phase:string)=>phase==='answer_batch'?{initial:32768,maximum:32768}:phase.startsWith('answer_task_')||phase.startsWith('answer_part_')?{initial:8192,maximum:32768}:phase.startsWith('refine_plan')||phase.startsWith('answer')?{initial:16384,maximum:32768}:{initial:8192,maximum:16384};
const outputLimitReasons=new Set(['length','max_tokens','max_output_tokens','MAX_TOKENS']);
export const isOutputTokenLimit=(completion?:ProviderCompletion)=>!!completion?.finishReason&&outputLimitReasons.has(completion.finishReason);
export function henosisGenerationBudget(connection:Connection,phase:string,inputTokensEstimate=0,expanded=false){
 const capacity=henosisModelCapacity(connection),windowTokens=capacity.windowTokens??32768;
 const marginTokens=Math.max(1024,Math.floor(windowTokens*.08));
 const caps=stageCaps(phase),initial=Math.min(caps.initial,Math.max(512,Math.floor(windowTokens*.25)));
 const inputBudget=Math.max(0,Math.min(60000,windowTokens-marginTokens-initial));
 const available=Math.max(0,windowTokens-marginTokens-inputTokensEstimate);
 return {windowTokens,windowSource:capacity.windowSource,applicationFallback:capacity.windowTokens===null,marginTokens,inputBudget,outputCap:Math.min(expanded?caps.maximum:initial,available)};
}
export type HenosisGenerationAttempt=ProviderCompletion&{
 attempt:number;phase:string;status:'started'|'completed'|'failed';outputCap:number;
 inputTokensEstimate:number;windowTokens:number;marginTokens:number;
 thinking:Connection['thinking'];reasoningEffort?:'high';errorCode:string|null;
};
type Journal={version:1;phase:string;attempts:HenosisGenerationAttempt[]};
const MAX_STAGE_ATTEMPTS=3;
const recoverableTimeoutCodes=new Set(['PROVIDER_FIRST_BYTE_TIMEOUT','PROVIDER_IDLE_TIMEOUT','PROVIDER_TOTAL_TIMEOUT']);
export const isRecoverableHenosisTimeout=(error:unknown)=>error instanceof ProviderConnectionError&&recoverableTimeoutCodes.has(error.code);
// Only resource/format failures can change strategy. Never reinterpret refusal,
// cancellation, authentication, networking or an unknown exception as success.
export const isHenosisResourceFailure=(error:unknown)=>error instanceof ModelOutputError||error instanceof ProviderConnectionError&&(
 isRecoverableHenosisTimeout(error)||['HENOSIS_OUTPUT_LIMIT','HENOSIS_GENERATION_LIMIT','PROVIDER_TOO_LARGE','PROVIDER_STREAM_FRAME_TOO_LARGE','HENOSIS_CONTEXT_BUDGET','HENOSIS_REQUEST_BUDGET'].includes(error.code)||
 error.code==='PROVIDER_INCOMPLETE'&&isOutputTokenLimit(error.completion));
export function henosisStageLabel(phase:string){
 if(phase==='initial_plan_repair')return '初始问题规划修复';
 if(phase==='refine_plan_repair')return '补充规划修复';
 if(phase==='initial_plan')return '初始问题规划';
 if(phase==='refine_plan')return '补充规划';
 if(phase.startsWith('compress'))return '证据压缩';
 if(phase.startsWith('answer'))return phase.includes('repair')?'回答结构修复':'整合回答';
 return '分析阶段';
}
export class HenosisGenerationLimitError extends ProviderConnectionError {
 constructor(public phase:string,public attempts:HenosisGenerationAttempt[]){
  const length=isOutputTokenLimit(attempts.at(-1)),label=henosisStageLabel(phase);
  super(`${label}${length?'在有限恢复后仍未完整输出':'已达到本次请求的执行次数上限'}；已完成阶段保留。请调整问题或模型后正常发送新请求。`,length?'HENOSIS_OUTPUT_LIMIT':'HENOSIS_GENERATION_LIMIT',attempts.at(-1));
 }
}
type Args={connection:Connection;instructions:string;data:unknown;phase:string;json:boolean;cacheKey:string;signal?:AbortSignal;
 beforeAttempt?:(request:{inputTokensEstimate:number;outputCap:number})=>number|void;
 options?:CallOptions;validate?:(value:any)=>void;
 load:<T>(name:string)=>Promise<T|undefined>;save:(name:string,value:unknown)=>Promise<void>;
 onAttempt?:(attempt:HenosisGenerationAttempt)=>void;onAttemptUpdate?:(attempt:HenosisGenerationAttempt)=>void;onRetry?:(cap:number)=>void;
 onTimeoutRecovery?:(code:string,directSynthesis:boolean)=>void;};
export async function generateHenosisStage(args:Args){
 const name='generation_'+args.cacheKey,previous=await args.load<Journal>(name);
 const journal:Journal=previous??{version:1,phase:args.phase,attempts:[]},attemptLimit=args.phase==='answer_batch'||args.phase.startsWith('answer')&&args.phase.endsWith('_repair')?1:args.phase.startsWith('answer')?MAX_STAGE_ATTEMPTS:2;
 if(journal.version!==1||journal.phase!==args.phase||!Array.isArray(journal.attempts)||journal.attempts.length>attemptLimit)throw new ProviderConnectionError('阶段恢复记录无效，请正常发送新请求。','HENOSIS_GENERATION_STATE');
 if(journal.attempts.length>=attemptLimit)throw new HenosisGenerationLimitError(args.phase,journal.attempts);
 const inputTokensEstimate=estimateTokens(args.instructions+'\n'+JSON.stringify(args.data));
 if(inputTokensEstimate>60000)throw new ProviderConnectionError('本阶段必要资料超过输入预算，问题和已完成阶段保留。','HENOSIS_CONTEXT_BUDGET');
 while(journal.attempts.length<attemptLimit){
  args.signal?.throwIfAborted();
  const prior=journal.attempts.at(-1),priorTimedOut=!!prior&&recoverableTimeoutCodes.has(prior.errorCode||''),timeoutRecovery=args.phase.startsWith('answer')&&journal.attempts.some(attempt=>recoverableTimeoutCodes.has(attempt.errorCode||''));
  // Supplement routing returns missing query coordinates, not an analysis of the
  // user. Spend the user's requested thinking budget on the actual answer.
  const mechanical=args.phase==='refine_plan'||args.phase.endsWith('_repair')||args.phase.startsWith('compress')||/^answer_part_.+_0$/.test(args.phase);
  // Initial routing extracts bounded fields; deep interpretation happens after
  // the engine supplies facts. Do not spend a full reasoning pass on this schema.
  const direct=args.phase==='initial_plan'||mechanical||timeoutRecovery||journal.attempts.some(a=>isOutputTokenLimit(a));
  const activeConnection=direct?{...args.connection,thinking:'disabled' as const}:args.connection;
  const expanded=isOutputTokenLimit(prior),budget=henosisGenerationBudget(activeConnection,args.phase,inputTokensEstimate,expanded);
  const allowance=args.beforeAttempt?.({inputTokensEstimate,outputCap:budget.outputCap});
  if(typeof allowance==='number')budget.outputCap=Math.min(budget.outputCap,allowance);
  if(budget.outputCap<512)throw new ProviderConnectionError('本阶段输入与输出所需容量超过模型窗口，问题和已完成阶段保留。','HENOSIS_CONTEXT_BUDGET');
  if(expanded&&budget.outputCap<=prior!.outputCap)throw new HenosisGenerationLimitError(args.phase,journal.attempts);
  // Reserve explicit high effort for semantic planning and the first synthesis.
  // Formatting/compression use direct output; semantic planning and the first
  // synthesis keep the user's reasoning setting. Length recovery changes strategy.
  const highReasoning=['initial_plan','refine_plan','answer'].includes(args.phase);
  const reasoningEffort=highReasoning&&activeConnection.thinking==='enabled'&&supportsGLMReasoningEffort(activeConnection)?'high' as const:undefined;
  const attempt:HenosisGenerationAttempt={attempt:journal.attempts.length+1,phase:args.phase,status:'started',outputCap:budget.outputCap,inputTokensEstimate,windowTokens:budget.windowTokens,marginTokens:budget.marginTokens,thinking:activeConnection.thinking,reasoningEffort,finishReason:null,tokenUsage:null,errorCode:null};
  journal.attempts.push(attempt);
  // Persist the attempt before sending: reconnecting cannot reset this stage's cap.
  // Only bounded metadata is stored; no prompts, partial text, hidden reasoning or keys.
  await args.save(name,journal);
  if(expanded)args.onRetry?.(budget.outputCap);
  if(priorTimedOut&&args.phase.startsWith('answer'))args.onTimeoutRecovery?.(prior!.errorCode||'PROVIDER_TIMEOUT',activeConnection.thinking==='disabled');
  let usage:ProviderUsage|undefined;
  const options:CallOptions={...args.options,requireComplete:true,reasoningEffort,
   beforeRequest:()=>{args.options?.beforeRequest?.();args.onAttempt?.({...attempt});},
   onUsage:value=>{usage={...usage,...Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined))};attempt.tokenUsage=completionMetadata(null,usage).tokenUsage;args.onAttemptUpdate?.({...attempt});args.options?.onUsage?.(value);},
   onCompletion:value=>{attempt.finishReason=value.finishReason;if(value.tokenUsage)attempt.tokenUsage={...attempt.tokenUsage,...Object.fromEntries(Object.entries(value.tokenUsage).filter(([,v])=>v!==undefined))};args.onAttemptUpdate?.({...attempt});args.options?.onCompletion?.(value);}};
  try{
   const value=args.json?await generateJSON(activeConnection,args.instructions,args.data,args.signal,budget.outputCap,options):await generateText(activeConnection,args.instructions,args.data,args.signal,budget.outputCap,options);
   args.validate?.(value);args.signal?.throwIfAborted();attempt.status='completed';await args.save(name,journal);
   return {value,attempts:journal.attempts};
  }catch(error){
   attempt.status='failed';attempt.errorCode=error instanceof ProviderConnectionError?error.code:args.signal?.aborted?'PROVIDER_CANCELLED':'HENOSIS_STAGE_FAILED';
   if(error instanceof ProviderConnectionError&&error.completion){attempt.finishReason=error.completion.finishReason;attempt.tokenUsage=error.completion.tokenUsage??attempt.tokenUsage;}
   attempt.tokenUsage=attempt.tokenUsage??completionMetadata(null,usage).tokenUsage;
   await args.save(name,journal);
   if(isRecoverableHenosisTimeout(error)&&args.phase.startsWith('answer')&&journal.attempts.length<attemptLimit)continue;
   // Refusal, invalid JSON, abort and network failures never auto-retry.
   if(!(error instanceof ProviderConnectionError)||error.code!=='PROVIDER_INCOMPLETE'||!isOutputTokenLimit(error.completion))throw error;
   if(journal.attempts.filter(a=>isOutputTokenLimit(a)).length>=2||journal.attempts.length>=attemptLimit)throw new HenosisGenerationLimitError(args.phase,journal.attempts);
  }
 }
 throw new HenosisGenerationLimitError(args.phase,journal.attempts);
}
