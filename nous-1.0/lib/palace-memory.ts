import {rawDb} from '@/db/raw';
import {createChart,type ChartData} from './chart';
import {generateJSON} from './providers/client';
import type {Connection} from './providers/config';
import {encryptKey,decryptKey} from './providers/vault';
import {buildPalaceFacts,budgetMemoryTargets,chartVersion,digest,memoryTargets,topicPalaces,type FactRow} from './palace-memory-facts';
import {memorySkillInstructions,memorySkillSchema,MEMORY_SKILL_VERSION} from './palace-memory-skill';
import {estimateTokens} from './context-capacity';
import {parseTemporalIntent} from './temporal-intent';
import {timingPalaces} from './timing-palaces';
import type {TimingRequest} from './timing-request';

export type RetrievedMemory={conversationSummary:string;backgroundEvents:any[];backgroundFacts:any[];coverage:any[];corrections?:any[];cards:any[];facts:any[];tokensEstimate:number};
const empty=():RetrievedMemory=>({conversationSummary:'',backgroundEvents:[],backgroundFacts:[],coverage:[],corrections:[],cards:[],facts:[],tokensEstimate:0});
const readJson=(s:any)=>{try{return typeof s==='string'?JSON.parse(s):s||{};}catch{return {};}};
const seal=(value:any,owner:string,id:string)=>encryptKey(JSON.stringify(value),owner,'memory:'+id);
const unseal=async(value:string,owner:string,id:string)=>JSON.parse(await decryptKey(value,owner,'memory:'+id));
const absent=(e:unknown)=>/no such table.*(?:palace_|conversation_summaries)/i.test(String(e));

export async function enqueuePalaceMemory(owner:string,profileId:string,sourceId:string){
 await rawDb().prepare("INSERT OR IGNORE INTO palace_memory_jobs(owner,profile_id,source_id,status,created_at) SELECT ?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM messages WHERE id=? AND owner=?)").bind(owner,profileId,sourceId,Date.now(),sourceId,owner).run();
}

