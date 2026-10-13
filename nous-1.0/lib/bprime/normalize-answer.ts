import type {AnswerContract,FrameworkDraft} from './contracts';
import type {FactRegistry,RegisteredFact} from './fact-contract';
const scopes:Record<string,string>={本命:'natal',生年:'natal',大限:'decadal',童限:'decadal',流年:'yearly',流月:'monthly',流日:'daily'};
const palace='命宫|兄弟|夫妻|子女|财帛|疾厄|迁移|交友|官禄|田宅|福德|父母';
const layer='本命|大限|童限|流年|流月|流日';
const scopeMatches=(f:RegisteredFact,label:string)=>!label||(f.queryScope===scopes[label]&&(!['童限','大限'].includes(label)||f.queryLabel===label));
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Normalize only an entire, positive, unambiguous factual clause with declared provenance.
 * Never correct a conflicting value, guess a source, or promote an unknown ID to a fact.
 */
function naturalFacts(text:string,refs:string[],registry:FactRegistry){
 const facts=refs.map(r=>registry.get(r)).filter((f):f is RegisteredFact=>!!f);
 const stars=[...new Set(facts.map(f=>f.star))].map(escape).join('|');if(!stars)return text;
 const at=new RegExp(`^(?:(${layer})[·\\s]*)?(${stars})(?:星)?(?:坐守|位于|落在|落入|在|守|入)(?:(${layer})[·\\s]*)?(${palace})(?:宫)?(?:[\\[【]?([庙旺得利平陷])[\\]】]?)?$`);
 const contains=new RegExp(`^(?:(${layer})[·\\s]*)?(${palace})(?:宫)?(?:有|见|为|：|:)(${stars})(?:星)?(?:[\\[【]?([庙旺得利平陷])[\\]】]?)?$`);
 const mutation=new RegExp(`^(${stars})(生年|本命|大限|童限|流年|流月|流日)化([禄权科忌])$`);
 return text.split(/([，,。；;\n])/u).map(clause=>{
  const s=clause.trim();if(!s||/不|非|未|否认|假设|如果|例如|若|\{fact:/.test(s))return clause;
  let matches:RegisteredFact[]=[];const a=s.match(at),b=s.match(contains),m=s.match(mutation);
  if(a){const scope=a[1]||a[3];if(a[1]&&a[3]&&a[1]!==a[3])return clause;matches=facts.filter(f=>f.star===a[2]&&f.scopePalace===a[4]&&scopeMatches(f,scope)&&(!a[5]||f.brightness===a[5]));}
  else if(b)matches=facts.filter(f=>f.star===b[3]&&f.scopePalace===b[2]&&scopeMatches(f,b[1])&&(!b[4]||f.brightness===b[4]));
  else if(m)matches=facts.filter(f=>f.star===m[1]&&f.transformations.some(t=>t.scope===scopes[m[2]]&&t.value===m[3]&&(!['童限','大限'].includes(m[2])||t.source.label===m[2]+'四化')));
  return matches.length===1?`{fact:${matches[0].ref}}`:clause;
 }).join('');
}
export function normalizeFrameworkAnswer(input:FrameworkDraft,c:AnswerContract,r:FactRegistry):FrameworkDraft{
 const d=structuredClone(input),origin=new Map(c.conditions.map(x=>[x.id,x.origin]));
 const partition=(x:{conditionIds:string[];assumptionIds:string[]})=>{
  const known=[...new Set([...x.conditionIds,...x.assumptionIds])];
  x.conditionIds=[...new Set([...known.filter(id=>origin.get(id)==='user'),...x.conditionIds.filter(id=>!origin.has(id))])];
  x.assumptionIds=[...new Set([...known.filter(id=>origin.get(id)==='assumption'),...x.assumptionIds.filter(id=>!origin.has(id))])];
 };
 partition(d.decision);
 for(const b of d.blocks){if(b.kind==='condition')partition(b);if(b.kind==='traditional_interpretation')b.text=naturalFacts(b.text,b.subjectRefs,r);}
 // Move an already-written independent answer, never invent one or reorder a dependency chain.
 if(c.mustAnswerDecisionFirst&&d.blocks[0]?.kind==='chart_fact'){
  const independent=d.blocks.map((b,i)=>({b,i})).filter(({b})=>b.kind!=='chart_fact'&&!b.dependsOn.length&&(!c.periodComparison||b.kind==='traditional_interpretation'&&b.optionId===d.decision.preferredOptionId));
  const index=(independent.find(({b})=>b.kind==='condition')||independent[0])?.i??-1;
  if(index>0)d.blocks.unshift(...d.blocks.splice(index,1));
 }
 return d;
}
