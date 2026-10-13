/** One versioned palace registry for planning, evidence collection and memory retrieval.
 * Associations are traditional topic routing, not factual predictions about the user. */
export const QUESTION_DOMAIN_VERSION='question-domains.1';
export const PALACE_NAMES=['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','交友','官禄','田宅','福德','父母'] as const;
export type DomainId='career'|'wealth'|'education'|'relationship'|'health'|'self'|'siblings'|'children'|'parents'|'property'|'network'|'travel'|'wellbeing';
export type QuestionDomain={id:DomainId;label:string;re:RegExp;primary:string;corePalaces:string[];conditionalPalaces:{when:RegExp;palaces:string[];reason:string}[]};
export const QUESTION_DOMAINS:QuestionDomain[]=[
 {id:'career',label:'事业',re:/工作|事业|职业|跳槽|创业|上班|副业|项目|入职|升职|晋升|转职|适合干什么|适合做什么|干什(?:么|麼)|官禄/,primary:'官禄',corePalaces:['官禄','命宫'],conditionalPalaces:[{when:/收入|薪|钱|财|创业|副业/,palaces:['财帛'],reason:'收入和经营条件'},{when:/跳槽|转职|异地|出国|外派|迁|环境/,palaces:['迁移'],reason:'环境变化'},{when:/合作|合伙|团队|同事|客户/,palaces:['交友'],reason:'合作关系'}]},
 {id:'wealth',label:'财务',re:/钱|财运|财富|收入|财务|投资|资金|财帛|赚钱|薪资|工资|积蓄|债务|支出/,primary:'财帛',corePalaces:['财帛','官禄'],conditionalPalaces:[{when:/房|资产|积累|积蓄|储蓄/,palaces:['田宅'],reason:'资产积累'},{when:/合伙|合作|借钱/,palaces:['交友'],reason:'共同财务'}]},
 {id:'education',label:'学业',re:/学历|学位|学业|学习|升学|读博|读研|博士|硕士|考试|考研|留学|申请|投递/,primary:'官禄',corePalaces:['官禄','父母','福德'],conditionalPalaces:[{when:/出国|留学|异地/,palaces:['迁移'],reason:'学习环境迁移'}]},
 {id:'relationship',label:'婚恋',re:/婚|恋爱|感情|伴侣|对象|夫妻|交往|脱单|分手|复合/,primary:'夫妻',corePalaces:['夫妻','命宫','福德'],conditionalPalaces:[{when:/相识|社交|朋友|介绍|脱单/,palaces:['交友'],reason:'关系建立渠道'},{when:/异地|出国|远距离/,palaces:['迁移'],reason:'关系中的距离'},{when:/房|同居|家庭|成家/,palaces:['田宅'],reason:'共同生活条件'},{when:/父母|家长/,palaces:['父母'],reason:'双方家庭互动'}]},
 {id:'health',label:'身体与日常状态',re:/健康|身体|体质|睡眠|作息|不适|生病|住院|疾厄|失眠|病/,primary:'疾厄',corePalaces:['疾厄','福德','命宫'],conditionalPalaces:[{when:/出行|旅行|异地|环境/,palaces:['迁移'],reason:'生活环境'}]},
 {id:'self',label:'本征属性',re:/性格|优势|弱点|天赋|擅长|禀赋|本性|整体|全面|十二宫|适合我|我适合|命宫|身宫/,primary:'命宫',corePalaces:['命宫','福德'],conditionalPalaces:[{when:/外在|表现|他人眼中|人际/,palaces:['迁移'],reason:'外在表现'}]},
 {id:'siblings',label:'手足',re:/兄弟|姐妹|手足|哥哥|姐姐|弟弟|妹妹/,primary:'兄弟',corePalaces:['兄弟','命宫'],conditionalPalaces:[{when:/父母|家庭|家里/,palaces:['父母','田宅'],reason:'家庭关系背景'},{when:/合作|合伙|借钱/,palaces:['财帛','交友'],reason:'手足合作条件'}]},
 {id:'children',label:'子女',re:/子女|孩子|育儿|生育|备孕|怀孕|亲子|儿子|女儿/,primary:'子女',corePalaces:['子女','夫妻'],conditionalPalaces:[{when:/家庭|住|教育|养育/,palaces:['田宅'],reason:'养育环境'},{when:/体质|身体|健康|备孕|怀孕/,palaces:['疾厄'],reason:'身体状态描述，沿用健康边界'}]},
 {id:'parents',label:'父母与长辈',re:/父母|父亲|母亲|爸爸|妈妈|长辈|家长/,primary:'父母',corePalaces:['父母','命宫'],conditionalPalaces:[{when:/同住|家庭|家里|养老/,palaces:['田宅'],reason:'家庭照顾条件'}]},
 {id:'property',label:'居住与资产',re:/田宅|房产|买房|卖房|住房|搬家|安家|定居|居住|置业|家宅|装修/,primary:'田宅',corePalaces:['田宅','财帛'],conditionalPalaces:[{when:/搬家|定居|异地|出国/,palaces:['迁移'],reason:'居住迁移'},{when:/婚|伴侣|同居/,palaces:['夫妻'],reason:'共同居住关系'}]},
 {id:'network',label:'人际与合作',re:/交友|朋友|人际|同事|团队|合伙|合作|贵人|客户|下属|社交/,primary:'交友',corePalaces:['交友','命宫'],conditionalPalaces:[{when:/工作|事业|团队|同事|客户|下属/,palaces:['官禄'],reason:'职场关系'},{when:/投资|创业|合伙|资金|钱/,palaces:['财帛'],reason:'合作财务'}]},
 {id:'travel',label:'迁移与外部环境',re:/迁移|迁居|出国|异地|外派|旅行|旅游|出行|移民|外地|远行/,primary:'迁移',corePalaces:['迁移','命宫'],conditionalPalaces:[{when:/工作|事业|外派/,palaces:['官禄'],reason:'职业迁移'},{when:/定居|迁居|移民|住/,palaces:['田宅'],reason:'长期居住'}]},
 {id:'wellbeing',label:'内在感受',re:/福德|情绪|心态|心境|压力|焦虑|内耗|幸福|精神|满足感|安全感/,primary:'福德',corePalaces:['福德','命宫'],conditionalPalaces:[{when:/睡眠|作息|身体/,palaces:['疾厄'],reason:'日常恢复条件'},{when:/工作|事业|职业/,palaces:['官禄'],reason:'职业情境'}]},
];
export const DOMAIN_IDS=QUESTION_DOMAINS.map(domain=>domain.id);

