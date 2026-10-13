import {retrievePalaceMemory, type RetrievedMemory} from './palace-memory';
import {topicPalaces} from './palace-memory-facts';
import {retrievePersonalEvidence} from './personal-memory';
import {estimateTokens} from './context-capacity';
import type {PersonalCrossEvidence} from './personal-context';
import type {ChartData} from './chart';
import {rawDb} from '@/db/raw';

/** Cross-mode material is borrowed evidence. Never copy the other mode's history or summary. */
export async function retrieveAnalysisEvidence(owner:string,profileId:string,revision:number,chart:ChartData,question:string):Promise<PersonalCrossEvidence[]>{
 if(!topicPalaces(question).length)return [];
 const memory=await retrievePalaceMemory(owner,profileId,chart,question,chart.target);
 const result:PersonalCrossEvidence[]=[];let tokens=0;
 for(const card of memory.cards){
  // Reverting birth details can recreate a chart hash. It must not relabel an old source as a new revision.
  const source=await rawDb().prepare('SELECT profile_revision FROM messages WHERE owner=? AND profile_id=? AND id=? AND role=?').bind(owner,profileId,card.sourceId,'assistant').first<{profile_revision:number}>();
  if(!source||source.profile_revision!==revision||card.provenance?.profileId&&card.provenance.profileId!==profileId)continue;
  const content=JSON.stringify({userFocus:card.userFocus,summary:card.summary,interpretation:card.interpretation,conclusions:card.conclusions,binding:card.binding,sourceRecordedAt:card.provenance?.recordedAt,
   note:'来自命盘对话的历史解读，仅作参考；不能当作用户已发生的经历，也不能替代本轮引擎计算。'});
  const cost=estimateTokens(content);if(tokens+cost>1800)continue;
  result.push({id:card.id,source:'palace-analysis',content,profileId,profileRevision:source.profile_revision,sourceMessageId:card.sourceId,
   ...(card.binding?.atemporal||card.binding?.year===0?{}:{targetStart:card.binding?.start||card.binding?.date,targetEnd:card.binding?.end||card.binding?.date})});
  tokens+=cost;if(result.length>=3)break;
 }
 return result;
}

/** Original chart chat keeps its own memory assembly. Only matching explicit facts/goals may supplement it. */
export async function retrieveChartChatMemory(...args:Parameters<typeof retrievePalaceMemory>):Promise<RetrievedMemory>{
 const memory=await retrievePalaceMemory(...args);
 const [owner,profileId,,question,,, ,plan]=args;
 // The plan binds the source to the current profile revision. Legacy callers retain their old behavior.
 if(!plan?.profileRevision)return memory;
 const cards=await retrievePersonalEvidence(owner,profileId,plan.profileRevision,question).catch(()=>[]);
 let tokens=memory.tokensEstimate;
 for(const card of cards){
  if(card.kind==='preference'||card.kind==='interpretation')continue;
  const fact={sourceId:card.sourceId||card.id,quote:card.sourceQuote||card.content,meaning:card.content,source:'personal-chat',borrowed:true,kind:card.kind,
   recordedAt:new Date(card.createdAt).toISOString(),updatedAt:new Date(card.updatedAt).toISOString(),eventTime:card.eventStart||card.eventEnd?{start:card.eventStart,end:card.eventEnd}:null,
   sourceProfileRevision:card.profileRevision,sourceSessionId:card.sessionId,
   note:'来自个性化聊天的历史用户陈述；相对时间以 recordedAt 为准，目标是否仍在执行以最新明确资料为准。不继承其聊天风格、摘要或时间调查计划。'};
  const cost=estimateTokens(JSON.stringify(fact));if(tokens+cost>10000)continue;
  memory.backgroundFacts.push(fact);tokens+=cost;
 }
 return {...memory,tokensEstimate:tokens};
}
