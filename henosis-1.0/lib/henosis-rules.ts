import type {HenosisObservation,HenosisPlan,HenosisHypothesis,HenosisEvidenceBundle} from './henosis-contracts';

export const HENOSIS_RULE_VERSION='henosis-traditional-candidates.1';
const sourceUrl='https://zh.wikisource.org/zh-hans/紫微斗數全書/卷一';
type Dimension='处理方式'|'稳定与变化'|'资源安排'|'表达与辨析'|'照顾与协作'|'注意与复核';
type CandidateRule={id:string;trigger:string;dimension:Dimension;direction:string;sourceSection:string;palaces:string[];conditions:string[];alternatives:string[]};
const personal=['命宫','官禄','福德','迁移'],resource=['命宫','官禄','财帛','田宅'],relational=['命宫','官禄','夫妻','兄弟','交友','子女','父母','福德'];
const all=['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','交友','官禄','田宅','福德','父母'];
const rows:[string,Dimension,string,string[],string][]=[
 ['紫微','处理方式','统筹',personal,'问紫微所主若何？'],
 ['天机','稳定与变化','调整',personal,'问天机所主若何？'],
 ['太阳','照顾与协作','对外承担',personal,'问太阳所主若何？'],
 ['武曲','资源安排','执行分配',resource,'问武曲所主若何？'],
 ['天同','照顾与协作','温和协调',relational,'问天同所主若何？'],
 ['廉贞','处理方式','秩序边界',personal,'问廉贞所主若何？'],
 ['天府','资源安排','保管积累',resource,'问天府所主若何？'],
 ['太阴','照顾与协作','温和照料',[...relational,'田宅'],'问太阴所主若何？'],
 ['贪狼','稳定与变化','多样尝试',personal,'问贪狼所主若何？'],
 ['巨门','表达与辨析','辨析质询',personal,'问巨门所主若何？'],
 ['天相','照顾与协作','协调辅助',relational,'问天相所主若何？'],
 ['天梁','处理方式','稳健守护',[...personal,'父母'],'问天梁所主若何？'],
 ['七杀','处理方式','决断推进',personal,'问七杀所主若何？'],
 ['破军','稳定与变化','更替调整',[...personal,'财帛','田宅'],'问破军所主若何？'],
 ['禄','资源安排','资源支持',all,'问化禄星所主若何？'],
 ['权','处理方式','主动推进',all,'问化权星所主若何？'],
 ['科','表达与辨析','文事认可',all,'问化科星所主若何？'],
 ['忌','注意与复核','受阻复核',all,'问化忌星所主若何？'],
];
export const henosisCandidateRules:CandidateRule[]=rows.map(([trigger,dimension,direction,palaces,sourceSection],index)=>({
 id:`henosis:traditional:${index+1}:v1`,trigger,dimension,direction,sourceSection,palaces:[...new Set(palaces)],
 conditions:['须有引擎星曜或该层四化及正确宫位引用','宫位仅限定本议题；不能推成整个人的性格','同宫主星、三方四正、亮度及四化须共同核对'],
 alternatives:[trigger==='紫微'?'统筹也依赖配合条件，不能仅凭紫微认定现实领导身份':trigger==='天同'?'温和的象意不等于没有志向':trigger==='破军'?'耗与进退仅抽象成调整线索，不能直接认定创新能力或关系破裂':trigger==='忌'?'提醒复核不等于失败、疾病或已经发生的事件':'同宫其他星曜、层次与现实条件可提供不同解释','用户本人陈述和真实经历可以不支持本候选'],
}));
export const henosisRuleCatalog={
 version:HENOSIS_RULE_VERSION,status:'candidate_unreviewed',kind:'traditional_interpretation_policy',
 sources:[{id:'zwds-quanshu-1',url:sourceUrl,title:'紫微斗数全书·卷一',accessedAt:'2026-09-10',status:'public_transcription_not_scholarly_reviewed'}],
 coverage:{mainStars:14,transformations:4,reviewedEntries:0,unknown:'未列入的组合、格局、心理特质及现实事件不据此判定'},
 basis:'条目的短标签是基于原典星曜象意的保守现代抽象，不是原文逐字结论、科学结论或已审校知识库；未采用其中道德、性别、寿命和疾病断语。',
 rules:henosisCandidateRules.map(r=>({...r,sourceId:'zwds-quanshu-1',sourceUrl:sourceUrl+'#'+encodeURIComponent(r.sourceSection)})),
 comparison:{method:'同一议题宫位、同一维度的候选集合比较，无权重或心理分数',labels:{alignment:'候选方向相同',mixed:'部分方向相同，同时有新增方向',deviation:'已覆盖候选方向不同，不表示人格改变',unknown:'至少一层无适用规则',return:'当前候选与本命相同，紧邻的已发生大限候选不同；仅为解释回归线索'}},
};
const unique=<T>(values:T[])=>[...new Set(values)];
const group=<T>(items:T[],key:(item:T)=>string)=>{const map=new Map<string,T[]>();for(const item of items){const k=key(item);map.set(k,[...(map.get(k)||[]),item]);}return map;};

