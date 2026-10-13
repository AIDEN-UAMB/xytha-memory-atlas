import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {chat,env,createChart,todayShanghai,example,birthSchema,connectionSchema,retrievePalaceMemory} from '../dist/engine.mjs';
import {LOCAL_OWNER} from './bindings.mjs';
import {modelConnection} from './config.mjs';
import {installEgressGuard} from '../deployment/egress.mjs';
const connection=modelConnection(connectionSchema);
installEgressGuard();
const port=Number(process.env.PORT||4174);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be 1024–65535');
const host='127.0.0.1',origin=`http://${host}:${port}`,db=env.DB;
const fixture={...example,name:'Synthetic example · 合成示例',calendar:'solar',date:'2000-01-15',time:'12:00',place:'Synthetic / 合成',confirmed:true};
await db.prepare('INSERT OR IGNORE INTO profiles(id,owner,name,birth,created_at,revision) VALUES(?,?,?,?,?,1)').bind('synthetic-profile',LOCAL_OWNER,fixture.name,JSON.stringify(fixture),new Date().toISOString()).run();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req){let size=0;const chunks=[];if(!String(req.headers['content-type']).startsWith('application/json'))throw Object.assign(Error('JSON required'),{status:415});for await(const part of req){size+=part.length;if(size>30000)throw Object.assign(Error('Request too large'),{status:413});chunks.push(part);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Object.assign(Error('Invalid JSON object'),{status:400});}}
const files=new Map([['/',['../web/index.html','text/html']],['/client.js',['../dist/client.js','text/javascript']],['/style.css',['../web/style.css','text/css']],['/mark.svg',['../../docs/mark.svg','image/svg+xml']]]);
const server=createServer(async(req,res)=>{try{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.headers.host!==`${host}:${port}`)return json(res,403,{error:'Use the printed loopback URL.'});
  if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Cross-origin request rejected.'});
  if(req.method==='POST'&&req.headers.origin!==origin)return json(res,403,{error:'Origin required.'});
  const url=new URL(req.url,origin),pathname=url.pathname;
  if(req.method==='GET'&&files.has(pathname)){const [file,type]=files.get(pathname);res.setHeader('Content-Type',type+'; charset=utf-8');return res.end(await readFile(new URL(file,import.meta.url)));}
  if(req.method==='GET'&&pathname==='/api/status')return json(res,200,{version:'Nous-1.0',modelConfigured:!!connection,model:connection?.model||null,streaming:'progress + completed-answer chunks',directOutput:env.XYTHA_DIRECT_OUTPUT==='true'});
  if(req.method==='GET'&&pathname==='/api/profiles'){const r=await db.prepare('SELECT id,name,birth,revision FROM profiles WHERE owner=? ORDER BY created_at').bind(LOCAL_OWNER).all();return json(res,200,{profiles:r.results.map(p=>({...p,birth:JSON.parse(p.birth)}))});}
  if(req.method==='POST'&&pathname==='/api/profiles'){const input=await body(req),birth=birthSchema.parse(input.birth);createChart(birth,todayShanghai());const id=randomUUID();await db.prepare('INSERT INTO profiles(id,owner,name,birth,created_at,revision) VALUES(?,?,?,?,?,1)').bind(id,LOCAL_OWNER,birth.name,JSON.stringify(birth),new Date().toISOString()).run();return json(res,201,{id});}
  if(req.method==='GET'&&['/api/history','/api/chart','/api/memory'].includes(pathname)){
    const id=url.searchParams.get('profileId'),p=await db.prepare('SELECT birth,revision FROM profiles WHERE owner=? AND id=?').bind(LOCAL_OWNER,id).first();
    if(!p)return json(res,404,{error:'Profile not found.'});
    if(pathname==='/api/history'){const r=await db.prepare('SELECT id,role,content,created_at FROM messages WHERE owner=? AND profile_id=? AND profile_revision=? ORDER BY created_at,rowid LIMIT 500').bind(LOCAL_OWNER,id,p.revision).all();return json(res,200,{messages:r.results});}
    const date=url.searchParams.get('date')||todayShanghai(),chart=createChart(JSON.parse(p.birth),date);
    if(pathname==='/api/chart')return json(res,200,chart);
    return json(res,200,await retrievePalaceMemory(LOCAL_OWNER,id,chart,url.searchParams.get('question')||'事业 财务 关系 自我',date));
  }
  if(req.method==='POST'&&pathname==='/api/chat'){
    const input=await body(req);if(input.profileId==='demo')return json(res,400,{error:'Select a local profile.'});
    // Credentials and identity are server-owned. Ignore browser-supplied connection/key/owner.
    const payload=Object.fromEntries(['requestId','profileId','profileRevision','question','target','scope','selected','continuationProtocol','recoveryOnly'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
    if(connection)payload.connection=connection;
    const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
    const result=await chat(new Request(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream','Origin':origin,'oai-authenticated-user-id':LOCAL_OWNER},body:JSON.stringify(payload),signal:abort.signal}));
    res.writeHead(result.status,Object.fromEntries(result.headers));
    if(result.body){const reader=result.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;if(res.destroyed)break;if(!res.write(part.value))await once(res,'drain',{signal:abort.signal});}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
    return res.end();
  }
  return json(res,404,{error:'Not found.'});
}catch(error){if(res.destroyed)return;if(res.headersSent){res.end();return;}json(res,error.status||400,{error:error.name==='ZodError'?'Check the input fields.':String(error.message).slice(0,250)});}});
server.headersTimeout=10000;server.requestTimeout=30000;
server.listen(port,host,()=>console.log(`Nous 1.0 local workspace: ${origin}\nMode: ${connection?'your configured model (provider fees apply)':'deterministic chart facts; no model configured'}\nLocal single-user host; not a public multi-user deployment.`));
