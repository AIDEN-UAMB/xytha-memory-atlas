import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runHenosis,createChart,birthSchema,henosisSettingsSchema,connectionSchema} from './dist/engine.mjs';
const chartOnly=process.argv.includes('--chart');
const arg=process.argv.slice(2).find(x=>!x.startsWith('--'));
try{
 if(!chartOnly&&!arg)throw Object.assign(Error(),{code:'INPUT_REQUIRED'});
 const file=arg||fileURLToPath(new URL('./examples/input.json',import.meta.url));
 const input=JSON.parse(await readFile(file,'utf8')),birth=birthSchema.parse(input.birth);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.date)))throw Object.assign(Error(),{code:'INVALID_DATE'});
 const chart=createChart(birth,input.date);
 if(chartOnly){
  console.log(JSON.stringify({mode:'deterministic-chart-only',modelCalls:0,synthetic:!arg,date:chart.target,palaces:chart.palaces.map(p=>({name:p.name,majorStars:p.majorStars})),note:'No generated interpretation or prediction.'},null,2));
 }else{
  if(typeof input.question!=='string'||!input.question.trim())throw Object.assign(Error(),{code:'QUESTION_REQUIRED'});
  const connection=connectionSchema.parse({provider:'custom',baseUrl:process.env.HENOSIS_BASE_URL,model:process.env.HENOSIS_MODEL,key:process.env.HENOSIS_API_KEY,protocol:process.env.HENOSIS_PROTOCOL||'openai-chat',jsonMode:process.env.HENOSIS_JSON_MODE==='true',thinking:'auto',...(process.env.HENOSIS_CONTEXT_WINDOW?{contextWindow:Number(process.env.HENOSIS_CONTEXT_WINDOW)}:{})});
  const checkpoints=new Map();
  const result=await runHenosis({chart,question:input.question,history:[],settings:henosisSettingsSchema.parse(input.settings),profileId:'local-cli',profileRevision:1,now:input.date+'T04:00:00Z',connection,
   load:async name=>checkpoints.get(name),save:async(name,value)=>{checkpoints.set(name,structuredClone(value));},
   onProgress:p=>{if(p.status==='done')process.stderr.write(p.stage+'\n');}});
  console.log(result.answer.content);
  console.error(JSON.stringify({completion:result.answer.completion,usage:result.answer.henosis.usage}));
  if(result.answer.completion!=='answered')process.exitCode=2;
 }
}catch(error){
 // Never print raw provider errors, input, validation values or credentials.
 console.error('Henosis could not complete:',/^[A-Z_0-9]+$/.test(error?.code||'')?error.code:'INPUT_OR_EXECUTION_ERROR');
 console.error('Usage: npm run demo | npm start -- private-inputs/input.json');
 process.exitCode=1;
}
