import {z} from 'zod';
import type {Scope} from '../chart-model';

// Atomic runtime branch: only enabled by XYTHA_FRAMEWORK_V1=true; old branch retained.
export const CONTRACT_VERSION='bprime.2';
const id=z.string().min(1).max(160);
const ids=z.array(id).max(100);
const text=z.string().trim().min(1).max(2600);
export const stanceSchema=z.enum(['supports','conditional','not_supported','insufficient_coverage']);
const common={id,dependsOn:ids.default([])};
const blockSchema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('chart_fact'),factRefs:ids.min(1)}).strict(),
 z.object({...common,kind:z.literal('traditional_interpretation'),subjectRefs:ids.min(1),text,optionId:id.nullable().default(null),windowId:id.nullable().optional()}).strict(),
 z.object({...common,kind:z.literal('condition'),conditionIds:ids,assumptionIds:ids,text,optionId:id.nullable().default(null)}).strict(),
]);
export const referenceSchema=z.object({refId:id,sourceId:z.null(),title:z.string().max(200).nullable(),locator:z.string().max(300).nullable(),url:z.string().url().max(1000).nullable(),quote:z.string().max(1000).nullable(),hash:z.null()}).strict();
const strictFrameworkDraftSchema=z.object({
 decision:z.object({targetId:id,stance:stanceSchema,preferredOptionId:id.nullable(),conditionIds:ids,assumptionIds:ids}).strict(),
 blocks:z.array(blockSchema).min(1).max(16),
 windowIds:ids.max(2).default([]),references:z.array(referenceSchema).max(8).default([]),
}).strict();
export const frameworkDraftSchema=z.preprocess(value=>{
 const normalized=stripRetiredFields(value).value;
 // Existing structuredCall.normalizeOutput adds claims=[] for answer/repair. This empty legacy
 // compatibility field is inert; non-empty claims and undeclared fields still fail the new schema.
 if(normalized&&typeof normalized==='object'&&!Array.isArray(normalized)){
  const v={...normalized} as Record<string,unknown>;
  if(Array.isArray(v.claims)&&v.claims.length===0)delete v.claims;
  // chart_fact has no model-authored prose in the rendering contract. Discard only its
  // redundant display text, never its references or any unknown provenance fields.
  // This prevents an unnecessary full-model repair for harmless presentation fields.
  if(Array.isArray(v.blocks))v.blocks=v.blocks.map(block=>{
   if(!block||typeof block!=='object'||Array.isArray(block)||block.kind!=='chart_fact')return block;
   const b={...block};delete b.text;delete b.content;return b;
  });
  return v;
 }
 return normalized;
},strictFrameworkDraftSchema);
export type FrameworkDraft=z.infer<typeof strictFrameworkDraftSchema>;
export type FrameworkBlock=FrameworkDraft['blocks'][number];
export type GuardIssue={code:string;blockId:string|null;guard:'fact'|'boundary'|'reference'|'answer'};
export type AnswerContract={targetId:string;targetLabel:string;mustAnswerDecisionFirst:boolean;options:{id:string;label:string}[];conditions:{id:string;text:string;origin:'user'|'assumption';critical:boolean}[];requiredScopes:Scope[];scopeDateSignature:string;question:string;periodComparison?:{topic:string;primaryPalace:string;options:{id:string;label:string;date:string}[];omitted:string[]}};
const check=z.enum(['pass','fail','na']);
export const frameworkAuditSchema=z.object({pass:z.boolean(),checks:z.object({facts:check,boundaries:check,references:check,relevance:check}).strict(),issues:z.array(z.object({code:id,blockId:id.nullable(),severity:z.enum(['blocking','suggestion']).optional()}).strict()).max(12)}).strict();
export type FrameworkAudit=z.infer<typeof frameworkAuditSchema>;
// Only these editorial suggestions are non-blocking. Unknown and fact/boundary issues stay hard.
export const isReviewSuggestion=(i:FrameworkAudit['issues'][number])=>i.severity==='suggestion'&&['STYLE_DETAIL','STYLE_ORDER','EXPLANATION_DEPTH','TRADITIONAL_UNCERTAINTY'].includes(i.code);

/** Only retired, explicitly named fields are removed. A fake factRef is never normalized away. */
export function stripRetiredFields(input:unknown):{value:unknown;removed:number}{
 let removed=0;
 const visit=(v:unknown,depth:number):unknown=>{
  if(depth>30)throw Error('FRAMEWORK_INPUT_DEPTH');
  if(Array.isArray(v))return v.map(x=>visit(x,depth+1));
  if(!v||typeof v!=='object')return v;
  const out:Record<string,unknown>={};
  for(const [k,x] of Object.entries(v)){
   if(['knowledgeRef','knowledgeRefs','materialIds'].includes(k)){removed++;continue;}
   if(k==='__proto__'||k==='constructor'||k==='prototype')throw Error('FRAMEWORK_INPUT_KEY');
   out[k]=visit(x,depth+1);
  }
  return out;
 };
 return {value:visit(input,0),removed};
}
export const normalizeGuardText=(text:string)=>text.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu,'');
export function uniqueIssues(issues:GuardIssue[]){return [...new Map(issues.map(i=>[`${i.guard}:${i.code}:${i.blockId}`,i])).values()];}
