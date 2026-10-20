// Synthetic protocol fixture only. The assertions exercise task/layer/citation contracts,
// never use this generated prose as evidence of real model answer quality.
export function depthAnswerFixture(data){
 const packet={...data.investigation};
 // Decode the wire format independently of production code so fixture assertions
 // still exercise actual palace/layer/candidate bindings after column encoding.
 for(const [key,table] of Object.entries(packet.tables||{}))packet[key]=table.rows.map(row=>({...Object.fromEntries(table.columns.map((name,i)=>[name,row[i]])),...row[table.columns.length]}));
 return {tasks:data.answerContract.tasks.map(t=>{
  const periods=packet.periods.filter(p=>p.taskId===t.taskId);
  const palaces=t.requiredPalaces||t.palaces||[],unique=a=>[...new Set(a)];
  const refs=role=>{const selected=periods.filter(p=>!role||p.role===role),all=selected.flatMap(p=>p.citations),scopes=['decadal','yearly'].flatMap(scope=>selected.filter(p=>p.scope===scope).slice(0,1).flatMap(p=>p.citations.slice(0,1))),palaceRefs=palaces.flatMap(p=>all.filter(id=>packet.facts.find(f=>f.id===id)?.palace===p).slice(0,1));return unique([...scopes,...palaceRefs,...all]).slice(0,24);};
  const palaceText=palaces.join('、')||'本轮主题宫位',detail='合成分层解释用于验证深度、层次和引用协议，不代表实际命理判断。这里分别说明支持信号、相反信号、层级主次和现实条件，并把每项判断绑定到当前任务的真实取数。大限只作为阶段背景，流年只作为阶段修饰；盘面倾向不等于用户已经发生的经历，也不保证未来事件。';
  return {taskId:t.taskId,conclusion:`合成协议回答直接回应“${t.question}”：围绕${palaceText}给出主次判断、适用条件和边界，并保留不同时间候选之间的差异。本段只验证交付结构与证据关联，不代表实际命理结论或确定事件。`,
   sections:t.requiredSections.map(kind=>{const role=kind==='natal'?'natal':kind==='current'?'current':kind==='trajectory'?'retrospective':undefined;return {kind,text:`${palaceText}：${detail}${detail}`,citations:refs(role)};}),
   comparison:t.comparisonTargets.map(c=>({candidateIds:[c.id],text:`${c.label} 单独比较：保留该候选的支持、冲突、父大限背景和与其他候选的具体差异；区段边界不是事件发生日，现实条件仍会改变选择。`,citations:c.citations.slice(0,24)}))};
 })};
}
