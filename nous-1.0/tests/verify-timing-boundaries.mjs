import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const out=resolve('.sites-runtime/verification/timing-boundaries');mkdirSync(out,{recursive:true});
await build({entryPoints:['lib/chart.ts','lib/timing.ts','lib/timing-periods.ts'],outdir:out+'/bundles',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
const load=name=>import(pathToFileURL(out+'/bundles/'+name+'.mjs').href);
const {createChartReader,example}=await load('chart'),{splitTimingPeriods}=await load('timing-periods'),{analyzeTiming,timingModelContext,timingRecord,renderTiming,timingPalaces}=await load('timing');
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),days=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000);
const read=createChartReader(example),key=c=>JSON.stringify([c.age,...['decadal','yearly'].map(s=>[c.layers[s].index,c.layers[s].heavenlyStem,c.layers[s].earthlyBranch,c.layers[s].palaceNames,c.layers[s].mutagen,c.layers[s].stars])]);
const coverage=(periods,start,end)=>{
 assert.equal(periods[0].start,start);assert.equal(periods.at(-1).end,end);
 assert.equal(periods.reduce((n,p)=>n+days(p.start,p.end)+1,0),days(start,end)+1);
 for(let i=0;i<periods.length;i++){
  const p=periods[i];assert(p.start<=p.end);assert.equal(p.start.slice(0,4),p.end.slice(0,4));
  if(i)assert.equal(addDays(periods[i-1].end,1),p.start);
  assert.equal(key(read(p.start)),key(read(p.end)),'Enclosing year/decade must remain unchanged throughout each period');
 }
};
const results=[];

// Exhaustively compare one real year against the boundary search, including the lunar-year transition.
const actual=splitTimingPeriods(read,'2026-01-01','2026-12-31');coverage(actual,'2026-01-01','2026-12-31');
assert.deepEqual(actual.map(p=>[p.start,p.end]),[['2026-01-01','2026-02-16'],['2026-02-17','2026-12-31']]);
for(let d='2026-01-01';d<='2026-12-31';d=addDays(d,1)){const p=actual.find(p=>p.start<=d&&d<=p.end);assert.equal(key(read(d)),key(p.chart));}
results.push({case:'actual-normal-lunar-boundary-matches-every-day-of-2026',periods:actual.length});

