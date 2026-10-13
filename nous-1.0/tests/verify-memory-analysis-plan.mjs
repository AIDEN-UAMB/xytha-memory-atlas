import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {connection} from './fixtures/bprime-runtime-provider.mjs';

// Synthetic charts and an in-memory database only. Every provider URL is asserted before response.
const out='.sites-runtime/verification/memory-analysis-plan';mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
class Prepared{constructor(q){this.q=q;this.v=[];}bind(...v){assert(v.length<=100,'D1 binding limit');this.v=v;return this;}async first(){return sql.prepare(this.q).get(...this.v)||null;}async all(){return {results:sql.prepare(this.q).all(...this.v)};}async run(){return {meta:sql.prepare(this.q).run(...this.v)};}}
globalThis.__bindings={MODEL_VAULT_KEY:'a'.repeat(64),DB:{prepare:q=>new Prepared(q),batch:async ss=>{sql.exec('BEGIN');try{const results=[];for(const s of ss)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
await build({entryPoints:['lib/palace-memory.ts','lib/palace-memory-facts.ts','lib/chart.ts','lib/providers/vault.ts'],outdir:out+'/bundles',bundle:true,platform:'node',format:'esm',external:['zod'],outExtension:{'.js':'.mjs'},plugins:[{name:'bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__bindings;',loader:'js'}));}}]});
const load=p=>import(pathToFileURL(resolve(out+'/bundles/'+p+'.mjs')).href);
const {createChart,example}=await load('chart'),{memoryTargets,budgetMemoryTargets,buildPalaceFacts,chartVersion}=await load('palace-memory-facts'),{processPalaceMemory,enqueuePalaceMemory,retrievePalaceMemory}=await load('palace-memory'),{encryptKey,decryptKey}=await load('providers/vault');
const today='2026-09-09',chart=createChart(example,today),version=await chartVersion(chart),results=[];
let providerCalls=0,providerHook=null,quoteOverride=null;
globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://mock.example.com/v1/chat/completions','No real provider allowed');providerCalls++;const data=JSON.parse(JSON.parse(options.body).messages.at(-1).content);assert.equal(data.skill,'xytha-palace-memory/3');assert(JSON.stringify(data).length<65000,'Bounded archival prompt');
 const cards=data.sources.flatMap(s=>s.targets.flatMap(t=>t.palaces.map(p=>({sourceId:s.id,targetId:t.id,palace:p,userFocus:s.question.slice(0,100),interpretation:'模拟解读 '+(t.taskId||'legacy')+'，不是用户已发生的事实。',conditions:[],userFacts:quoteOverride?[{quote:quoteOverride,meaning:'测试自述'}]:[],correction:/更正/.test(s.question)}))));assert(cards.length<=32);if(providerHook)await providerHook(data);
 return Response.json({choices:[{message:{content:JSON.stringify({conversationSummary:'以最新明确条件为准的合成摘要：'+data.sources.at(-1).question,cards})}}]});};
