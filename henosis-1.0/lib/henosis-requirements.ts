import type {HenosisPlan} from './henosis-contracts';

// A second, small contract reads the ORIGINAL question, independently of the
// model plan and evidence coverage. This is routing validation, not content review.
export function henosisTemporalRequirements(question:string){
 return [...question.matchAll(/(未来|接下来|往后|过去|此前)([一二两三四五六七八九十\d]+)年/g)].map(m=>({
  quote:m[0],start:m.index!,end:m.index!+m[0].length,direction:/未来|接下来|往后/.test(m[1])?'future' as const:'past' as const,
 }));
}
export function checkHenosisRequirements(plan:HenosisPlan){
 return henosisTemporalRequirements(plan.question).flatMap<{requirement:ReturnType<typeof henosisTemporalRequirements>[number];taskId?:string;code:string}>(requirement=>{
  const task=plan.tasks.find(t=>t.source.start<=requirement.start&&t.source.end>=requirement.end);
  if(!task)return [{requirement,code:'HENOSIS_REQUIREMENT_MISSING'}];
  const range=task.timingRequest,reference=task.temporalIntent.referenceDate||plan.referenceDate;
  if(!range||(requirement.direction==='future'?range.end<=reference:range.start>=reference))return [{requirement,taskId:task.id,code:'HENOSIS_TIME_ROLE_CONFLICT'}];
  return [];
 });
}