const chart=read('2026-09-09'),request={goal:'2024年开始的恋爱什么时候适合结婚？',start:'2026-09-09',end:'2036-09-08',today:'2026-09-09',detail:'yearly',task:'relationship',assumptions:[],plan:{version:1,event:'结婚',backgroundEvents:[{text:'2024年开始恋爱',year:2024}],referenceDate:'2026-09-09',rangeSource:'age_default',focusEnd:'2031-09-08',retrospective:false,constraints:{excludedYears:[]}}};
let reads=0;const observed=[];
const analysis=await analyzeTiming(chart,request,undefined,undefined,date=>{reads++;return read(date);},c=>observed.push(c));
coverage(analysis.periods,request.start,request.end);assert(reads<170,'Ten years must not require a daily chart scan');
const years=Array.from({length:11},(_,i)=>2026+i);assert.deepEqual([...new Set(analysis.periods.map(p=>Number(p.start.slice(0,4))))],years);
assert.equal(analysis.periods[0].snapshot.date,request.start);assert(analysis.periods.every(p=>p.snapshot.date>=request.start&&p.snapshot.date<=request.end));
const model=timingModelContext(analysis),record=timingRecord(analysis);
assert.equal(model.coverage.days,days(request.start,request.end)+1);assert.equal(model.coverage.years,11);
assert.equal(model.currentEnvironment.referenceDate,request.today);assert.equal(model.currentEnvironment.nominalAge,chart.age);assert.equal(model.currentEnvironment.chronologicalAge,27);
const ordinal=chart.decades.findIndex(d=>chart.age>=d.ageRange[0]&&chart.age<=d.ageRange[1])+1;assert.equal(model.currentEnvironment.decade.ordinal,ordinal);
assert.equal(model.yearlyPeriods.length,analysis.periods.length);assert.equal(record.segments.length,analysis.periods.length);assert.deepEqual(record.plan,request.plan);
assert.deepEqual(record.palaces,['夫妻','命宫','福德']);assert.equal(new Set(model.natalPalaces.map(p=>p.id)).size,model.natalPalaces.length);assert(model.natalPalaces.length<=12);
for(const p of model.yearlyPeriods){
 assert(model.decades.some(d=>d.id===p.decadeId));
 assert(analysis.evidence.some(e=>e.date===p.observedOn&&e.scope==='yearly'),'Every compared segment needs year-scoped fact references');
 const c=read(p.observedOn);
 for(const f of p.yearlyLayer.focus){const natal=model.natalPalaces.find(n=>n.id===f.natalRef);assert(natal);assert.equal(natal.palace,c.palaces[f.index].name);assert.deepEqual(natal.majorStars,c.palaces[f.index].majorStars);assert.deepEqual(f.flowingStars,c.layers.yearly.stars[f.index]);}
}
for(const e of analysis.evidence){const c=observed.find(c=>c.target===e.date)||chart;for(const s of e.sources){assert.equal(c.transformationSources[s.scope].stemBranch,s.stemBranch);}}
assert.equal(new Set(analysis.windows.map(w=>w.start.slice(0,4))).size,analysis.windows.length);
assert(analysis.windows.every(w=>w.days.every(d=>d.layers.at(-1).scope==='yearly')));
const rendered=renderTiming(analysis);for(const year of years)assert(rendered.includes(year+' 年'));assert(!rendered.includes('7 月 1 日'));assert(!rendered.includes('可细化到'));
results.push({case:'rolling-ten-year-range-complete-context-and-time-bound-memory',chartReads:reads,years:model.coverage.years,periods:model.yearlyPeriods.length,contextCharacters:JSON.stringify(model).length,evidence:analysis.evidence.length});

const longRequest={...request,start:'2026-01-01',end:'2045-12-31'},long=await analyzeTiming(chart,longRequest);
coverage(long.periods,longRequest.start,longRequest.end);assert(long.yearlyContext.decades.length>=3);
const transition=long.periods.find((p,i)=>i&&p.snapshot.decade.ordinal!==long.periods[i-1].snapshot.decade.ordinal);assert(transition);assert.notEqual(transition.start.slice(5),'01-01');
const previous=long.periods[long.periods.indexOf(transition)-1];assert.equal(addDays(previous.end,1),transition.start);
assert.equal(previous.start.slice(0,4),transition.start.slice(0,4));
results.push({case:'twenty-years-cross-multiple-decades-with-intra-year-transition',decades:long.yearlyContext.decades.length,transition:transition.start});

const excluded=await analyzeTiming(chart,{...request,end:'2031-09-08',plan:{...request.plan,constraints:{excludedYears:[2027]}}}),excludedModel=timingModelContext(excluded);
assert(excluded.periods.every(p=>!p.start.startsWith('2027')));assert(excluded.windows.every(p=>!p.start.startsWith('2027')));assert(excludedModel.yearlyPeriods.every(p=>p.year!==2027));
assert.deepEqual(excludedModel.coverage.excludedYears,[2027]);assert.equal(excludedModel.coverage.days,days(request.start,'2031-09-08')+1-365);
results.push({case:'explicit-excluded-year-is-not-scanned-ranked-or-counted',excludedYears:excludedModel.coverage.excludedYears,includedDays:excludedModel.coverage.days});

const monthCross=await analyzeTiming(chart,{...request,start:'2026-12-20',end:'2027-01-08',detail:'monthly'}),monthRecord=timingRecord(monthCross);
assert.deepEqual([...new Set(monthRecord.segments.map(s=>s.year))],[2026,2027]);
for(const s of monthRecord.segments){assert.equal(s.date,s.start);assert.equal(s.start.slice(0,4),s.end.slice(0,4));}
assert.equal(monthRecord.segments.reduce((n,s)=>n+days(s.start,s.end)+1,0),20);
assert.deepEqual(monthRecord.windows,monthCross.windows.map(w=>({start:w.start,end:w.end})));
results.push({case:'monthly-window-kept-intact-while-memory-is-indexed-by-civil-year'});

