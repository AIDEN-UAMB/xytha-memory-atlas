import {rawDb} from '@/db/raw';
import {matchQuestionDomains} from './question-domains';
import {parseTemporalIntent} from './temporal-intent';
import {todayShanghai} from './chart';

export type PersonalMemoryKind='fact'|'preference'|'goal'|'interpretation';
export type PersonalMemory={id:string;content:string;kind:PersonalMemoryKind;sourceId:string|null;sourceQuote:string;sourceKind:'manual'|'explicit_rule';createdAt:number;updatedAt:number;expiresAt?:number;eventStart?:string;eventEnd?:string;domains:string[]};
export type PersonalSummary={method:'rule_extract_v1';text:string;sourceIds:string[];updatedAt:number};
export type PersonalCorrection={id:string;memoryId:string;action:'updated'|'deleted'|'superseded';sourceId:string|null;sourceQuote:string;previousContent:string;replacement?:string;createdAt:number;relatedSourceIds?:string[]};
export const personalDomains=(text:string)=>matchQuestionDomains(text).map(d=>d.id);
export function personalEventBounds(text:string,recordedAt=Date.now()){
 const reference=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(recordedAt));
 const intent=parseTemporalIntent(text,reference),base=Number(intent.referenceDate.slice(0,4)),offsets:Record<string,number>={前年:-2,去年:-1,今年:0,明年:1,后年:2};
 const years=[...text.matchAll(/\b(19\d{2}|20\d{2}|2100)年/g)].map(m=>Number(m[1])).concat(intent.explicitYears,[...text.matchAll(/前年|去年|今年|明年|后年/g)].map(m=>base+offsets[m[0]]));
 return years.length?{eventStart:`${Math.min(...years)}-01-01`,eventEnd:`${Math.max(...years)}-12-31`}:{};
}
/** Only two explicit current-state slots; a shared domain alone never proves a correction. */
export function personalStatementSlot(text:string){
 const s=text.replace(/(?:更正|纠正)[：:]?\s*/g,'').replace(/\b(?:19\d{2}|20\d{2}|2100)年/g,'').trim();
 if(/^我(?:本人)?(?:目前|现在|已经|已)?(?:是)?(?:单身|未婚|已婚|结婚了|分手了|离婚了|有(?:了)?(?:对象|伴侣)|在恋爱|正在恋爱|开始恋爱|脱单了)/.test(s))return {slot:'relationship_status',domain:'relationship'};
 const nonCurrent=/工作过|就职过|任职过|实习过|待过|呆过|曾|过去|以前|从前|当时|原来|原先|之前|离职|将来|未来|以后|明年|后年|准备|计划|打算|想去|想在|会在|将(?:在|去)/.test(s);
 if(!nonCurrent&&/^我(?:本人)?(?:目前|现在|已经)?(?:在|就职于|任职于)[^，,。；;!?？]{1,32}?(?:公司|企业|机构|工作室)/.test(s))return {slot:'current_employer',domain:'career'};
 return null;
}
const explicit=/^(?:更正[：:]?\s*|纠正[：:]?\s*)?我(?:本人)?(?:的|目前|现在|已经|在|是|有|没有|喜欢|不喜欢|偏好|希望|想要|计划|打算|目标|正在|不想|不愿|愿意|准备|决定|不再|想)/;

/** Conservative, quote-preserving user statements only. No model call or inferred personality. */
export function extractPersonalMemories(question:string,sourceId:string,now=Date.now()){
 if(/如果|假如|假设|要是/.test(question))return [];
 const clauses=question.match(/[^，,。；;！？!?\n]+[！？!?]?/g)||[];
 return clauses.map(s=>s.trim()).filter(s=>s.length>=4&&s.length<=600&&explicit.test(s)&&!/[?？]|如果|假如|假设|要是|是否|会不会|能否|能不能|该不该|适合吗|怎么办|怎么样|如何|什么时候|哪年|几月|呢$|吗$/.test(s)).slice(0,6).map(sourceQuote=>{
  const kind:PersonalMemoryKind=/我(?:本人)?(?:目前|现在)?(?:不喜欢|喜欢|偏好|不愿|愿意|希望.{0,12}(?:回答|回复|建议|方式|语气))/.test(sourceQuote)?'preference':/我(?:本人)?(?:目前|现在)?(?:计划|打算|目标|准备|决定|想要|想|希望)/.test(sourceQuote)?'goal':'fact';
  const slot=personalStatementSlot(sourceQuote);
  return {content:sourceQuote,kind,sourceId,sourceQuote,sourceKind:'explicit_rule' as const,createdAt:now,updatedAt:now,domains:[...new Set([...personalDomains(sourceQuote),...(slot?[slot.domain]:[])])],...personalEventBounds(sourceQuote,now)};
 });
}

