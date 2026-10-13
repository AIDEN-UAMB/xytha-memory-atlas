import {MAIN_STARS} from './knowledge-contract';
import {scopeOrder,type ChartData,type Scope} from './chart';
import type {Evidence,Answer} from './workflow';
import type {WorkflowObservation} from './workflow-observation';
import type {QuestionRoute} from './question-type';
import type {TimingSnapshot} from './timing';

export const OBSERVATION_VERSION='p0b-observation.1';
export const observationEnabled=(env:Record<string,unknown>)=>env.XYTHA_DEMAND_OBSERVATION_V1!=='false';
export const OBSERVATION_RETENTION_DAYS=90;
export const SUMMARY_COLUMNS=['version','created_at','owner','request_id','profile_id','profile_revision','route','reason_code','domain','domain_source','outcome','delivery_state','first_t2','facts_conditional','actual_calls','input_chars','query_started','query_complete','cohort'] as const;
export const DEMAND_COLUMNS=['owner','request_id','scope','scope_palace','main_star','purpose','target','expanded','injected','cited','modifiers'] as const;
export type DemandPurpose='general'|'decision'|'timing_scan';
export type DemandModifier={sourceScope:Scope;value:string};
export type DemandRow={owner:string;request_id:string;scope:Scope;scope_palace:string;main_star:string;purpose:string;target:number;expanded:number;injected:number;cited:number;modifiers:string};
export type SummaryRow={version:string;created_at:string;owner:string;request_id:string;profile_id:string;profile_revision:number;route:string;reason_code:string;domain:string;domain_source:string;outcome:string;delivery_state:string;first_t2:string;facts_conditional:number|null;actual_calls:number;input_chars:number;query_started:number;query_complete:number;cohort:'production'|'test'};
const palaces=new Set(['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','交友','官禄','田宅','福德','父母']);
const canonicalPalace=(s:string)=>s==='仆役'||s==='仆役宫'?'交友':s==='命宫'?s:s.replace(/宫$/,'');
const key=(scope:string,palace:string,star:string)=>JSON.stringify([scope,palace,star]);
const domains=[['career',/工作|职业|事业|跳槽|升职|入职|上班|副业|创业/],['relationship',/感情|恋爱|婚姻|结婚|伴侣|夫妻|领证/],['wealth',/财运|财富|财务|投资|股票|收入|资金|赚钱|变现/],['education',/读博|博士|硕士|深造|学业|升学|申请/],['health',/健康|身体|睡眠|作息|症状/]] as const;
export function observationDomain(goal:string,event?:QuestionRoute['eventType']){
 const found=domains.filter(([,re])=>re.test(goal)).map(([name])=>name as string);
 if(!found.length&&event&&event!=='general')found.push(event==='application'?'education':event);
 return {domain:JSON.stringify(found.length?found:['unknown']),domain_source:'rules.1'};
}

