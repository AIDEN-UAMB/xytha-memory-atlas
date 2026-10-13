import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const suites=['verify-chart','verify-analysis-plan','verify-bprime-guards','verify-bprime-call-budget','verify-bprime-api','verify-context-upgrade','verify-timing-boundaries','verify-memory-analysis-plan','verify-chat-recovery','verify-chat-stream','verify-providers'];
for(const suite of suites){console.log('\nSuite: '+suite);const r=spawnSync(process.execPath,['--import','./harness-integration/scripts/register-windows-esm.mjs','tests/'+suite+'.mjs'],{stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(r.status||1);}
const r=spawnSync(process.execPath,['--test','tests/local-runtime.test.mjs'],{stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(r.status||1);
console.log('All Nous public-distribution suites passed. These use synthetic fixtures, not paid provider benchmarks.');
