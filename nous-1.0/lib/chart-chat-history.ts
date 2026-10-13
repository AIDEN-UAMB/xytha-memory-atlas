import {rawDb} from '@/db/raw';
import {HttpError} from './server';
import {historyMetadata} from './context-snapshot';
// Public Nous 1.0: retain the history wire identifier without importing Henosis implementation.
const HENOSIS_VERSION='xytha-henosis.1';

export type ChartChatHistoryMessage={id:string;role:string;content:string;meta?:any;createdAt:number;source:'nous'|'henosis'};
type Input={owner:string;profileId:string;profileRevision:number;cutoff:number;henosisSessionId?:string;limit?:number;consumer:'nous'|'henosis'};
type Row={id:string;role:string;content:string;meta:string;created_at:string|number;sequence:number;request_id?:string};

function henosisMetadata(value:string,input:Input){
 let meta:any;try{meta=JSON.parse(value);}catch{return {};}
 if(!meta||typeof meta!=='object'||Array.isArray(meta))return {};
 if(input.consumer==='henosis')return meta;
 const plan=meta.henosis?.plan;
 // Carry only validated task/range metadata into the existing Nous selector.
 // An earlier answer is dialogue, never a new chart evidence source.
 const kinds=['attribute','current_state','historical_compare','future_timing','decision','knowledge','mixed'];
 const precisions=['none','natal','decadal','yearly','monthly','daily'];
 const valid=meta.henosis?.version===HENOSIS_VERSION&&plan?.version===1&&
  plan.profileId===input.profileId&&plan.profileRevision===input.profileRevision&&
  Array.isArray(plan.tasks)&&plan.tasks.length<=6&&plan.tasks.every((task:any)=>
   task&&typeof task.id==='string'&&typeof task.question==='string'&&kinds.includes(task.kind)&&
   precisions.includes(task.precision)&&Array.isArray(task.palaces)&&task.palaces.every((v:unknown)=>typeof v==='string')&&
   Array.isArray(task.domains)&&task.domains.every((v:unknown)=>typeof v==='string'));
 return historyMetadata({...meta,analysisPlan:valid?plan:undefined});
}

/** Server-owned, bounded dialogue bridge. Neither client messages nor personal chat are consulted. */
export async function loadChartChatHistory(input:Input):Promise<ChartChatHistoryMessage[]>{
 const db=rawDb(),limit=Math.max(1,Math.min(60,Math.trunc(input.limit??32)));
 if(!Number.isFinite(input.cutoff))throw new HttpError('对话时间边界无效。',400,'HISTORY_CUTOFF_INVALID');
 const profile=input.profileId==='demo'?{revision:1}:await db.prepare('SELECT revision FROM profiles WHERE owner=? AND id=?').bind(input.owner,input.profileId).first<{revision:number}>();
 if(!profile)throw new HttpError('未找到该命例。',404,'PROFILE_NOT_FOUND');
 if(profile.revision!==input.profileRevision)throw new HttpError('命例资料已更新，请重新同步后提问。',409,'PROFILE_CHANGED');
 const nous=await db.prepare('SELECT rowid AS sequence,id,role,content,meta,created_at FROM messages WHERE owner=? AND profile_id=? AND profile_revision=? AND created_at<=? AND role IN (\'user\',\'assistant\') ORDER BY created_at DESC,rowid DESC LIMIT ?')
  .bind(input.owner,input.profileId,input.profileRevision,new Date(input.cutoff).toISOString(),limit).all<Row>();
 // A legacy Nous-only installation must not create Henosis tables or sessions just to read history.
 const tables=await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('henosis_messages','henosis_sessions','henosis_runs')").first<{n:number}>();
 if(input.henosisSessionId&&tables?.n!==3)throw new HttpError('Henosis 会话已失效，请重新同步。',409,'HENOSIS_SESSION_CHANGED');
 let henosis:Row[]=[];
 if(tables?.n===3){
  const session=await db.prepare(`SELECT id FROM henosis_sessions WHERE owner=? AND profile_id=? AND profile_revision=? AND status='active'${input.henosisSessionId?' AND id=?':''}`)
   .bind(input.owner,input.profileId,input.profileRevision,...(input.henosisSessionId?[input.henosisSessionId]:[])).first<{id:string}>();
  if(input.henosisSessionId&&!session)throw new HttpError('Henosis 会话已失效，请重新同步。',409,'HENOSIS_SESSION_CHANGED');
  if(session){
   const rows=await db.prepare(`SELECT m.rowid AS sequence,m.id,m.role,m.content,m.meta,m.created_at,m.request_id
    FROM henosis_messages m JOIN henosis_runs r ON r.owner=m.owner AND r.id=m.request_id
     AND r.profile_id=m.profile_id AND r.profile_revision=m.profile_revision AND r.session_id=m.session_id
    JOIN henosis_messages a ON a.owner=r.owner AND a.id=r.assistant_id AND a.request_id=r.id
     AND a.profile_id=r.profile_id AND a.profile_revision=r.profile_revision AND a.session_id=r.session_id AND a.role='assistant'
    WHERE m.owner=? AND m.profile_id=? AND m.profile_revision=? AND m.session_id=?
     AND r.status='completed' AND a.created_at<=? AND m.created_at<=? AND m.role IN ('user','assistant')
    ORDER BY m.created_at DESC,m.rowid DESC LIMIT ?`)
    .bind(input.owner,input.profileId,input.profileRevision,session.id,input.cutoff,input.cutoff,limit).all<Row>();
   henosis=rows.results;
  }
 }
 const normalize=(row:Row,source:ChartChatHistoryMessage['source'])=>({id:row.id,role:row.role,content:row.content,
  meta:source==='nous'?row.meta:henosisMetadata(row.meta,input),createdAt:typeof row.created_at==='number'?row.created_at:Date.parse(row.created_at),source,sequence:row.sequence,requestId:row.request_id});
 const recent=[...nous.results.map(row=>normalize(row,'nous')),...henosis.map(row=>normalize(row,'henosis'))]
  .filter(row=>Number.isFinite(row.createdAt)&&row.createdAt<=input.cutoff)
  .sort((a,b)=>a.createdAt-b.createdAt||a.source.localeCompare(b.source)||a.sequence-b.sequence||a.id.localeCompare(b.id))
  .slice(-limit);
 // A count boundary may cut the oldest Henosis turn; do not retain its orphaned half.
 return recent.filter(row=>row.source!=='henosis'||recent.some(other=>other.source==='henosis'&&other.requestId===row.requestId&&other.role!==row.role))
  .map(({sequence:_sequence,requestId:_requestId,...row})=>row);
}
