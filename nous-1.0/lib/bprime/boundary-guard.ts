import {normalizeGuardText,uniqueIssues,type FrameworkDraft,type GuardIssue,type AnswerContract} from './contracts';

export const BOUNDARY_VERSION='bp1-boundary.1';
// Language/product boundaries only. Never put star/palace interpretations into these lists.
const health=/(?:癌|病|症|伤残|残疾|受伤|伤亡|骨折|手术|死亡|丧命|瘫痪|流产|失明|失聪|抑郁|焦虑障碍|糖尿|心梗|中风|车祸)/u;
const person=/(?:你|您|命主|命例|当事人|本人|他|她|此人|对方)/u;
const assertion=/(?:会|患|得|发生|出现|遭|有|没有|并无|容易|可能|风险|概率|注定|必|一定|迟早|将在|应期|确诊|健康|平安|免于)/u;
const doubleNegative=/(?:并非不|不是不|不会不|不是没有|并非没有|未必不会|不能不|不一定不)/u;
const safeHealth=/^(?:不能|不可以|无法|不应)(?:仅)?(?:凭|从|据|依据)?(?:命盘|盘面|此|紫微斗数)?(?:来)?(?:判断|诊断|推断|预测|确定|得出)[^。！？；\n]*[。！？；]?$/u;
const safeReferral=/^(?:如果|如|若)?(?:有|出现|存在)(?:持续|明显|身体)?(?:不适|症状|疼痛)[，,]?(?:请|应|建议)?(?:及时|尽快)?(?:就医|寻求医学评估)[。！？；\n]?$/u;
export const RULE_BOUNDARIES={
 health:'不能从命盘判断是否患病或何时发生伤病；实际健康状况应依据真实情况与医学评估。',
 absolute:'可以讨论倾向、条件与行动选择，不能据此保证现实结果或给出成功概率。',
 facts:'这部分盘面表述与本轮计算依据未能对应，暂不据此作结论；其余独立内容需重新核对后保留。',
} as const;

/** An acknowledgement is allowed only against exact, server-supplied USER statements.
 * Assistant history and model-created assumptions are not evidence of a diagnosis.
 */
function removeAcknowledgements(s:string,contract?:AnswerContract){
 for(const c of contract?.conditions.filter(c=>c.origin==='user')||[]){
  const value=normalizeGuardText(c.text).replace(/[。！？；]$/u,'');
  for(const prefix of ['你已明确说：','你提到：','用户明确说：'])s=s.split(normalizeGuardText(prefix)+value).join('已述条件');
 }
 return s;
}
export function boundaryTextIssues(text:string,blockId:string|null,contract?:AnswerContract):GuardIssue[]{
 const issues:GuardIssue[]=[],add=(code:string)=>issues.push({guard:'boundary',code,blockId});
 const normalized=normalizeGuardText(text);
 const s=removeAcknowledgements(normalized,contract);
 // Check across sentences too: quotation marks or an earlier disease mention cannot launder
 // “因此你会…”. Safe denial is removed only when it occupies a whole sentence.
 const segments=s.match(/[^。！？；\n]+[。！？；\n]?/gu)||[];
 const unsafe=segments.filter(x=>!safeHealth.test(x.trim())&&!safeReferral.test(x.trim())).join('');
 if(health.test(unsafe)&&person.test(unsafe)&&assertion.test(unsafe))add('HEALTH_PERSONAL_INFERENCE');
 if(health.test(unsafe)&&doubleNegative.test(unsafe))add('HEALTH_NEGATION_AMBIGUOUS');
 if(health.test(unsafe)&&/(?:\d{4}|今年|明年|本月|下月|届时|应期|近期|迟早)/u.test(unsafe)&&assertion.test(unsafe))add('HEALTH_TIMING');
 let absolute=s.replace(/必修课|必要材料|必要条件|在一定程度上|一定程度|必要时|必须提交材料/gu,'中性词');
 // Only direct disavowals, not double-negative reassurances, may be removed.
 if(!doubleNegative.test(absolute))absolute=absolute.replace(/(?:不能|无法|不作|不是|并非|不代表|不能假定)(?:据此)?(?:保证|成功保证|一定|必然|注定|百分之百)[^。；！？\n]*[。；！？]?/gu,'边界说明');
 if(/(?:必(?:定|然|将|会|获|成|能)|一定(?:会|能|将|成功|录取|变现|发生)|注定|保证(?:你|您|成功|录取|变现|会|能)|百分之百|100\s*%|成功率\s*[:：为是]?\s*\d+(?:\.\d+)?\s*%)/u.test(absolute))add('ABSOLUTE_OUTCOME');
 if(doubleNegative.test(absolute)&&/(?:会|能|成功|录取|变现|健康)/u.test(absolute))add('NEGATION_AMBIGUOUS');
 return uniqueIssues(issues);
}
export function boundaryGuard(draft:FrameworkDraft,contract?:AnswerContract){
 const blocks=draft.blocks.filter(b=>b.kind!=='chart_fact');
 const issues=blocks.flatMap(b=>boundaryTextIssues(b.text,b.id,contract));
 // Cross-block anaphora is conservatively a whole-draft issue; do not keep its conclusion.
 const cross=boundaryTextIssues(blocks.map(b=>b.text).join('\n'),null,contract);
 for(const i of cross)if(!issues.some(x=>x.code===i.code))issues.push(i);
 return uniqueIssues(issues);
}