/** Conditional traditional interpretations. No user facts, scores, or clinical/personality assertions. */
export function deriveHenosisHypotheses(observations:HenosisObservation[],plan:HenosisPlan,references:HenosisEvidenceBundle['references']):HenosisHypothesis[]{
 const natalByIndex=new Map(observations.filter(o=>o.scope==='natal').map(o=>[o.palaceIndex,o])),refTasks=new Map(references.map(r=>[r.id,(Array.isArray(r.taskIds)?r.taskIds:[r.taskId]).filter((id):id is string=>typeof id==='string')]));
 const output:HenosisHypothesis[]=[];
 const applicable=(o:HenosisObservation)=>{
  const fixed=natalByIndex.get(o.palaceIndex),triggers=unique([...(fixed?.stars||[]).map(s=>s.name),...o.transformations.map(t=>t.value.replace(/^化/,''))]);
  return henosisCandidateRules.filter(r=>triggers.includes(r.trigger)&&r.palaces.includes(o.palace));
 };
 for(const originalTask of plan.tasks){
  const task={...originalTask,palaces:unique([...originalTask.palaces,...plan.henosis.additions.filter(a=>a.taskId===originalTask.id).flatMap(a=>a.query.palaces)])};
  if(!task.needsChart||task.precision==='none'||task.reasonCodes.includes('subject_identity_required'))continue;
  const members=observations.filter(o=>task.palaces.includes(o.palace)&&(o.taskId===task.id||o.scope==='natal'&&o.evidenceIds.some(id=>refTasks.get(id)?.includes(task.id))));
  for(const palace of task.palaces){
   const natal=members.find(o=>o.scope==='natal'&&o.palace===palace);if(!natal)continue;
   const baseline=group(applicable(natal),r=>r.dimension);
   const append=(dimension:string,claim:string,used:HenosisObservation[],rules:CandidateRule[],extra:string[]=[])=>{
    const evidenceIds=unique(used.flatMap(o=>[...o.evidenceIds,...(natalByIndex.get(o.palaceIndex)?.evidenceIds||[])])).filter(id=>refTasks.get(id)?.includes(task.id));
    if(!evidenceIds.length||!rules.length)return;
    output.push({id:`henosis:hypothesis:${task.id}:${output.length+1}`,taskId:task.id,dimension,claim,status:'interpretation_hypothesis',evidenceIds,ruleIds:unique(rules.map(r=>r.id)),alternatives:unique([...extra,...rules.flatMap(r=>r.alternatives)]),asOf:plan.henosis.asOf});
   };
   for(const [dimension,rules] of baseline)append(dimension,`${palace}的本命层在“${dimension}”上可提出${unique(rules.map(r=>r.direction)).join('、')}的议题处理候选；仅为传统象意，不是用户已确认的偏好或经历。`,[natal],rules);
   const comparisons=members.filter(o=>o.scope!=='natal'&&o.palace===palace).flatMap(o=>{
    // No matching rule is unknown, not an implied neutral/negative direction.
    // Do not emit repeated empty hypotheses; full observations remain available.
    const parent=o.scope==='decadal'?natal:members.filter(p=>p.scope==='decadal'&&p.palace===palace&&o.parentDecade&&p.parentDecade===o.parentDecade).sort((a,b)=>Number(b.date===o.date)-Number(a.date===o.date)||b.date.localeCompare(a.date))[0];
    const parentRules=parent?group(applicable(parent),r=>r.dimension):new Map<Dimension,CandidateRule[]>();
    const current=group(applicable(o),r=>r.dimension),dimensions=[...current.keys()];
    return dimensions.map(dimension=>{const base=parentRules.get(dimension)||[],now=current.get(dimension)||[],a=unique(base.map(r=>r.direction)).sort(),b=unique(now.map(r=>r.direction)).sort();
     const label: keyof typeof henosisRuleCatalog.comparison.labels=!a.length||!b.length?'unknown':a.join('|')===b.join('|')?'alignment':a.some(x=>b.includes(x))?'mixed':'deviation';
     return {o,parent,dimension,base,now,label,signature:[o.scope,o.role,o.temporalStatus,dimension,label,a.join(','),b.join(',')].join('|')};});
   });
   for(const rows of group(comparisons,r=>r.signature).values()){
    const {o,dimension,base,now,label}=rows[0],used=rows.map(r=>r.o),directions=unique(now.map(r=>r.direction)),dates=unique(used.map(x=>x.date)).sort(),span=dates.length===1?dates[0]:`${dates[0]}至${dates.at(-1)}的${dates.length}个已取样区段`;
    const earlier=members.filter(x=>x.palace===palace&&x.scope===o.scope&&(o.scope==='decadal'||x.parentDecade===o.parentDecade)&&x.role==='retrospective'&&x.temporalStatus==='past'&&x.date<o.date).sort((a,b)=>b.date.localeCompare(a.date))[0];
    const earlierRules=earlier?applicable(earlier).filter(r=>r.dimension===dimension):[],baseSet=unique(base.map(r=>r.direction)).sort().join('|'),earlierSet=unique(earlierRules.map(r=>r.direction)).sort().join('|');
    const returned=o.role==='current'&&label==='alignment'&&earlier&&earlierSet&&earlierSet!==baseSet&&!earlierRules.some(r=>base.some(b=>b.direction===r.direction));
    const relationship=returned?'return':label,description=henosisRuleCatalog.comparison.labels[relationship];
    const parents=rows.map(r=>r.parent).filter((p):p is HenosisObservation=>!!p);
    append(dimension,`${palace} ${span} ${o.scope}/${o.role}/${o.temporalStatus}：相对${o.scope==='decadal'?'本命':'所属大限'}，“${dimension}”${description}；候选为${directions.join('、')}。`,[natal,...parents,...used,...(returned?[earlier]:[])],unique([...base,...now,...(returned?earlierRules:[])]),[label==='unknown'?'至少一层无适用规则，比较保持未知':'候选集合变化不是现实心理变化，需同层关系证据和用户反馈检验']);
   }
  }
 }
 return output;
}