export async function retrievePalaceMemory(owner:string,profileId:string,chart:ChartData,question:string,referenceDate:string,topicHint='',timingRequest?:TimingRequest|null,analysisPlan?:any):Promise<RetrievedMemory>{
 const db=rawDb(),version=await chartVersion(chart),result=empty();let correctionGate:any[]=[];
 try{
  const summary=await db.prepare('SELECT payload FROM conversation_summaries WHERE owner=? AND profile_id=? AND chart_version=?').bind(owner,profileId,version).first<{payload:string}>();
  if(summary){const value=await unseal(summary.payload,owner,'summary:'+profileId+':'+version);correctionGate=value.corrections||[];result.conversationSummary=(value.text||'').slice(0,4000);result.backgroundEvents=(value.backgroundEvents||[]).slice(-24);result.backgroundFacts=(value.backgroundFacts||[]).filter((f:any)=>!correctionGate.some(c=>c.sourceId!==f.sourceId&&c.recordedAt>(f.recordedAt||'')&&topicPalaces((f.quote||'')+' '+(f.meaning||'')).some(p=>c.palaces?.includes(p)))).slice(-24);result.coverage=(value.coverage||[]).slice(-4);result.corrections=correctionGate.slice(-24);}
  const directPalaces=topicPalaces(question),fallbackPalaces=timingRequest?.plan?timingPalaces(timingRequest):directPalaces.length?directPalaces:topicPalaces(topicHint),targets=memoryTargets(question+' '+fallbackPalaces.join(' '),analysisPlan?{analysisPlan}:timingRequest?.plan?{timing:{...timingRequest,palaces:fallbackPalaces}}:{},referenceDate,'retrieval'),palaces=analysisPlan?[...new Set(targets.flatMap(t=>t.palaces))]:fallbackPalaces,years=[...new Set(targets.map(t=>t.year))];
  const decadeRanges=new Map<string,number[]>();
  for(const t of targets.filter(t=>t.scope==='decadal')){const c=createChart(chart.birth,t.date),decade=c.decades.find(d=>c.age>=d.ageRange[0]&&c.age<=d.ageRange[1]);if(decade){decadeRanges.set(t.id,decade.ageRange);for(let y=Math.max(1900,decade.yearRange[0]);y<=Math.min(2100,decade.yearRange[1]+1);y++)if(!years.includes(y))years.push(y);}}
  if(analysisPlan&&targets.length&&!years.includes(0))years.push(0); // Atemporal attributes may support a timed question, with their role kept explicit.
  const baseTokens=()=>estimateTokens(JSON.stringify({conversationSummary:result.conversationSummary,backgroundEvents:result.backgroundEvents,backgroundFacts:result.backgroundFacts,coverage:result.coverage,corrections:result.corrections}));
  while(baseTokens()>5000&&result.backgroundEvents.length)result.backgroundEvents.shift();
  while(baseTokens()>5000&&result.backgroundFacts.length)result.backgroundFacts.shift();
  while(baseTokens()>5000&&result.coverage.length)result.coverage.shift();
  while(baseTokens()>5000&&result.corrections?.length)result.corrections.shift();
  if(!palaces.length||!years.length){result.tokensEstimate=baseTokens();return result;}
  const marks=(a:any[])=>a.map(()=>'?').join(',');
  const queryYear=+(timingRequest?.start||referenceDate).slice(0,4);
  type MemoryRow={id:string;payload:string;target_year:number;target_date:string;palace:string;created_at:number};
  let rows:{results:MemoryRow[]}={results:[]};
  for(let i=0;i<years.length;i+=64){const group=years.slice(i,i+64),found=await db.prepare(`SELECT id,payload,target_year,target_date,palace,created_at FROM palace_memories WHERE owner=? AND profile_id=? AND chart_version=? AND target_year IN (${marks(group)}) AND palace IN (${marks(palaces)}) ORDER BY abs(target_year-?) ASC,created_at DESC LIMIT 96`).bind(owner,profileId,version,...group,...palaces,queryYear).all<MemoryRow>();rows.results.push(...found.results);}
  const explicitTime=analysisPlan?true:timingRequest?.plan?timingRequest.plan.rangeSource!=='default':/\d{4}|今年|明年|后年|去年|前年|过去|未来|接下来|往后|流年|大限|[一二三四五六七八九十\d]+月/.test(parseTemporalIntent(question,referenceDate).targetText);
  let crossPeriod=false;
  if(!rows.results.length&&!explicitTime){
   rows=await db.prepare(`SELECT id,payload,target_year,target_date,palace,created_at FROM palace_memories WHERE owner=? AND profile_id=? AND chart_version=? AND palace IN (${marks(palaces)}) ORDER BY abs(target_year-?) ASC,created_at DESC LIMIT 12`).bind(owner,profileId,version,...palaces,+referenceDate.slice(0,4)).all<typeof rows.results[number]>();crossPeriod=true;
  }
  const targetMatch=(c:any,t:typeof targets[number])=>t.palaces.includes(c.binding.palace)&&(c.binding.atemporal||c.binding.year===0||!t.atemporal&&(decadeRanges.has(t.id)?!c.binding.yearlyRef&&JSON.stringify(c.binding.decade?.ageRange)===JSON.stringify(decadeRanges.get(t.id)):(c.binding.end||c.binding.date)>=(t.start||t.date)&&(c.binding.start||c.binding.date)<=(t.end||t.date)));
  const matches=(c:any)=>analysisPlan?targets.some(t=>targetMatch(c,t)):!timingRequest?.plan||crossPeriod||(c.binding.end||c.binding.date)>=timingRequest.start&&(c.binding.start||c.binding.date)<=timingRequest.end;
  const corrected=(c:any)=>correctionGate.some(f=>f.sourceId!==c.sourceId&&f.palaces?.includes(c.binding.palace)&&f.recordedAt>(c.provenance?.recordedAt||c.recordedAt||''));
  const decoded=(await Promise.all(rows.results.map(async r=>{const value=await unseal(r.payload,owner,r.id);return (Array.isArray(value.taskEntries)?value.taskEntries:[value]).map((c:any)=>({...c,...(crossPeriod?{retrievalNote:'同主题的其他年份历史背景，不能作为本期命盘结论'}:{})}));}))).flat();
  const ranked=decoded.filter(c=>matches(c)&&!corrected(c)).sort((a,b)=>Math.abs(a.binding.year-queryYear)-Math.abs(b.binding.year-queryYear)||palaces.indexOf(a.binding.palace)-palaces.indexOf(b.binding.palace));
  const groups=analysisPlan?analysisPlan.tasks.flatMap((task:any)=>[...new Set(targets.filter(t=>t.taskId===task.id).flatMap(t=>t.palaces))].map(palace=>ranked.filter(c=>c.binding.palace===palace&&targets.some(t=>t.taskId===task.id&&targetMatch(c,t))))):palaces.map(palace=>ranked.filter(c=>c.binding.palace===palace));
  const candidates:any[]=[],candidateIds=new Set<string>();for(let depth=0;depth<24&&candidates.length<24;depth++)for(const group of groups){const c=group[depth];if(c&&!candidateIds.has(c.id)){candidateIds.add(c.id);candidates.push(c);if(candidates.length===24)break;}}
  const allFacts=new Map<string,any>();
  const refs=(c:any):string[]=>[c.binding.natalRef,c.binding.decadalRef,c.binding.yearlyRef,c.binding.monthlyRef,c.binding.dailyRef].filter((id):id is string=>typeof id==='string');
  const fetchFacts=async(ids:string[])=>{for(let i=0;i<ids.length;i+=80){const group=ids.slice(i,i+80),found=await db.prepare(`SELECT id,payload FROM palace_facts WHERE owner=? AND profile_id=? AND chart_version=? AND id IN (${marks(group)})`).bind(owner,profileId,version,...group).all<{id:string;payload:string}>();for(const f of found.results)allFacts.set(f.id,{id:f.id,...await unseal(f.payload,owner,f.id)});}};
  await fetchFacts([...new Set<string>(candidates.flatMap(refs))]);
  await fetchFacts([...new Set<string>([...allFacts.values()].map(f=>f.natalPalaceRef).filter(id=>id&&!allFacts.has(id)))]);
  // Pre-namespace duplicate-birth profiles could already have orphaned references. Recompute only
  // those legacy bindings from this profile's verified chart version; never read another profile's rows.
  for(const c of candidates)if(!c.provenance&&/^n:/.test(c.binding.natalRef)&&refs(c).some(id=>!allFacts.has(id))){
   const b=c.binding,pack=await buildPalaceFacts(chart,[{id:b.targetId||'legacy',taskId:b.taskId,date:b.date,year:b.year,precision:b.atemporal?'natal':b.precision==='period'?'period':b.precision==='year'?'year':'date',atemporal:!!b.atemporal,scope:b.monthlyRef?'monthly':b.yearlyRef?'yearly':'decadal',basis:b.basis,palaces:[b.palace],...(b.start&&b.end?{start:b.start,end:b.end}:{})}],profileId);
   const binding=pack.bindings[0];if(binding){c.binding=binding;c.factRecovery={kind:'deterministic_recalculation',chartVersion:version,note:'旧命例引用缺失，按当前匹配的命盘版本重算关联事实；原始解读未改写'};for(const fact of pack.facts)allFacts.set(fact.id,{id:fact.id,...fact.data});}
  }
  const facts=new Map<string,any>();let tokens=baseTokens(),seen=new Set<string>();
  for(const card of candidates){
   const key=card.binding.palace+'|'+card.binding.date+'|'+(card.binding.taskId||'')+'|'+card.userFocus;if(seen.has(key))continue;
   const ids=refs(card),loaded=new Map<string,any>();
   for(const id of ids){const f=allFacts.get(id);if(f&&!facts.has(id))loaded.set(id,f);if(f?.natalPalaceRef&&!facts.has(f.natalPalaceRef)&&allFacts.has(f.natalPalaceRef))loaded.set(f.natalPalaceRef,allFacts.get(f.natalPalaceRef));}
   if(ids.some(id=>!facts.has(id)&&!loaded.has(id)))continue;
   const cost=estimateTokens(JSON.stringify({card,facts:[...loaded.values()]}));if(tokens+cost>10000)continue;
   result.cards.push(card);loaded.forEach((v,k)=>facts.set(k,v));tokens+=cost;seen.add(key);if(result.cards.length>=6)break;
  }
  result.facts=[...facts.values()];result.tokensEstimate=tokens;return result;
 }catch(e){if(absent(e))return result;throw e;}
}

