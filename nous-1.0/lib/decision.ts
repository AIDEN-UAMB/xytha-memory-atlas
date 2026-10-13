import type {ChartData,Scope} from './chart-model';
import {solarISO} from './query-dates';

type ChoiceKind='research'|'employment_project'|'employment'|'venture'|'solo'|'partnership'|'other';
export type Choice={id:'a'|'b';label:string;kind:ChoiceKind};
export type Comparison={choices:Choice[];year:string|null;requirements:string[]};
const kind=(s:string):ChoiceKind=>/读博|博士|深造|科研|学术/.test(s)?'research':/副业|兼职/.test(s)&&/工作|上班|在职|就业/.test(s)?'employment_project':/合伙|合作/.test(s)?'partnership':/单干|独立|自己做/.test(s)?'solo':/创业|项目|变现/.test(s)?'venture':/上班|工作|就业|入职/.test(s)?'employment':'other';
const terms:Record<ChoiceKind,RegExp>={research:/读博|博士|深造|科研|研究训练/,employment_project:/副业|兼职|小项目|业余项目/,employment:/工作|上班|就业|入职/,venture:/创业|项目|变现/,solo:/单干|独立|自己|单人/,partnership:/合伙|合作/,other:/$^/};
export function comparisonRequest(goal:string):Comparison|null{
 const pair=goal.split(/还是|或是/);if(pair.length!==2||!/适合|选择|选|哪|该|建议|深造|上班|工作|创业|单干|合伙|副业|路线|路径/.test(goal))return null;
 const left=pair[0].split(/[，,。；;？?\n]/).filter(Boolean).at(-1)||pair[0];
 const a=left.replace(/^.*?(?:适合|应该|选择|选|是)(?=.{2,}$)/,'').replace(/^(?:继续|先)/,'').trim();
 const b=pair[1].split(/[？?。；;\n]/)[0].replace(/[，,！!]+$/,'').replace(/[呢吗呀啊]$/,'').trim();
 if(!a||!b)return null;
 const choices:Choice[]=[{id:'a',label:a.slice(0,100),kind:kind(a)},{id:'b',label:b.slice(0,100),kind:kind(b)}];
 // A year comparison or a choice of chart layers is handled by normal time analysis.
 if(choices.every(c=>/^(?:本命|大限|流年|流月|流日|\d{4}年?)$/.test(c.label)))return null;
 if(choices.every(c=>c.kind==='other'&&/\d{4}年|\d{1,2}月|本月|下月|上半年|下半年|明年|今年/.test(c.label)))return null;
 return {choices,year:goal.match(/\b(19\d{2}|20\d{2}|2100)年?/)?.[1]||null,requirements:[
  '第一段给出有条件的倾向，或按不同目标明确选择；不要仅说各有利弊、无法判断或把选择反问给用户。',
  '分别比较两条路径的投入、机会成本、主要风险与适用条件；覆盖问题中指明的大限、流年和时代背景。',
  '说明什么现实条件会让建议反转，并给可以立即执行的下一步；未提供的条件必须用如果/假设表达。',
  '命盘事实与传统解释分开；人生路径选择不由星曜证明。没有检索实时行业资料时，不编造2026年的招聘、薪酬、政策或AI市场统计。'
 ]};
}
export function comparisonCoverage(text:string,comparison:Comparison){
 const issues:string[]=[];
 for(const c of comparison.choices){const found=c.kind==='other'?text.includes(c.label.slice(0,12)):terms[c.kind].test(text);if(!found)issues.push(`需要正面比较路径${c.id.toUpperCase()}：${c.label}。`);}
 const first=text.split(/\n\s*\n/)[0];
 if(!/倾向|优先|先|建议|选择|选|更适合|如果|若|取决于|暂以/.test(first))issues.push('比较问题的首段需要给出明确的条件性选择。');
 if(!/如果|假设|前提|若|除非|条件|取决于|一旦|尚未|未确认/.test(text))issues.push('需要写明比较建议成立的前提或改变选择的条件。');
 return issues;
}

/** Complete minimum layer coverage from code, without treating “2026年 + 还是” as a request to pick dates. */
export function comparisonQueries(c:ChartData,comparison:Comparison,today:string):{scope:Scope;date:string;palaces:string[];relations:boolean}[]{
 const date=comparison.year?(comparison.year===today.slice(0,4)?today:comparison.year+'-07-01'):today;
 const palaces=['命宫','官禄','财帛','福德','父母'];
 return [{scope:'natal',date:solarISO(c.solarDate),palaces,relations:false},{scope:'decadal',date,palaces,relations:false},{scope:'yearly',date,palaces,relations:false}];
}

