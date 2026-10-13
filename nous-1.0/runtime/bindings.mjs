// Node host adapter. Canonical engine source continues to use cloudflare:workers.
import {openDatabase} from '../deployment/database.mjs';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const state=path.resolve(root,process.env.NOUS_STATE_DIR||'.runtime');
mkdirSync(state,{recursive:true,mode:0o700});
const keyPath=path.join(state,'vault-secret');
if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
const key=readFileSync(keyPath,'utf8').trim();
if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid local vault key');
const defaults={XYTHA_FRAMEWORK_V1:'true',XYTHA_ADAPTIVE_CONTEXT:'true',XYTHA_RESUMABLE_CHAT:'true',XYTHA_DIRECT_OUTPUT:'false',XYTHA_CHAT_HOURLY_LIMIT:'30'};
let db;
export const env=new Proxy({}, {get(_target,name){
  if(name==='DB')return db??=openDatabase(path.join(state,'nous.sqlite'),path.join(root,'drizzle'));
  if(name==='MODEL_VAULT_KEY')return key;
  // Never read unrelated provider credentials from the developer's environment.
  if(name==='OPENAI_API_KEY'||name==='OPENAI_MODEL')return undefined;
  if(name==='XYTHA_LOCAL_DEV_MODE')return 'false';
  if(name==='XYTHA_PROVIDER_MODE')return 'remote';
  return Object.hasOwn(defaults,name)?process.env[name]??defaults[name]:undefined;
}});
export const LOCAL_OWNER='nous-local-user';
