import {QUESTION_DOMAINS,matchQuestionDomains,requestedTopicText,type DomainId} from './question-domains';

/** Henosis-only interpretation. Never change the shared Nous classifiers. */
export function henosisNatalOnly(text:string){
 if(/(?:不要|不能|不应|不必|不)只(?:根据|依据|看|分析)/.test(text)||/(?:另外|另一个问题|再问|第二)[^。！？]{0,30}(?:未来|今年|明年|\d{4}年)/.test(text))return false;
 return /(?:只|仅)(?:根据|依据|看|分析|论|从)[^。！？;；]{0,12}本命/.test(text)
  || /不(?:分析|考虑|看)(?:任何)?(?:运限|大限|流年)(?:或|和|及)?(?:未来年份)?/.test(text)&&/本命/.test(text);
}
export function henosisDomains(text:string):DomainId[]{
 // Suitability is not a health symptom. Negated topic handling remains shared.
 const cleaned=text.replace(/不适合/g,'适合性').replace(/不适宜/g,'适宜性');
 const ids=matchQuestionDomains(cleaned).map(d=>d.id);
 if(/转行|换行业|换赛道|职业转换|独立经营|专业执行|职业方向/.test(requestedTopicText(cleaned))&&!ids.includes('career'))ids.push('career');
 return ids;
}
export function henosisDomainPalaces(ids:DomainId[]){return [...new Set(QUESTION_DOMAINS.filter(d=>ids.includes(d.id)).flatMap(d=>d.corePalaces))];}

/** Connectors and enumeration may be attached losslessly; dates/negation never skipped. */
export function henosisConnector(text:string){
 return !text.replace(/[\s，,。；;！？!?、：:]/g,'').replace(/^(?:(?:请)?分别回答(?:以下|这)?[两二三四五六\d]+个问题)?(?:第[一二三四五六\d]+)?$/,'').replace(/^(?:及|和|与|并|以及|然后|再)$/,'');
}

/** Method clauses are constraints on an event, not independently answerable goals.
 * Semantic roles may supplement this conservative compatibility recognizer. */
