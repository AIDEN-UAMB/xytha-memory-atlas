import {generateText} from './providers/client';
import type {Connection} from './providers/config';
import type {Activity} from './providers/transport';
import {phaseCall,WorkflowContinuation} from './workflow-phase';
import type {CallLedger,CallAttempt,StageId} from './workflow-observation';

/** Same natural-language output and no added reviewer. Only execution bookkeeping changes. */
export async function directAnswer(args:{connection:Connection;instructions:string;data:unknown;tokens:number;signal?:AbortSignal;ledger:CallLedger;stageId:StageId;onActivity?:(a:Activity)=>void}){
 let attempt:CallAttempt|undefined;const started=Date.now();
 const begin=()=>{attempt=args.ledger.start(args.stageId,args.connection.model,1,args.instructions.length+JSON.stringify(args.data).length,0,true);};
 try{
  const response=await phaseCall({model:{...args.connection,key:undefined},instructions:args.instructions,data:args.data,tokens:args.tokens,stage:'direct-answer'},
   ()=>generateText(args.connection,args.instructions,args.data,args.signal,args.tokens,{stage:'answer',beforeRequest:begin,onActivity:args.onActivity}),begin,
   (_raw,_invalid,duration)=>args.ledger.finishAttempt(attempt,Date.now()-duration));
  args.ledger.finishAttempt(attempt,response.durationMs===undefined?started:Date.now()-response.durationMs,undefined,response.replayed);
  return response.raw as string;
 }catch(error){if(!(error instanceof WorkflowContinuation))args.ledger.finishAttempt(attempt,started,'DIRECT_CALL_FAILED');throw error;}
}