/** A side channel only. Never include this object in a prompt, message meta, or chart output. */
export class DemandObservation{
 readonly summary:SummaryRow;
 private rows=new Map<string,DemandRow>();
 private pending=0;
 private incomplete=false;
 private ledger?:WorkflowObservation;
 private hasConnection:boolean;
 constructor(args:{owner:string;requestId:string;profileId:string;profileRevision:number;hasConnection:boolean;cohort?:'production'|'test';now?:string}){
  this.hasConnection=args.hasConnection;
  this.summary={version:OBSERVATION_VERSION,created_at:args.now||new Date().toISOString(),owner:args.owner,request_id:args.requestId,profile_id:args.profileId,profile_revision:args.profileRevision,route:'unknown',reason_code:'not_routed',domain:'["unknown"]',domain_source:'rules.1',outcome:'unknown',delivery_state:'not_saved',first_t2:'not_attempted',facts_conditional:null,actual_calls:0,input_chars:0,query_started:0,query_complete:0,cohort:args.cohort||'production'};
 }
 route(route:QuestionRoute,actual=route.questionType){
  this.summary.route=actual;this.summary.reason_code=route.reasonCode;
  this.summary.version=OBSERVATION_VERSION+'/'+route.version;
  Object.assign(this.summary,observationDomain(route.effectiveQuestion,route.eventType));
 }
 attach(ledger:WorkflowObservation){this.ledger=ledger;}
 begin(){this.summary.query_started=1;this.pending++;}
 end(){if(this.pending>0)this.pending--;else this.incomplete=true;}
 private merge(scope:Scope,palace:string,star:string,purpose:DemandPurpose,target:boolean,expanded:boolean,mods:DemandModifier[]){
  palace=canonicalPalace(palace);
  if(!scopeOrder.includes(scope)||!palaces.has(palace)||!MAIN_STARS.has(star)){this.incomplete=true;return;}
  const id=key(scope,palace,star),existing=this.rows.get(id);
  // The mathematical domain is 5 scopes × 12 palaces × 14 main stars, regardless of scan length.
  if(!existing&&this.rows.size>=840){this.incomplete=true;return;}
  const row=existing||{owner:this.summary.owner,request_id:this.summary.request_id,scope,scope_palace:palace,main_star:star,purpose:'{}',target:0,expanded:0,injected:0,cited:0,modifiers:'[]'};
  // Preserve the role per purpose inside the already-approved field. A scan target must
  // never turn a decision's expanded palace into an actual topic target after deduplication.
  const purposes:Record<string,string[]>=JSON.parse(row.purpose);
  purposes[purpose]=[...new Set([...(purposes[purpose]||[]),...(target?['target']:[]),...(expanded?['expanded']:[])])].sort();
  row.purpose=JSON.stringify(Object.fromEntries(Object.entries(purposes).sort(([a],[b])=>a.localeCompare(b))));
  row.target=Math.max(row.target,Number(target));row.expanded=Math.max(row.expanded,Number(expanded));
  const merged=[...JSON.parse(row.modifiers) as DemandModifier[],...mods];
  row.modifiers=JSON.stringify([...new Map(merged.map(m=>[key(m.sourceScope,m.value,''),m])).values()].sort((a,b)=>scopeOrder.indexOf(a.sourceScope)-scopeOrder.indexOf(b.sourceScope)||a.value.localeCompare(b.value)));
  this.rows.set(id,row);
 }
 record(c:ChartData,items:Evidence[],purpose:DemandPurpose,targets:string[]){
  for(const e of items)for(const s of e.stars){
   if(!MAIN_STARS.has(s.name))continue;
   const mods:DemandModifier[]=[];
   for(const t of s.transformations){
    const source=c.transformationSources[t.scope];
    if(!source||source.id!==t.sourceId||!source.mutations.some(m=>m.id===t.id&&m.star===s.name&&m.palaceIndex===e.index&&m.value===t.value)){this.incomplete=true;continue;}
    mods.push({sourceScope:t.scope,value:t.value});
   }
   this.merge(e.scope,e.scopePalace,s.name,purpose,targets.includes(e.scopePalace),!targets.includes(e.scopePalace),mods);
  }
 }
 timing(c:ChartData,snapshot:TimingSnapshot){
  // A scan reads matching transformation hits, not every main star in every palace of the reader.
  for(const layer of snapshot.layers)for(const hit of layer.hits){
   if(!MAIN_STARS.has(hit.star))continue;
   const source=c.transformationSources[layer.scope];
   if(source.id!==hit.sourceId||hit.scope!==layer.scope||!source.mutations.some(m=>m.id===hit.id&&m.star===hit.star&&m.palaceIndex===hit.palaceIndex&&m.value===hit.value)){this.incomplete=true;continue;}
   this.merge(layer.scope,hit.scopePalace,hit.star,'timing_scan',hit.relation==='同宫',hit.relation!=='同宫',[{sourceScope:hit.scope,value:hit.value}]);
  }
 }
 private mark(items:unknown,field:'injected'|'cited'){
  if(!Array.isArray(items))return;
  for(const e of items){
   if(!e||typeof e!=='object')continue;
   const scope=e.scope,palace=e.scopePalace||e.palace;
   if(typeof palace!=='string'||!Array.isArray(e.stars))continue;
   for(const s of e.stars){const row=this.rows.get(key(scope,canonicalPalace(palace),s.name));if(row)row[field]=1;}
  }
 }
 injected(data:unknown){
  // Runs at the transport boundary; blocked inputs do not claim an injection.
  const d=data as any;if(!d||typeof d!=='object')return;
  if(d.originalTask){this.injected(d.originalTask);return;}
  this.mark(d.evidence,'injected');this.mark(d.decisionEvidence,'injected');
  // Decode equivalent B′-2 tables at the SAME transport boundary; no new stored columns.
  const objects=(t:any)=>t?.columns&&Array.isArray(t.rows)?t.rows.map((r:any[])=>Object.fromEntries(t.columns.map((k:string,i:number)=>[k,r[i]]))):[];
  if(d.evidence?.columns)this.mark(objects(d.evidence).map((e:any)=>({...e,stars:objects(e.stars)})),'injected');
  if(d.decisionEvidence?.columns)this.mark(objects(d.decisionEvidence).map((e:any)=>({scope:e.queryScope,palace:e.scopePalace,stars:e['stars(ref,star,brightness,transformationRefs)'].map((s:any[])=>({name:s[1]}))})),'injected');
  const windows=d.timing?.windows;
  if(windows?.columns)for(const h of windows.hits||[]){const row=this.rows.get(key(h[0],h[5],h[1]));if(row)row.injected=1;}

  for(const w of Array.isArray(d.timing?.windows)?d.timing.windows:[])for(const snapshot of [w.monthly,...(w.days||[])])for(const layer of snapshot?.layers||[])for(const h of layer.hits||[]){
   const row=this.rows.get(key(layer.scope,h.scopePalace,h.star));if(row)row.injected=1;
  }
 }
 answer(answer:Answer){
  if(answer.observation)this.ledger=answer.observation;
  // 'cited' is retained answer Evidence, not a claim that every listed star appears in prose.
  this.mark(answer.evidence,'cited');
  if(this.summary.outcome==='unknown')this.summary.outcome=answer.mode==='llm'?'model':'rules';
 }
 finish(delivery:'saved'|'emitted'|'failed'|'cancelled',failure?:'failed'|'cancelled'|'validation'){
  const o=this.ledger;
  if(o){
   this.summary.route=o.route;this.summary.reason_code=o.reasonCode;
   this.summary.version=OBSERVATION_VERSION+'/'+o.routeVersion;
   this.summary.actual_calls=o.actualCalls;this.summary.input_chars=o.inputChars;
   this.summary.first_t2=o.firstT2||'not_attempted';
   this.summary.facts_conditional=o.factsConditional===undefined?null:Number(o.factsConditional);
   if(o.outcome)this.summary.outcome=o.outcome;
  }
  if(failure)this.summary.outcome=failure;
  else if(!this.hasConnection&&this.summary.outcome==='rules')this.summary.outcome='no_connection';
  this.summary.delivery_state=delivery;
  this.summary.query_complete=Number(!!this.summary.query_started&&!this.pending&&!this.incomplete);
  return {summary:{...this.summary},rows:[...this.rows.values()].map(r=>({...r}))};
 }
}
