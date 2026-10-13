import {register} from 'node:module';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import {resolve} from 'node:path';

register('./windows-esm-loader.mjs',import.meta.url);

if(process.platform==='win32'){
  const original=childProcess.execFileSync;
  childProcess.execFileSync=(file,args=[],options={})=>{
    const normalized=String(file).replaceAll('\\','/');
    if(normalized.endsWith('/node_modules/.bin/workerd')){
      const projectRoot=normalized.slice(0,-'/node_modules/.bin/workerd'.length);
      return original(process.execPath,[resolve(projectRoot,'node_modules/workerd/bin/workerd'),...args],options);
    }
    return original(file,args,options);
  };
  syncBuiltinESMExports();
}
