import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

test('local host: profile isolation, origin checks, original chat route, saved history and replay', {timeout:40000},async()=>{
 const state=await mkdtemp(path.join(tmpdir(),'nous-public-test-')),port=24174,origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['runtime/server.mjs'],{env:{...process.env,PORT:String(port),NOUS_STATE_DIR:state,NOUS_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 try{
  let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Local server failed: '+logs);try{const r=await fetch(origin+'/api/status');if(r.ok){ready=true;break;}}catch{}await delay(100);}assert(ready,'server started');
  const status=await (await fetch(origin+'/api/status')).json();assert.equal(status.version,'Nous-1.0');assert.equal(status.modelConfigured,false);
  const page=await fetch(origin);assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert((await page.text()).includes('Nous 1.0'));
  assert.equal((await fetch(origin+'/api/status',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
  const profiles=await (await fetch(origin+'/api/profiles')).json();assert.equal(profiles.profiles.length,1);const p=profiles.profiles[0];
  const payload={requestId:crypto.randomUUID(),profileId:p.id,profileRevision:1,question:'请列出本命命宫的星曜',target:'2026-10-13',scope:'natal',selected:0,continuationProtocol:1};
  assert.equal((await fetch(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,403);
  const send=body=>fetch(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  const {consumeChat}=await import('../dist/engine.mjs');
  // Malicious client-supplied credentials must not trigger a provider request.
  const result=await consumeChat(await send({...payload,key:'must-be-ignored',connection:{baseUrl:'http://127.0.0.1',key:'ignored'}}),()=>{});assert(result.content.length>0);assert.equal(result.mode,'rules');
  const again=await consumeChat(await send(payload),()=>{});assert.equal(again.id,result.id);assert.equal(again.content,result.content);
  const history=await (await fetch(origin+'/api/history?profileId='+p.id)).json();assert.equal(history.messages.length,2);
  assert.equal((await send({...payload,question:'different'})).status,409);
  assert.equal((await fetch(origin+'/api/history?profileId=missing')).status,404);
  const r=await fetch(origin+'/api/profiles',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({birth:{...p.birth,name:'Second synthetic'}})});assert.equal(r.status,201);const second=await r.json();
  const empty=await (await fetch(origin+'/api/history?profileId='+second.id)).json();assert.equal(empty.messages.length,0);
  assert.equal((await fetch(origin+'/api/memory?profileId='+p.id)).status,200);
  assert.equal((await fetch(origin+'/api/chart?profileId='+p.id+'&date=not-a-date')).status,400);
  const invalid=await fetch(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{'});assert.equal(invalid.status,400);
 }finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});await rm(state,{recursive:true,force:true});}
});
