import {z} from 'zod';
import type {AnalysisPlan,PlanInput} from './analysis-plan';
import type {ChartData,Scope} from './chart';
import type {DatedQuery} from './query-dates';

export const HENOSIS_VERSION='xytha-henosis.1';
export const henosisSettingsSchema=z.object({
  historyDecades:z.union([z.literal(1),z.literal(2),z.literal(3)]).default(2),
  maxSupplementRounds:z.union([z.literal(0),z.literal(1)]).default(1),
  thinking:z.enum(['auto','enabled','disabled']).default('enabled'),
}).default({historyDecades:2,maxSupplementRounds:1,thinking:'enabled'});
export type HenosisSettings=z.infer<typeof henosisSettingsSchema>;
export type HenosisModelCall=(instructions:string,data:unknown,phase:'initial_plan'|'refine_plan'|'initial_plan_repair'|'refine_plan_repair')=>Promise<unknown>;
export type HenosisDecision={phase:string;taskId?:string;action:string;reason:string;evidenceIds?:string[]};
export type HenosisPlan=AnalysisPlan&{
  henosis:{version:typeof HENOSIS_VERSION;revision:number;settings:HenosisSettings;decisions:HenosisDecision[];
    additions:{taskId:string;query:DatedQuery;reason:string;evidenceIds:string[]}[];
    perspective:'present_retrospective'|'historical_as_of';asOf:string;clarification?:string;
    dependencies?:{taskId:string;dependsOnTaskId:string;relation:'same_event'|'conditional'}[];
    questionContract?:ReturnType<typeof import('./henosis-orchestration').henosisQuestionContract>;
    deliveryGroups?:{taskId:string;sourceTaskIds:string[]}[];};
};
export type HenosisPlanningInput=PlanInput&{settings:HenosisSettings;callModel?:HenosisModelCall;signal?:AbortSignal};
export type HenosisObservation={
  id:string;taskId:string;role:'natal'|'current'|'retrospective'|'candidate';scope:Scope;date:string;
  start?:string;end?:string;palace:string;natalPalace:string;palaceIndex:number;
  parentDecade?:string;temporalStatus:'timeless'|'past'|'current'|'projection';
  stars:{name:string;brightness:string|null}[];
  transformations:{star:string;value:string;sourceId:string;scope:Scope}[];
  evidenceIds:string[];
};
export type HenosisHypothesis={
  id:string;taskId:string;dimension:string;claim:string;status:'interpretation_hypothesis';
  evidenceIds:string[];ruleIds:string[];alternatives:string[];asOf:string;
};
export type HenosisEvidenceBundle={
  version:1;chartVersion:string;referenceDate:string;plan:HenosisPlan;
  observations:HenosisObservation[];hypotheses:HenosisHypothesis[];
  evidence:unknown[];references:{id:string;scope?:string;date?:string;palace?:string;[key:string]:unknown}[];
  coverage:{taskId:string;status:'complete'|'partial'|'unavailable'|'not_applicable';reason:string;missing:string[]}[];
  issues:string[];executedQueries:{taskId:string;query:DatedQuery;role:HenosisObservation['role']}[];
  context:unknown;
};
export type HenosisEvidenceInput={chart:ChartData;plan:HenosisPlan;settings:HenosisSettings;
  previous?:HenosisEvidenceBundle;signal?:AbortSignal;onProgress?:(detail:string)=>void;};
