import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {henosisFingerprint} from '../dist/engine.mjs';
test('chart demo works without provider credentials',()=>{
 const r=spawnSync(process.execPath,['cli.mjs','--chart'],{encoding:'utf8',env:{...process.env,HENOSIS_API_KEY:'',HENOSIS_BASE_URL:''}});
 assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);assert.equal(result.palaces.length,12);assert.equal(result.modelCalls,0);assert.equal(result.synthetic,true);
});
test('missing input fails before model access without printing environment',()=>{
 const r=spawnSync(process.execPath,['cli.mjs'],{encoding:'utf8',env:{...process.env,HENOSIS_API_KEY:'synthetic-secret-not-to-print'}});
 assert.equal(r.status,1);assert.match(r.stderr,/INPUT_REQUIRED/);assert(!r.stderr.includes('synthetic-secret-not-to-print'));
});
test('original checkpoint fingerprint is stable and excludes secrets',async()=>{
 assert.equal(await henosisFingerprint({question:'x',key:'first',data:{b:2,a:1}}),await henosisFingerprint({data:{a:1,b:2},key:'second',question:'x'}));
 assert.notEqual(await henosisFingerprint({question:'x'}),await henosisFingerprint({question:'y'}));
});
