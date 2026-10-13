import {ProviderConnectionError} from './providers/transport';
export type StageId='G1'|'G2'|'G3'|'G4'|'G5'|'T1'|'T2'|'T3';
export type CallAttempt={ordinal:number;stage:StageId;model:string;formatAttempt:number;inputChars:number;durationMs:number;status:'running'|'succeeded'|'failed';code?:string};
export type WorkflowObservation={version:1;requestId?:string;route:string;routeVersion:string;reasonCode:string;maxCalls:number;actualCalls:number;inputChars:number;inputBaselineChars?:number;inputLimitChars?:number;blockedInputChars?:number;attempts:CallAttempt[];outcome?:'model'|'isolated_model'|'rules'|'validation'|'failed'|'cancelled';fallbackReason?:string;firstT2?:'passed'|'failed'|'not_attempted';factsConditional?:boolean;knowledgeCoverage?:{reviewed:number;total:number}};
export class WorkflowBudgetError extends ProviderConnectionError{
 constructor(public dimension:'calls'|'input'){super('已达到本轮处理预算，改用可核对的条件式说明。','WORKFLOW_BUDGET_EXHAUSTED');}
}
/** One ledger per claimed request. Count at the actual transport boundary, including format retries. */
export class CallLedger{
 readonly observation:WorkflowObservation;
 private inputLimit=Infinity;
 private perCallInputLimit=Infinity;
 constructor(route:string,maxCalls:number,requestId?:string,routeVersion='flow-4.8',reasonCode='legacy'){
  this.observation={version:1,requestId,route,routeVersion,reasonCode,maxCalls,actualCalls:0,inputChars:0,attempts:[],firstT2:'not_attempted'};
 }
 get remaining(){return this.observation.maxCalls-this.observation.actualCalls;}
 setInputLimits(perCall:number,total:number){this.perCallInputLimit=perCall;this.inputLimit=total;this.observation.inputBaselineChars=perCall;this.observation.inputLimitChars=total;}
 start(stage:StageId,model:string,formatAttempt:number,inputChars:number,reserve=0,observeInputOnly=false){
  if(this.remaining<=reserve)throw new WorkflowBudgetError('calls');
  if(!observeInputOnly&&(inputChars>this.perCallInputLimit||this.observation.inputChars+inputChars>this.inputLimit)){this.observation.blockedInputChars=inputChars;throw new WorkflowBudgetError('input');}
  const attempt:CallAttempt={ordinal:++this.observation.actualCalls,stage,model,formatAttempt,inputChars,durationMs:0,status:'running'};
  this.observation.inputChars+=inputChars;this.observation.attempts.push(attempt);return attempt;
 }
 finishAttempt(attempt:CallAttempt|undefined,started:number,code?:string,replayed=false){
  if(!attempt)return;
  Object.assign(attempt,{durationMs:Date.now()-started,status:code?'failed':'succeeded',...(code?{code}:{})});
  if(!replayed)console.info(JSON.stringify({event:'workflow_llm_attempt',requestId:this.observation.requestId,route:this.observation.route,...attempt}));
 }
 finish(outcome:WorkflowObservation['outcome'],extra:Partial<WorkflowObservation>={}){
  Object.assign(this.observation,extra,{outcome});
  console.info(JSON.stringify({event:'workflow_request_summary',...this.observation}));
  return this.observation;
 }
}
