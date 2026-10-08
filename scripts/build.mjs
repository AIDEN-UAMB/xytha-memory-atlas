import {cp,mkdir,writeFile,readdir,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checkRelease} from './check-release.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));await checkRelease();
// Refuse a dirty or linked output directory rather than risk publishing stale data.
const expected=new Set(['index.html','src','data','docs','.nojekyll']);
try{
 const stat=await lstat(root+'dist');if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('dist must be a real directory');
 for(const item of await readdir(root+'dist')){if(!expected.has(item))throw Error('Unexpected dist entry; use a fresh checkout: '+item);if((await lstat(root+'dist/'+item)).isSymbolicLink())throw Error('Linked output is not allowed');}
 async function checkTree(source,target){
  for(const item of await readdir(target,{withFileTypes:true})){
   if(item.isSymbolicLink())throw Error('Linked output is not allowed');
   if(target.endsWith('/docs')&&!['architecture.html','mark.svg'].includes(item.name))throw Error('Unexpected docs output');
   const original=await lstat(source+'/'+item.name);if(original.isSymbolicLink())throw Error('Linked source is not allowed');
   if(item.isDirectory())await checkTree(source+'/'+item.name,target+'/'+item.name);
  }
 }
 for(const folder of ['src','data','docs'])try{await checkTree(root+folder,root+'dist/'+folder);}catch(e){if(e.code!=='ENOENT')throw e;else if(e.path?.includes('dist'))continue;else throw Error('Stale output; build in a fresh checkout');}
}catch(e){if(e.code!=='ENOENT')throw e;}
// Explicit static asset allowlist. No production source, credentials or logs.
await mkdir(root+'dist',{recursive:true});
for(const name of ['index.html','src','data','docs/architecture.html','docs/mark.svg'])await cp(root+name,root+'dist/'+name,{recursive:true});
await writeFile(root+'dist/.nojekyll','');
console.log('Built dist/ (static ES modules; no dependency install or provider key required).');
