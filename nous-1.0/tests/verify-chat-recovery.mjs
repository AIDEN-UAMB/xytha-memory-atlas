import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE chat_runs(owner TEXT NOT NULL,id TEXT NOT NULL,profile_id TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,message_id TEXT,user_id TEXT,PRIMARY KEY(owner,id));
CREATE UNIQUE INDEX idx_chat_runs_owner_active ON chat_runs(owner) WHERE status='running';
CREATE TABLE messages(id TEXT PRIMARY KEY,owner TEXT NOT NULL,content TEXT NOT NULL,meta TEXT NOT NULL);`);
class Prepared{constructor(q){this.q=q;this.v=[];}bind(...v){this.v=v;return this;}async first(){return sql.prepare(this.q).get(...this.v)||null;}async run(){return{meta:sql.prepare(this.q).run(...this.v)};}}
globalThis.__bindings={DB:{prepare:q=>new Prepared(q)}};
await build({entryPoints:['lib/chat-runs.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/verification/chat-recovery.mjs',external:['zod'],plugins:[{name:'bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__bindings;',loader:'js'}));}}]});
const {claimRun,failRun,renewRun,RUN_LEASE_MS}=await import('../.sites-runtime/verification/chat-recovery.mjs');
const owner='lease-user',id='11111111-1111-4111-8111-111111111111',payload={question:'同一个问题'};

assert.equal(await claimRun(owner,id,'demo',payload,0),null);
let row=sql.prepare('SELECT * FROM chat_runs WHERE owner=? AND id=?').get(owner,id);
assert.equal(row.status,'running');
assert(row.expires_at>Date.now()&&row.expires_at<=Date.now()+RUN_LEASE_MS+1000);
await assert.rejects(()=>claimRun(owner,id,'demo',payload,0),e=>e.code==='REQUEST_RUNNING');

assert.equal(await renewRun(owner,id),true);
row=sql.prepare('SELECT * FROM chat_runs WHERE owner=? AND id=?').get(owner,id);
assert(row.expires_at>Date.now());

await failRun(owner,id);assert.equal(sql.prepare('SELECT status FROM chat_runs WHERE owner=? AND id=?').get(owner,id).status,'failed');
await assert.rejects(()=>claimRun(owner,id,'demo',payload,0),e=>e.code==='REQUEST_ENDED');
assert.equal(sql.prepare('SELECT status FROM chat_runs WHERE owner=? AND id=?').get(owner,id).status,'failed');

sql.prepare("UPDATE chat_runs SET status='expired' WHERE owner=? AND id=?").run(owner,id);
await assert.rejects(()=>claimRun(owner,id,'demo',payload,0),e=>e.code==='REQUEST_ENDED');
assert.equal(await renewRun(owner,id),false);
const fresh='33333333-3333-4333-8333-333333333333';
await assert.rejects(()=>claimRun(owner,fresh,'demo',payload,0,true),e=>e.code==='REQUEST_NOT_FOUND');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM chat_runs WHERE id=?').get(fresh).n,0);
assert.equal(await claimRun(owner,fresh,'demo',payload,0),null);
await assert.rejects(()=>claimRun(owner,'22222222-2222-4222-8222-222222222222','demo',{question:'新问题'},0),e=>e.code==='REQUEST_CONCURRENCY');
sql.prepare('UPDATE chat_runs SET expires_at=? WHERE owner=? AND id=?').run(Date.now()-1,owner,fresh);
assert.equal(await renewRun(owner,fresh),false);
assert.equal(await claimRun(owner,'22222222-2222-4222-8222-222222222222','demo',{question:'新问题'},0),null);

console.log('PASS: renewable lease, passive recovery never starts/restarts provider work, no expired-lease revival, concurrency guard and stale-run release.');
