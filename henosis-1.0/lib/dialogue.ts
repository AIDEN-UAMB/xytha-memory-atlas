import {comparisonRequest} from './decision';
export type HistoryMessage={role:string;content:string;meta?:unknown};
export type DialogueRecord={version:1;goal:string;questionPolicy:'answer_first'|'one_essential_question';comparisonYear?:string};
export type DialogueContext={goal:string;turnKind:'new_question'|'context_reply'|'direct_answer'|'context_declined';clarificationAllowed:boolean;userStatements:string[];askedQuestions:string[];answeredQuestions:{question:string;answer:string}[];comparisonYear?:string};

function metadata(message?:HistoryMessage):Record<string,unknown>{
 try{const value=typeof message?.meta==='string'?JSON.parse(message.meta):message?.meta;return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}catch{return {};}
}
const topicPatterns=[/健康|身体|疾厄|睡眠|不适|失眠/,/学历|学位|读书|升学|学业|教育|学习/,/事业|工作|职业|创业|项目|单干|合作|跳槽/,/婚姻|感情|恋爱|伴侣|夫妻|结婚/,/财运|收入|投资|股票|财务/,/性格|优势|擅长|天赋/];
const topic=(text:string)=>topicPatterns.findIndex(re=>re.test(text));
export const questionsIn=(text:string)=>text.match(/[^。！!\n？?]*[？?]/g)?.map(q=>q.trim()).filter(Boolean)||[];
const compact=(text:string)=>text.normalize('NFKC').toLowerCase()
 .replace(/薪酬|薪资|工资|经济回报|赚钱/g,'收入').replace(/工作|职业/g,'事业')
 .replace(/一个人(?:做)?|独立(?:做)?|单独(?:做)?/g,'单干').replace(/与人合作|找人合作|找合伙人/g,'合作')
 .replace(/学历|学位/g,'教育程度').replace(/目前|现在/g,'当前').replace(/哪一种|哪一个/g,'哪个')
 .replace(/请问|麻烦|能否|可以|你认为|你觉得|想知道|想了解|希望了解|自己|本人|命主|[我你您]/g,'')
 .replace(/[\p{P}\p{Z}\s]|[吗呢呀啊的]/gu,'');