const profile=(id,owner='fixture')=>sql.prepare('INSERT INTO profiles(id,owner,name,birth,revision,pinned,archived,created_at) VALUES(?,?,?,?,1,0,0,?)').run(id,owner,'合成命例 '+id,JSON.stringify(example),today+'T00:00:00.000Z');
const plan=(id,tasks)=>({version:1,id,chartVersion:version,registryVersion:'test-registry',referenceDate:today,status:'executed',tasks});
const natalTask=(id='attribute',palaces=['夫妻'])=>({id,question:'感情观是什么',kind:'attribute',precision:'natal',palaces,queries:[{scope:'natal',date:chart.solarDate,palaces}]});
const intervalTask=(id,palaces,start,end,scope='yearly')=>({id,question:id,kind:'historical_compare',precision:scope,palaces,timing:{plan:{version:1,start,end,constraints:{excludedYears:[]}},segments:[{start,end,date:start,palaces,scope}]}});
const insertTurn=(profileId,id,question,meta,day='2026-09-09',owner='fixture')=>{for(const [role,content,suffix,ms] of [['user',question,'u','000'],['assistant','保留的合成原答 '+id,'a','001']])sql.prepare('INSERT INTO messages(id,owner,profile_id,profile_revision,role,content,meta,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id+'-'+suffix,owner,profileId,1,role,content,JSON.stringify(meta),day+'T12:00:00.'+ms+'Z');};
const archive=async(profileId,id)=>{await enqueuePalaceMemory('fixture',profileId,id+'-a');const r=await processPalaceMemory('fixture',profileId,chart,connection);assert.equal(r.status,'done',JSON.stringify(r));return r;};
const retrieve=(profileId,analysisPlan,question='感情观和事业')=>retrievePalaceMemory('fixture',profileId,chart,question,today,'',null,analysisPlan);
const unpack=async row=>JSON.parse(await decryptKey(row.payload,'fixture','memory:'+row.id));

const natalPlan=plan('natal-plan',[natalTask()]),natalTargets=memoryTargets('2024年开始恋爱，我的感情观是什么',{analysisPlan:natalPlan},today);
assert.equal(natalTargets.length,1);assert.equal(natalTargets[0].year,0);assert(natalTargets[0].atemporal);
const natalPack=await buildPalaceFacts(chart,natalTargets,'natal-test');assert.equal(natalPack.facts.length,12);assert(natalPack.bindings.every(b=>b.atemporal&&!b.decadalRef&&!b.yearlyRef&&!b.decade));
assert.deepEqual(memoryTargets('2024年事业',{analysisPlan:plan('knowledge',[{id:'k',kind:'knowledge',precision:'none',palaces:['官禄']}])},today),[]);
results.push({case:'natal-only-is-atemporal-without-fake-transit-bindings'});
for(const blocked of [{needsChart:false},{coverage:{status:'unavailable'}},{reasonCodes:['subject_identity_required']}]){const blockedPlan=plan('blocked-subject',[{...natalTask(),...blocked}]);assert.equal(memoryTargets('朋友的命盘性格如何',{analysisPlan:blockedPlan},today).length,0);assert.equal(memoryTargets('朋友的命盘性格如何',{analysisPlan:blockedPlan},today,'retrieval').length,0);}
results.push({case:'unavailable-or-other-subject-natal-task-cannot-archive-or-retrieve-current-profile'});

for(const id of ['same-birth-a','same-birth-b']){profile(id);insertTurn(id,id,'我的感情观是什么',{analysisPlan:natalPlan});await archive(id,id);}
const first=await retrieve('same-birth-a',natalPlan),second=await retrieve('same-birth-b',natalPlan);
assert(first.cards.length&&second.cards.length);assert(first.facts.every(f=>f.scope==='natal'));assert(second.facts.every(f=>f.scope==='natal'));
assert(first.facts.every(a=>second.facts.every(b=>a.id!==b.id)),'Same birth profile facts must be disjoint');
assert.equal(sql.prepare("SELECT count(*) n FROM palace_facts WHERE owner='fixture' AND scope='natal'").get().n,24);
for(const c of second.cards){assert.equal(c.binding.year,0);assert.equal(c.evidenceKind,'traditional_interpretation');assert.equal(c.provenance.chartVersion,version);assert.equal(c.provenance.profileId,'same-birth-b');assert.equal(c.provenance.taskId,'attribute');assert.equal(c.eventTime.kind,'atemporal');assert(c.provenance.questionSourceId.endsWith('-u'));}
assert.equal((await retrievePalaceMemory('other','same-birth-a',chart,'感情观',today,'',null,natalPlan)).cards.length,0);
results.push({case:'same-owner-same-birth-profiles-isolate-encrypted-facts-and-provenance',natalFacts:24});

profile('compound');const compoundPlan=plan('compound-plan',[natalTask('traits'),intervalTask('career-2024',['官禄'],'2024-06-01','2024-12-31'),intervalTask('marriage-2030',['夫妻'],'2030-06-01','2030-12-31')]);
const compoundTargets=memoryTargets('2020年开始恋爱，性格、2024事业及2030结婚如何',{analysisPlan:compoundPlan,timing:{plan:{version:1,start:'2020-01-01',end:'2020-12-31'}}},today);
assert.deepEqual(compoundTargets.map(t=>t.year),[0,2024,2030]);assert.deepEqual(compoundTargets.map(t=>t.taskId),['traits','career-2024','marriage-2030']);
insertTurn('compound','compound','2020年开始恋爱，性格、2024事业及2030结婚如何',{analysisPlan:compoundPlan});const compoundSaved=await archive('compound','compound');assert.equal(compoundSaved.bindings,3);
const compoundRetrieved=await retrieve('compound',compoundPlan);assert(compoundRetrieved.cards.some(c=>c.binding.taskId==='career-2024'));assert(compoundRetrieved.cards.some(c=>c.binding.taskId==='marriage-2030'));assert(compoundRetrieved.cards.every(c=>c.binding.year!==2020));assert(compoundRetrieved.tokensEstimate<=10000);
const wrongPair=plan('wrong-pair',[intervalTask('career-2030',['官禄'],'2030-01-01','2030-12-31')]);assert.equal((await retrieve('compound',wrongPair)).cards.length,0,'Compound retrieval cannot cross-join palace and year from different tasks');
results.push({case:'compound-tasks-archive-and-retrieve-own-palace-time-pairs'});

const requestOnly=plan('not-executed',[{id:'future',question:'2024开始恋爱何时结婚',kind:'future_timing',precision:'yearly',palaces:['夫妻'],timingRequest:{plan:{version:1,start:'2030-01-01',end:'2031-12-31'}}}]);
assert.equal(memoryTargets('2024开始恋爱',{analysisPlan:requestOnly},today).length,0);
assert.deepEqual(memoryTargets('2024开始恋爱',{analysisPlan:requestOnly},today,'retrieval').map(t=>t.year),[2030,2031]);
const many=Array.from({length:40},(_,i)=>({id:'long'+i,taskId:'long',date:(2020+i)+'-01-01',year:2020+i,precision:'period',palaces:['官禄','财帛']}));many.push({id:'single',taskId:'single',date:'2030-01-01',year:2030,precision:'period',palaces:['夫妻']});
const budgeted=budgetMemoryTargets(many,32);assert(budgeted.some(t=>t.taskId==='single'));assert(budgeted.reduce((n,t)=>n+t.palaces.length,0)<=32);assert(budgeted.some(t=>t.id==='long39'));
results.push({case:'unexecuted-plans-are-not-archived-and-long-task-cannot-starve-short-task'});

profile('same-date');const sameDatePlan=plan('same-date-plan',[{id:'decade',kind:'historical_compare',precision:'decadal',palaces:['官禄'],queries:[{scope:'decadal',date:'2024-06-01',palaces:['官禄']}]},intervalTask('year',['官禄'],'2024-06-01','2024-12-31')]);
insertTurn('same-date','same-date','2024年的事业与所在大限事业如何',{analysisPlan:sameDatePlan});const sameDateSaved=await archive('same-date','same-date');assert.equal(sameDateSaved.cards,1);assert.equal(sameDateSaved.bindings,2);assert.equal(sameDateSaved.coverage[0].archivedBindings,2);
const sameDateRow=sql.prepare("SELECT id,payload,target_date FROM palace_memories WHERE profile_id='same-date'").get(),sameDateCard=await unpack(sameDateRow);assert.equal(sameDateRow.target_date,'2024-06-01');assert.equal(sameDateCard.taskEntries.length,2);
const sameDateRetrieved=await retrieve('same-date',sameDatePlan);assert.equal(sameDateRetrieved.cards.length,2);assert(sameDateRetrieved.cards.find(c=>c.binding.taskId==='decade').binding.decadalRef);assert(!sameDateRetrieved.cards.find(c=>c.binding.taskId==='decade').binding.yearlyRef);assert(sameDateRetrieved.cards.find(c=>c.binding.taskId==='year').binding.yearlyRef);
results.push({case:'same-date-palace-subtasks-share-row-preserving-separate-precision-and-evidence'});
const laterDecadePlan=plan('later-observation',[{id:'same-decade-later',kind:'historical_compare',precision:'decadal',palaces:['官禄'],queries:[{scope:'decadal',date:'2025-06-01',palaces:['官禄']}]}]),laterDecade=await retrieve('same-date',laterDecadePlan);
assert.equal(laterDecade.cards.length,1);assert.equal(laterDecade.cards[0].binding.taskId,'decade');assert(!laterDecade.cards[0].binding.yearlyRef);results.push({case:'decade-memory-matches-actual-decade-across-observation-years-without-annual-leak'});

const monthPlan=plan('month-plan',[intervalTask('month',['夫妻'],'2028-06-01','2028-06-30','monthly')]),monthTargets=memoryTargets('2028年6月',{analysisPlan:monthPlan},today),monthPack=await buildPalaceFacts(chart,monthTargets,'month');
assert(monthPack.bindings[0].monthlyRef);assert(!monthPack.bindings[0].dailyRef);assert(monthPack.facts.some(f=>f.scope==='monthly'));
assert(monthPack.facts.filter(f=>f.scope!=='natal').every(f=>!f.data.majorStars&&f.data.natalPalaceRef));
results.push({case:'monthly-targets-add-month-facts-without-daily-or-repeated-natal-stars'});

insertTurn('same-birth-a','corrected','更正：我的感情观更重视独立',{analysisPlan:natalPlan},'2026-09-10');await archive('same-birth-a','corrected');
const corrected=await retrieve('same-birth-a',natalPlan);assert(corrected.cards.length);assert(corrected.cards.every(c=>c.sourceId==='corrected-a'));assert(corrected.corrections.some(c=>c.sourceId==='corrected-a'));assert(sql.prepare("SELECT id FROM messages WHERE id='same-birth-a-a'").get());assert(sql.prepare("SELECT id FROM palace_memories WHERE source_id='same-birth-a-a'").get());assert.equal(sql.prepare("SELECT count(*) n FROM palace_facts WHERE profile_id='same-birth-a' AND scope='natal'").get().n,12);
results.push({case:'explicit-correction-excludes-stale-injection-preserves-originals-and-natal-dedup'});

profile('legacy');const legacyPack=await buildPalaceFacts(chart,natalTargets);for(const f of legacyPack.facts)sql.prepare('INSERT INTO palace_facts(owner,profile_id,chart_version,id,scope,palace,period_key,payload) VALUES(?,?,?,?,?,?,?,?)').run('fixture','legacy',version,f.id,f.scope,f.palace,f.periodKey,await encryptKey(JSON.stringify(f.data),'fixture','memory:'+f.id));
insertTurn('legacy','legacy','感情观是什么',{analysisPlan:natalPlan});await archive('legacy','legacy');const legacyRetrieved=await retrieve('legacy',natalPlan);assert(legacyRetrieved.cards.length);assert(legacyRetrieved.cards.every(c=>c.binding.natalRef.startsWith('n:')));assert.equal(sql.prepare("SELECT count(*) n FROM palace_facts WHERE profile_id='legacy' AND scope='natal'").get().n,12);
results.push({case:'legacy-natal-ids-remain-readable-and-reused-within-original-profile'});
profile('legacy-orphan');const orphanPlan=plan('orphan-plan',[intervalTask('old-year',['夫妻'],'2024-01-01','2024-12-31')]),orphanPack=await buildPalaceFacts(chart,[{id:'old-target',date:'2024-07-01',year:2024,precision:'date',basis:'旧版本记录',palaces:['夫妻']}]);
insertTurn('legacy-orphan','legacy-orphan','2024年感情如何',{});const orphanCard={id:'legacy-orphan-card',sourceId:'legacy-orphan-a',kind:'historical_interpretation',userFocus:'2024年感情',interpretation:'旧版合成解读，保留原文。',userFacts:[],binding:orphanPack.bindings[0]};
sql.prepare('INSERT INTO palace_memories(owner,profile_id,chart_version,id,source_id,palace,target_year,target_date,kind,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('fixture','legacy-orphan',version,orphanCard.id,orphanCard.sourceId,'夫妻',2024,'2024-07-01',orphanCard.kind,await encryptKey(JSON.stringify(orphanCard),'fixture','memory:'+orphanCard.id),Date.now());
const recovered=await retrieve('legacy-orphan',orphanPlan);assert.equal(recovered.cards.length,1);assert.equal(recovered.cards[0].interpretation,orphanCard.interpretation);assert.equal(recovered.cards[0].factRecovery.kind,'deterministic_recalculation');assert(recovered.facts.some(f=>f.id===recovered.cards[0].binding.natalRef));assert.equal(sql.prepare("SELECT count(*) n FROM palace_facts WHERE profile_id='legacy-orphan'").get().n,0);
results.push({case:'orphaned-legacy-profile-facts-recomputed-read-only-without-cross-profile-read'});

profile('stale-chart');insertTurn('stale-chart','stale-chart','感情观是什么',{analysisPlan:{...natalPlan,chartVersion:'obsolete-chart'}});await enqueuePalaceMemory('fixture','stale-chart','stale-chart-a');const before=providerCalls;assert.equal((await processPalaceMemory('fixture','stale-chart',chart,connection)).status,'failed');assert.equal(providerCalls,before);assert.equal(sql.prepare("SELECT count(*) n FROM palace_memories WHERE profile_id='stale-chart'").get().n,0);
profile('changed-during-job');insertTurn('changed-during-job','changed-during-job','感情观是什么',{analysisPlan:natalPlan});await enqueuePalaceMemory('fixture','changed-during-job','changed-during-job-a');providerHook=async()=>{sql.prepare("UPDATE profiles SET revision=2 WHERE id='changed-during-job'").run();};assert.equal((await processPalaceMemory('fixture','changed-during-job',chart,connection)).status,'failed');providerHook=null;assert.equal(sql.prepare("SELECT count(*) n FROM palace_memories WHERE profile_id='changed-during-job'").get().n,0);
results.push({case:'stale-plan-and-concurrent-profile-revision-cannot-write-current-memory'});

profile('hypothesis');insertTurn('hypothesis','hypothesis','假如我已经结婚，我的感情观是什么',{analysisPlan:natalPlan});quoteOverride='我已经结婚';await archive('hypothesis','hypothesis');quoteOverride=null;assert((await retrieve('hypothesis',natalPlan)).cards.every(c=>c.userFacts.length===0));
results.push({case:'verbatim-hypothesis-is-not-promoted-to-user-statement'});

writeFileSync(out+'/results.json',JSON.stringify({realProviderCalls:0,mockProviderCalls:providerCalls,cases:results},null,2));console.log(JSON.stringify(results,null,2));console.log('PASS analysis-plan palace memory regression');
