import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import {Agent,setGlobalDispatcher} from 'undici';

export function publicAddress(address){
 const family=isIP(address);
 if(family===4){const [a,b,c]=address.split('.').map(Number);return a>0&&a<224&&a!==10&&a!==127&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||(b===88&&c===99)))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19||(b===51&&c===100)))&&!(a===203&&b===0&&c===113);}
 if(family===6){const normalized=new URL('https://['+address+']/').hostname.slice(1,-1),parts=normalized.split(':'),first=parseInt(parts[0],16),second=parseInt(parts[1]||'0',16);return first>=0x2000&&first<=0x3fff&&first!==0x2002&&!(first===0x2001&&(second<=0x1ff||second===0xdb8))&&!(first===0x3fff&&second<=0xfff);}
 return false;
}
export function installEgressGuard(){
 setGlobalDispatcher(new Agent({connect:{lookup(hostname,options,callback){
  lookup(hostname,{...options,all:true},(error,addresses)=>{
   if(error)return callback(error);
   if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))return callback(Error('Private network destinations are not allowed'));
   if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
  });
 }}}));
 const original=globalThis.fetch;
 globalThis.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:input);
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||host==='localhost'||host.endsWith('.localhost')||(isIP(host)&&!publicAddress(host)))return Promise.reject(Error('Only public HTTPS destinations are allowed'));
  // No automatic redirect may send credentials to another origin or private address.
  return original(input,{...init,redirect:'manual'});
 };
}
