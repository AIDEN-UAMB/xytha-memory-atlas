import type {ChartData,Scope,Transformation,TransformationSource} from '../chart-model';
import {scopeNames,scopeOrder} from '../chart-model';
import type {Evidence} from '../workflow';
import {normalizeGuardText,uniqueIssues,type FrameworkDraft,type FrameworkBlock,type GuardIssue} from './contracts';

export type RequestBinding={requestId:string;owner:string;profileId:string;profileRevision:number;engineVersion:string;config:{algorithm:string;yearDivide:string;horoscopeDivide:string;ageDivide:string;dayDivide:string}};
export type RegisteredFact={ref:string;evidenceId:string;queryScope:Scope;queryLabel:string;date:string;palaceIndex:number;scopePalace:string;natalPalace:string;star:string;brightness:string|null;transformations:(Transformation&{source:Omit<TransformationSource,'mutations'>})[]};
export type RegisteredWindow={id:string;start:string;end:string;days:{date:string}[]};
const bindingKey=(b:RequestBinding)=>JSON.stringify([b.requestId,b.owner,b.profileId,b.profileRevision,b.engineVersion,...(['algorithm','yearDivide','horoscopeDivide','ageDivide','dayDivide'] as const).map(k=>b.config[k])]);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const tKey=(t:Transformation)=>[t.id,t.sourceId,t.scope,t.value,t.star,t.palaceIndex,t.natalPalace,t.scopePalace];
const sourceKey=(s:Omit<TransformationSource,'mutations'>)=>[s.id,s.scope,s.label,s.origin,s.heavenlyStem,s.stemBranch,s.fixed,s.observedOn,s.periodLabel,s.ageRange??null,s.yearRange??null];
const immutable=<T,>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(immutable);Object.freeze(v);}return v;};

/** Trusted iztro snapshots are supplied by the caller; no astrology calculations or cache here.
 * Validate the whole evidence graph against those snapshots BEFORE issuing any short reference.
 * Scope is the queried palace frame; sourceScope is the transformation's independent origin.
 */
