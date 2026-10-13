import {z} from 'zod';
export const protocols=['openai-chat','openai-responses','anthropic','gemini'] as const;
export type Protocol=typeof protocols[number];
export const connectionSchema=z.object({provider:z.string().max(50).default('custom'),baseUrl:z.string().url().max(600),protocol:z.enum(protocols),model:z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_./:@-]+$/),key:z.string().min(1).max(2000),jsonMode:z.boolean().default(false),thinking:z.enum(['auto','enabled','disabled']).default('auto'),contextWindow:z.number().int().min(1024).max(2000000).optional()});
export type Connection=z.infer<typeof connectionSchema>;
export type ModelPreset={id:string;name:string;baseUrl:string;protocol:Protocol;model:string;jsonMode:boolean;note:string;docs:string};
export const presets:ModelPreset[]=[
{id:'bigmodel',name:'智谱 · 国内',baseUrl:'https://open.bigmodel.cn/api/paas/v4',protocol:'openai-chat',model:'glm-5.2',jsonMode:true,note:'使用通用 API 计费密钥。Coding Plan 的接口与可用模型可能不同。',docs:'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2'},
{id:'zai',name:'Z.ai · 国际',baseUrl:'https://api.z.ai/api/paas/v4',protocol:'openai-chat',model:'glm-5.2',jsonMode:true,note:'请使用 Z.ai 通用 API 密钥，不与智谱国内账户混用。',docs:'https://docs.z.ai/guides/llm/glm-5.2'},
{id:'openai',name:'OpenAI',baseUrl:'https://api.openai.com/v1',protocol:'openai-responses',model:'gpt-6-astra',jsonMode:true,note:'模型需在你的 API 账户中可用。',docs:'https://developers.openai.com/api/docs/guides/text'},
{id:'deepseek',name:'DeepSeek',baseUrl:'https://api.deepseek.com',protocol:'openai-chat',model:'deepseek-v4-pro',jsonMode:true,note:'模型 ID 可按账户可用列表修改。',docs:'https://api-docs.deepseek.com/'},
{id:'qwen',name:'通义千问 · Qwen',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',protocol:'openai-chat',model:'qwen-plus',jsonMode:false,note:'请用控制台显示的地域与工作空间 Base URL 替换预设地址。',docs:'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope'},
{id:'moonshot',name:'Kimi',baseUrl:'https://api.moonshot.ai/v1',protocol:'openai-chat',model:'kimi-k3',jsonMode:false,note:'若你的账户使用国内域名，请按控制台改为 api.moonshot.cn。',docs:'https://platform.kimi.ai/docs/overview'},
{id:'siliconflow',name:'硅基流动',baseUrl:'https://api.siliconflow.cn/v1',protocol:'openai-chat',model:'',jsonMode:false,note:'从控制台复制完整模型 ID，可包含组织名与斜杠。',docs:'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions'},
{id:'openrouter',name:'OpenRouter',baseUrl:'https://openrouter.ai/api/v1',protocol:'openai-chat',model:'',jsonMode:false,note:'复制完整模型 ID，例如服务商/模型名称。',docs:'https://openrouter.ai/docs/api/reference/overview'},
{id:'anthropic',name:'Anthropic · Claude',baseUrl:'https://api.anthropic.com/v1',protocol:'anthropic',model:'',jsonMode:false,note:'使用 Messages 原生协议，请填入账户可用模型 ID。',docs:'https://platform.claude.com/docs/en/api/messages'},
{id:'gemini',name:'Google · Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',protocol:'gemini',model:'',jsonMode:true,note:'使用 generateContent 原生协议，请填入可用模型 ID。',docs:'https://ai.google.dev/api/generate-content'},
{id:'custom',name:'自定义服务 / 中转',baseUrl:'https://',protocol:'openai-chat',model:'',jsonMode:false,note:'填写可信服务商的 HTTPS Base URL，并选择它实际支持的协议。',docs:''}
];
export const defaultConnection={...presets[0],provider:presets[0].id,key:'',thinking:'auto' as const};
export function safeConnection(c:Connection){const{key,...safe}=c;return safe;}