export function henosisPresentationConstraint(text:string){
 const s=text.trim().replace(/[。；;！？!?]+$/,'');
 if(/(?:另一个|另外问|第二个问题|是否|何时|什么时候|哪年|哪一年)/.test(s))return false;
 return /^(?:请)?(?:再|然后)?结合本命[、，,]大限与?目标流年逐年比较/.test(s)
  || /^(?:如果|若)跨大限[，,]?(?:请)?说明变化$/.test(s)
  || /^(?:请)?(?:最后|再|然后)?(?:给出|列出|说明)(?:优先顺序|优先级|成立条件|不确定|现实条件|关键依据)/.test(s)
  || /^(?:只|仅)(?:分析|比较|精确|细化)(?:到|至)(?:年份|年|大限|月份|月)(?:[，,].*)?$/.test(s)
  || /^(?:不必|无需|不用|不要)(?:推算|分析|细化)(?:到)?(?:月份|流月|日期|流日)$/.test(s)
  || /^(?:[^。！？?]{1,30})(?:不足|未提供|未知|不明确)时[，,]?(?:请)?(?:明确|说明|列出)(?:哪些|需要哪些|还需)[^。！？?]*(?:信息|条件)[^。！？?]*(?:建议|判断|结论|补充)$/.test(s);
}
export function henosisBackgroundRequirement(text:string){
 return /回顾|对照|回看/.test(text)&&/(?:作为|仅作|用作|以此为)(?:比较|分析|决策)?背景/.test(text)
  && !/(?:另外|另一个问题|独立回答|分别回答)/.test(text);
}
export function henosisBriefAnswer(text:string){
 const clauses=text.split(/[。；;！？!?]/).map(s=>s.trim());
 return clauses.some(s=>/^(?:请)?(?:整体|全文|回答|答案)?(?:保持|尽量|用)?(?:简短|简洁|简要)(?:地)?(?:回答|说明|解说|分析)?$/.test(s)
  || /^(?:请)?(?:用)?一句话(?:回答|说明|概括)/.test(s)||/^(?:请)?只(?:给|说|要)(?:结论|结果)/.test(s));
}
export function henosisDecisionTargets(text:string){
 const targets=[...text.matchAll(/哪(?:一)?年(?:更)?适合([^？?。；;，,]+)/g)].map(m=>m[1].trim());
 return [...new Set(targets)].slice(0,6);
}
export function henosisAnalysisFacet(text:string){
 if(henosisPresentationConstraint(text))return true;
 const clauses=text.split(/[，,。；;！？!?]/).map(s=>s.trim()).filter(Boolean);
 if(clauses.length>1)return clauses.every(henosisAnalysisFacet);
 const s=text.replace(/[\s，,。；;！？!?、：:]/g,'');
 if(/^(?:不包含|排除|不包括)(?:19|20)\d{2}年?$/.test(s)||/^\d{4}年(?:只是|是)背景$/.test(s)||/^不是(?:结婚|创业|行动|调查)范围的终点$/.test(s))return true;
 if(/(?:19|20)\d{2}|未来[一二三四五六七八九十\d]+年|过去[一二三四五六七八九十\d]+年|第[一二三四五六\d]+大限/.test(s))return false;
 if(/(?:什么时候|何时|适不适合|是否|怎样|哪年|吗[？?]?$)/.test(s))return false;
 return /^(?:请)?(?:先)?(?:结合|分析|说明)?(?:我的)?(?:当前年龄|本命(?:偏好|关系特征|相关宫位|基础|特征)|当前(?:环境|大限|流年))/.test(s)
  || /^(?:再|然后|请)?(?:对照|回顾|比较|结合)?(?:过去的?变化|历史变化|过去当前大限的变化)/.test(s)
  || /^(?:如果|若)(?:跨|进入|跨入|跨过)(?:下一个?|下一)?大限/.test(s)
  || /^(?:请)?(?:自行|自动)?确定合理(?:的)?(?:未来)?调查范围/.test(s)
  || /^(?:请)?(?:逐年|分别)比较并说明(?:成立)?条件/.test(s)
  || /^(?:请)?给出适合(?:准备|试行|正式行动)/.test(s)
  || /^(?:请)?(?:两个|两项|各个)问题使用各自/.test(s)
  || /^(?:即使(?:其中|第)?一个问题(?:资料不足|无法确定|不适合行动)|也要独立回答|不要求唯一最佳|不把推测写成|不細化|不细化|不分析流月|(?:也)?不要分析到月份|请以相关本命|各年所属大限和流年为依据|(?:请)?先说明新大限背景|请展示分层依据)/.test(s);
}

/** Keep the event target apart from instructions about examining its layers.
 * Explicit date constraints survive; their original source is never rewritten. */
export function henosisTargetText(text:string){
 const clauses=text.split(/(?<=[，,。；;！？!?])/);
 const kept=clauses.filter(s=>!henosisAnalysisFacet(s)||/^(?:不包含|排除|不包括)/.test(s.trim()));
 return kept.join('').replace(/(?:不包含|不包括)(?=\d{4})/g,'排除')||text;
}

/** Conservative lossless fallback for one event or explicitly enumerated goals.
 * Returns source spans, not invented user requests or chart facts. */
export function henosisFallbackSpans(question:string){
 if(/(?:过去|此前|近)[一二三四五六七八九十\d]+年/.test(question)&&/(?:未来|往后|接下来)[一二三四五六七八九十\d]+年/.test(question))return undefined;
 const markers=[...question.matchAll(/第[一二三四五六][，,、：:]/g)];
 if(markers.length>=2){
  return markers.map((m,i)=>({start:i?m.index!:0,end:markers[i+1]?.index??question.length}));
 }
 const firstEnd=question.search(/[。？?]/),head=firstEnd<0?question:question.slice(0,firstEnd+1),tail=firstEnd<0?'':question.slice(firstEnd+1);
 const singleDomain=henosisDomains(head).length>0;
 const methodTail=!tail||henosisAnalysisFacet(tail);
 if(henosisNatalOnly(question)||singleDomain&&methodTail)return [{start:0,end:question.length}];
 return undefined;
}