export function createFactRegistry(binding:RequestBinding,evidence:Evidence[],charts:ChartData[],windows:RegisteredWindow[]=[],scannedDates:string[]=[]){
 if(!binding.requestId||!binding.owner||!binding.profileId||!Number.isInteger(binding.profileRevision)||Object.values(binding.config).length!==5||Object.values(binding.config).some(v=>!v))throw Error('FACT_BINDING');
 if(!charts.length||charts.some(c=>c.ruleVersion!==binding.engineVersion))throw Error('FACT_ENGINE');
 // A registry cannot combine charts for different birth data, even if palace layouts coincide.
 if(charts.some(c=>!equal(c.birth,charts[0].birth)))throw Error('FACT_PROFILE');
 const byId=new Map<string,RegisteredFact>(),seen=new Set<string>();
 const issuedKey=bindingKey(binding),allowedDates=new Set(scannedDates);
 const windowMap=new Map<string,Readonly<RegisteredWindow>>();
 for(const w of windows){
  if(windowMap.has(w.id)||w.start>w.end||!w.days.length||w.days.some(d=>!allowedDates.has(d.date)||d.date<w.start||d.date>w.end)||new Set(w.days.map(d=>d.date)).size!==w.days.length||!allowedDates.has(w.start)||!allowedDates.has(w.end))throw Error('WINDOW_SCAN_CLOSURE');
  windowMap.set(w.id,immutable(structuredClone(w)));
 }
 for(const e of evidence){
  const identity=`${e.id}:${e.scope}:${e.date}`;
  if(seen.has(identity))throw Error('FACT_EVIDENCE_DUPLICATE');seen.add(identity);
  const c=charts.find(c=>(e.scope==='natal'?c.solarDate:c.target)===e.date);
  const p=c?.palaces[e.index];
  if(!c||!p||!scopeOrder.includes(e.scope)||p.name!==e.natalPalace||(e.scope==='natal'?p.name:c.layers[e.scope].palaceNames[e.index])!==e.scopePalace)throw Error('FACT_PALACE_SCOPE_DATE');
  for(const source of e.sources){
   const actual=c.transformationSources[source.scope];
   if(!actual||!equal(sourceKey(source),sourceKey(actual)))throw Error('FACT_SOURCE_CATALOG');
  }
  const stars=[...p.majorStars,...p.minorStars,...p.adjectiveStars];
  const starNames=new Set<string>();
  for(const s of e.stars){
   if(starNames.has(s.name))throw Error('FACT_STAR_DUPLICATE');starNames.add(s.name);
   const actual=stars.find(x=>x.name===s.name);
   if(!actual||(actual.brightness||null)!==(s.brightness||null))throw Error('FACT_STAR_BRIGHTNESS');
   const expected=e.sources.flatMap(source=>c.transformationSources[source.scope].mutations.filter(t=>t.star===s.name&&t.palaceIndex===p.index));
   if(s.transformations.length!==expected.length||new Set(s.transformations.map(t=>t.id)).size!==s.transformations.length)throw Error('FACT_TRANSFORMATION_CLOSURE');
   const transformations=s.transformations.map(t=>{
    const src=c.transformationSources[t.scope];
    if(!src||!e.sources.some(s=>s.id===t.sourceId)||!expected.some(x=>equal(tKey(x),tKey(t))))throw Error('FACT_TRANSFORMATION_SOURCE');
    const {mutations:_,...source}=src;
    return {...t,source};
   });
   const ref=`f${byId.size}`;
   byId.set(ref,immutable(structuredClone({ref,evidenceId:e.id,queryScope:e.scope,queryLabel:e.scope==='decadal'&&c.layers.decadal.name==='童限'?'童限':scopeNames[e.scope],date:e.date,palaceIndex:e.index,scopePalace:e.scopePalace,natalPalace:e.natalPalace,star:s.name,brightness:s.brightness||null,transformations})));
  }
 }
 return Object.freeze({
  matches:(expected:RequestBinding)=>issuedKey===bindingKey(expected),
  starNames:()=>[...new Set(charts.flatMap(c=>c.palaces.flatMap(p=>[...p.majorStars,...p.minorStars,...p.adjectiveStars].map(s=>s.name))))],
  get:(id:string)=>byId.get(id),all:()=>[...byId.values()] as readonly RegisteredFact[],
  window:(id:string)=>windowMap.get(id),windowIds:()=>[...windowMap.keys()],
 });
}
export type FactRegistry=ReturnType<typeof createFactRegistry>;
export function renderFact(f:RegisteredFact){
 const origin=f.transformations.map(t=>`${t.source.label}·${t.source.scope==='natal'?'生年':t.source.label==='童限四化'?'童限':scopeNames[t.scope]}化${t.value}（${t.source.periodLabel}${t.source.observedOn?`，观察日 ${t.source.observedOn}`:''}）`).join('；');
 return `${f.queryLabel}·${f.scopePalace}（本命${f.natalPalace}，${f.date}）：${f.star}${f.brightness?`[${f.brightness}]`:'[亮度未知]'}${origin?`；${origin}`:''}`;
}
export const blockFactRefs=(b:FrameworkBlock)=>b.kind==='chart_fact'?b.factRefs:b.kind==='traditional_interpretation'?b.subjectRefs:[];

/** Bounded grammar: explicit/raw personal chart facts must use slots, even if accidentally true.
 * It is NOT a proof of the semantics of arbitrary Chinese; independent T2 remains mandatory.
 */
