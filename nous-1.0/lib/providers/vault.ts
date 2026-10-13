import {env} from 'cloudflare:workers';
import {rawDb} from '@/db/raw';
import {connectionSchema,Connection,safeConnection} from './config';
const enc=new TextEncoder();
function keyBytes(){const h=(env as unknown as Record<string,string>).MODEL_VAULT_KEY;if(!/^[0-9a-f]{64}$/.test(h||''))throw Error('密钥保管服务未配置，请先使用本次会话连接。');return Uint8Array.from(h.match(/../g)!.map(v=>parseInt(v,16)));}
const b64=(bytes:Uint8Array)=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const un64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function encryptKey(value:string,owner:string,id:string){const key=await crypto.subtle.importKey('raw',keyBytes(),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(owner+'|'+id)},key,enc.encode(value));return JSON.stringify({v:1,iv:b64(iv),data:b64(new Uint8Array(ct))});}
export async function decryptKey(secret:string,owner:string,id:string){const r=JSON.parse(secret);if(r.v!==1)throw Error('密钥格式不受支持。');const key=await crypto.subtle.importKey('raw',keyBytes(),'AES-GCM',false,['decrypt']);const result=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(r.iv),additionalData:enc.encode(owner+'|'+id)},key,un64(r.data));return new TextDecoder().decode(result);}
export async function getConnection(owner:string,id:string):Promise<Connection>{const row=await rawDb().prepare('SELECT config,secret FROM connections WHERE owner=? AND id=?').bind(owner,id).first<{config:string;secret:string}>();if(!row)throw Error('模型连接不存在或不属于当前账户。');return connectionSchema.parse({...JSON.parse(row.config),key:await decryptKey(row.secret,owner,id)});}
export {safeConnection};
