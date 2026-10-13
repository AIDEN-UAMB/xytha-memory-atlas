import {AsyncLocalStorage} from 'node:async_hooks';
import {measureContext,estimateTokens,type ContextCapacity} from './context-capacity';
import type {Connection} from './providers/config';
import type {CallOptions} from './providers/transport';

type ContextObserver={emit:(value:ContextCapacity)=>void;latest?:ContextCapacity};
const observers=new AsyncLocalStorage<ContextObserver>();
export function withContextTelemetry<T>(emit:ContextObserver['emit'],run:()=>Promise<T>){return observers.run({emit},run);}
export function currentContextCapacity(){return observers.getStore()?.latest;}
export function publishContextCapacity(value:ContextCapacity){const observer=observers.getStore();if(observer){observer.latest=value;observer.emit(value);}}
export function observeModelContext(c:Connection,instructions:string,data:unknown,tokens:number,options:CallOptions){
 let value=measureContext(c,instructions,data,tokens,options.stage||'answer');
 const publish=(patch:Partial<ContextCapacity>)=>{value={...value,...patch};publishContextCapacity(value);};
 return {options:{...options,beforeRequest:()=>{options.beforeRequest?.();publish({state:'prepared'});},onActivity:(activity)=>{publish({state:'generating',outputTokensEstimate:activity.outputTokensEstimate??Math.ceil(activity.characters/4)});options.onActivity?.(activity);},onUsage:(usage)=>{publish({inputTokensActual:usage.inputTokens,outputTokensActual:usage.outputTokens});options.onUsage?.(usage);}} as CallOptions,
 complete:(text:string)=>publish({state:'completed',outputTokensEstimate:estimateTokens(text)})};
}