/** Conservative lexical/paraphrase guard, backed by the stronger per-goal clarification budget. */
export function sameQuestion(a:string,b:string){
 const x=compact(a),y=compact(b);if(!x||!y)return false;if(x===y)return true;
 if(Math.min(x.length,y.length)>=7&&(x.includes(y)||y.includes(x)))return true;
 const grams=(s:string)=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
 const gx=grams(x),gy=grams(y),overlap=[...gx].filter(v=>gy.has(v)).length;
 return Math.min(gx.size,gy.size)>=5&&2*overlap/(gx.size+gy.size)>=.72;
}
const direct=/直接(?:说|回答|分析|判断|解盘|给)|(?:别|不要|不用)(?:再)?(?:问|反问|确认|追问)|你(?:来|自己)(?:判断|分析|推断|决定)|已经(?:说|回答|告诉|提供)|反过来.*问|把.*问题.*(?:问|丢|抛|推).*我|我是问你|你怎么又问我|(?:你|这个回答|这次回答).{0,12}没(?:有)?(?:正面)?(?:回答|说|讲|提到)|没(?:有)?回答我的问题|答非所问|没有正面回答|别绕|不要绕|说重点|我问的(?:是|不是)/;
const declined=/不知道|不清楚|不方便(?:说|提供)|无法提供|不想(?:说|提供|回答)|没有更多(?:信息|资料)/;
const shortReply=/^(?:本命|大限|流年|流月|流日|都(?:看|要|关注|分析)?|全部|综合(?:分析)?|第[一二三123]个|前者|后者|是的?|不是|好的?|可以|继续|嗯|对|按你(?:判断|说的)|你(?:来|自己)(?:判断|分析))$/;
export function buildDialogueContext(question:string,input:HistoryMessage[]):DialogueContext{
 const history=input.slice(-32),lastAssistant=history.filter(m=>m.role==='assistant').at(-1),lastUser=history.filter(m=>m.role==='user').at(-1);
 const meta=metadata(lastAssistant),record=meta.dialogue as Partial<DialogueRecord>|undefined;
 const previousGoal=typeof record?.goal==='string'?record.goal.slice(0,3000):lastUser?.content||question;
 const correctedGoal=question.match(/我问的是(.+?)(?:而不是|不是|[。！!]|$)/)?.[1]?.trim().replace(/[，,；;]+$/g,'');
 const cleaned=question.trim().replace(/[。！？?!，,\s]/g,'');
 const previousQuestions=lastAssistant?questionsIn(lastAssistant.content):[];
 const asksNewQuestion=/[？?]|怎么|如何|为什么|什么|何时|哪年|(?:想|希望)(?:知道|了解)|帮我|看看|聊聊/.test(question.replace(/没有?什么|没啥|不怎么/g,''));
 // A reply such as “收入” answers a career follow-up; its keyword alone is not a topic switch.
 const currentTopic=topic(correctedGoal||question),answersAskedTopic=!asksNewQuestion&&currentTopic>=0&&previousQuestions.some(q=>topicPatterns[currentTopic].test(q));
 const yearReply=/^(?:那(?:么)?|改(?:成|为|看)|换(?:成|到)|看|按|如果是|假如是)?\s*(?:19\d{2}|20\d{2}|2100)年?(?:呢|的话|如何|怎么看|再比较|重新比较|[？?。!！\s])*$/.test(question);
 const decisionUpdate=!!comparisonRequest(previousGoal)&&!correctedGoal&&!/换个话题|另一个问题|健康|身体|婚姻|感情/.test(question)&&(/(?:资助|全奖|导师|现金流|研究方向|科研目标|付费用户|预算|时间投入)/.test(question)||/建议.{0,6}(?:改|变)|更新建议|重新比较/.test(question)||yearReply);
 const freshTopic=/换个话题|另一个问题/.test(question)||(currentTopic>=0&&topic(previousGoal)>=0&&currentTopic!==topic(previousGoal)&&!answersAskedTopic&&!decisionUpdate);
 const wasClarification=meta.responseType==='clarification'||previousQuestions.length>0;
 const followOn=!!lastAssistant&&/^(?:那(?:么|具体|接下来|应该|要|我)?|这样|这种|刚才|上述|基于这些|结合这些|按这个|接着|继续)/.test(cleaned);
 const timingRefinement=!!lastAssistant&&/什么时候|何时|哪天|哪个月|时间窗口/.test(previousGoal)&&/^(?:首选|备选|细化|精确|那个月)/.test(cleaned);
 const reply=!freshTopic&&(timingRefinement||decisionUpdate||shortReply.test(cleaned)||followOn||(wasClarification&&!asksNewQuestion));
 const directRequest=direct.test(question),contextDeclined=declined.test(question);
 const goal=correctedGoal||(reply||(!freshTopic&&(directRequest||contextDeclined))?previousGoal:question);
 const sameGoal=!freshTopic&&(reply||sameQuestion(goal,previousGoal)||directRequest||contextDeclined);
 const comparison=comparisonRequest(goal),yearChange=sameGoal&&!/出生|生于|毕业/.test(question)&&(/(?:那|改|换|看|按|考虑|比较|如果是|假如是).{0,16}(?:19\d{2}|20\d{2}|2100)年?/.test(question)||yearReply);
 const latestYear=yearChange?[...question.matchAll(/\b(19\d{2}|20\d{2}|2100)年?/g)].at(-1)?.[1]:undefined;
 const storedYear=typeof record?.comparisonYear==='string'&&/^(?:19\d{2}|20\d{2}|2100)$/.test(record.comparisonYear)?record.comparisonYear:undefined;
 const comparisonYear=comparison?(latestYear||(sameGoal?storedYear:undefined)||comparison.year):null;
 const answeredQuestions:DialogueContext['answeredQuestions']=[];
 for(let i=0;i<history.length;i++){
  if(history[i].role!=='assistant')continue;
  const answer=history.slice(i+1).find(m=>m.role==='user')?.content||(i===history.length-1?question:'');
  if(answer)for(const q of questionsIn(history[i].content))answeredQuestions.push({question:q.slice(0,300),answer:answer.slice(0,600)});
 }
 return {goal,...(comparisonYear?{comparisonYear}:{}),turnKind:directRequest?'direct_answer':contextDeclined?'context_declined':reply?'context_reply':'new_question',
  clarificationAllowed:!(directRequest||contextDeclined||(sameGoal&&(wasClarification||record?.questionPolicy==='answer_first'))),
  userStatements:history.filter(m=>m.role==='user'&&!/[？?]$/.test(m.content.trim())).slice(-8).map(m=>m.content.slice(0,400)),
  askedQuestions:history.filter(m=>m.role==='assistant').flatMap(m=>questionsIn(m.content)).slice(-12).map(q=>q.slice(0,300)),answeredQuestions:answeredQuestions.slice(-8)};
}
export function dialogueRecord(context:DialogueContext,questionConsumed=false):DialogueRecord{return {version:1,goal:context.goal,questionPolicy:context.clarificationAllowed&&!questionConsumed?'one_essential_question':'answer_first',...(context.comparisonYear?{comparisonYear:context.comparisonYear}:{})};}
export function clarificationIssue(candidate:string,current:string,context:DialogueContext){
 if(!context.clarificationAllowed)return '用户已回应澄清或要求直接回答，必须沿用已有条件推进。';
 if(questionsIn(candidate).length!==1)return '必要澄清只能包含一个问题。';
 if([current,context.goal].some(q=>sameQuestion(candidate,q)))return '不能把用户正在请你判断的问题反问给用户。';
 if(context.askedQuestions.some(q=>sameQuestion(candidate,q)))return '该问题已经问过，不能换一种说法重复确认。';
 if(/(?:你|您)(?:自己)?(?:觉得|认为|判断|猜测).{0,40}(?:适合|应该|如何|怎么|学历|学位|是什么|会不会|能不能)/.test(candidate))return '不能要求用户替模型给出所请求的判断。';
 if(/(?:要不要|需要我|是否要我|可以开始)|(?:希望|想|最在意).{0,20}(?:先|优先|哪方面|什么方向|哪个方向|还是)/.test(candidate))return '讨论方向已有问题与上下文可用，应先回答，不追加选题确认。';
 return '';
}
export function dialogueAnswerIssues(content:string,current:string,context:DialogueContext){
 // Quoting the user's question before answering it is not asking it back.
 const checked=content.replace(/[“「『][^”」』\n]*[”」』]/g,'').replace(/(?:你(?:刚才)?问的是|你(?:的)?问题是|针对你的问题)[：:]?[^。！!\n？?]*[？?]/g,'');
 const questions=questionsIn(checked);
 const issues:string[]=questions.map(q=>clarificationIssue(q,current,context)).filter(Boolean);
 const rest=content.replace(/[^。！!\n？?]*[？?]/g,'').replace(/[\s\p{P}]/gu,'');
 if(questionsIn(content).length&&rest.length<24)issues.push('回答只包含反问，尚未回应用户需要的分析。');
 if(/(?:请|需要你|能否).{0,12}(?:再|重新)(?:告诉|说明|确认|提供)/.test(checked)&&!context.clarificationAllowed)issues.push('不要用陈述句变相要求用户重复确认。');
 if(/(?:你|您)(?:自己)?(?:觉得|认为|判断|猜测).{0,40}(?:适合|应该|如何|怎么|学历|学位|是什么|会不会|能不能)/.test(checked))issues.push('不能省略问号后把用户请求的判断交回给用户。');
 if(/(?:需要我|要不要我|是否要我).{0,16}(?:继续|开始|分析|展开)|(?:你|您)(?:希望|想|最在意).{0,20}(?:先|优先|哪方面|什么方向|哪个方向|还是)/.test(checked))issues.push('先完成本轮回答，不要求用户再次选择展开方向或确认开始。');
 return [...new Set(issues)];
}
