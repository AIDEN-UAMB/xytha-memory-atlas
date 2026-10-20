import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const suites=['plan','evidence','generation','runtime','orchestration','reliability','efficiency','router','depth','temporal-regression'];
for(const suite of suites){
 const result=spawnSync(process.execPath,['tests/verify-henosis-'+suite+'.mjs'],{stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
const cli=spawnSync(process.execPath,['--test','tests/cli.test.mjs'],{stdio:'inherit'});
if(cli.status!==0)process.exit(cli.status||1);
console.log('All 10 original regression suites and CLI tests passed; no real model calls.');