/** A transparent conditional decision aid, not a personalized horoscope verdict or a pretend model reply. */
export function comparisonFallback(comparison:Comparison,statements:string[]=[]):string{
 const research=comparison.choices.find(c=>c.kind==='research'),jobProject=comparison.choices.find(c=>c.kind==='employment_project'),job=comparison.choices.find(c=>c.kind==='employment');
 const practical=jobProject||job;
 if(research&&practical){
  const side=!!jobProject;
  let funding=false,researchGoal=false,incomeGoal=false;
  for(const text of statements)for(const clause of text.split(/[，,。；;\n]/)){
   if(/如果|假设|假如|是否|\?|？|可能|不确定/.test(clause))continue;
   if(/(?:全奖|全额资助|资助).{0,6}(?:没了|没有|取消|中断|失去)|(?:没有|未|没拿到|取消).{0,8}(?:全奖|全额资助|资助)/.test(clause))funding=false;
   else if(/全奖|全额资助|资助已落实/.test(clause)&&/已|拿到|获得|落实|有/.test(clause))funding=true;
   if(/长期科研|学术研究|研究岗位|科研岗位/.test(clause))researchGoal=!/不想|不考虑|放弃|不是/.test(clause)&&/目标|想|希望|计划|决定/.test(clause);
   if(/现金流|赚钱|收入/.test(clause)&&/更看重|首要|优先|核心目标/.test(clause))incomeGoal=!/不再|不是|不想/.test(clause);
  }
  const prioritizeResearch=funding&&researchGoal&&!incomeGoal;
  const lead=prioritizeResearch?'按你已经明确提供的资助条件和长期研究目标，我会先倾向读博深造，把 AI 项目保留为与研究互补的实践。这个倾向以资助持续可用、导师与方向匹配为前提；不应因为“AI时代”就忽略你已说明的目标。':`如果暂以保留现金流、降低不可逆投入并验证真实需求为目标，我会先倾向「${practical.label}」，同时保留读博机会。这是按这一明确目标给出的条件性选择，并非认定你没有读博条件；如果核心目标是长期研究且资助、导师匹配，倾向会改变。`;
  const next=prioritizeResearch?'优先核对导师、课题、资助期限与培养要求；把 AI 项目限制在能支持研究的范围，并为研究投入设置阶段性评估。':side?'先用 8–12 周做一次小规模验证：只选一个用户群和一个问题，确认需求后再做最小可用产品，以真实试用、付费或复用反馈决定是否加码；同时核对潜在博士方向和资助，不急着辞职或取消申请。':'先核对目标岗位与博士项目的实际要求，分别列出可获得的经验、时间投入和资金条件，再选择最能弥补当前能力缺口的路径。';
  return `${lead}\n\n读博深造：更适合把长期研究训练、学术成果或要求博士训练的岗位作为核心目标。优势是持续积累研究能力；代价是数年的集中投入和机会成本。判断重点是研究问题是否值得长期做、导师与团队是否匹配、资助能否覆盖实际需要。仅仅因为 AI 正在兴起，并不足以决定必须读博。\n\n${side?'上班＋AI副业项目':'先就业'}：${side?'保留工作收入，利用固定的业余时间验证一个具体用户问题；优势是可以较小规模试错，风险是精力分散和项目一直得不到真实付费反馈。AI 工具的可用性不等于产品需求已经成立。':'先积累真实岗位经验、能力和现金流，再根据目标岗位是否确实需要研究训练决定深造。风险是工作内容可能与长期研究目标脱节，需要主动保留学习和申请时间。'}\n\n改变选择的条件：如果已经有高度匹配的研究方向、可靠资助和导师机会，而且未来目标依赖博士训练，我会把读博放在前面。${side?'反过来，如果更看重独立产品和商业验证，先保留工作并测试项目，更符合这种目标。':''}\n\n下一步：${next}${comparison.year?`\n\n关于 ${comparison.year} 年的大限与流年：命盘只能补充传统视角，不能证明读博或创业一定更成功。具体星曜与四化应以本轮计算的分层依据为准；这里的倾向来自上述明确假设，不把“AI时代”当作已经核实的行业红利。`:''}`;
 }
 const solo=comparison.choices.find(c=>c.kind==='solo'),partner=comparison.choices.find(c=>c.kind==='partnership');
 if(solo&&partner)return `如果项目还在验证阶段、尚未确认必须互补的资源，我会先倾向小规模单干；若已经明确缺少独自无法补齐的技术、渠道或交付能力，再优先考虑合伙。\n\n单干的优势是决策快、试错边界清楚，风险是能力与精力上限；合伙可以补齐资源，代价是沟通、责任和收益分配的协调成本。\n\n下一步先拆出一个可独立验证的任务，再用真实交付检验合作需求。若进入合伙，先明确投入、职责、收益与退出安排。这是基于项目条件的选择，不是命盘对成败的保证。`;
 const [a,b]=comparison.choices;
 return `比较「${a.label}」和「${b.label}」时，我建议暂以保留选择空间、验证关键假设为目标：优先推进能够小规模尝试、代价可承担且可以回退的那一条。现有已确认条件还不足以给两条路线强排一个个性化名次，因此不应凭命盘硬判输赢。\n\n对「${a.label}」，先核对实际投入、最可能获得的能力或回报，以及退出代价；对「${b.label}」，用同一标准核对，尤其留意它是否解决了另一条路线不能解决的核心问题。\n\n如果其中一条已经有明确机会、可验证的结果和可承担的成本，可以优先选择它；如果两条都尚未验证，先分别安排一个低成本试验，用真实反馈更新选择。先做可逆的一步，再决定长期投入，不需要为了开始分析而反复确认同一个问题。`;
}
