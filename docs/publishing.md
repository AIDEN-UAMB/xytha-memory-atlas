# 发布指南

建议仓库名：`xytha-memory-atlas`

建议 GitHub About：

> A source-traceable memory atlas with six time layers and archived palace tags. Dependency-free, synthetic-data playground from Xytha.

Website：`https://xytha.com`

Topics：`memory`、`personalization`、`visualization`、`provenance`、`human-in-the-loop`、`ziwei-doushu`、`javascript`、`xytha`

## 上传范围

仅发布本目录，包括 `.github` 和 `.gitignore`。不要从生产项目复制额外文件。不要加入服务器环境、运行日志、真实数据、整站源代码或旧 Git 历史。

先运行 `npm test`、`npm run check`、`npm run build`，再审阅文件列表。MIT 只适用于本公开包，保留其许可证与署名文本；其说明见 [GitHub 维护的许可证介绍](https://choosealicense.com/licenses/mit/)。

## 推送到新建的空仓库

在 GitHub 创建空仓库后，使用自己的登录凭据进行推送，不要把凭据写进远程地址或文件。将以下 `YOUR_ACCOUNT` 替换为仓库所属账号：

```sh
git init -b main
git add .
git commit -m "Publish Xytha Memory Atlas public example"
git remote add origin https://github.com/YOUR_ACCOUNT/xytha-memory-atlas.git
git push -u origin main
```

如果目录已经初始化，只需设置远程并推送。CI 工作流会执行测试、发布扫描与构建；其远端运行结果必须在仓库中检查，不能用本地通过代替。

## 静态演示

`npm run build` 生成 `dist/`。将其作为站点根目录部署，或放到 GitHub Pages 对应的发布分支。所有运行时资源使用相对路径，允许放在 `/xytha-memory-atlas/` 这样的子路径下。

本仓库通过 `.github/workflows/pages.yml` 发布公开静态演示：`main` 更新后运行测试、公开文件检查和构建，仅上传 `dist/`。部署任务只申请 Pages 与 OIDC 权限，不修改 Xytha 正式站点。确认静态站点可访问后，可在 README 首屏增加其实际地址；不要预先填写尚不存在的在线演示链接。

## 首次发布文字

标题：**Xytha Memory Atlas 0.1.0：让记忆的来源与结构可被检查**

> 我们把 Xytha 记忆系统的一部分公开检查能力整理成了独立示例：六层时间选择、归档宫位图、对话原文与概述对照，以及不覆写历史的追加更正。它无需模型密钥，下载即可运行。
>
> 这不是完整产品源码，也不是命理有效性的研究结论。所有样例都是合成数据。我们希望先把记忆如何记录、追溯与修正讲清楚，再讨论它如何真正帮助用户。
>
> 欢迎试用、提出可复现问题，或改造成其他领域的记忆检查工具。完整产品入口：https://xytha.com

## 后续内容

- 第一篇：演示一次“原话 → 概述 → 标签 → 更正”的完整追溯。
- 第二篇：解释为什么切换观察时间不能重写历史标签。
- 第三篇：展示一个新增合成场景的贡献流程。

这些是待发布文案与选题，没有自动发送到任何平台。不要添加不存在的 Star 数、用户数、实验结论或媒体背书。
