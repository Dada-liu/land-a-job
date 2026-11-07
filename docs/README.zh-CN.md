# 文档索引

[English](./README.md) · **简体中文**

本目录存放**全部主文档**（产品定义、架构、实施计划）与**过程性文档**（PR 记录、变更提案、评审纪要）。

## 主文档

| 文档 | 内容 | 什么时候读 |
| --- | --- | --- |
| [../README.zh-CN.md](../README.zh-CN.md) | 快速开始、详细使用方式、架构图、接口速查、约束 | 上手、查命令、看整体架构 |
| [PRD.zh-CN.md](./PRD.zh-CN.md) | 需求、北极星指标、验收标准、已定决策 D1–D3 | 讨论「要不要做」「做成什么」 |
| [ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md) | 设计原则、数据模型、API 契约、MCP 工具表、Skill 契约、ADR | 改代码之前 |
| [IMPLEMENTATION.zh-CN.md](./IMPLEMENTATION.zh-CN.md) | 8 周阶段计划、实测完成情况、测试与 E2E 口径 | 排期、验收、查「做到哪了」 |

根目录只留 `README.md` 作为入口（GitHub 仓库首页会渲染它），其余文档都在本目录。
三份主文档互相引用用的是同目录相对链接（如 `./ARCHITECTURE.zh-CN.md`），在本目录内跳转仍然有效；
从仓库根目录、`apps/`、`skills/` 等处引用它们时必须带 `docs/` 前缀，例如 `docs/ARCHITECTURE.md`。

## 过程性文档

| 类型 | 路径 | 命名 | 说明 |
| --- | --- | --- | --- |
| PR 记录 | `docs/pr/` | `NNNN-短标题.md` | 一次可评审的变更：背景、改动、影响面、验证、风险与回滚；编号四位递增，不复用 |
| PR 模板 | `docs/pull-request-template.md` | — | 新建 PR 记录时复制填写；用 GitHub PR 时可把正文搬进 `.github/PULL_REQUEST_TEMPLATE.md` |
| 变更提案 | `docs/proposals/`（**不在 main 上**） | `YYYY-MM-DD-短标题.md` | 尚未实施、需要讨论的方案；落地后改为引用对应 PR 记录。这些提案属于内部推演，不随仓库分发，只保存在本地分支 `local-proposals`（见下方说明） |
| 评审纪要 / 复盘 | `docs/reviews/` | `YYYY-MM-DD-短标题.md` | 只记结论与待办，过程聊天记录不入库 |
| 独立 ADR | `docs/adr/` | `NNNN-短标题.md` | 目前 ADR 摘要收在 `ARCHITECTURE.zh-CN.md` §12；单条决策需要展开论证时才独立成篇 |

目录按需创建，不放空的占位文件。已有示例见 [pr/0001-jd-collect-and-cn-ats.zh-CN.md](./pr/0001-jd-collect-and-cn-ats.zh-CN.md)。

> **`docs/proposals/` 为什么不在 main 上**：提案是内部推演材料（商业模式、远程服务设想等），对外分发没有价值，也容易被误当成路线图。它们整体保存在本地分支 `local-proposals`——`git switch local-proposals` 可以查看或继续写，但**这个分支不推送到远程**。在 main 上写新提案前，先切到该分支。
>
> 注意：不要用 `git push --all` 或 `git push origin local-proposals`，那会把它变成公开分支，与这条约定冲突。

## 写 PR 记录的最低要求

1. **写清「明确不做」**：这个项目的边界（单用户本地、应用零 LLM）比功能更重要，说清没做什么能省下大量评审往返。
2. **列影响面**：数据库列、MCP 工具、Skill 注册表、迁移版本、文档数量口径，任一变动都要点名——它们各自有对应的静态检查。
3. **贴真实验证结果**：`npm test` / `npm run typecheck` / `npm run build` / `npm run e2e` 的实际数字，不要写「应该通过」。
4. **给回滚方式**：迁移是否可回退、旧库升级后历史行怎么处理、Skill 是否需要重装。

## 质量红线（评审时逐条对照）

| # | 红线 | 违反时的症状 |
| --- | --- | --- |
| 1 | 依赖中不得出现 `openai` / `@anthropic-ai/*` / `langchain` / `ai` | 应用开始代理模型请求，违背 D2 |
| 2 | `.env.example` 不含模型 / API Key 配置 | 同上 |
| 3 | MCP 工具名不得出现 `generate_*` | 生成能力被挪进应用 |
| 4 | 写接口必须校验 `provenance.skill ∈ SKILL_REGISTRY` | AI 产出无法归因，版本胜率统计失真 |
| 5 | `SKILL.md` 引用的工具名必须存在于 MCP 注册表 | CI 静态检查失败 |
| 6 | 新增数据库列必须同步 `apps/server/src/db/tables.ts` 与 `schema.test.ts` 的 `user_version` 断言 | `npm test` 变红（刻意设计） |
| 7 | 改状态只走 `POST /applications/:id/status`；`PATCH` 不接受 `status` | 事件与时间线漏写，漏斗口径错 |
| 8 | PATCH schema 由 `patchOf()` 生成，字段不带 `.default()` | 空 body 静默重置默认值 |
| 9 | 屏幕预览与无头 PDF 共用 `ResumePages` 分页 | 两套分页逻辑漂移 |
| 10 | `apps/web` 里 import `@land/resume-kit` 的页面必须 `lazy()` | jsPDF / html-to-image 进首屏包 |

## 维护约定

- 改了代码，同步更新对应主文档的状态表；改了接口，更新 `README.zh-CN.md` 的「本机接口」表与 `ARCHITECTURE.zh-CN.md` §6.2。
- 增删 MCP 工具：`TOOL_MANIFEST`、`apps/mcp/test/manifest.test.ts`、文档里的工具数量三处一起改。
- 增删 Skill：`packages/core/src/skills.ts` 的 `SKILL_REGISTRY`、`scripts/install-skills.sh` 覆盖的目录、文档里的 Skill 数量与列表一起改；还要同步 `apps/mcp/test/manifest.test.ts`、`apps/server/test/api.test.ts`、`scripts/e2e/p5.mjs`、`scripts/e2e/p7.mjs` 里的 Skill 数量断言；装完需重启 Agent。
- 四个批量 / 浏览器类 Skill（`job-search-batch`、`resume-tailor-batch`、`browser-apply`、`application-status-sync`）的 §0 前置检查是**同一份文本**，改一处必须四处同步；`scripts/e2e/p5.mjs` 会检查它们都在且都带前置检查。
- `docs/` 里的文档不参与构建与运行时，也不含真实简历、手机号、令牌等敏感数据。
- **每份文档都有英文对应版本**（`*.md` 为英文，`*.zh-CN.md` 为中文）：同一次提交里两边一起改，文件头部的语言切换链接不要漏。
- 官网同样分两版：`site/index.html`、`site/agent-install.md` 是英文（GitHub Pages 的默认入口），`site/index.zh-CN.html`、`site/agent-install.zh-CN.md` 是中文。两边一起改，导航里的语言切换不要丢；应用内给出的外链在 `apps/web/src/lib/links.ts`，指向中文页。
- **`skills/**` 刻意只保留中文**：`SKILL.md` 是 Agent 读的执行说明，不是给人浏览的文档；双份容易让同一套流程跑偏，而任何 Agent 都读得懂中文。工具名、路径、frontmatter 本来就是 ASCII，英文读者照样能跟。
