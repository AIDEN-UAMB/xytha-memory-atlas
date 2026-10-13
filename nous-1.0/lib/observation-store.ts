import {SUMMARY_COLUMNS,DEMAND_COLUMNS,OBSERVATION_RETENTION_DAYS,type SummaryRow,type DemandRow} from './demand-observation';

type Database={prepare:(sql:string)=>{bind:(...values:any[])=>any};batch:(queries:any[])=>Promise<any[]>};
type Snapshot={summary:SummaryRow;rows:DemandRow[]};

/** One atomic bounded batch. Telemetry never changes chat success or retries model requests. */
export async function persistObservation(db:Database,snapshot:Snapshot,timeoutMs=1500):Promise<'written'|'skipped'|'failed'>{
 const {summary:s,rows}=snapshot;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  if(rows.length>840)throw Error('observation row domain exceeded');
  const cutoff=new Date(new Date(s.created_at).getTime()-OBSERVATION_RETENTION_DAYS*86400000).toISOString();
  const insert=`INSERT INTO workflow_observations (${SUMMARY_COLUMNS.join(',')}) SELECT ${SUMMARY_COLUMNS.map(()=>'?').join(',')} WHERE EXISTS (SELECT 1 FROM chat_runs WHERE owner=? AND id=? AND status<>'invalidated') AND (?='demo' OR EXISTS (SELECT 1 FROM profiles WHERE owner=? AND id=?)) ON CONFLICT(owner,request_id) DO NOTHING`;
  const details=`INSERT INTO knowledge_demand (${DEMAND_COLUMNS.join(',')}) SELECT ${DEMAND_COLUMNS.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE EXISTS (SELECT 1 FROM workflow_observations WHERE owner=? AND request_id=? AND created_at=? AND profile_id=? AND profile_revision=?) ON CONFLICT(owner,request_id,scope,scope_palace,main_star) DO NOTHING`;
  const operations=[
   // Only request-level combination details expire; keep the approved summary history.
   db.prepare('DELETE FROM knowledge_demand WHERE owner=? AND request_id IN (SELECT o.request_id FROM workflow_observations o WHERE o.owner=? AND o.created_at<? AND EXISTS (SELECT 1 FROM knowledge_demand d WHERE d.owner=o.owner AND d.request_id=o.request_id) ORDER BY o.created_at LIMIT 10)').bind(s.owner,s.owner,cutoff),
   db.prepare(insert).bind(...SUMMARY_COLUMNS.map(k=>s[k]),s.owner,s.request_id,s.profile_id,s.owner,s.profile_id),
   db.prepare(details).bind(JSON.stringify(rows),s.owner,s.request_id,s.created_at,s.profile_id,s.profile_revision)
  ];
  const result=await Promise.race([db.batch(operations),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('observation timeout')),timeoutMs);})]);
  if(result.some(r=>r?.success===false))throw Error('observation batch failed');
  const written=Number(result[1]?.meta?.changes||0)>0;
  console.info(JSON.stringify({event:'workflow_observation_saved',requestId:s.request_id,status:written?'written':'skipped'}));
  return written?'written':'skipped';
 }catch{
  // Do not log driver errors: they can contain bound private values. A timeout may commit later.
  console.warn(JSON.stringify({event:'workflow_observation_write_unconfirmed',requestId:s.request_id}));
  return 'failed';
 }finally{if(timer)clearTimeout(timer);}
}
