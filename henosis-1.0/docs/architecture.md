# Henosis 1.0 架构与接入

原版流水线标识：`xytha-henosis.1` / `henosis-depth.10`。

| 阶段 | 输入 | 输出与约束 |
| --- | --- | --- |
| 输入 | 命主盘面、原问题、历史、设置、冻结时间 | 日期统一用于同一轮调查；历史原话单独保留 |
| 初始规划 | 问题原文、领域与时间识别、模型提案 | `HenosisPlan`；检查原文引用、任务对象与区间 |
| 取证 | 已确认任务、查询时间、宫位 | `HenosisEvidenceBundle`；确定性星曜、四化、来源 ID |
| 补查 | 已有证据、缺口、模型建议 | 经检查的追加查询；次数受原版设置约束 |
| 组织上下文 | 事实、候选、前史、当前环境 | 引用别名、结构化表和可独立回答的分区 |
| 生成 | 答案契约、任务与当前证据分区 | 分层比较草稿，逐项关联候选和事实 |
| 检查修复 | 草稿、引用注册表与覆盖要求 | 有限修复；无法完成的任务标明限制，不伪造通过 |
| 综合 | 已完成子任务、覆盖与用量 | `answer`、历史原话摘要索引、进度和计量信息 |

## 核心 API

```js
import {
  runHenosis, createChart, henosisSettingsSchema
} from './dist/engine.mjs';

// birth and connection come from the authenticated host, not model-generated data.
const checkpoints = new Map();
const result = await runHenosis({
  chart: createChart(birth, '2026-10-20'),
  question: '请比较2027和2028年的事业方向。',
  history: [],
  settings: henosisSettingsSchema.parse(undefined),
  profileId: 'your-profile-id',
  profileRevision: 1,
  now: '2026-10-20T04:00:00Z',
  connection,
  load: async key => checkpoints.get(key),
  save: async (key, value) => checkpoints.set(key, structuredClone(value)),
  onProgress: event => renderProgress(event)
});
renderAnswer(result.answer.content);
```

服务端集成时，存储必须按认证用户、命主、资料版本和请求隔离。恢复前核验问题、模型连接和资料指纹；不要把多个用户或不同问题放进同一个 Map。主应用的会话租约及数据库实现不属于本独立宿主，生产集成方需实现并测试并发、取消、幂等和授权。

可选 `borrow(plan)` 用于提供有来源的关联记忆，`summary` 为已有摘要索引，`signal` 用于取消。历史/借用记忆不构成新的盘面事实。CLI 的简化示例使用空历史，完整接口保留原版参数。

## 宿主适配

- `lib/server.ts`：保留原 `HttpError`，去掉网站身份入口。
- `lib/henosis-store.ts`：保留原 `clean` 和 `henosisFingerprint`，数据库由 `load/save` 替代。
- `lib/workflow.ts`：仅保留进度事件类型，避免携入 Nous 执行器。
- `lib/demand-observation.ts`：可选观测端口的类型声明；不上传生产遥测。
- `runtime/bindings.mjs`：空宿主绑定，不自动读取开发者环境中的其他模型密钥。

这些差异在源码清单中标明，不改变排盘、规划和答案审核算法。未包含应用层认证不代表它不需要认证；此包默认通过本机 CLI 使用。
