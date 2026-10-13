import {estimateTokens,modelContextWindow} from './context-capacity';
import type {Connection} from './providers/config';

/** Compact optional conversation material before touching the current task or its computed evidence. */
export function fitAnalysisContext(input:Record<string,any>,connection:Connection|undefined,reservedOutputTokens:number){
 const context=structuredClone(input),window=connection?modelContextWindow(connection).windowTokens:null;
 const budget=Math.max(0,Math.min(90000,window===null?90000:window-reservedOutputTokens-8000));
 const before=estimateTokens(JSON.stringify(context));
 let removedHistory=0,removedCards=0;
 const measure=()=>estimateTokens(JSON.stringify(context));
 const dialogue=context.dialogue||{};
 while(measure()>budget&&(dialogue.recent?.length||context.history?.length)){
  if(dialogue.recent?.length)dialogue.recent.shift();else context.history.shift();removedHistory++;
 }
 const memory=context.personalMemory;
 const pruneMemoryFacts=()=>{
  const bindings=memory.cards.flatMap((c:any)=>[c.binding,...(c.taskEntries||[]).map((e:any)=>e.binding)]).filter(Boolean);
  const refs=new Set(bindings.flatMap((b:any)=>[b.natalRef,b.decadalRef,b.yearlyRef,b.monthlyRef,b.dailyRef].filter(Boolean)));
  for(const fact of memory.facts||[])if(refs.has(fact.id)&&fact.natalPalaceRef)refs.add(fact.natalPalaceRef);
  memory.facts=(memory.facts||[]).filter((f:any)=>refs.has(f.id));
 };
 // Remove the abandoned card's exclusive facts before measuring again; otherwise their old
 // size can force every remaining card out even when one removal was already sufficient.
 while(measure()>budget&&memory?.cards?.length){memory.cards.pop();removedCards++;pruneMemoryFacts();}
 if(measure()>budget&&memory?.conversationSummary?.length>1600)memory.conversationSummary=memory.conversationSummary.slice(0,1000)+'（旧摘要已节选，原始记录可回查）'+memory.conversationSummary.slice(-600);
 if(measure()>budget&&context.feedback?.length)context.feedback=[];
 const after=measure();
 context.contextRetention={beforeTokensEstimate:before,afterTokensEstimate:after,budgetTokens:budget,removedHistory,removedCards,essentialEvidenceRetained:true,overBudget:after>budget};
 return {context,retention:context.contextRetention};
}
