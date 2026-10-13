import {env,createChart,todayShanghai,connectionSchema,processPalaceMemory} from '../dist/engine.mjs';
import {LOCAL_OWNER} from './bindings.mjs';
import {modelConnection} from './config.mjs';
import {installEgressGuard} from '../deployment/egress.mjs';
const connection=modelConnection(connectionSchema);
if(!connection)throw Error('Memory summarization requires your NOUS_API_KEY and NOUS_MODEL.');
installEgressGuard();
const profiles=await env.DB.prepare('SELECT id,birth FROM profiles WHERE owner=?').bind(LOCAL_OWNER).all();
for(const p of profiles.results){const result=await processPalaceMemory(LOCAL_OWNER,p.id,createChart(JSON.parse(p.birth),todayShanghai()),connection);console.log(JSON.stringify({profileId:p.id,...result}));}
console.log('Processed at most one queued job per profile. Run again to process further jobs; each may call your provider.');