/** An explicitly labelled bounded excerpt ledger, not a generated semantic summary. */
export function summarizePersonalMessages(messages:{id:string;role:string;content:string;createdAt?:number;created_at?:number}[],now=Date.now(),corrections:PersonalCorrection[]=[]):PersonalSummary{
 const selected=messages.slice(-12).filter(m=>!corrections.some(c=>(m.createdAt??m.created_at??0)<=c.createdAt&&(c.sourceId===m.id||c.relatedSourceIds?.includes(m.id)))).map(m=>{let content=m.content;for(const c of corrections){if((m.createdAt??m.created_at??0)>c.createdAt)continue;for(const old of [c.sourceQuote,c.previousContent].filter(Boolean))content=content.split(old).join('（已按用户记忆操作移除，不再作为事实参考）');}return {...m,content};}),lines=selected.map(m=>`${m.role==='user'?'用户原文节选':'模型回答节选（非用户事实）'} [${m.id}]：${m.content.length>200?m.content.slice(0,140)+'…'+m.content.slice(-50):m.content}`);
 return {method:'rule_extract_v1',text:lines.join('\n').slice(-3600),sourceIds:selected.map(m=>m.id),updatedAt:now};
}

export function decodePersonalMemory(row:any):PersonalMemory{return {id:row.id,content:row.content,kind:row.kind,sourceId:row.source_id||null,sourceQuote:row.source_quote,sourceKind:row.source_kind,createdAt:row.created_at,updatedAt:row.updated_at,...(row.expires_at!==null?{expiresAt:row.expires_at}:{}),...(row.event_start?{eventStart:row.event_start}:{}),...(row.event_end?{eventEnd:row.event_end}:{}),domains:JSON.parse(row.domains||'[]')};}

/** Read-only bridge. Missing personal tables are an empty result, never schema initialization.
 * The traditional chart route receives explicit facts/goals only; preferences stay in personal chat.
 */
export async function retrievePersonalEvidence(owner:string,profileId:string,revision:number,question:string,sessionId?:string){
 const domains=new Set<string>(personalDomains(question));if(!domains.size)return [];
 const db=rawDb(),now=Date.now();
 if(profileId!=='demo'&&!await db.prepare('SELECT id FROM profiles WHERE owner=? AND id=? AND revision=?').bind(owner,profileId,revision).first())return [];
 if(profileId==='demo'&&revision!==1)return [];
 try{
  const sql=`SELECT m.* FROM personal_chat_memories m JOIN personal_chat_sessions s ON s.owner=m.owner AND s.id=m.session_id WHERE m.owner=? AND m.profile_id=? AND m.profile_revision=? AND m.status='active' AND s.status='active' AND m.kind IN ('fact','goal') AND (m.expires_at IS NULL OR m.expires_at>?)${sessionId?' AND m.session_id=?':''} ORDER BY CASE m.source_kind WHEN 'manual' THEN 0 ELSE 1 END,m.updated_at DESC LIMIT 100`;
  const rows=await db.prepare(sql).bind(owner,profileId,revision,now,...(sessionId?[sessionId]:[])).all<any>();
  const intent=parseTemporalIntent(question,todayShanghai());
  const base=Number(intent.referenceDate.slice(0,4)),relative=/前年/.test(intent.targetText)?-2:/后年/.test(intent.targetText)?2:/去年/.test(intent.targetText)?-1:/明年/.test(intent.targetText)?1:/今年|现在|当前|本月|今天/.test(intent.targetText)?0:null;
  const range=intent.yearRange||(intent.retrospectiveEndYear!==undefined?{startYear:1900,endYear:intent.retrospectiveEndYear}:intent.spanYears?intent.retrospective?{startYear:base-intent.spanYears,endYear:base-1}:{startYear:base,endYear:base+intent.spanYears-1}:null);
  const years=range?Array.from({length:Math.max(0,Math.min(201,range.endYear-range.startYear+1))},(_,i)=>range.startYear+i):intent.explicitYears.length?intent.explicitYears:relative!==null?[base+relative]:[];
  const unique=new Set<string>(),out:any[]=[];let chars=0;
  for(const row of rows.results){
   const m=decodePersonalMemory(row);if(!m.domains.some(d=>domains.has(d)))continue;
   if(years.length&&m.eventStart&&m.eventEnd&&!years.some(y=>m.eventStart!<=`${y}-12-31`&&m.eventEnd!>=`${y}-01-01`))continue;
   if(unique.has(m.kind+'|'+m.content)||chars+m.content.length+m.sourceQuote.length>2800)continue;
   unique.add(m.kind+'|'+m.content);chars+=m.content.length+m.sourceQuote.length;
   out.push({...m,source:'personal_chat',evidenceKind:'user_statement',verification:'user_report_unverified',profileId,profileRevision:revision,sessionId:row.session_id});if(out.length===6)break;
  }
  return out;
 }catch(e){if(/no such table.*personal_chat_/i.test(String(e)))return [];throw e;}
}
