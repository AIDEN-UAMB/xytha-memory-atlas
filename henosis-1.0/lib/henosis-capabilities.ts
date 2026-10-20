import type {Connection} from './providers/config';
import {modelContextWindow} from './context-capacity';

/** Henosis-local registry. Never changes Nous/provider defaults or user settings. */
export function henosisModelCapacity(connection:Connection){
 const existing=modelContextWindow(connection);
 if(existing.windowTokens)return {...existing,verifiedAt:undefined as string|undefined};
 try{
  const url=new URL(connection.baseUrl),path=url.pathname.replace(/\/$/,'');
  if(url.protocol==='https:'&&url.hostname==='api.deepseek.com'&&['','/v1','/anthropic'].includes(path)&&['deepseek-flash','deepseek-v4-pro'].includes(connection.model))return {
   windowTokens:1000000,windowSource:'official' as const,sourceUrl:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',verifiedAt:'2026-09-22'};
 }catch{}
 return {...existing,verifiedAt:undefined as string|undefined};
}
