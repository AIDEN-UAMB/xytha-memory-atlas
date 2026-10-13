import type {DatedQuery} from './query-dates';
import {matchQuestionDomains,resolveQuestionPalaces} from './question-domains';
/** Initial tool-plan completion only. Palace/topic mapping, never interpretation or scoring. */
export function completeTopicQueries(question:string,queries:DatedQuery[]){
 const themes=matchQuestionDomains(question);
 if(themes.length<2||!/分别|同时|另外|还有|以及|和|与|、|[？?].+[？?]/.test(question))return queries;
 const needed=resolveQuestionPalaces(question,{fallback:false}),out:DatedQuery[]=[];
 for(const q of queries){
  const all=[...new Set([...q.palaces,...needed])];
  for(let i=0;i<all.length;i+=5)out.push({...q,palaces:all.slice(i,i+5),relations:true});
 }
 // At most 4 original time groups × 3 palace groups. No unbounded model tool loop.
 return out;
}
