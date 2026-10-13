import {normalizeGuardText,type FrameworkDraft,type GuardIssue} from './contracts';

export type SourceExcerpt={sourceId:string;title:string;locator:string;url:string|null;text:string;origin:'tool'|'user'};
export type ReferenceResult={refId:string;status:'generic'|'unverified'|'text_matched';title:string|null;locator:string|null;sourceId:string|null;hash:string|null;origin:'tool'|'user'|null};
const hasLocator=(s:string|null,title:string|null)=>!!s&&s.trim()!==title&&!/^(?:相关章节|某章|某页|见原文|待核实|未知|null|全书|原文)$/u.test(s.trim())&&/(?:第?.{1,20}[章节卷篇页]|[Pp]\.?\s*\d|§\s*\d|条目[:：])/u.test(s);
const plain=(s:string)=>normalizeGuardText(s).replace(/[“”「」『』"《》]/gu,'');
const sha256=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');

/** Excerpts come only from an already-authorized tool or user source. This guard fetches nothing.
 * A locator is NOT verification. A server digest proves bytes, never prediction validity.
 */
export async function referenceGuard(draft:FrameworkDraft,excerpts:readonly SourceExcerpt[]=[]){
 const issues:GuardIssue[]=[],references:ReferenceResult[]=[],seen=new Set<string>();
 for(const r of draft.references){
  if(seen.has(r.refId))issues.push({guard:'reference',code:'REFERENCE_DUPLICATE',blockId:null});seen.add(r.refId);
  if(r.sourceId!==null||r.hash!==null)issues.push({guard:'reference',code:'REFERENCE_MODEL_PROVENANCE',blockId:null});
  const located=hasLocator(r.locator,r.title);
  const actual=located&&r.quote?excerpts.find(x=>x.title===r.title&&x.locator===r.locator&&x.text.includes(r.quote!)&&x.text.length>0):undefined;
  references.push({refId:r.refId,status:actual?'text_matched':located?'unverified':'generic',title:located?r.title:null,locator:located?r.locator:null,sourceId:actual?.sourceId??null,hash:actual?await sha256(actual.text):null,origin:actual?.origin??null});
 }
 const blocks=draft.blocks.map(b=>{
  if(b.kind==='chart_fact')return b;
  let text=b.text;
  // Capture original language for health checks upstream: weakening attribution never clears a redline.
  for(const r of draft.references){
   const result=references.find(x=>x.refId===r.refId)!;
   text=text.split(`{ref:${r.refId}}`).join(result.status==='text_matched'?`原文线索（${r.refId}）`:'传统说法');
   if(result.status!=='text_matched'&&r.quote)text=text.split(r.quote).join(plain(r.quote));
  }
  if(/\{ref:/u.test(text))issues.push({guard:'reference',code:'REFERENCE_SLOT_UNKNOWN',blockId:b.id});
  // Unregistered book attributions are also downgraded; a model cannot hide them outside references[].
  text=text.replace(/(?:据|根据|依照|参照)?《[^》\n]{1,200}》(?:所述|记载|指出|认为|有言|说)?[：:]?/gu,'传统说法：');
  if(text!==b.text)text=plain(text); // do not leave a fabricated direct quotation presented as an original
  return {...b,text};
 });
 return {draft:{...draft,blocks},references,issues};
}
