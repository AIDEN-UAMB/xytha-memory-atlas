import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
await build({entryPoints:['runtime/exports.ts'],outfile:'dist/engine.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'local-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'../runtime/bindings.mjs',external:true}));}}]});
await build({entryPoints:['web/client.ts'],outfile:'dist/client.js',bundle:true,platform:'browser',format:'esm',minify:true});
console.log('Built Nous 1.0 engine and local browser client.');