for(const [start,end] of [['2026-02-16','2026-02-17'],['2026-02-17','2026-02-17'],['2026-12-31','2027-01-01'],['2036-09-01','2036-09-08']])coverage(splitTimingPeriods(read,start,end),start,end);
const controller=new AbortController();controller.abort();assert.throws(()=>splitTimingPeriods(read,'2026-01-01','2027-01-01',controller.signal),/abort/i);
assert.throws(()=>splitTimingPeriods(read,'2026-02-30','2026-03-01'),/RANGE/);
assert.throws(()=>splitTimingPeriods(read,'2026-01-01','2056-01-01'),/RANGE/);
assert.deepEqual(timingPalaces({task:'relationship',goal:'异地恋结婚，住房和经济需要考虑'}),['夫妻','命宫','福德','迁移','田宅','财帛']); // Shared domain registry defines core then conditional order.
results.push({case:'exact-boundary-single-day-year-end-cancellation-and-topic-binding'});

const healthRequest={...request,goal:'2026年之前哪年身体最需要注意',task:'general',start:'2016-01-01',end:'2025-12-31',plan:{...request.plan,event:'health',retrospective:true}};
const health=await analyzeTiming(chart,healthRequest),healthContext=timingModelContext(health),healthText=renderTiming(health);
coverage(health.periods,healthRequest.start,healthRequest.end);
assert.equal(health.comparisonMode,'descriptive');assert.deepEqual(health.windows,[]);assert.deepEqual(health.palaces,['疾厄','福德','命宫']);
assert.equal(healthContext.coverage.years,10);assert.equal(healthContext.comparisonMode,'descriptive');
for(let y=2016;y<=2025;y++)assert(healthText.includes(y+' 年'));
for(const p of health.periods)assert(health.evidence.some(e=>e.scope==='yearly'&&e.date===p.snapshot.date));
assert(!/优先参考|未选出候选|材料和沟通复核|候选日期用于/.test(healthText));
results.push({case:'historical-health-descriptive-comparison-has-all-years-and-no-action-ranking',periods:health.periods.length});

const shortHealth=await analyzeTiming(chart,{...healthRequest,start:'2025-09-01',end:'2025-09-30',detail:'monthly'});
assert.deepEqual(shortHealth.windows,[]);assert(shortHealth.evidence.length>0);
for(const p of shortHealth.periods)assert(shortHealth.evidence.some(e=>e.date===p.snapshot.date&&e.scope==='monthly'));
assert(renderTiming(shortHealth).includes('2025-09-01'));assert(!renderTiming(shortHealth).includes('无明显优势行动窗口'));
results.push({case:'short-health-comparison-retains-period-facts-without-fabricated-candidates'});

const careerCaution=await analyzeTiming(chart,{...healthRequest,goal:'2026年之前事业哪年需要注意',task:'career',plan:{...healthRequest.plan,event:'career'}});
assert.equal(careerCaution.comparisonMode,'descriptive');assert.deepEqual(careerCaution.windows,[]);assert.deepEqual(careerCaution.palaces,['官禄','命宫']); // Shared career core; migration is conditional on an environment-change question.
assert.equal(careerCaution.periods.length,health.periods.length);
results.push({case:'historical-caution-question-does-not-use-favorable-action-ranking'});

const actionWithCaution=await analyzeTiming(chart,{...request,goal:'2024年至2028年什么时候适合结婚，有什么注意事项？',start:'2024-01-01',end:'2028-12-31',plan:{...request.plan,event:'marriage',retrospective:true}});
assert.equal(actionWithCaution.comparisonMode,undefined);assert.equal(actionWithCaution.windows.length,2);
results.push({case:'caution-as-secondary-action-question-keeps-original-candidates'});

writeFileSync(out+'/results.json',JSON.stringify({realProviderCalls:0,results},null,2));console.log(JSON.stringify(results,null,2));
console.log('PASS timing boundaries: real local engine, complete intervals and annual context, no live model calls');
