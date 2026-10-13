import {currentContextCapacity,publishContextCapacity} from './context-telemetry';
import type {ContextCapacity} from './context-capacity';
import {AsyncLocalStorage} from 'node:async_hooks';
import {ModelOutputError} from './providers/output';
export class WorkflowContinuation extends Error{constructor(public completedCalls:number){super('WORKFLOW_CONTINUE');}}
export type PhaseEntry={contextCapacity?:ContextCapacity;digest:string;durationMs:number;raw?:unknown;invalidJSON?:string};
export type PhaseState={version:1;startedAt:number;snapshot:any;entries:PhaseEntry[];contexts?:Record<string,unknown>};
type Runner={state:PhaseState;persist:()=>Promise<void>;requestId:string;cursor:number};
const active=new AsyncLocalStorage<Runner>();
export function withWorkflowPhase<T>(runner:Omit<Runner,'cursor'>,fn:()=>Promise<T>){return active.run({...runner,cursor:0},fn);}
export function currentPhaseReplay(){const r=active.getStore();return !!r&&r.cursor<r.state.entries.length;}
/** Freeze non-model retrieval with the next saved model result; replay sees the same task input. */
export async function phaseContext<T>(key:string,build:()=>Promise<T>):Promise<T>{
 const r=active.getStore();if(!r)return build();
 const contexts=r.state.contexts||(r.state.contexts={});
 if(Object.prototype.hasOwnProperty.call(contexts,key))return structuredClone(contexts[key]) as T;
 const value=await build();
 if(Object.keys(contexts).length>=6||new TextEncoder().encode(JSON.stringify(value)).byteLength>160000)throw Error('PHASE_CONTEXT_BUDGET');
 contexts[key]=structuredClone(value);return value;
}
/** One actual provider attempt per HTTP phase. Persist BEFORE yielding. Replays reconstruct
 * the same checks and global ledger; they never make the same provider request again.
 */
export async function phaseCall(signature:unknown,request:()=>Promise<unknown>,replayStart:()=>void,completed?:(raw:unknown,invalidJSON:string|undefined,durationMs:number)=>void){
 const r=active.getStore();if(!r)return {raw:await request(),invalidJSON:undefined,durationMs:undefined,replayed:false};
 const index=r.cursor++;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(signature)));
 const digest=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
 const saved=r.state.entries[index];
 if(saved){
  if(saved.digest!==digest)throw Error('续接上下文已变化，问题已保留，请重新发送。');
  replayStart();if(saved.contextCapacity)publishContextCapacity({...saved.contextCapacity,replayed:true});return {raw:saved.raw,invalidJSON:saved.invalidJSON,durationMs:saved.durationMs,replayed:true};
 }
 if(index!==r.state.entries.length||index>=7)throw Error('续接阶段超出处理预算。');
 const started=Date.now();let raw:unknown,invalidJSON:string|undefined;
 try{raw=await request();}catch(e){if(!(e instanceof ModelOutputError))throw e;invalidJSON=e.raw;}
 r.state.entries.push({contextCapacity:currentContextCapacity(),digest,durationMs:Date.now()-started,...(invalidJSON!==undefined?{invalidJSON}:{raw})});
 completed?.(raw,invalidJSON,Date.now()-started);
 await r.persist();
 console.info(JSON.stringify({event:'workflow_phase_saved',requestId:r.requestId,ordinal:index+1,durationMs:Date.now()-started}));
 throw new WorkflowContinuation(r.state.entries.length);
}
