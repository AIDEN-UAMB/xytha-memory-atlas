import { env } from 'cloudflare:workers';
export function rawDb(){ if(!env.DB) throw new Error('云端存储暂时不可用，请稍后重试。'); return env.DB; }
