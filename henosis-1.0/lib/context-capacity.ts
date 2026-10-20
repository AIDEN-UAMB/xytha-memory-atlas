import type {Connection} from './providers/config';

export type ContextCapacity={
 version:1;model:string;stage:string;state:'prepared'|'generating'|'completed';
 inputChars:number;inputTokensEstimate:number;outputTokensEstimate:number;reservedOutputTokens:number;
 windowTokens:number|null;windowSource:'configured'|'official'|'unknown';sourceUrl?:string;
 inputTokensActual?:number;outputTokensActual?:number;replayed?:boolean;
 historyMessages:number;memories:number;
 analysis?:{taskCount:number;completedTasks:number;periods:number;precisions:string[]};
 compaction?:{removedHistory:number;removedCards:number;essentialEvidenceRetained:boolean};
 checkpoint?:{bytes:number;limitBytes:number};
};
export const CONTEXT_ESTIMATE_NOTE='按中英文字符估算，包含当前调用的系统说明、问题、历史和命盘；不等同于服务商计费 token。';
export function estimateTokens(text:string){
 const wide=(text.match(/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/gu)||[]).length;
 return Math.ceil(wide+(text.length-wide)/4);
}
export function modelContextWindow(c:Pick<Connection,'model'|'baseUrl'|'contextWindow'>){
 if(c.contextWindow)return {windowTokens:c.contextWindow,windowSource:'configured' as const};
 // Only the documented general-purpose endpoint; custom gateways may have other limits.
 try{const u=new URL(c.baseUrl);if(u.hostname==='open.bigmodel.cn'&&u.pathname.replace(/\/$/,'')==='/api/paas/v4'&&c.model==='glm-5.2')return {windowTokens:1000000,windowSource:'official' as const,sourceUrl:'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2'};}catch{}
 return {windowTokens:null,windowSource:'unknown' as const};
}
export function measureContext(c:Pick<Connection,'model'|'baseUrl'|'contextWindow'>,instructions:string,data:unknown,reservedOutputTokens:number,stage:string):ContextCapacity{
 const text=instructions+'\n'+JSON.stringify(data),d=(data||{}) as Record<string,any>,dialogue=d.dialogue||{};
 const tasks=d.analysisPlan?.tasks||[];
 return {version:1,model:c.model,stage,state:'prepared',inputChars:text.length,inputTokensEstimate:estimateTokens(text),outputTokensEstimate:0,reservedOutputTokens,...modelContextWindow(c),historyMessages:(dialogue.recent||d.history||[]).length,memories:(dialogue.confirmedMemories||d.confirmedMemories||[]).length+(d.personalMemory?.cards||[]).length,
  ...(tasks.length?{analysis:{taskCount:tasks.length,completedTasks:tasks.filter((t:any)=>t.coverage?.status==='complete'||t.coverage?.status==='not_applicable').length,periods:tasks.reduce((n:number,t:any)=>n+(t.coverage?.periods||0),0),precisions:[...new Set<string>(tasks.map((t:any)=>t.precision))]}}:{}),
  ...(d.contextRetention?{compaction:{removedHistory:d.contextRetention.removedHistory,removedCards:d.contextRetention.removedCards,essentialEvidenceRetained:d.contextRetention.essentialEvidenceRetained}}:{})};
}
