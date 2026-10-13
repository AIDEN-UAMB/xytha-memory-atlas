export function modelConnection(schema){
  if(!process.env.NOUS_API_KEY)return undefined;
  if(!process.env.NOUS_MODEL)throw Error('Set NOUS_MODEL to a model available in your provider account.');
  const baseUrl=process.env.NOUS_BASE_URL||'https://api.deepseek.com';
  const known={'api.deepseek.com':'deepseek','open.bigmodel.cn':'bigmodel','api.z.ai':'zai','api.openai.com':'openai','api.anthropic.com':'anthropic','generativelanguage.googleapis.com':'gemini'};
  return schema.parse({provider:process.env.NOUS_PROVIDER||known[new URL(baseUrl).hostname]||'custom',baseUrl,protocol:process.env.NOUS_PROTOCOL||'openai-chat',model:process.env.NOUS_MODEL,key:process.env.NOUS_API_KEY,jsonMode:process.env.NOUS_JSON_MODE==='true',thinking:process.env.NOUS_THINKING||'auto'});
}
