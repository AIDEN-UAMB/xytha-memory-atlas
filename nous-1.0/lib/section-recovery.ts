import {checkEvidence,type StarClaim} from './evidence-check';
import type {Evidence} from './workflow';
export type ReplyBlock={text:string;kind:'chart_fact'|'traditional_interpretation'|'reflection';evidenceIds:string[]};
export type ReplyDraft={blocks:ReplyBlock[];claims:StarClaim[];memoryProposal?:string};

/** Quarantine invalid facts and dependent sections, preserving independent sections for a fresh semantic review. */
export function recoverSections(draft:ReplyDraft,evidence:Evidence[]){
 const rejected=new Map<number,string[]>(),tainted=new Set<string>();
 const starNames=[...new Set(evidence.flatMap(e=>e.stars.map(s=>s.name)))];
 const independent=(block:ReplyBlock)=>block.kind==='reflection'&&!/命盘|盘面|星曜|宫位|命宫|本命|大限|流年|流月|流日|四化|化[禄权科忌]|因此|由此|据此|注定|必然/.test(block.text)&&!starNames.some(s=>block.text.includes(s));
 draft.blocks.forEach((block,index)=>{
  const claims=draft.claims.filter(c=>block.evidenceIds.includes(c.evidenceId));
  const issues=checkEvidence({blocks:[block],claims},evidence);
  if(issues.length){rejected.set(index,issues);block.evidenceIds.forEach(id=>tainted.add(id));}
 });
 const blocks=draft.blocks.flatMap((block,index)=>{
  if(independent(block))return [{...block,evidenceIds:[]}]; // Real-world conditional advice does not inherit another paragraph's malformed claims.
  return !rejected.has(index)&&!block.evidenceIds.some(id=>tainted.has(id))?[block]:[];
 });
 const ids=new Set(blocks.flatMap(b=>b.evidenceIds)),claims=draft.claims.filter(c=>ids.has(c.evidenceId));
 return {draft:{blocks,claims},removed:draft.blocks.length-blocks.length,issues:[...new Set([...rejected.values()].flat())]};
}
