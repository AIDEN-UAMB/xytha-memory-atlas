# 安装、模型与数据

## 安装与启动

Node.js 24 LTS；Windows、macOS、Linux 均使用 `npm ci && npm run build` 的顺序（PowerShell 可逐行执行）。然后 `npm start`，访问日志中的 `http://127.0.0.1:4174`。使用精确的回环地址；Host/Origin 校验会拒绝不同主机名。

构建不需要云服务，不会发布官网，也不需要生产密钥。不要将正式站点的 `.env` 或用户数据库复制进开源目录。更改 `PORT` 后按新地址访问。

## 自备模型

复制 `.env.example` 为 `.env`，填写本人的供应商信息。

| 配置 | 含义 |
| --- | --- |
| `NOUS_API_KEY` | 你自己的模型密钥；留空运行规则模式 |
| `NOUS_MODEL` | 账户实际可用的模型 ID；设置密钥时必填 |
| `NOUS_BASE_URL` | 供应商公开 HTTPS API 地址 |
| `NOUS_PROTOCOL` | `openai-chat`、`openai-responses`、`anthropic`、`gemini` |
| `NOUS_PROVIDER` | 供应商品牌 ID，用于原有参数策略；更换供应商时一并更新或删除以按地址识别 |
| `NOUS_JSON_MODE` | 模型是否支持所用协议的 JSON 模式 |
| `NOUS_THINKING` | `auto`、`enabled`、`disabled`，最终支持以供应商为准 |
| `XYTHA_DIRECT_OUTPUT` | 默认 `false`；启用会跳过原有证据契约审查 |

原有 provider 配置内的型号是源码快照预设，不是当前可用性保证。此工作台要求显式填写模型，不会偷偷选用未指定的收费型号。外发保护只接受公开 HTTPS，不支持本机模型端点。

## 数据在哪里

默认保存在 `nous-1.0/.runtime/`，不会进入 Git。对话原文在 SQLite 中；记忆和检查点沿用选定字段加密，**不是整库加密**。本机 `vault-secret` 用于这些字段；丢失后不能解密旧记录。迁移请停止进程后安全备份整个目录，不要单独移动数据库，也不要将该目录上传 GitHub。

工作台是一套本地单用户数据，不等于官网浏览器本地存储，也不会自动同步官网账号。新的出生时间按输入的 civil time 排盘；地区只是记录字段，本地创建表单不自动换算真太阳时。首次示例明确标记为合成。

## 记忆任务

模型对话完成后由原 route 排队。`npm run memory:process` 使用同一模型配置，为每个命主最多处理一个任务。处理结果会报告 idle/busy/completed/failed 等实际状态；失败不应伪装成成功。此包装不自动定时调用模型。若自行部署 worker，需要自行管理频率、预算与持久队列监控。

## 公网部署边界

这个版本提供本地运行入口与可移植核心，未附生产多租户认证部署。公开服务需要可信账号认证、租户隔离、TLS、密钥服务、配额、备份与运维。原 route 的认证头必须由可信服务端产生。没有提供 Supabase 管理密钥、SSH 密钥、生产域名路由、签名材料或私有服务器地址。
