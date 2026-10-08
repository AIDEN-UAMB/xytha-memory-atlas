import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDemo} from '../data/demo.mjs';
import {validateArchive,selectPeriod,optionsFor,filterMemories,traceMemory,appendFeedback,sharedAxes} from '../src/memory.mjs';
test('synthetic archive has valid source pointers and six contiguous layers',()=>assert.equal(validateArchive(freshDemo()).records.length,4));
test('new parent clears every descendant, re-click cancels, skipped layer does not select',()=>{
 const a=freshDemo(),p='sample-a';let s=selectPeriod({},p+'-day1',a,p);assert.deepEqual(s,{});
 s=selectPeriod(s,p+'-d1',a,p);s=selectPeriod(s,p+'-y1',a,p);s=selectPeriod(s,p+'-m1',a,p);
 assert.equal(Object.keys(s).length,3);s=selectPeriod(s,p+'-d2',a,p);assert.deepEqual(s,{decadal:p+'-d2'});
 assert.deepEqual(selectPeriod(s,p+'-d2',a,p),{});
});
test('only children of the selected parent are shown',()=>{
 const a=freshDemo();assert.equal(optionsFor(a,'sample-a',{},'yearly').length,0);
 assert.deepEqual(optionsFor(a,'sample-a',{decadal:'sample-a-d2'},'yearly').map(x=>x.id),['sample-a-y3']);
});
test('profile isolation applies to listing, source trace and feedback',()=>{
 const a=freshDemo();assert.equal(filterMemories(a,{profileId:'sample-b'}).length,1);
 assert.equal(traceMemory(a,'m-01','sample-b'),null);
 assert.throws(()=>appendFeedback(a,{id:'f1',recordId:'m-01',profileId:'sample-b',kind:'useful',at:'2026-10-08T11:00:00Z'}));
});
test('exact time/palace filtering never re-tags a historical record',()=>{
 const a=freshDemo(),before=JSON.stringify(a);
 const matches=filterMemories(a,{profileId:'sample-a',selection:{decadal:'sample-a-d1',yearly:'sample-a-y1'},palace:'迁移'});
 assert.deepEqual(matches.map(x=>x.id),['m-01']);assert.equal(JSON.stringify(a),before);
 assert.equal(filterMemories(a,{profileId:'sample-a',selection:{yearly:'sample-a-y2'},palace:'疾厄'}).length,0);
});
test('feedback appends events without overwriting source, summary or tags',()=>{
 const a=freshDemo(),before=structuredClone(a.records);
 const next=appendFeedback(a,{id:'f1',recordId:'m-01',profileId:'sample-a',kind:'correction',note:'Only in this context',at:'2026-10-08T11:00:00Z'});
 assert.equal(a.feedback.length,0);assert.equal(next.feedback.length,1);assert.deepEqual(next.records,before);assert.deepEqual(next.sources,a.sources);
 assert.throws(()=>appendFeedback(next,{...next.feedback[0],profileId:'sample-a'}));
});
test('source cannot be relinked across profiles, and quotes cannot be invented',()=>{
 const a=freshDemo();a.records[0].sourceId=a.sources[3].id;assert.throws(()=>validateArchive(a));
 const b=freshDemo();b.records[0].quote='invented quote';assert.throws(()=>validateArchive(b));
});
test('invalid dates, impossible parents, missing layers and inconsistent stem-branch are rejected',()=>{
 for(const mutate of [a=>a.periods[0].start='2026-02-30T00:00:00Z',a=>a.periods[2].parentId='missing',a=>a.records[0].tags.pop(),a=>a.records[0].tags[2].stemBranch='甲子']){const a=freshDemo();mutate(a);assert.throws(()=>validateArchive(a));}
});
test('shared-axis counts are descriptive, with no preference score',()=>{
 const axes=sharedAxes(freshDemo().records[0].tags);assert.deepEqual(axes,[{palaces:['命宫','迁移'],layers:['natal','decadal','yearly','monthly','daily','hourly']}]);
 assert(!('score' in axes[0]));
});
test('JSON export/import round trip preserves provenance',()=>{const a=freshDemo();assert.deepEqual(validateArchive(JSON.parse(JSON.stringify(a))),a);});
test('undeclared fields and duplicate natal roots are rejected',()=>{
 const a=freshDemo();a.records[0].privateExtra='must not be carried through';assert.throws(()=>validateArchive(a));
 const b=freshDemo();b.periods.push({...b.periods[0],id:'extra-root'});assert.throws(()=>validateArchive(b));
 const c=freshDemo();c.feedback=null;assert.throws(()=>validateArchive(c));
});
