import {referenceIds,scopeNames,type ChartData,type Scope} from './chart';
import {MAIN_STARS,MISSING_KNOWLEDGE} from './knowledge-contract';
import type {EventType} from './question-type';
import type {Evidence} from './workflow';
import type {DemandObservation} from './demand-observation';

export type DecisionEvidence=Evidence&{relations:{focusPalace:string;relation:'同宫'|'三合'|'对宫'}[]};
export type DecisionVerdict='supports'|'conditional'|'not_supported'|'insufficient_coverage';
export type DecisionMaterials={ruleId:string;verdict:DecisionVerdict;summary:string;conditions:string[];materialIds:string[];evidenceIds:string[];facts:string[];coverage:{reviewed:number;total:number};missingKnowledgeKeys:string[];factsConditional:true};
export const decisionPalaces=(event:EventType)=>event==='career'?['官禄','迁移','财帛']:event==='application'?['官禄','父母','福德']:event==='relationship'?['夫妻','福德','迁移']:['命宫','迁移','福德'];

/** Observe the already calculated days. Add decision evidence only at an actual long-cycle boundary. */
export function createDecisionCollector(event:EventType,observer?:DemandObservation){
 const registry=new Map<string,DecisionEvidence>(),signatures=new Map<Scope,string>(),queries:{scope:Scope;date:string;palaces:string[]}[]=[];
 const palaces=decisionPalaces(event);
 return {queries,evidence:()=>[...registry.values()],observe(c:ChartData){
  for(const scope of ['natal','decadal','yearly'] as const){
   const source=c.transformationSources[scope],names=scope==='natal'?c.palaces.map(p=>p.name):c.layers[scope].palaceNames;
   const signature=JSON.stringify([names,source.stemBranch,scope==='natal'?'本命':c.layers[scope].name,source.ageRange,source.yearRange,source.mutations.map(t=>[t.star,t.value,t.palaceIndex])]);
   if(signatures.get(scope)===signature)continue;signatures.set(scope,signature);
   observer?.begin();
   queries.push({scope,date:scope==='natal'?c.solarDate:c.target,palaces});
   const relations=new Map<number,DecisionEvidence['relations']>();
   for(const palace of palaces){const index=names.indexOf(palace);if(index<0)continue;
    for(const offset of [0,4,8,6]){const i=(index+offset)%12;relations.set(i,[...(relations.get(i)||[]),{focusPalace:palace,relation:offset===0?'同宫':offset===6?'对宫':'三合'}]);}
   }
   const items=referenceIds(c,scope,[...relations.keys()]);observer?.record(c,items,'decision',palaces);
   for(const e of items){const id=`${e.date}/${e.id}`;registry.set(id,{...e,id,relations:relations.get(e.index)!});}
   observer?.end();
  }
 }};
}

// These are explicit product decision policies, not claimed star meanings or new ancient-text entries.
const policies:Record<EventType,{summary:string;conditions:string[]}>= {
 career:{summary:'对于跳槽或职业变动，我建议先推进岗位比较、沟通与面试；拿到匹配且可落实的机会、能够承受过渡成本时，再考虑正式变动。不建议仅凭候选日期先辞职。',conditions:['新岗位的职责、待遇与入职安排已经核实','能够承受过渡成本，并完成合同与交接检查']},
 application:{summary:'对于申请或深造，我建议先推进材料准备与项目比较；研究或学习目标、资格条件和可投入资源匹配时，可以考虑申请。是否投入长期深造，要以这些条件是否成立为前提。',conditions:['目标项目的资格、方向和截止安排已经核实','时间投入与费用或资助条件可以落实']},
 relationship:{summary:'对于关系推进，我建议先沟通双方意愿与现实安排；双方明确同意、相关准备可落实时，再考虑推进。候选窗口本身不构成对方愿意或关系必然成功的依据。',conditions:['双方真实意愿已经沟通并达成一致','相关时间与现实安排能够共同落实']},
 general:{summary:'对于这项行动，我建议先做可逆的准备和小范围验证；目标明确、资源可承受时再逐步推进，涉及不可逆承诺时先核实条件。',conditions:['行动目标和必要条件已经明确','投入与可能损失在可承受范围内']}
};
export function buildDecisionMaterials(event:EventType,evidence:DecisionEvidence[]):DecisionMaterials{
 const policy=policies[event],layers=new Set(evidence.map(e=>e.scope));
 const verdict=layers.size===3?'conditional':'insufficient_coverage';
 const missing=[...new Set(evidence.flatMap(e=>e.stars.filter(s=>MAIN_STARS.has(s.name)).map(s=>`${e.scope}:${s.name}@${e.scopePalace}`)))].sort();
 const facts=evidence.filter(e=>e.relations.some(r=>r.relation==='同宫')).map(e=>{
  const mutations=e.stars.flatMap(s=>s.transformations.filter(t=>t.scope===e.scope).map(t=>`${t.star}${t.scope==='natal'?'生年':scopeNames[t.scope]}化${t.value}`));
  return `${e.label} · ${e.date}：${mutations.join('、')||'未检出本层四化落入此宫'}。`;
 });
 const ruleId=`policy.conditional.${event}.v1`;
 return {ruleId,verdict,summary:policy.summary+' 这是基于现实条件的建议；目前已核对的盘面事实还不足以给出经审校的命理适配性倾向。',conditions:policy.conditions,materialIds:[ruleId],evidenceIds:evidence.map(e=>e.id),facts,coverage:{reviewed:0,total:missing.length},missingKnowledgeKeys:missing,factsConditional:true};
}
export function renderDecision(materials:DecisionMaterials){
 return materials.summary+'\n\n'+MISSING_KNOWLEDGE+'。本命、大限与流年分别核对；以下窗口作为行动安排的后续参考。'+(materials.facts.length?'\n\n分层事实摘要：\n'+materials.facts.join('\n'):'');
}
