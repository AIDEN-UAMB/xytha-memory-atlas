export const connection={provider:'custom',baseUrl:'https://mock.example.com/v1',protocol:'openai-chat',model:'fixture-model',key:'mock-only',jsonMode:true,thinking:'auto'};
export const comparisonText=[
 '如果暂以保留现金流并验证产品需求为目标，我会先倾向上班＋AI副业，把读博作为有明确研究目标和资助条件时再优先推进的选项。',
 '读博深造的收益是研究训练与学术积累，代价是时间投入与机会成本；如果导师方向和资助匹配，并以长期研究为目标，读博更合适。',
 '上班＋AI副业可以保留工作收入，以小规模项目验证需求；风险是精力分散和缺少真实付费反馈，不能假定一定变现。',
 '改变选择的条件是出现匹配的研究机会，或者项目获得持续真实需求。下一步先做短周期用户验证，同时核对导师与资助。'
];
export const specimens=[
 {id:'general-career',question:'我适合跳槽吗？',history:[],memories:[],feedback:[]},
 {id:'general-history',question:'我适合跳槽吗？',history:Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',content:i%2?'沿用已经明确的条件，分开讨论目标与准备。'.repeat(8):'我希望先比较岗位要求和现实准备，保留已有收入。'.repeat(8)})),memories:['先给结论，再说明条件。'],feedback:[{content:'希望回答切题并保留现实条件。',feedback:-1}]},
 {id:'general-comparison',question:'2026年继续读博还是上班做AI副业更适合？',history:[],memories:[],feedback:[]}
];
export const plan={intent:'事业选择',mode:'answer',questions:[],subquestions:[],outline:[],queries:['natal','decadal','yearly'].map(scope=>({scope,date:'2026-09-07',palaces:['官禄','迁移','财帛'],relations:true}))};
export const audit=pass=>({pass,checks:{facts:'pass',boundaries:'pass',references:'na',relevance:pass?'pass':'fail'},issues:pass?[]:[{code:'补充行动条件',blockId:null}]});
const objects=t=>t.rows.map(r=>Object.fromEntries(t.columns.map((k,i)=>[k,r[i]])));
export function factRows(data){
 if(data.decisionEvidence)return objects(data.decisionEvidence).flatMap(e=>e['stars(ref,star,brightness,transformationRefs)'].map(s=>({ref:s[0],scope:e.queryScope,star:s[1],date:e.date})));
 return objects(data.evidence).flatMap(e=>objects(e.stars).map(s=>({ref:s.ref,scope:e.scope,star:s.name,date:e.date})));
}
export function validDraft(data){
 const c=data.frameworkContract,rows=factRows(data),refs=c.requiredScopes.map(scope=>rows.find(f=>f.scope===scope).ref),comparison=c.options.length>1;
 const texts=comparison?comparisonText:['我建议先推进岗位比较；有匹配的职责、待遇及可承受的过渡成本时，再考虑变动。下一步先核实岗位安排，不仅凭命盘作决定。'];
 const blocks=texts.map((text,i)=>({id:'b'+i,kind:'condition',conditionIds:[],assumptionIds:['a1'],text,optionId:comparison?(i===1?c.options[0][0]:i===2?c.options[1][0]:null):null}));
 const windows=(data.timing?.windows?.windows||[]).map(w=>w[0]);
 if(windows.length){
  blocks.push({id:'explanation',kind:'traditional_interpretation',subjectRefs:refs,text:'从传统视角，结合已计算的长短周期依据比较行动条件。盘面参考不等于现实结果；岗位安排和已确认条件优先。',optionId:null});
  for(const [i,id] of windows.entries())blocks.push({id:'w'+i,kind:'traditional_interpretation',subjectRefs:refs,windowId:id,text:'这组候选范围可以用于比较行动安排。传统层级信息仅供参考，准备程度、实际机会和已经确认的时间安排优先；不能把程序排序解释为成功保证。',optionId:null});
 }
 blocks.push({id:'facts',kind:'chart_fact',factRefs:refs});
 return {decision:{targetId:c.targetId,stance:'conditional',preferredOptionId:c.options.at(-1)[0],conditionIds:[],assumptionIds:['a1']},blocks,windowIds:windows,references:[]};
}
export const identity=requestId=>({owner:'fixture',profileId:'fixture',profileRevision:1,requestId});
