import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'SOURCE-MANIFEST.json'),'utf8'));
for(const f of manifest.files){
 const bytes=await readFile(path.join(root,f.path));
 if(createHash('sha256').update(bytes).digest('hex')!==f.publishedSHA256)throw Error('Source provenance mismatch: '+f.path);
}
const excluded=new Set(['node_modules','dist','.runtime','.sites-runtime','.git']);
const patterns=[new RegExp('-----BEGIN '+'(?:RSA |OPENSSH |EC )?PRIVATE KEY-----'),new RegExp('(?:ghp|gho|ghu|ghs|github_pat)'+'_[A-Za-z0-9_]{25,}'),new RegExp('(?:^|[^A-Za-z0-9_-])sk-'+'[A-Za-z0-9_-]{25,}')];
let count=0;
async function walk(dir){
 for(const f of await readdir(dir,{withFileTypes:true})){
  if(excluded.has(f.name))continue;
  if(f.isSymbolicLink())throw Error('Unexpected symlink');
  const file=path.join(dir,f.name),rel=path.relative(root,file).replaceAll('\\','/');
  if(/(?:^|\/)(?:nous2|henosis2|auth|vault|private-inputs|internal)(?:\/|$)/i.test(rel))throw Error('Private/out-of-scope path: '+rel);
  if(f.isDirectory()){await walk(file);continue;}
  if(f.name!=='.env.example'&&/^\.env(?:\.|$)|\.(?:key|pem|pfx|sqlite|db|log)$/i.test(f.name))throw Error('Private file: '+rel);
  const text=await readFile(file,'utf8');
  if(patterns.some(re=>re.test(text)))throw Error('Credential-shaped content (withheld): '+rel);
  count++;
 }
}
await walk(root);
console.log(`${manifest.files.length} source hashes and ${count} text files checked; no blocked credential patterns. Not a security audit.`);
