import type {TimingRequest} from './timing-request';
import {PALACE_NAMES,resolveQuestionPalaces} from './question-domains';

/** Keep the time comparison and memory topic binding on the same small palace set. */
export function timingPalaces(request:Pick<TimingRequest,'task'|'goal'|'plan'|'palaces'>):string[]{
 if(request.palaces?.length){const palaces=[...new Set(request.palaces)];if(palaces.some(p=>!PALACE_NAMES.includes(p as typeof PALACE_NAMES[number])))throw Error('TIMING_UNKNOWN_PALACE');return palaces;}
 return resolveQuestionPalaces(request.goal);
}
