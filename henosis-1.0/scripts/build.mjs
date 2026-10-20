import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
await build({entryPoints:['runtime/exports.ts'],outfile:'dist/engine.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'standalone-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'../runtime/bindings.mjs',external:true}));
}}]});
console.log('Built original Henosis 1.0 standalone engine.');
