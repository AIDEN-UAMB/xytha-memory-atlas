import type {TimingAnalysis,TimingSnapshot} from '../timing';
import type {Transformation} from '../chart-model';
import {generationInstructions,auditInstructions} from './prompts';
export {generationInstructions,auditInstructions};

/** B′-2 equivalent serializer, originally measured offline in B′-1.
 * Facts are tabled without merging scopes. References resolve through a server-side manifest;
 * the model never generates transformation IDs or calculates positions. No history compression.
 */
export function packWindowFacts(analysis:TimingAnalysis){
 const hits:unknown[][]=[],hitKeys=new Map<string,number>(),layers:unknown[][]=[],layerKeys=new Map<string,number>();
 const manifest:{snapshot:string;layer:number;hit:number;transformationId:string;sourceId:string}[]=[];
 const intern=(row:unknown[],rows:unknown[][],keys:Map<string,number>)=>{const key=JSON.stringify(row);if(keys.has(key))return keys.get(key)!;const i=rows.length;rows.push(row);keys.set(key,i);return i;};
 const snapshot=(s:TimingSnapshot)=>{
  const ls=s.layers.map(l=>{
   const index=intern([l.scope,l.label,l.stemBranch,l.focus.map(f=>[f.palace,f.index,f.natalPalace])],layers,layerKeys);
   const hs=l.hits.map(h=>{
    const hit=intern([h.scope,h.star,h.value,h.palaceIndex,h.natalPalace,h.scopePalace,h.relation,h.focusPalace],hits,hitKeys);
    manifest.push({snapshot:s.date,layer:index,hit,transformationId:h.id,sourceId:h.sourceId});
    return hit;
   });
   return [index,hs];
  });
  // Keep computed overlap membership and mixed flags; do not ask the LLM to rescore windows.
  const overlaps=s.overlaps.map(o=>[o.palaceIndex,o.natalPalace,o.mixed,o.hits.map(h=>hitKeys.get(JSON.stringify([h.scope,h.star,h.value,h.palaceIndex,h.natalPalace,h.scopePalace,h.relation,h.focusPalace])))]);
  return [s.date,s.lunar,ls,overlaps,s.supportLayers,s.cautionLayers];
 };
 const windows=analysis.windows.map(w=>[w.id,w.start,w.end,snapshot(w.snapshot),w.days.map(snapshot)]);
 const data={columns:{layer:['sourceScope','label','stemBranch','focus(palace,index,natalPalace)'],hit:['sourceScope','star','value','palaceIndex','natalPalace','scopePalace','relation','focusPalace'],snapshot:['observedOn','lunar','layers(layerRow,hitRows)','overlaps(index,natalPalace,mixed,hitRows)','supportLayers','cautionLayers'],window:['windowId','start','end','snapshot','days']},layers,hits,windows};
 return {data,manifest};
}

export function packDecisionEvidence(evidence:Record<string,any>[],catalog:Record<string,any>[],transformations:Transformation[]){
 let ref=0;
 const sources=new Map(catalog.map((s,i)=>[s.id,`s${i}`]));
 const manifest=evidence.map((e,i)=>({ref:`e${i}`,id:e.id,sourceIds:e.sourceIds}));
 const transformIds=[...new Set<string>(evidence.flatMap(e=>e.stars.flatMap((s:Record<string,any>)=>s.transformations)))];
 const transformationRows=transformIds.map((id,i)=>{const t=transformations.find(t=>t.id===id);if(!t||!sources.has(t.sourceId))throw Error('PACK_TRANSFORMATION_CLOSURE');return [`t${i}`,sources.get(t.sourceId),t.scope,t.star,t.value];});
 const rows=evidence.map((e,i)=>[`e${i}`,e.scope,e.date,e.palace,e.natalPalace,e.relations,e.sourceIds.map((id:string)=>{if(!sources.has(id))throw Error('PACK_SOURCE_CLOSURE');return sources.get(id);}),e.stars.map((s:Record<string,any>)=>[`f${ref++}`,s.name,s.brightness||null,s.transformations.map((id:string)=>`t${transformIds.indexOf(id)}`)])]);
 return {data:{columns:['evidenceRef','queryScope','date','scopePalace','natalPalace','relations','sourceRefs','stars(ref,star,brightness,transformationRefs)'],rows,transformationColumns:['ref','sourceRef','sourceScope','star','value'],transformations:transformationRows},sourceCatalog:catalog.map(s=>({...s,id:sources.get(s.id)})),manifest,sourceManifest:[...sources].map(([id,ref])=>({id,ref})),transformationManifest:transformIds.map((id,i)=>({id,ref:`t${i}`}))};
}
export const outputShape={decision:'{targetId,stance:supports|conditional|not_supported|insufficient_coverage,preferredOptionId:null|id,conditionIds:[],assumptionIds:[]}',blocks:'[{id,kind:chart_fact,factRefs:[]}|{id,kind:traditional_interpretation,subjectRefs:[],text,optionId:null|id}|{id,kind:condition,conditionIds:[],assumptionIds:[],text,optionId:null|id}]; dependsOn:[]可选',windowIds:'[]，最多2项',references:'[{refId,sourceId:null,title:null|string,locator:null|string,url:null|string,quote:null|string,hash:null}]'};

type RowObject=Record<string,unknown>;
type Table={columns:string[];rows:unknown[][]};
function table(items:RowObject[]):Table{
 const columns=items.length?Object.keys(items[0]):[];
 // This is an equivalent representation, not a lossy summarizer. Reject heterogeneous fields.
 if(items.some(item=>Object.keys(item).length!==columns.length||columns.some(k=>!(k in item))))throw Error('FACT_TABLE_HETEROGENEOUS');
 return {columns,rows:items.map(item=>columns.map(k=>item[k]))};
}
function objects(t:Table):RowObject[]{return t.rows.map(row=>Object.fromEntries(t.columns.map((key,i)=>[key,row[i]])));}
/** General-path fact format replacement. Every original field, empty value, relation, source,
 * flowing star and newly assigned ref is recoverable; user/history/memories are untouched.
 */
export function packGeneralEvidence(evidence:RowObject[]){
 return table(evidence.map(e=>({...e,stars:table((e.stars as RowObject[]).map(s=>({...s,transformations:table(s.transformations as RowObject[])})))})));
}
export function unpackGeneralEvidence(data:Table){
 return objects(data).map(e=>({...e,stars:objects(e.stars as Table).map(s=>({...s,transformations:objects(s.transformations as Table)}))}));
}
