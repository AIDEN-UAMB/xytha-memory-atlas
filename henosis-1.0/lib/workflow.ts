// Standalone type adapter: original Progress contract only, no Nous executor.
export type Progress={stage:string;detail:string;status:'running'|'done';contextCapacity?:import('./context-capacity').ContextCapacity};
