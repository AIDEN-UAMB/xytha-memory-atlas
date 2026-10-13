import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),out=root+'/.sites-runtime/verification';
await build({entryPoints:[root+'/lib/providers/client.ts'],outfile:out+'/providers-bundle.mjs',bundle:true,platform:'node',format:'esm'});
const {endpointFor,providerRequest,extractText,parseJSON,generateJSON,listModels}=await import(out+'/providers-bundle.mjs');
const c={provider:'bigmodel',key:'test-secret-only',baseUrl:'https://open.bigmodel.cn/api/paas/v4',protocol:'openai-chat',model:'glm-5.2',jsonMode:true,thinking:'disabled'};
assert.equal(String(endpointFor(c)),'https://open.bigmodel.cn/api/paas/v4/chat/completions');assert.equal(String(endpointFor({...c,baseUrl:c.baseUrl+'/chat/completions'})),String(endpointFor(c)));
for(const baseUrl of ['http://api.example.com','https://127.0.0.1','https://2130706433','https://[::1]','https://user:pass@api.example.com','https://api.example.com?key=secret','https://host.internal','https://example.chatgpt.site','https://api.example.com:8443'])assert.throws(()=>endpointFor({...c,baseUrl}));
let r=providerRequest(c,'Return JSON',{question:'test'});assert.equal(r.body.thinking.type,'disabled');assert.equal(r.headers.Authorization,'Bearer test-secret-only');
r=providerRequest({...c,protocol:'openai-responses',baseUrl:'https://api.openai.com/v1'},'JSON',{});assert.equal(r.body.store,false);assert.equal(r.body.text.format.type,'json_object');assert.equal(String(r.url),'https://api.openai.com/v1/responses');
r=providerRequest({...c,protocol:'anthropic',baseUrl:'https://api.anthropic.com/v1'},'JSON',{});assert.equal(r.headers['x-api-key'],c.key);assert.equal(r.headers.Authorization,undefined);assert.equal(r.body.max_tokens,8000);
r=providerRequest({...c,protocol:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'models/gemini-test'},'JSON',{});assert.equal(r.headers['x-goog-api-key'],c.key);assert.equal(r.body.generationConfig.responseMimeType,'application/json');assert.equal(String(r.url),'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
assert.equal(extractText('openai-responses',{output:[{type:'reasoning',summary:[]},{content:[{type:'output_text',text:'{"ok":true}'}]}]}),'{"ok":true}');
assert.equal(extractText('anthropic',{content:[{type:'thinking',text:'hidden'},{type:'text',text:'answer'}]}),'answer');assert.equal(extractText('gemini',{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'hidden'},{text:'answer'}]}}]}),'answer');
assert.throws(()=>extractText('openai-chat',{choices:[{finish_reason:'length',message:{content:'partial'}}]}),/截断/);assert.throws(()=>parseJSON(''),/没有返回/);assert.throws(()=>parseJSON('not-json'),/不是有效/);assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'),{ok:true});
globalThis.fetch=async(_url,opts)=>{assert.equal(opts.redirect,'manual');return Response.json({choices:[{message:{content:'{"ok":true}'}}]})};assert.deepEqual(await generateJSON(c,'JSON',{}),{ok:true});
globalThis.fetch=async()=>new Response('upstream private detail',{status:429});await assert.rejects(()=>generateJSON(c,'JSON',{}),/额度不足/);
globalThis.fetch=async()=>Response.json({models:[{name:'models/gemini-test'}]});assert.deepEqual(await listModels({...c,protocol:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}),['gemini-test']);
console.log('PASS: four native/compatible API envelopes, endpoint restrictions, secret headers, model discovery, truncated outputs and error handling (mock providers).');

let redirectCalls=0;
globalThis.fetch=async(_url,opts)=>{redirectCalls++;assert.equal(opts.redirect,'manual');return new Response(null,{status:307,headers:{Location:'https://another.example.com/?key=never-disclose'}})};
await assert.rejects(()=>generateJSON(c,'JSON',{}),e=>e.code==='PROVIDER_REDIRECT'&&!e.message.includes('never-disclose'));
await assert.rejects(()=>listModels(c),e=>e.code==='PROVIDER_REDIRECT');assert.equal(redirectCalls,2);
console.log('PASS: redirect rejection preserves credentials and never exposes Location.');

const automatic={...c,thinking:'auto'};
assert.equal(providerRequest(automatic,'JSON',{},1500,{stage:'plan'}).body.thinking.type,'disabled');
assert.equal(providerRequest(automatic,'JSON',{},9000,{stage:'answer'}).body.reasoning_effort,undefined);
// Public snapshot adaptation: the shipped GLM 5.2 auto policy includes answer
// in its explicit disabled stages. Check that existing policy, without changing
// provider implementation or treating auto as an enabled user override.
assert.equal(providerRequest(automatic,'JSON',{},9000,{stage:'answer'}).body.thinking.type,'disabled');
assert.equal(providerRequest({...c,thinking:'enabled'},'JSON',{},4000,{stage:'plan'}).body.thinking.type,'enabled');
assert.equal(providerRequest(c,'JSON',{},9000,{stage:'answer'}).body.thinking.type,'disabled');
assert.equal(providerRequest({...automatic,model:'glm-5.3'},'JSON',{},4000,{stage:'plan'}).body.thinking,undefined);
console.log('PASS: stage-aware GLM 5.2 thinking policy and explicit user overrides.');
assert.deepEqual(parseJSON('回答如下：\n```json\n{"ok":true,"text":"括号 } 与转义 \\\""}\n```'),{ok:true,text:'括号 } 与转义 "'});
assert.throws(()=>parseJSON('{"ok":true} {"ok":false}'),/JSON/);
assert.throws(()=>parseJSON('{"ok":true'),/JSON/);
console.log('PASS: one complete wrapped JSON object; ambiguous or truncated JSON remains rejected.');
