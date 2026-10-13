import type {Scope} from './chart-model';
import type {Evidence} from './workflow';

export const MISSING_KNOWLEDGE='本知识库对该组合尚无已审校解释';
export type KnowledgeEntry={id:string;entryVersion:number;key:{star:string;palace:string};confidence:'reviewed'|'draft';applicability:{scope:Scope[]};interpretation:{core:string};review:{reviewer:string|null;reviewedAt:string|null}};
export type KnowledgeUse={knowledgeRef:string;evidenceId:string;scope:Scope;star:string};
// P0-A provides the contract only. No example or generated entry is silently promoted to reviewed.
export const knowledgeCatalog:readonly KnowledgeEntry[]=[];
export const MAIN_STARS=new Set(['紫微','天机','太阳','武曲','天同','廉贞','天府','太阴','贪狼','巨门','天相','天梁','七杀','破军']);
export const KNOWLEDGE_VERSION='p0a-empty';
export const aux_unverified_interpretation=false;

/** Step F: membership in the injected catalogue AND matching evidence/scope/placement are mandatory. */
export function knowledgeReferenceIssues(uses:KnowledgeUse[],catalog:readonly KnowledgeEntry[],evidence:Evidence[]){
 const issues:string[]=[],entries=new Map(catalog.map(k=>[k.id,k])),facts=new Map(evidence.map(e=>[e.id,e]));
 const seen=new Set<string>();
 for(const use of uses){
  const key=`${use.knowledgeRef}/${use.evidenceId}/${use.star}`;
  if(seen.has(key))issues.push('KNOWLEDGE_REF_DUPLICATE');seen.add(key);
  const entry=entries.get(use.knowledgeRef),fact=facts.get(use.evidenceId);
  if(!entry){issues.push('KNOWLEDGE_REF_NOT_INJECTED');continue;}
  if(entry.confidence!=='reviewed'||!entry.review.reviewer||!entry.review.reviewedAt)issues.push('KNOWLEDGE_REF_UNREVIEWED');
  if(!fact){issues.push('KNOWLEDGE_EVIDENCE_MISSING');continue;}
  if(use.scope!==fact.scope||!entry.applicability.scope.includes(use.scope))issues.push('KNOWLEDGE_SCOPE_MISMATCH');
  if(entry.key.star!==use.star||entry.key.palace!==fact.scopePalace||!fact.stars.some(s=>s.name===use.star))issues.push('KNOWLEDGE_PLACEMENT_MISMATCH');
 }
 return [...new Set(issues)];
}
