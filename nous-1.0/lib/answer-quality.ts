import type {DialogueContext} from './dialogue';
import {comparisonRequest,comparisonCoverage,type Comparison} from './decision';

type Block={text:string;kind:string;evidenceIds:string[]};
export type AnswerContract={goal:string;chartLookup:boolean;educationOutcome:'ceiling'|'actual'|null;topics:string[];requirements:string[];comparison?:Comparison};
const education=/学历|学位|读研|读博|硕士|博士|本科|专科/;
const themeTerms:Record<string,RegExp>={教育:/学历|学位|读研|读博|硕士|博士|本科|专科|学习|学业|升学/,事业:/事业|工作|职业|创业|项目|跳槽|单干|合伙|合作/,感情:/婚姻|感情|恋爱|伴侣|夫妻|结婚/,财务:/收入|财运|财务|投资|资金/,健康:/健康|身体|睡眠|疾厄|作息/};

/** A response contract is about question coverage, not a claim that chart symbolism predicts facts. */
export function answerContract(question:string,dialogue:DialogueContext):AnswerContract{
 const goal=dialogue.turnKind==='new_question'?question:dialogue.goal;
 const outcome=education.test(goal)&&/(?:最高|上限|大概率|最可能|推测|猜测|猜|什么学历|什么学位|能到|能读到|能达到)/.test(goal);
 const chartLookup=!outcome&&/(?:列出|有哪些|有什么|有没有|是不是|是否|在哪|哪宫|查一下|查询|位置|亮度|四化来源|四化表|星曜表|星曜列表|[旺陷庙得利平]吗)/.test(goal)&&/星曜|星星|宫位|命宫|四化|生年|化[禄权科忌]|亮度/.test(goal)&&!/意味着|说明|影响|适合|怎么|如何|为什么/.test(goal);
 const educationOutcome=outcome?/(?:最高|上限|能到|能读到|能达到)/.test(goal)?'ceiling':'actual':null;
 const comparison=comparisonRequest(goal);
 if(comparison&&dialogue.comparisonYear)comparison.year=dialogue.comparisonYear;
 return {goal,chartLookup,educationOutcome,...(comparison?{comparison}:{}),topics:Object.entries(themeTerms).filter(([,re])=>re.test(goal)).map(([name])=>name),requirements:[
  '首段直接回答本轮问题；明确结论、条件性判断或具体的推断边界。',
  '依据服务于结论，不能用宫位与星曜清单替代回答。',
  '分别覆盖用户提出的多个问题；用户指出遗漏时优先补答遗漏。',
  '允许标明传统视角和条件的解释；不虚构现实经历、学历档位概率或确定的未来。',
  ...(comparison?comparison.requirements:[]),
  ...(educationOutcome?['直接谈学历或学位，区分既有学历、未来目标和传统学习象意。不能把命盘当作学历上限或录取概率模型。']:[]),
  ...(dialogue.turnKind==='direct_answer'?['这是用户要求纠偏的一轮，不要再解释服务流程、重新选题或复述上一条命盘清单。']:[])
 ]};
}

