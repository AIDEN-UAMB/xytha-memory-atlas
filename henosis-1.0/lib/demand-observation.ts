// Optional host-observation port used by timing.ts. No production telemetry.
import type {ChartData,Scope} from './chart';
import type {TimingSnapshot} from './timing';
export interface DemandObservation {
 begin():void;
 end():void;
 timing(chart:ChartData,snapshot:TimingSnapshot):void;
 record(chart:ChartData,items:unknown[],purpose:string,palaces:string[]):void;
}
