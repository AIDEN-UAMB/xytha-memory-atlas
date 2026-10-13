import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const output=root+'/.sites-runtime/verification';mkdirSync(output,{recursive:true});
import assert from 'node:assert/strict';
await build({entryPoints:[root+'/lib/chart.ts'],outfile:output+'/chart-bundle.mjs',bundle:true,platform:'node',format:'esm'});
const {createChart,example,hourIndex}=await import(output+'/chart-bundle.mjs');
const c=createChart(example,'2026-09-05');
assert.equal(c.solarDate,'1999-6-27');const soul=c.palaces.find(p=>p.name==='命宫');assert.equal(soul.earthlyBranch,'亥');assert(soul.majorStars.some(s=>s.name==='巨门'&&s.brightness==='旺'));assert(soul.minorStars.some(s=>s.name==='文曲'&&s.brightness==='旺'&&s.mutagen==='忌'));assert(soul.adjectiveStars.some(s=>s.name==='天贵'&&s.brightness===''));
assert.equal(c.decades[2].palaceName,'夫妻');const f=createChart({...example,gender:'女'},'2026-09-05');assert.equal(f.decades[2].palaceName,'福德');
for(const k of ['decadal','yearly','monthly','daily']){assert.equal(c.layers[k].palaceNames.length,12);assert.equal(c.layers[k].mutagen.length,4)}
assert.equal(hourIndex('12:59'),6);assert.equal(hourIndex('13:00'),7);assert.equal(hourIndex('14:59'),7);assert.equal(hourIndex('15:00'),8);assert.equal(hourIndex('23:25'),12);
assert.throws(()=>createChart({...example,calendar:'solar',date:'2025-02-30'},'2026-09-05'));
assert.throws(()=>createChart({...example,date:'1999-05-31'},'2026-09-05'));
assert.throws(()=>createChart({...example,leap:true},'2026-09-05'));
assert.throws(()=>createChart(example,'1998-01-01'));
const solar=createChart({...example,calendar:'solar',date:'1999-06-27'},'2026-09-05');assert.deepEqual(solar.palaces,c.palaces);
const next=createChart(example,'2026-09-06');assert.notEqual(next.layers.daily.index,c.layers.daily.index);assert.deepEqual(next.palaces,c.palaces);
console.log('PASS: example, solar/lunar equivalence, sex-dependent decades, all transit layers, hour boundaries, invalid dates, date-before-birth, natal stability.');

// Independent four-transformation table (iztro 2.6.1 default school); all ten birth-year stems.
const table={甲:['廉贞','破军','武曲','太阳'],乙:['天机','天梁','紫微','太阴'],丙:['天同','天机','文昌','廉贞'],丁:['太阴','天同','天机','巨门'],戊:['贪狼','太阴','右弼','天机'],己:['武曲','贪狼','天梁','文曲'],庚:['太阳','武曲','太阴','天同'],辛:['巨门','太阳','文曲','文昌'],壬:['天梁','紫微','左辅','武曲'],癸:['破军','巨门','太阴','贪狼']};
for(let year=1984;year<1994;year++){
 const sample=createChart({...example,calendar:'solar',date:`${year}-07-01`},'2026-09-06');
 for(const source of Object.values(sample.transformationSources)){
  assert.equal(source.mutations.length,4);
  assert.deepEqual(['禄','权','科','忌'].map(value=>source.mutations.find(t=>t.value===value).star),table[source.heavenlyStem]);
  for(const t of source.mutations){assert.equal(t.scope,source.scope);assert.equal(t.sourceId,source.id);assert.equal(t.natalPalace,sample.palaces[t.palaceIndex].name);assert.equal(t.scopePalace,t.scope==='natal'?t.natalPalace:sample.layers[t.scope].palaceNames[t.palaceIndex]);}
 }
}
assert.deepEqual(c.transformationSources.natal,next.transformationSources.natal);
assert.equal(c.transformationSources.natal.heavenlyStem,'己');assert.equal(c.transformationSources.natal.fixed,true);assert.equal(c.transformationSources.natal.observedOn,null);
assert.deepEqual(c.transformationSources.decadal.ageRange,[26,35]);assert.deepEqual(c.transformationSources.decadal.yearRange,[2024,2033]);
assert.equal(c.transformationSources.natal.mutations.find(t=>t.star==='文曲').value,'忌');
const future=createChart(example,'2027-07-01');assert.equal(future.transformationSources.decadal.mutations.find(t=>t.star==='巨门').value,'权');assert.equal(future.transformationSources.yearly.mutations.find(t=>t.star==='巨门').value,'忌');assert(!future.transformationSources.natal.mutations.some(t=>t.star==='巨门'));
const beforeNewYear=createChart(example,'2026-02-16'),afterNewYear=createChart(example,'2026-02-17');assert.equal(beforeNewYear.transformationSources.yearly.heavenlyStem,'乙');assert.equal(afterNewYear.transformationSources.yearly.heavenlyStem,'丙');
assert(c.palaces.some(p=>p.name==='交友'));for(const l of Object.values(c.layers))assert(l.palaceNames.includes('交友'));
const child=createChart(example,'1999-07-01');assert.equal(child.transformationSources.decadal.label,'童限四化');assert(!child.transformationSources.decadal.ageRange);
console.log('PASS: ten stems × five layers, stable natal sources, simultaneous transformations, lunar-year boundary, childhood and canonical friendship-palace names.');
