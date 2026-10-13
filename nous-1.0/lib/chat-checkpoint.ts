import {rawDb} from '@/db/raw';
import {encryptKey,decryptKey} from './providers/vault';
import {HttpError} from './server';
import {withWorkflowPhase,type PhaseState} from './workflow-phase';
import {RUN_LEASE_MS} from './chat-runs';
import {compactSnapshot} from './context-snapshot';
import {digest} from './palace-memory-facts';
const RETENTION_MS=3600000;
export const PHASE_LIMIT_MS=270000;
export class ChatCheckpoint{
 constructor(public owner:string,public id:string,public token:string,public state:PhaseState){}
 private async save(status:'running'|'waiting'){
  const json=JSON.stringify(this.state);if(new TextEncoder().encode(json).byteLength>4000000)throw new HttpError('本轮恢复数据超过存储预算，原始对话仍保留；这不是模型上下文窗口限制。',413,'CHECKPOINT_STORAGE_SIZE');
  const encrypted=await encryptKey(json,this.owner,'chat-checkpoint:'+this.id);
  const db=rawDb(),now=Date.now();
  const pieces=encrypted.length>256000?Array.from({length:Math.ceil(encrypted.length/256000)},(_,i)=>encrypted.slice(i*256000,(i+1)*256000)):[];
  const payload=pieces.length?JSON.stringify({v:2,parts:pieces.length,digest:await digest(encrypted)}):encrypted;
  const parts=pieces.length?[
   db.prepare("DELETE FROM chat_checkpoint_parts WHERE owner=? AND request_id=? AND EXISTS(SELECT 1 FROM chat_checkpoints WHERE owner=? AND request_id=? AND lease_token=? AND status='running')").bind(this.owner,this.id,this.owner,this.id,this.token),
   ...pieces.map((piece,i)=>db.prepare("INSERT INTO chat_checkpoint_parts(owner,request_id,part,payload) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_checkpoints WHERE owner=? AND request_id=? AND lease_token=? AND status='running')").bind(this.owner,this.id,i,piece,this.owner,this.id,this.token))]:[];
  const results=await db.batch([
   ...parts,
   db.prepare("UPDATE chat_checkpoints SET payload=?,status=? WHERE owner=? AND request_id=? AND lease_token=? AND status='running' AND EXISTS(SELECT 1 FROM chat_runs WHERE owner=? AND id=? AND status='running' AND expires_at>?)").bind(payload,status,this.owner,this.id,this.token,this.owner,this.id,now),
   db.prepare("UPDATE chat_runs SET expires_at=? WHERE owner=? AND id=? AND status='running' AND expires_at>? AND EXISTS(SELECT 1 FROM chat_checkpoints WHERE owner=? AND request_id=? AND lease_token=? AND status=?)").bind(now+RUN_LEASE_MS,this.owner,this.id,now,this.owner,this.id,this.token,status),
  ]);
  if(results.slice(-2).some(r=>!r.meta.changes))throw new HttpError('本轮已停止或命例已变化，未保存旧阶段。',409,'REQUEST_ENDED');
 }
 async snapshot(value:any){if(!this.state.snapshot){this.state.snapshot=compactSnapshot(value);await this.save('running');}return this.state.snapshot;}
 run<T>(fn:()=>Promise<T>){return withWorkflowPhase({state:this.state,requestId:this.id,persist:()=>this.save('waiting')},fn);}
 async clear(){await rawDb().prepare('DELETE FROM chat_checkpoints WHERE owner=? AND request_id=? AND lease_token=?').bind(this.owner,this.id,this.token).run();}
}
export async function createCheckpoint(owner:string,id:string){
 const token=crypto.randomUUID(),state:PhaseState={version:1,startedAt:Date.now(),snapshot:null,entries:[]};
 const db=rawDb();
 await db.prepare('DELETE FROM chat_checkpoints WHERE owner=? AND expires_at<?').bind(owner,Date.now()).run();
 const payload=await encryptKey(JSON.stringify(state),owner,'chat-checkpoint:'+id);
 await db.prepare("INSERT INTO chat_checkpoints(owner,request_id,status,lease_token,payload,expires_at) VALUES (?,?,'running',?,?,?)").bind(owner,id,token,payload,Date.now()+RETENTION_MS).run();
 return new ChatCheckpoint(owner,id,token,state);
}
export async function resumeCheckpoint(owner:string,id:string){
 const token=crypto.randomUUID(),db=rawDb(),now=Date.now();
 // D1 batch is transactional: only the CAS winner can renew this execution's lease.
 const updated=await db.batch([
  db.prepare("UPDATE chat_checkpoints SET status='running',lease_token=? WHERE owner=? AND request_id=? AND status='waiting' AND expires_at>? AND EXISTS(SELECT 1 FROM chat_runs WHERE owner=? AND id=? AND status='running' AND expires_at>?)").bind(token,owner,id,now,owner,id,now),
  db.prepare("UPDATE chat_runs SET expires_at=? WHERE owner=? AND id=? AND status='running' AND expires_at>? AND EXISTS(SELECT 1 FROM chat_checkpoints WHERE owner=? AND request_id=? AND lease_token=? AND status='running')").bind(now+RUN_LEASE_MS,owner,id,now,owner,id,token),
 ]);
 if(!updated[0].meta.changes)return null;
 if(!updated[1].meta.changes)throw new HttpError('本轮租约已结束，问题已保留。',409,'REQUEST_ENDED');
 const row=await db.prepare('SELECT payload FROM chat_checkpoints WHERE owner=? AND request_id=? AND lease_token=?').bind(owner,id,token).first<{payload:string}>();
 if(!row)throw new HttpError('续接状态不存在，问题已保留。',409,'REQUEST_ENDED');
 const header=JSON.parse(row.payload);let payload=row.payload;
 if(header.v===2){
  if(!Number.isInteger(header.parts)||header.parts<1||header.parts>24)throw new HttpError('恢复数据清单无效。',409,'CHECKPOINT_CORRUPT');
  const parts=await db.prepare('SELECT part,payload FROM chat_checkpoint_parts WHERE owner=? AND request_id=? ORDER BY part').bind(owner,id).all<{part:number;payload:string}>();
  if(parts.results.length!==header.parts||parts.results.some((p,i)=>p.part!==i))throw new HttpError('恢复数据不完整。',409,'CHECKPOINT_CORRUPT');
  payload=parts.results.map(p=>p.payload).join('');if(await digest(payload)!==header.digest)throw new HttpError('恢复数据校验失败。',409,'CHECKPOINT_CORRUPT');
 }
 const state=JSON.parse(await decryptKey(payload,owner,'chat-checkpoint:'+id)) as PhaseState;
 if(state.version!==1||Date.now()-state.startedAt>600000)throw new HttpError('本轮处理时限已结束，问题已保留。',408,'WORKFLOW_TOTAL_TIMEOUT');
 return new ChatCheckpoint(owner,id,token,state);
}
