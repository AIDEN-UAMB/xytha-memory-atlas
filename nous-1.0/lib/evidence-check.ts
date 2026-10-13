import type {referenceIds,Scope} from './chart';
type Evidence=ReturnType<typeof referenceIds>[number];
export type StarClaim={evidenceId:string;star:string;brightness?:string;natalMutagen?:string;layerMutagen?:string;transformationIds?:string[]};
type Block={text:string;kind:string;evidenceIds:string[]};
const aliases:Record<string,Scope>={生年:'natal',本命:'natal',大限:'decadal',童限:'decadal',流年:'yearly',流月:'monthly',流日:'daily'};
export function evidenceIssueCategories(issues:string[]){return [...new Set(issues.map(s=>/亮度/.test(s)?'brightness':/未检索|没有引用/.test(s)?'reference':/缺少.*断言/.test(s)?'claim_missing':/时间层|不能只写本层/.test(s)?'scope_missing':/日期/.test(s)?'date':/来源|四化|童限/.test(s)?'transformation_source':'star_claim'))];}

/** Check declared sources AND common explicit transformation assertions in the visible text.
 * This is a bounded grammar, not a semantic proof; an independent model still reviews every draft.
 */
export function checkEvidence(draft:{blocks:Block[];claims:StarClaim[]},evidence:Evidence[]){
 const errors:string[]=[];const registry=new Map(evidence.map(e=>[e.id,e]));
 for(const claim of draft.claims){
  const e=registry.get(claim.evidenceId),star=e?.stars.find(s=>s.name===claim.star);
  if(!star){errors.push('结构化星曜断言不在引用宫位。');continue;}
  if(claim.brightness!==undefined&&claim.brightness!==star.brightness)errors.push('亮度与规则引擎不一致。');
  if(claim.natalMutagen!==undefined&&claim.natalMutagen!==star.natalMutagen)errors.push('生年（本命）四化与规则引擎不一致。');
  if(claim.layerMutagen!==undefined&&claim.layerMutagen!==star.layerMutagen)errors.push('当前时间层四化与规则引擎不一致。');
  for(const id of claim.transformationIds||[])if(!star.transformations.some(t=>t.id===id))errors.push('四化来源、星曜或观察日期与检索证据不一致。');
 }
 for(const block of draft.blocks){
  const cited=block.evidenceIds.flatMap(id=>registry.has(id)?[registry.get(id)!]:[]);
  if(cited.length!==block.evidenceIds.length)errors.push('引用了未检索的证据。');
  const claims=draft.claims.filter(c=>block.evidenceIds.includes(c.evidenceId));
  if(block.kind==='chart_fact'&&!cited.length)errors.push('排盘事实没有引用依据。');
  if(block.kind==='chart_fact'&&!claims.length)errors.push('排盘事实缺少可检查的星曜断言。');
  if(/本层化[禄权科忌]|当前(?:层)?化[禄权科忌]/u.test(block.text))errors.push('四化须写明生年、大限、流年、流月或流日，不能只写本层。');
  const names=[...new Set(evidence.flatMap(e=>e.stars.map(s=>s.name)))];
  for(const match of block.text.matchAll(/化([禄权科忌])/gu)){
   const pos=match.index!,prefix=block.text.slice(0,pos),tail=block.text.slice(pos+2,pos+18);
   const sentence=prefix.split(/[。；;\n]/u).pop()||'';
   // Negated examples are left to the semantic reviewer; do not mistake them for positive claims.
   if(/(?:不是|并非|没有|不属于)[^，,]{0,12}$/u.test(sentence))continue;
   const nearby=names.map(name=>({name,at:prefix.lastIndexOf(name)})).filter(n=>n.at>=0&&pos-n.at<32).sort((a,b)=>b.at-a.at);
   const starName=nearby[0]?.name||names.find(n=>tail.startsWith(n));
   if(!starName)continue; // e.g. explaining the general meaning of 化忌, without asserting a star.
   const suffix=tail.match(/^(?:，|,)?(?:来自|属于|源于|是)?(?:的)?(生年|本命|大限|童限|流年|流月|流日)/u);
   const localPrefix=prefix.split(/[。；;\n]/u).pop()||'';
   const markers=[...localPrefix.matchAll(/生年|本命|大限|童限|流年|流月|流日/gu)];
   const marker=suffix?{0:suffix[1]}:markers.at(-1);const scope=marker?aliases[marker[0]]:undefined;
   if(!scope){errors.push(`${starName}化${match[1]}缺少明确的四化时间层。`);continue;}
   const candidates=cited.flatMap(e=>e.stars.filter(s=>s.name===starName).flatMap(s=>s.transformations.filter(t=>t.scope===scope&&t.value===match[1]).map(t=>({e,t}))));
   if(!candidates.length){errors.push(`${starName}的${marker![0]}化${match[1]}与来源表不一致，不得将运限四化归为生年属性。`);continue;}
   if(scope==='decadal'&&candidates.every(({e,t})=>e.sources.some(s=>s.id===t.sourceId&&s.label==='童限四化'))&&marker?.[0]==='大限')errors.push('当前为童限，不能标注为已进入大限。');
   const supported=candidates.some(({e,t})=>claims.some(c=>c.evidenceId===e.id&&c.star===starName&&((c.transformationIds||[]).includes(t.id)||(scope==='natal'&&c.natalMutagen===t.value)||(scope===e.scope&&scope!=='natal'&&c.layerMutagen===t.value))));
   if(!supported)errors.push(`${starName}的四化陈述缺少对应来源的结构化断言。`);
   const date=sentence.match(/\d{4}-\d{2}-\d{2}/u)?.[0];
   if(date&&scope!=='natal'&&!candidates.some(({e,t})=>e.sources.some(s=>s.id===t.sourceId&&s.observedOn===date)))errors.push('正文四化观察日期与引用来源不一致。');
  }
 }
 return [...new Set(errors)];
}

// B′-2 routes both pre-review and final delivery through this source-preserving fact contract.
export {factContractIssues as checkFrameworkEvidence} from './bprime/fact-contract';