export function statedEducation(statements:string[]):string|null{
 let degree:string|null=null;
 for(const statement of statements)for(const clause of statement.split(/[，,。；;\n]/)){
  const negated=clause.match(/(?:没|未|不是).{0,6}(本科|硕士|博士|专科|高中).{0,4}(?:毕业|学位|学历)/);
  if(negated){if(degree===negated[1])degree=null;continue;}
  if(/如果|假如|假设|比如|打算|希望|准备|计划|争取|能否|能不能|可能|想要|目标|是否|毕业了吗|学位了吗|学历吗|吗$|\?|？/.test(clause))continue;
  const found=clause.match(/(?:我|本人|命主)(?:已经|已|是|目前|现在|有|获得|取得|拥有|刚刚|刚|的)*\s*(本科|硕士|博士|专科|高中)(?:研究生)?(?:毕业|学位|学历)/);
  if(found)degree=found[1];
 }
 return degree;
}
export function educationConclusion(contract:AnswerContract,statements:string[]=[]):string|null{
 const known=statedEducation(statements);
 if(known&&contract.educationOutcome==='actual')return `按你已经明确提供的教育经历，目前可确认的自述是${known}学历。这是沿用你的实际背景，不是由命盘推出来的；没有新的教育经历信息时，不应再把它猜成其他学历。`;
 if(known&&contract.educationOutcome==='ceiling')return `直接回答：你已经提到${known}毕业，这是目前已知的起点；命盘不能再给你设定一个“最高只能读到哪里”的上限。继续升学要按目标项目要求、研究兴趣和可投入的时间评估，不能从星曜换算出硕士或博士的录取概率。\n\n如果希望进一步深造，可以把下一阶段学历作为可争取的目标，逐项核对入学条件与研究训练是否匹配。目标可以调整，不应被命盘预设的学历档位限制。`;
 if(contract.educationOutcome==='ceiling')return '直接回答：这张命盘不能给出可信的“最高学历”档位。不能据此认定止于本科或硕士，也不能把博士视为必然结果；学历上限不应由命盘预设。\n\n如果目标是继续升学，硕士可以作为一个阶段，博士可以作为后续研究路径来评估；这属于目标规划，不是命盘预测。能否推进，要看实际学业基础、研究兴趣和可投入的时间。传统解盘可以讨论学习风格与可能的阻力，但没有可靠的方法把星曜换算成学历等级或录取概率。';
 if(contract.educationOutcome==='actual')return '直接回答：仅凭这张命盘，不能识别命主已经取得的学历或学位，没有依据在本科、硕士和博士之间选定一个“最可能”的答案。实际学历需要教育经历或记录来确认；传统学习象意与已经取得的学历是两件不同的事。';
 return null;
}

export function standaloneEducationQuestion(contract:AnswerContract){
 return !!contract.educationOutcome&&contract.topics.every(t=>t==='教育')&&!/如何|怎么|准备|备考|申请|学习风格|学习优势|象意|传统解读|仅按传统|娱乐|为什么|另外|还有|同时|分别|以及|[？?].*[？?]|列出|查询|有哪些/.test(contract.goal);
}

export function coverageIssues(blocks:Block[],contract:AnswerContract):string[]{
 if(contract.chartLookup)return [];
 const issues:string[]=[],first=blocks[0]?.text||'',content=blocks.map(b=>b.text).join('\n\n');
 if(blocks.length&&blocks.every(b=>b.kind==='chart_fact'))issues.push('只有排盘事实清单，没有回答用户需要的判断、解释或行动建议。');
 else if(blocks[0]?.kind==='chart_fact')issues.push('首段在罗列命盘；请把直接结论放在依据之前。');
 if(contract.educationOutcome&&!education.test(first))issues.push('首段没有回答学历或学位问题，应先说明可判断的层次或明确上限不能由命盘确定。');
 if(contract.comparison)issues.push(...comparisonCoverage(content,contract.comparison));
 // Only enforce literal topic coverage for explicit multi-part requests. A lone topic
 // may be answered with ordinary synonyms; semantic coverage remains the reviewer's job.
 if(/分别|同时|另外|还有|[？?].*[？?]/.test(contract.goal))for(const name of contract.topics)if(!themeTerms[name].test(content))issues.push(`遗漏了用户询问的${name}问题。`);
 // A negative review cannot be bypassed by relabeling a table of stars as a reflection.
 if(/^(?:先给.{0,100}(?:能核对|可核对)|当前可核对|目前能核对|以下是.{0,20}命盘)/.test(first))issues.push('不能以可核对的星曜清单代替本轮回答。');
 return [...new Set(issues)];
}

export function unavailableConclusion(contract:AnswerContract,reason:'format_recovery'|'evidence_recovery'){
 const educationAnswer=educationConclusion(contract);if(educationAnswer)return educationAnswer;
 const target=contract.goal.replace(/[？?]/g,'').slice(0,180);
 return `关于“${target}”，这次还没有形成可用的个性化结论。${reason==='format_recovery'?'模型返回格式未能完成修复':'生成的解读仍有未解决的依据或答题问题'}。这是本轮服务没有完成，不代表你的问题或已提供的条件有问题。原问题与上下文会继续保留。`;
}
