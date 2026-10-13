import {rawDb} from '@/db/raw';
import {HttpError} from './server';
export const RUN_LIMIT_MS=10*60*1000;
// The workflow may run for ten minutes, but its concurrency lease is renewed while alive.
// A hard Worker/client disconnect therefore stops blocking new questions after at most 60 seconds.
export const RUN_LEASE_MS=60*1000;
export const RUN_LEASE_RENEW_MS=20*1000;
/** Server setting only: 0 disables the hourly quota during the authorized test period. */
export function hourlyChatLimit(value:unknown){return typeof value==='string'&&/^(0|[1-9]\d{0,4})$/.test(value)?Number(value):30;}
export async function claimRun(owner:string,id:string,profileId:string,data:unknown,hourlyLimit=30,recoveryOnly=false,resume?:()=>Promise<boolean>){
 const db=rawDb(),now=Date.now();
 await db.prepare('DELETE FROM chat_runs WHERE owner=? AND created_at<? AND status<>?').bind(owner,now-86400000,'running').run();
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))),fingerprint=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 await db.prepare("UPDATE chat_runs SET status='expired' WHERE owner=? AND status='running' AND expires_at<=?").bind(owner,now).run();
 const existing=await db.prepare('SELECT fingerprint,status,message_id,user_id FROM chat_runs WHERE owner=? AND id=?').bind(owner,id).first<{fingerprint:string;status:string;message_id:string;user_id:string}>();
 if(existing){
  if(existing.fingerprint!==fingerprint)throw new HttpError('请求标识与问题不匹配，请重新发送。',409,'REQUEST_CONFLICT');
  if(existing.status==='completed'){
   const row=await db.prepare('SELECT content,meta FROM messages WHERE owner=? AND id=?').bind(owner,existing.message_id).first<{content:string;meta:string}>();
   if(row)return {...JSON.parse(row.meta),content:row.content,id:existing.message_id,userId:existing.user_id};
  }
  // A request ID has exactly one execution. Recovery only retrieves a completed result;
  // restarting an expired/failed row silently reruns paid calls and creates an ABA lease race.
  // A deliberate new submission must use a fresh ID (also safe for old APK retries).
  // A saved, owner-bound checkpoint may advance to its NEXT phase, never restart old calls.
  if(existing.status==='running'&&resume&&await resume())return null;
  throw new HttpError(existing.status==='running'?'上一条问题仍在处理，请稍后重试以取回结果。':'这次请求已结束，请重新发送问题。',409,existing.status==='running'?'REQUEST_RUNNING':'REQUEST_ENDED');
 }
 if(recoveryOnly)throw new HttpError('未找到已接收的请求，问题已保留，请重新发送。',409,'REQUEST_NOT_FOUND');
 const inserted=await db.prepare("INSERT OR IGNORE INTO chat_runs(owner,id,profile_id,fingerprint,status,created_at,expires_at) SELECT ?,?,?,?,'running',?,? WHERE (?=0 OR (SELECT COUNT(*) FROM chat_runs WHERE owner=? AND created_at>?)<?) AND NOT EXISTS(SELECT 1 FROM chat_runs WHERE owner=? AND status='running')").bind(owner,id,profileId,fingerprint,now,now+RUN_LEASE_MS,hourlyLimit,owner,now-3600000,hourlyLimit,owner).run();
 if(!inserted.meta.changes){
  const running=await db.prepare("SELECT id FROM chat_runs WHERE owner=? AND status='running'").bind(owner).first();
  throw new HttpError(running?'当前有问题正在处理，请等本轮完成后继续。':`本小时已达到 ${hourlyLimit} 次请求，请稍后继续。`,429,running?'REQUEST_CONCURRENCY':'CHAT_RATE_LIMIT');
 }
 return null;
}
export async function renewRun(owner:string,id:string){
 const now=Date.now();
 const result=await rawDb().prepare("UPDATE chat_runs SET expires_at=? WHERE owner=? AND id=? AND status='running' AND expires_at>?").bind(now+RUN_LEASE_MS,owner,id,now).run();
 return Number(result.meta.changes||0)>0;
}
export async function failRun(owner:string,id:string){await rawDb().prepare("UPDATE chat_runs SET status='failed' WHERE owner=? AND id=? AND status='running'").bind(owner,id).run();}
