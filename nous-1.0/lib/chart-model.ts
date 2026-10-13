import { z } from 'zod';

export const birthSchema=z.object({name:z.string().trim().min(1).max(40),calendar:z.enum(['lunar','solar']),date:z.string().regex(/^\d{4}-\d{1,2}-\d{1,2}$/),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),gender:z.enum(['男','女']),leap:z.boolean(),place:z.string().max(80),timeMode:z.enum(['civil','corrected']),confirmed:z.boolean()});
export type Birth=z.infer<typeof birthSchema>;
export type Scope='natal'|'decadal'|'yearly'|'monthly'|'daily';
export const scopeNames:Record<Scope,string>={natal:'本命',decadal:'大限',yearly:'流年',monthly:'流月',daily:'流日'};
export const example:Birth={name:'示例命盘',calendar:'lunar',date:'1999-05-14',time:'13:25',gender:'男',leap:false,place:'出生地待确认',timeMode:'civil',confirmed:false};
export type Star={name:string;brightness:string;mutagen:string;type:string};
export type Palace={index:number;name:string;heavenlyStem:string;earthlyBranch:string;isBodyPalace:boolean;majorStars:Star[];minorStars:Star[];adjectiveStars:Star[];decadal:{range:number[]};};
export type Overlay={index:number;name:string;heavenlyStem:string;earthlyBranch:string;palaceNames:string[];mutagen:string[];stars:Star[][]};
export const scopeOrder:Scope[]=['natal','decadal','yearly','monthly','daily'];
export const mutagenNames=['禄','权','科','忌'] as const;
export type Transformation={id:string;sourceId:string;scope:Scope;value:typeof mutagenNames[number];star:string;palaceIndex:number;natalPalace:string;scopePalace:string};
export type TransformationSource={id:string;scope:Scope;label:string;origin:string;heavenlyStem:string;stemBranch:string;fixed:boolean;observedOn:string|null;periodLabel:string;ageRange?:number[];yearRange?:number[];mutations:Transformation[]};
export type ChartData={birth:Birth;solarDate:string;lunarDate:string;chineseDate:string;time:string;timeRange:string;fiveElementsClass:string;soul:string;body:string;palaces:Palace[];target:string;targetLunar:string;age:number;layers:Record<Exclude<Scope,'natal'>,Overlay>;decades:(Overlay&{ageRange:number[];yearRange:number[];palaceName:string})[];transformationSources:Record<Scope,TransformationSource>;ruleVersion:string};
