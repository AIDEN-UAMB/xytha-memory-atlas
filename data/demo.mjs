// Authored synthetic examples. Dates and stem-branch tags illustrate the format;
// these are NOT chart-engine output or actual people's conversations.
import {LAYERS,validateArchive} from '../src/memory.mjs';
const profiles=[{id:'sample-a',name:'探索者 A · 合成角色'},{id:'sample-b',name:'探索者 B · 合成角色'}];
const periods=[];
function period(profileId,key,layer,parentId,label,stemBranch,start,end){const id=profileId+'-'+key;periods.push({id,profileId,layer,parentId:parentId?profileId+'-'+parentId:null,label,stemBranch,start,end});return id;}
for(const {id:p} of profiles){
 period(p,'n','natal',null,'本命 · 固定','己卯','2000-01-01T00:00:00Z','2100-01-01T00:00:00Z');
 period(p,'d1','decadal','n','示例阶段 I','癸酉','2020-01-01T00:00:00Z','2030-01-01T00:00:00Z');
 period(p,'d2','decadal','n','示例阶段 II','甲戌','2030-01-01T00:00:00Z','2040-01-01T00:00:00Z');
 period(p,'y1','yearly','d1','2026','丙午','2026-01-01T00:00:00Z','2027-01-01T00:00:00Z');
 period(p,'y2','yearly','d1','2027','丁未','2027-01-01T00:00:00Z','2028-01-01T00:00:00Z');
 period(p,'y3','yearly','d2','2031','辛亥','2031-01-01T00:00:00Z','2032-01-01T00:00:00Z');
 for(const [y,m,d,h,year]of [['y1','m1','day1','h1','2026'],['y2','m2','day2','h2','2027'],['y3','m3','day3','h3','2031']]){
  period(p,m,'monthly',y,'示例月 · 10 月','戊戌',`${year}-10-01T00:00:00Z`,`${year}-11-01T00:00:00Z`);
  period(p,d,'daily',m,'示例日 · 08 日','乙卯',`${year}-10-08T00:00:00Z`,`${year}-10-09T00:00:00Z`);
  period(p,h,'hourly',d,'示例时 · 10:00–12:00 UTC','辛巳',`${year}-10-08T10:00:00Z`,`${year}-10-08T12:00:00Z`);
 }
}
const samples=[
 ['m-01','sample-a',['n','d1','y1','m1','day1','h1'],'我在考虑换一个城市工作。比起别人说适不适合，我更想看清自己的选择依据。','我更想看清自己的选择依据','讨论重大选择时，偏好先看依据，再比较行动选项。',['命宫','迁移','命宫','迁移','命宫','迁移'],'这是合成回答：先列出你已经确认的现实条件，再讨论可验证的下一步。宫位标签只承担索引作用。'],
 ['m-02','sample-a',['n','d1','y2','m2','day2','h2'],'今年想专心做一个长期项目。请把合作边界和里程碑列清楚，暂时不需要情绪鼓励。','请把合作边界和里程碑列清楚','项目讨论中倾向明确合作边界与阶段任务。',['官禄','夫妻','官禄','夫妻','官禄','命宫'],'这是合成回答：可以按交付目标、合作责任、检查日期三个维度整理。'],
 ['m-03','sample-a',['n','d2','y3','m3','day3','h3'],'上次的记录需要改一下。我并非一直喜欢简短回答，遇到陌生问题时还是需要充分解释。','遇到陌生问题时还是需要充分解释','回答详略取决于问题熟悉度；需要继续确认适用场景。',['福德','财帛','命宫','福德','财帛','迁移'],'这是合成回答：保留先前原文，记录这次更正，后续不把单次偏好泛化为固定人格。'],
 ['m-04','sample-b',['n','d1','y1','m1','day1','h1'],'我想重新安排自己的休息节奏。先帮我整理我明确说过的生活习惯，不要猜。','先帮我整理我明确说过的生活习惯','希望围绕明确表达的生活习惯展开讨论。',['疾厄','父母','疾厄','父母','命宫','疾厄'],'这是合成回答：只整理你提供的习惯信息，不将文化标签当作健康事实。']
];
const sources=[],records=[];
for(const [id,profileId,path,question,quote,summary,anchors,answer]of samples){
 const tags=path.map((key,i)=>{const period=periods.find(p=>p.id===profileId+'-'+key);return {layer:LAYERS[i],periodId:period.id,stemBranch:period.stemBranch,palace:'命宫',anchorPalace:anchors[i]};});
 const at=periods.find(p=>p.id===tags[5].periodId).start;
 sources.push({id:'turn-'+id,profileId,at,question,answer});records.push({id,profileId,sourceId:'turn-'+id,recordedAt:at,quote,summary,tags});
}
export const demo=validateArchive({version:1,synthetic:true,profiles,periods,sources,records,feedback:[]});
export const freshDemo=()=>structuredClone(demo);