type Source={id:string;questionSourceId:string;askedAt:string;recordedAt:string;question:string;answer:string;answerExcerpted:boolean;meta:any;backgroundEvents:any[];targets:ReturnType<typeof memoryTargets>;availableTargets:ReturnType<typeof memoryTargets>};
function excerptAnswer(text:string,limit:number){
 if(text.length<=limit)return text;
 const count=12,size=Math.max(1,Math.floor((limit-300)/count)),parts=Array.from({length:count},(_,i)=>{const start=Math.floor(i*(text.length-size)/(count-1));return text.slice(start,start+size);});
 return parts.join('\n（原答分段节选，间隔内容请回查来源）\n');
}
/** One durable summarization job at a time per profile. No provider retry on ambiguous failure. */
export async function processPalaceMemory(owner:string,profileId:string,chart:ChartData,connection:Connection){
 const db=rawDb(),now=Date.now(),token=crypto.randomUUID(),version=await chartVersion(chart);let modelCalls=0;
 await db.prepare("UPDATE palace_memory_jobs SET status='failed',error_code='INTERRUPTED' WHERE owner=? AND profile_id=? AND status='running' AND lease_until<?").bind(owner,profileId,now).run();
 const job=await db.prepare("SELECT source_id FROM palace_memory_jobs WHERE owner=? AND profile_id=? AND status='pending' ORDER BY created_at LIMIT 1").bind(owner,profileId).first<{source_id:string}>();
 if(!job)return {status:'idle',modelCalls:0};
 const claimed=await db.prepare("UPDATE palace_memory_jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE owner=? AND source_id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM palace_memory_jobs WHERE owner=? AND profile_id=? AND status='running')").bind(token,now+90000,owner,job.source_id,owner,profileId).run();
 if(!claimed.meta.changes)return {status:'busy',modelCalls:0};
 try{
  const source=await db.prepare('SELECT profile_revision,created_at FROM messages WHERE owner=? AND id=? AND profile_id=?').bind(owner,job.source_id,profileId).first<{profile_revision:number;created_at:string}>();
  if(!source)throw Error('SOURCE_REMOVED');
  if(profileId!=='demo'){const p=await db.prepare('SELECT birth,revision FROM profiles WHERE owner=? AND id=?').bind(owner,profileId).first<{birth:string;revision:number}>();if(!p||p.revision!==source.profile_revision||await chartVersion(createChart(JSON.parse(p.birth),chart.target))!==version)throw Error('PROFILE_CHANGED');}
  const old=await db.prepare('SELECT payload,source_id FROM conversation_summaries WHERE owner=? AND profile_id=? AND chart_version=?').bind(owner,profileId,version).first<{payload:string;source_id:string}>();
  const previous=old?await unseal(old.payload,owner,'summary:'+profileId+':'+version):null;
  const rows=await db.prepare('SELECT id,role,content,meta,created_at FROM (SELECT rowid AS seq,id,role,content,meta,created_at FROM messages WHERE owner=? AND profile_id=? AND profile_revision=? AND created_at<=? ORDER BY created_at DESC,rowid DESC LIMIT 32) ORDER BY created_at,seq').bind(owner,profileId,source.profile_revision,source.created_at).all<{id:string;role:string;content:string;meta:string;created_at:string}>();
  const sources:Source[]=[];let question='',questionSourceId='',askedAt='',previousIndex=old?rows.results.findIndex(r=>r.id===old.source_id):-1;
  for(const [i,row] of rows.results.entries()){if(row.role==='user'){question=row.content;questionSourceId=row.id;askedAt=row.created_at;continue;}if(row.role!=='assistant'||!question||i<=previousIndex)continue;
   const meta=readJson(row.meta);const reference=meta.chartDate||chart.target;
   if(meta.analysisPlan?.chartVersion&&meta.analysisPlan.chartVersion!==version)throw Error('MEMORY_CHART_VERSION_MISMATCH');
   const hint=topicPalaces(question).length?'':topicPalaces(meta.dialogue?.goal||'').join(' ');
   const targets=memoryTargets(question+' '+hint,meta,reference),answer=excerptAnswer(row.content,18000);
   const backgroundEvents=meta.analysisPlan?meta.analysisPlan.tasks.flatMap((t:any)=>t.timing?.plan?.backgroundEvents||t.timingRequest?.plan?.backgroundEvents||[]):meta.timing?.plan?.backgroundEvents||parseTemporalIntent(question,reference).backgroundEvents;
   sources.push({id:row.id,questionSourceId,askedAt,recordedAt:row.created_at,question:question.slice(0,3000),answer,answerExcerpted:row.content.length>18000,meta,backgroundEvents,targets,availableTargets:targets});
  }
  if(!sources.length)throw Error('SOURCE_UNAVAILABLE');
  // Bootstrap is bounded to the latest context; normal jobs only consume the new turn.
  const selected=sources.slice(-12);let budget=40000-(previous?.text?.length||0),cardBudget=32;const input:Source[]=[];
  for(const source of selected.slice().reverse()){
   const targets=budgetMemoryTargets(source.targets,cardBudget,source.meta.timing?.windows||[]),s={...source,targets};
   const overhead=JSON.stringify({id:s.id,question:s.question,backgroundEvents:s.backgroundEvents,targets:s.targets}).length;
   if(budget-overhead<1000)continue;
   const answerLimit=Math.min(input.length?6000:18000,budget-overhead-100);s.answer=excerptAnswer(s.answer,answerLimit);s.answerExcerpted=s.answerExcerpted||s.answer!==source.answer;
   budget-=overhead+s.answer.length;cardBudget-=targets.reduce((n,t)=>n+t.palaces.length,0);input.push(s);
  }
  input.reverse();if(!input.length)throw Error('MEMORY_INPUT_BUDGET');
  modelCalls++;const generated=await generateJSON(connection,memorySkillInstructions,{skill:MEMORY_SKILL_VERSION,previousSummary:previous?.text||'',sources:input.map(({meta,availableTargets,...s})=>s)},AbortSignal.timeout(65000),6500,{stage:'plan',limits:{firstByteMs:20000,idleMs:25000,totalMs:65000}});
  const parsed=memorySkillSchema.parse(generated),savedFacts=new Map<string,FactRow>(),cards:any[]=[],packs=new Map<string,Awaited<ReturnType<typeof buildPalaceFacts>>>(),seen=new Set<string>(),backgroundFacts=new Map<string,any>((previous?.backgroundFacts||[]).map((f:any)=>[f.sourceId+'|'+f.quote,f])),corrections:any[]=[...(previous?.corrections||[])];
  for(const s of input)if(/更正|纠正|说错|记错|不是.{0,50}而是/.test(s.question)){const palaces=[...new Set(s.availableTargets.flatMap(t=>t.palaces))];if(palaces.length)corrections.push({sourceId:s.id,questionSourceId:s.questionSourceId,recordedAt:s.recordedAt,palaces,quote:s.question.slice(0,400),effect:'同宫旧卡暂不注入，保留原始归档；以新摘要和明确更正为准'});}
  // Reuse legacy canonical natal rows belonging to this profile; new profiles always get a namespaced identity.
  const existing=await db.prepare("SELECT id,payload FROM palace_facts WHERE owner=? AND profile_id=? AND chart_version=? AND scope='natal'").bind(owner,profileId,version).all<{id:string;payload:string}>(),existingNatalRefs:Record<number,string>={};
  for(const row of existing.results){const fact=await unseal(row.payload,owner,row.id);if(Number.isInteger(fact.index))existingNatalRefs[fact.index]=row.id;}
  for(const card of parsed.cards){
   const s=input.find(s=>s.id===card.sourceId),target=s?.targets.find(t=>t.id===card.targetId&&t.palaces.includes(card.palace));if(!s||!target)throw Error('MEMORY_SOURCE_MISMATCH');
   const key=s.id+'|'+target.id+'|'+card.palace;if(seen.has(key))continue;seen.add(key);
   let pack=packs.get(s.id);if(!pack){pack=await buildPalaceFacts(chart,s.targets,profileId,existingNatalRefs);packs.set(s.id,pack);}
   const binding=pack.bindings.find(b=>b.targetId===target.id&&b.palace===card.palace);if(!binding)continue;
   pack.facts.forEach(f=>savedFacts.set(f.id,f));
   if(card.userFacts.some(f=>!s.question.includes(f.quote)))throw Error('MEMORY_QUOTE_MISMATCH');
   const id='m:'+await digest({owner,profileId,version,key});
   const provenance={sourceId:s.id,questionSourceId:s.questionSourceId,askedAt:s.askedAt,recordedAt:s.recordedAt,archivedAt:new Date(now).toISOString(),profileId,profileRevision:source.profile_revision,chartVersion:version,ruleVersion:chart.ruleVersion,...(s.meta.analysisPlan?{analysisPlanId:s.meta.analysisPlan.id,analysisPlanVersion:s.meta.analysisPlan.version,registryVersion:s.meta.analysisPlan.registryVersion,taskId:target.taskId}:{})};
   const userFacts=card.userFacts.flatMap(f=>{if(/如果|假如|假设|要是/.test(s.question)||/[?？]|是否|会不会|能否/.test(f.quote))return [];const statement={...f,sourceId:s.id,questionSourceId:s.questionSourceId,kind:'user_statement_excerpt',evidenceKind:'user_statement',verification:'user_report_unverified',recordedAt:s.askedAt};const event=s.backgroundEvents.find(e=>typeof e.text==='string'&&(e.text.includes(f.quote)||f.quote.includes(e.text)));if(event){backgroundFacts.set(s.id+'|'+f.quote,{...statement,temporalRole:'background_event',eventTime:{year:event.year,date:event.date,relation:event.relation,basis:event.text}});return [];}return [{...statement,temporalRole:'user_statement',eventTime:null,timeNote:'引句事件时间未确认，独立于此卡分析区段，不能以 binding 年份替代'}];});
   const correction=card.correction&&/更正|纠正|说错|记错|不是.{0,50}而是/.test(s.question);
   if(correction&&!corrections.some(c=>c.sourceId===s.id&&c.palaces.includes(card.palace)))corrections.push({sourceId:s.id,questionSourceId:s.questionSourceId,recordedAt:s.recordedAt,palaces:[card.palace],quote:s.question.slice(0,400),effect:'同宫旧卡暂不注入，保留原始归档；以新摘要和明确更正为准'});
   cards.push({id,sourceId:s.id,skill:MEMORY_SKILL_VERSION,kind:'traditional_interpretation',evidenceKind:'traditional_interpretation',userFocus:card.userFocus,interpretation:card.interpretation,conditions:card.conditions,userFacts,correction,binding,provenance,eventTime:binding.atemporal?{kind:'atemporal'}:{kind:'chart_period',start:binding.start||binding.date,end:binding.end||binding.date,year:binding.year,precision:binding.precision}});
  }
  const guard="EXISTS(SELECT 1 FROM palace_memory_jobs j JOIN messages m ON m.id=j.source_id WHERE j.owner=? AND j.source_id=? AND j.lease_token=? AND j.status='running' AND j.lease_until>? AND m.owner=j.owner AND m.profile_id=j.profile_id AND (j.profile_id='demo' OR EXISTS(SELECT 1 FROM profiles p WHERE p.owner=j.owner AND p.id=j.profile_id AND p.revision=m.profile_revision)))";
  const gate=[owner,job.source_id,token,Date.now()];
  // Facts are immutable and content-addressed; partial preparation is harmless and reusable.
  const factList=[...savedFacts.values()];
  for(let i=0;i<factList.length;i+=10){const group=factList.slice(i,i+10),values=[];for(const f of group)values.push(owner,profileId,version,f.id,f.scope,f.palace,f.periodKey,await seal(f.data,owner,f.id));
   await db.prepare(`WITH fact_rows(owner,profile_id,chart_version,id,scope,palace,period_key,payload) AS (VALUES ${group.map(()=>'(?,?,?,?,?,?,?,?)').join(',')}) INSERT OR IGNORE INTO palace_facts SELECT * FROM fact_rows WHERE ${guard}`).bind(...values,...gate).run();
  }
  const writes=[];
  // The legacy unique key has no task column. Same-palace/date tasks share one row;
  // each member retains its own task, target, scope, interval and interpretation inside the encrypted payload.
  const groups=new Map<string,any[]>();for(const c of cards){const key=c.sourceId+'|'+c.binding.palace+'|'+c.binding.date;groups.set(key,[...(groups.get(key)||[]),c]);}
  const storedCards=[...groups.values()].map(group=>group.length===1?group[0]:{...group[0],taskIds:[...new Set(group.map(c=>c.binding.taskId).filter(Boolean))],taskEntries:group});
  for(const c of storedCards)writes.push(db.prepare(`INSERT OR IGNORE INTO palace_memories(owner,profile_id,chart_version,id,source_id,palace,target_year,target_date,kind,payload,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(owner,profileId,version,c.id,c.sourceId,c.binding.palace,c.binding.year,c.binding.date,c.kind,await seal(c,owner,c.id),now,...gate));
  const coverage=input.map(s=>{const saved=cards.filter(c=>c.sourceId===s.id),expected=s.availableTargets.reduce((n,t)=>n+t.palaces.length,0);return {sourceId:s.id,analysisPlanId:s.meta.analysisPlan?.id,availablePeriods:s.availableTargets.length,availableBindings:expected,archivedBindings:saved.length,archivedPeriods:new Set(saved.map(c=>c.binding.targetId)).size,partial:saved.length<expected,answerExcerpted:s.answerExcerpted,tasks:[...new Set(s.availableTargets.map(t=>t.taskId).filter(Boolean))].map(taskId=>({taskId,availableBindings:s.availableTargets.filter(t=>t.taskId===taskId).reduce((n,t)=>n+t.palaces.length,0),archivedBindings:saved.filter(c=>c.binding.taskId===taskId).length}))};});
  const backgroundEvents=[...(previous?.backgroundEvents||[]),...input.flatMap(s=>s.backgroundEvents.map(e=>({sourceId:s.id,...e,kind:'question_background_mention',note:'来源问题的背景时间；是否已发生以用户原文为准，不是未来分析年份'})))].slice(-40);
  const latestCorrections=new Map<string,any>();for(const correction of corrections.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)))for(const palace of correction.palaces)latestCorrections.set(palace,{...correction,palaces:[palace]});
  writes.push(db.prepare(`INSERT INTO conversation_summaries(owner,profile_id,chart_version,source_id,payload,updated_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(owner,profile_id,chart_version) DO UPDATE SET source_id=excluded.source_id,payload=excluded.payload,updated_at=excluded.updated_at`).bind(owner,profileId,version,job.source_id,await seal({text:parsed.conversationSummary,skill:MEMORY_SKILL_VERSION,sourceIds:input.map(s=>s.id),chartVersion:version,ruleVersion:chart.ruleVersion,recordedAt:new Date(now).toISOString(),backgroundEvents,backgroundFacts:[...backgroundFacts.values()].slice(-40),corrections:[...latestCorrections.values()],coverage},owner,'summary:'+profileId+':'+version),now,...gate));
  writes.push(db.prepare("UPDATE palace_memory_jobs SET status='done',lease_token=NULL WHERE owner=? AND source_id=? AND lease_token=? AND status='running' AND lease_until>?").bind(...gate));
  const result=await db.batch(writes);if(!result.at(-2)?.meta.changes)throw Error('MEMORY_JOB_INVALIDATED');
  console.info(JSON.stringify({event:'palace_memory_saved',cards:storedCards.length,bindings:cards.length,facts:savedFacts.size,modelCalls:1}));
  return {status:'done',cards:storedCards.length,bindings:cards.length,facts:savedFacts.size,modelCalls:1,coverage};
 }catch(e){await db.prepare("UPDATE palace_memory_jobs SET status='failed',error_code=?,lease_token=NULL WHERE owner=? AND source_id=? AND lease_token=?").bind('MEMORY_EXTRACTION_FAILED',owner,job.source_id,token).run();console.warn(JSON.stringify({event:'palace_memory_failed',code:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'MEMORY_EXTRACTION_FAILED'}));return {status:'failed',modelCalls};}
}
