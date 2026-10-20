import type {Scope} from './chart-model';
import {parseTemporalIntent} from './temporal-intent';
import {classifyAnalysisTask} from './question-planner';
import {QUESTION_DOMAINS,matchQuestionDomains,resolveQuestionPalaces,primaryDomainPalace,type DomainId} from './question-domains';

// Deterministic analysis scheduling strategy: 本命 → 大限 → 流年.
// Routing + signal classification ONLY. Never invents star meanings or prose.
export type PrecisionTier='natal'|'decadal'|'yearly';
export const TIER_SCOPES:Record<PrecisionTier,Scope[]>={natal:['natal'],decadal:['natal','decadal'],yearly:['natal','decadal','yearly']};

const AUSPICIOUS_TYPES=new Set(['soft','lucun']);
const INAUSPICIOUS_TYPES=new Set(['tough']);
const AUSPICIOUS_NAMES=new Set(['左辅','右弼','天魁','天钺','文昌','文曲','禄存']);
const INAUSPICIOUS_NAMES=new Set(['擎羊','陀罗','火星','铃星','地空','地劫']);

export type StarSignal='auspicious'|'inauspicious'|'neutral';
export function starSignal(type:string|undefined,name:string):StarSignal{
 if(AUSPICIOUS_TYPES.has(type||'')||AUSPICIOUS_NAMES.has(name))return 'auspicious';
 if(INAUSPICIOUS_TYPES.has(type||'')||INAUSPICIOUS_NAMES.has(name))return 'inauspicious';
 return 'neutral';
}

export type BrightnessSignal='strong'|'middle'|'weak'|'unknown';
export function brightnessSignal(brightness:string|undefined|null):BrightnessSignal{
 const b=(brightness||'').trim();
 if(b==='庙'||b==='旺')return 'strong';
 if(b==='得'||b==='利'||b==='平')return 'middle';
 if(b==='陷')return 'weak';
 return 'unknown';
}

export function mutagenSignal(value:string):'auspicious'|'inauspicious'|'neutral'{
 return value==='禄'||value==='权'||value==='科'?'auspicious':value==='忌'?'inauspicious':'neutral';
}

export function precisionTier(question:string):PrecisionTier{
 const precision=classifyAnalysisTask(question).precision;
 return precision==='none'||precision==='natal'?'natal':precision==='decadal'?'decadal':'yearly';
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrospective ("X年之前 / 过去几年 / 前几年") → list of past years to compare.
// Defaults to the most recent decade (10 years, one 大限 span) so "X年之前" drills
// into the decade-level flow years rather than stopping at the last two years.
// ─────────────────────────────────────────────────────────────────────────────

const RETROSPECTIVE_WORD=/年(?:之)?前|过去(?:几|[一二三四五六七八九十\d]+)?年|前(?:几|[一二三四五六七八九十\d]+)年|近几年|这几年(?:以前|之前)?/;

export function isRetrospective(question:string,today=new Date().toISOString().slice(0,10)):boolean{
 const intent=parseTemporalIntent(question,today);
 return intent.retrospectiveEndYear!==undefined||RETROSPECTIVE_WORD.test(intent.targetText)&&!/未来|接下来|往后|明年|后年/.test(intent.targetText);
}

/** Years to compare, ascending. Explicit retrospective upper bounds share the timing resolver's semantics. */
export function retrospectiveYears(question:string,today:string):string[]{
 const intent=parseTemporalIntent(question,today),current=Math.min(intent.retrospectiveEndYear??Number(today.slice(0,4)),intent.yearRange?.endYear??2100);
 const n=Math.max(1,Math.min(20,intent.spanYears??10));
 const years:string[]=[];
 const first=Math.max(1900,current-19,intent.yearRange?.startYear??current-n+1);
 for(let year=first;year<=current&&year<=2100;year++)years.push(String(year));
 return years;
}

export function futureYears(question:string,today:string):string[]{
 const match=question.match(/(?:未来|接下来|往后)(几|[一二三四五六七八九十\d]+)年/);if(!match)return [];
 const start=Number(today.slice(0,4)),count=Math.max(1,Math.min(20,match[1]==='几'?3:cnNum(match[1])));
 return Array.from({length:count},(_,i)=>start+i).filter(y=>y<=2100).map(String);
}

function cnNum(s:string):number{
 if(/^\d+$/.test(s))return Number(s);
 const map:Record<string,number>={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
 if(map[s])return map[s];
 if(s.startsWith('十'))return 10+(map[s[1]]||0);
 if(s.endsWith('十'))return (map[s[0]]||0)*10;
 return 3;
}

export type TopicId=DomainId;
export type Topic={id:TopicId;re:RegExp;palaces:string[]};

export const topics:Topic[]=QUESTION_DOMAINS.map(domain=>({id:domain.id,re:domain.re,palaces:[...domain.corePalaces]}));

export function matchedTopics(question:string):Topic[]{
 return matchQuestionDomains(question).map(domain=>({id:domain.id,re:domain.re,palaces:resolveQuestionPalaces(question,{fallback:false}).filter(p=>domain.corePalaces.includes(p)||domain.conditionalPalaces.some(c=>c.when.test(question)&&c.palaces.includes(p)))}));
}

export function primaryPalace(topic:TopicId):string{
 return primaryDomainPalace(topic);
}
