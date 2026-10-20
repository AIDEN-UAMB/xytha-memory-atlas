import type {HenosisGenerationAttempt} from './henosis-generation';
import type {Progress} from './workflow';

export type HenosisUsage = {
  calls:number; inputTokens:number; outputTokens:number; totalTokens:number;
  estimatedTokens:number; missingUsageCalls:number; activeCalls:number;
  scope:'entire_run_including_retries_and_resumes';
};
export type HenosisUsageRow = HenosisGenerationAttempt & {id:string; outputEstimate?:number};
export type HenosisProgress = Progress & {turnUsage?:HenosisUsage};

// Provider usage is a cumulative snapshot for ONE attempt, never a delta.
// Stable attempt IDs also prevent double-counting after resuming a request.
export function summarizeHenosisUsage(rows:HenosisUsageRow[]):HenosisUsage {
  const unique=[...new Map(rows.map(row=>[row.id,row])).values()];
  let inputTokens=0,outputTokens=0,estimatedTokens=0,missingUsageCalls=0,activeCalls=0;
  for(const row of unique){
    const input=row.tokenUsage?.inputTokens,output=row.tokenUsage?.outputTokens;
    inputTokens+=input??0;outputTokens+=output??0;
    if(input===undefined||output===undefined)missingUsageCalls++;
    if(row.status==='started')activeCalls++;
    // Estimates cover transmitted input and visible output only. Hidden reasoning
    // may be billed but cannot be measured until the provider supplies usage.
    if(input===undefined)estimatedTokens+=row.inputTokensEstimate;
    if(output===undefined)estimatedTokens+=row.outputEstimate??0;
  }
  return {calls:unique.length,inputTokens,outputTokens,totalTokens:inputTokens+outputTokens,
    estimatedTokens,missingUsageCalls,activeCalls,scope:'entire_run_including_retries_and_resumes'};
}