export function rawFactTextIssues(text:string,blockId:string,declared:string[],registry:FactRegistry):GuardIssue[]{
 const issues:GuardIssue[]=[],add=(code:string)=>issues.push({guard:'fact',code,blockId});
 let s=normalizeGuardText(text);
 s=s.replace(/\{fact:([^{}]+)\}/gu,(_,ref:string)=>{if(!declared.includes(ref)||!registry.get(ref))add('FACT_SLOT_CLOSURE');return '该项盘面事实';});
 if(/\{fact:|\bfactRef\b|\bf\d+\b/u.test(s))add('FACT_SLOT_SYNTAX');
 // Do not require membership in known star names: fabricated stars must not bypass this rule.
 const starTerms=registry.starNames().join('|');
 // Require an entity subject. “收入提升…财帛” and “在事业方面…官禄” are not placements.
 // Unknown names ending 星/曜 remain blocked rather than being silently accepted.
 const starSubject=`(?:${starTerms||'(?!)'}|[\\u3400-\\u9fff]{1,5}(?:星|曜))`;
 if(new RegExp(starSubject+'(?:星)?\\s*(?:在|落|坐|居|入|守|位于)[^。；\\n]{0,14}(?:命宫|官禄|财帛|迁移|疾厄|夫妻|父母|子女|交友|兄弟|田宅|福德)','u').test(s))add('FACT_RAW_PLACEMENT');
 if(new RegExp('(?:命宫|官禄|财帛|迁移|疾厄|夫妻|父母|子女|交友|兄弟|田宅|福德)(?:宫)?(?:里|中|内)?(?:有|见|为|：|:|坐落|落着)'+starSubject,'u').test(s))add('FACT_RAW_PLACEMENT');
 for(const star of new Set(registry.starNames())){
  const offset=s.indexOf(star);if(offset<0)continue;
  const tail=s.slice(offset+star.length,offset+star.length+12);
  if(/^(?:为|是|处于|呈|:|：|,|，|\s)*(?:化[禄权科忌]|旺|庙|陷|得地|平地)/u.test(tail))add('FACT_RAW_ATTRIBUTE');
 }
 if(/(?:生年|本命|大限|童限|流年|流月|流日|今年|明年)[^。；\n]{0,28}化[禄权科忌]|化[禄权科忌][^。；\n]{0,12}(?:生年|本命|大限|流年|流月|流日)|(?:本层|自化|宫干飞化)|亮度(?:为|是|变|属)|[\[【](?:庙|旺|得|利|平|陷)[\]】]/u.test(s))add('FACT_RAW_ATTRIBUTE');
 if(/(?:禄|忌|四化)[^。；\n]{0,20}(?:抵消|相抵|覆盖|永久|自带)|(?:系统|引擎|已经)(?:已)?(?:检测|判定|算出)[^。；\n]{0,20}(?:格局|成格)/u.test(s))add('FACT_UNCOMPUTED');
 if(/\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:\d|[一二三四五六七八九十])月(?:\d|[一二三四五六七八九十])+(?:日|号)/u.test(s))add('FACT_RAW_DATE');
 return uniqueIssues(issues);
}
export function factContractIssues(draft:FrameworkDraft,registry:FactRegistry,binding:RequestBinding){
 const issues:GuardIssue[]=[],add=(code:string,blockId:string|null)=>issues.push({guard:'fact',code,blockId});
 if(!registry.matches(binding))add('FACT_REQUEST_BINDING',null);
 const blocks=new Set(draft.blocks.map(b=>b.id));
 if(blocks.size!==draft.blocks.length)add('BLOCK_DUPLICATE',null);
 const seen=new Set<string>();
 for(const b of draft.blocks){
  const refs=blockFactRefs(b);
  if(new Set(refs).size!==refs.length)add('FACT_REF_DUPLICATE',b.id);
  for(const ref of refs)if(!registry.get(ref))add('FACT_REF_UNKNOWN',b.id);
  if(b.kind==='traditional_interpretation'&&b.windowId&&(!draft.windowIds.includes(b.windowId)||!registry.window(b.windowId)))add('WINDOW_BLOCK_CLOSURE',b.id);
  // Only backward dependencies: no missing dependencies, cycles or hidden self-support.
  if(new Set(b.dependsOn).size!==b.dependsOn.length||b.dependsOn.some(id=>!seen.has(id)))add('BLOCK_DEPENDENCY_CLOSURE',b.id);
  if(b.kind!=='chart_fact')issues.push(...rawFactTextIssues(b.text,b.id,refs,registry));
  seen.add(b.id);
 }
 if(new Set(draft.windowIds).size!==draft.windowIds.length||draft.windowIds.some(id=>!registry.window(id)))add('WINDOW_REF_CLOSURE',null);
 return uniqueIssues(issues);
}

export function isolateFactDependencies(draft:FrameworkDraft,issues:GuardIssue[]){
 if(issues.some(i=>i.blockId===null||!draft.blocks.some(b=>b.id===i.blockId)))return {draft:null,removed:draft.blocks.map(b=>b.id)};
 const removed=new Set(issues.map(i=>i.blockId!)),badRefs=new Set(draft.blocks.filter(b=>issues.some(i=>i.blockId===b.id&&i.guard!=='answer')).flatMap(blockFactRefs));
 // Expression/relevance rejection removes its block and explicit dependents. A bad FACT (or
 // boundary violation) also taints shared factRefs. Keep this distinction for window isolation.
 let changed=true;
 while(changed){changed=false;for(const b of draft.blocks)if(!removed.has(b.id)&&(b.dependsOn.some(id=>removed.has(id))||blockFactRefs(b).some(id=>badRefs.has(id)))){removed.add(b.id);blockFactRefs(b).forEach(id=>badRefs.add(id));changed=true;}}
 const blocks=draft.blocks.filter(b=>!removed.has(b.id));
 return {draft:blocks.length?{...draft,blocks}:null,removed:[...removed]};
}
