import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'SOURCE-MANIFEST.json'),'utf8'));
for(const f of manifest.files){const bytes=await readFile(path.join(root,f.path));if(createHash('sha256').update(bytes).digest('hex')!==f.publishedSHA256)throw Error('Baseline source changed without updating provenance: '+f.path);}
const excluded=new Set(['node_modules','dist','.runtime','.sites-runtime','.git','coverage']);
const secretPatterns=[new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),new RegExp('(?:ghp|gho|ghu|ghs|github_pat)'+'_[A-Za-z0-9_]{25,}'),new RegExp('(?:^|[^A-Za-z0-9_-])sk-'+'[A-Za-z0-9_-]{25,}')];
let count=0;
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(excluded.has(e.name))continue;const p=path.join(dir,e.name),rel=path.relative(root,p).replaceAll('\\','/');if(e.isSymbolicLink())throw Error('Symlink in release: '+rel);if(e.isDirectory()){await walk(p);continue;}
if(e.name!=='.env.example'&&/^(?:\.env)(?:\.|$)|\.(?:pem|key|pfx|sqlite|db|zip|log)$/i.test(e.name))throw Error('Private file: '+rel);
if(/(?:^|\/)(?:internal|ops|artifacts)(?:\/|$)|^lib\/henosis-/.test(rel))throw Error('Out-of-scope implementation: '+rel);
const text=await readFile(p,'utf8');if(secretPatterns.some(re=>re.test(text)))throw Error('Credential-like content (value withheld): '+rel);
if(/\/(?:opt|home)\/[\w.-]+\/(?:env|releases|backups)\//.test(text))throw Error('Review deployment content: '+rel);
if(/\.(?:ts|mjs)$/.test(e.name)&&!e.name.endsWith('.d.ts')){const src=ts.createSourceFile(rel,text,ts.ScriptTarget.Latest,true),imports=[];function visit(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))imports.push(n.moduleSpecifier.text);if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)&&ts.isStringLiteral(n.argument.literal))imports.push(n.argument.literal.text);ts.forEachChild(n,visit);}visit(src);for(const spec of imports){if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;const base=spec.startsWith('@/')?path.join(root,spec.slice(2)):path.resolve(path.dirname(p),spec);if(base.includes(path.sep+'dist'+path.sep))continue;let ok=false;for(const ext of ['', '.ts','.mjs','.js','/index.ts'])try{await readFile(base+ext);ok=true;break;}catch{}if(!ok)throw Error('Unresolved source import: '+rel+' → '+spec);}}
count++;}}
await walk(root);
console.log(`Nous release check: ${manifest.files.length} source hashes verified, ${count} publishable text files, imports resolved; no blocked credential patterns. This is not a security audit.`);
