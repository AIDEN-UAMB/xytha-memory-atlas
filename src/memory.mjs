/** Public inspection primitives. No chart calculation or production ranking. */
export const LAYERS = Object.freeze(['natal','decadal','yearly','monthly','daily','hourly']);
export const LABELS = Object.freeze({natal:'本命',decadal:'大限',yearly:'流年',monthly:'流月',daily:'流日',hourly:'流时'});
export const COLORS = Object.freeze({natal:'#dc5363',decadal:'#369473',yearly:'#397bec',monthly:'#b58123',daily:'#9262cb',hourly:'#76a94d'});
export const PALACES = Object.freeze(['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','交友','官禄','田宅','福德','父母']);
export const AXES = Object.freeze([['命宫','迁移'],['兄弟','交友'],['夫妻','官禄'],['子女','田宅'],['财帛','福德'],['疾厄','父母']]);
const demand=(condition,message)=>{if(!condition)throw new Error(message);};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const shape=(value,keys)=>{demand(plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Unexpected or missing archive fields');};
const text=(x,max=6000)=>typeof x==='string'&&x.length>0&&x.length<=max;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().replace('.000Z','Z')===x;
function ids(items,label){demand(Array.isArray(items)&&items.length<=5000,`${label}: invalid list`);const seen=new Set();for(const item of items){demand(plain(item)&&text(item.id,100)&&!seen.has(item.id),`${label}: invalid or duplicate id`);seen.add(item.id);}return new Map(items.map(x=>[x.id,x]));}
export function validateArchive(archive){
 shape(archive,['version','synthetic','profiles','periods','sources','records','feedback']);
 demand(plain(archive)&&archive.version===1&&archive.synthetic===true,'Only v1 synthetic demonstration archives are accepted');
 const profiles=ids(archive.profiles,'profiles'),periods=ids(archive.periods,'periods'),sources=ids(archive.sources,'sources'),records=ids(archive.records,'records');
 for(const p of profiles.values()){shape(p,['id','name']);demand(text(p.name,80),'Invalid profile name');demand(archive.periods.filter(x=>x.layer==='natal'&&x.profileId===p.id).length===1,'Each profile needs exactly one natal root');}
 for(const period of periods.values()){
  shape(period,['id','profileId','layer','parentId','label','stemBranch','start','end']);
  const level=LAYERS.indexOf(period.layer);demand(level>=0&&profiles.has(period.profileId),'Invalid period layer/profile');
  demand(text(period.label,100)&&/^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/.test(period.stemBranch),'Invalid period label');
  demand(date(period.start)&&date(period.end)&&period.start<period.end,'Invalid period interval');
  if(level===0)demand(period.parentId===null,'Natal period cannot have a parent');
  else{const parent=periods.get(period.parentId);demand(parent&&parent.layer===LAYERS[level-1]&&parent.profileId===period.profileId,'Invalid period parent');demand(parent.start<=period.start&&parent.end>=period.end,'Child period outside parent');}
 }
 for(const source of sources.values()){shape(source,['id','profileId','at','question','answer']);demand(profiles.has(source.profileId)&&date(source.at)&&text(source.question)&&text(source.answer),'Invalid source');}
 for(const record of records.values()){
  shape(record,['id','profileId','sourceId','recordedAt','quote','summary','tags']);
  const source=sources.get(record.sourceId);demand(source&&source.profileId===record.profileId,'Record/source profile mismatch');
  demand(date(record.recordedAt)&&text(record.summary,1000)&&text(record.quote)&&source.question.includes(record.quote),'Source quote must be verbatim');
  demand(Array.isArray(record.tags)&&record.tags.length===6,'Exactly six archived tags are required');
  for(let i=0;i<6;i++){
   const tag=record.tags[i],period=periods.get(tag.periodId);
   shape(tag,['layer','periodId','stemBranch','palace','anchorPalace']);
   demand(tag.layer===LAYERS[i]&&period&&period.layer===tag.layer&&period.profileId===record.profileId,'Invalid tag period');
   demand(PALACES.includes(tag.palace)&&PALACES.includes(tag.anchorPalace)&&tag.stemBranch===period.stemBranch,'Invalid palace or stem-branch');
   if(i)demand(period.parentId===record.tags[i-1].periodId,'Record tags do not form a contiguous time path');
  }
 }
 const feedback=ids(archive.feedback,'feedback');
 for(const event of feedback.values()){shape(event,['id','recordId','kind','note','at']);demand(records.has(event.recordId)&&['useful','not-relevant','correction'].includes(event.kind)&&date(event.at)&&typeof event.note==='string'&&event.note.length<=500,'Invalid feedback event');}
 return archive;
}
/** Re-click cancels this node; changing any parent discards all descendants. */
export function selectPeriod(selection,id,archive,profileId){
 const period=archive.periods.find(p=>p.id===id&&p.profileId===profileId);
 if(!period||period.layer==='natal')return {...selection};
 const index=LAYERS.indexOf(period.layer),parent=LAYERS[index-1];
 if(index>1&&selection[parent]!==period.parentId)return {...selection};
 const next={};for(const layer of LAYERS.slice(1,index))if(selection[layer])next[layer]=selection[layer];
 if(selection[period.layer]!==id)next[period.layer]=id;
 return next;
}
export function optionsFor(archive,profileId,selection,layer){
 const i=LAYERS.indexOf(layer);if(i<1)return [];
 const parent=i===1?archive.periods.find(p=>p.profileId===profileId&&p.layer==='natal')?.id:selection[LAYERS[i-1]];
 return parent?archive.periods.filter(p=>p.profileId===profileId&&p.layer===layer&&p.parentId===parent):[];
}
/** Exact recorded metadata filtering, never a claim of predictive relevance. */
export function filterMemories(archive,{profileId,selection={},palace=null,query=''}={}){
 const needle=query.trim().toLocaleLowerCase();
 return archive.records.filter(record=>record.profileId===profileId&&Object.entries(selection).every(([layer,id])=>record.tags.some(t=>t.layer===layer&&t.periodId===id))&&(!palace||record.tags.some(t=>t.anchorPalace===palace))&&(!needle||[record.summary,record.quote].some(v=>v.toLocaleLowerCase().includes(needle))));
}
export function traceMemory(archive,id,profileId){const record=archive.records.find(r=>r.id===id&&r.profileId===profileId);if(!record)return null;const source=archive.sources.find(s=>s.id===record.sourceId&&s.profileId===profileId);return {record,source,feedback:(archive.feedback||[]).filter(f=>f.recordId===id)};}
export function sharedAxes(tags){return AXES.map(palaces=>({palaces,layers:tags.filter(t=>palaces.includes(t.anchorPalace)).map(t=>t.layer)})).filter(v=>v.layers.length>1);}
/** Append-only user feedback; archived source, summary and tags stay untouched. */
export function appendFeedback(archive,{id,recordId,profileId,kind,note='',at}){
 demand(traceMemory(archive,recordId,profileId),'Feedback profile mismatch');
 const next={...archive,feedback:[...(archive.feedback||[]),{id,recordId,kind,note,at}]};validateArchive(next);return next;
}
