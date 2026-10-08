import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {demo} from '../data/demo.mjs';
import {validateArchive} from '../src/memory.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const allowedRoots=new Set(['.github','data','docs','schemas','scripts','src','tests']);
const allowedFiles=new Set(['.gitignore','package.json','package-lock.json','README.md','README.en.md','LICENSE','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','index.html']);
const excluded=new Set(['.git','node_modules','dist','artifacts']);
export async function checkRelease(){
 validateArchive(demo);let count=0;
 async function walk(dir,depth=0){for(const item of await readdir(dir,{withFileTypes:true})){
  if(!depth&&excluded.has(item.name))continue;
  if(item.isSymbolicLink())throw Error('Release cannot contain symlinks: '+item.name);
  if(!depth&&!allowedRoots.has(item.name)&&!allowedFiles.has(item.name))throw Error('Unexpected release path: '+item.name);
  const file=path.join(dir,item.name);if(item.isDirectory()){await walk(file,depth+1);continue;}
  if(/(?:\.env(?:\.|$)|\.sqlite|\.(?:pem|key)$)/i.test(item.name))throw Error('Private configuration or data file: '+item.name);
  const content=await readFile(file);if(item.name.endsWith('.png'))continue;
  const text=content.toString();
  const signatures=[new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),new RegExp('(?:ghp|gho|ghu|ghs|github_pat)'+'_[A-Za-z0-9_]{25,}'),new RegExp('sk-'+'[A-Za-z0-9_-]{25,}')];
  if(signatures.some(pattern=>pattern.test(text)))throw Error('Credential-like content in '+path.relative(root,file));
  if(/\/(?:opt|home)\/[\w.-]+\/(?:env|releases|backups)\//.test(text))throw Error('Deployment path in '+path.relative(root,file));
  count++;
 }}
 await walk(root);console.log(`Release check: ${count} text files; synthetic fixture valid; no blocked paths or credential patterns.`);
 return count;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await checkRelease();