/** Negative topic statements are not requests to analyse that topic. Keep subsequent clauses. */
export function requestedTopicText(question:string){
 return question.replace(/(?:不问|不看|不分析|不讨论|不考虑|不用看|不要分析|不是问)[^，,。；;？?\n]*?(?=，|,|。|；|;|？|\?|\n|而是|只问|只看|$)/g,'');
}
export function matchQuestionDomains(question:string):QuestionDomain[]{
 const text=requestedTopicText(question);
 return QUESTION_DOMAINS.filter(domain=>domain.re.test(text));
}
export function explicitQuestionPalaces(question:string):string[]{
 const text=requestedTopicText(question);
 return PALACE_NAMES.filter(p=>text.includes(p)||p==='命宫'&&text.includes('身宫'));
}
export function resolveQuestionPalaces(question:string,options:{fallback?:boolean}={}):string[]{
 const text=requestedTopicText(question);
 if(/十二宫|全盘|全面.{0,4}命盘/.test(text))return [...PALACE_NAMES];
 const domains=matchQuestionDomains(text),palaces=[...explicitQuestionPalaces(text),...domains.flatMap(d=>[...d.corePalaces,...d.conditionalPalaces.filter(c=>c.when.test(text)).flatMap(c=>c.palaces)])];
 return [...new Set(palaces.length?palaces:options.fallback===false?[]:['命宫','福德'])];
}
export function primaryDomainPalace(id:DomainId):string{return QUESTION_DOMAINS.find(d=>d.id===id)?.primary||'命宫';}
