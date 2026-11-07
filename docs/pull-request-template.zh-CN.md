# PR 描述模板

> 用法：复制本文件到 `docs/pr/NNNN-短标题.md` 后填写，删掉模板里的说明性括号。
> 若走 GitHub PR，也可把「正文」一段搬进 `.github/PULL_REQUEST_TEMPLATE.md`。

---

## 一句话

<!-- 例：让 JD 有服务端官方渠道采集 + Agent 浏览器兜底，并把采集方式持久化到 Web 可查看。 -->

## 背景 / 为什么

<!-- 现状是什么、哪里不够用、参考了什么（项目/文档/实测记录）。避免只写「优化体验」。 -->

## 明确不做

<!-- 这个项目的边界比功能重要：单用户本地、应用零 LLM、不启浏览器、不碰登录态、不硬刚反爬……
     写清没做什么，能省掉评审里一半的往返。 -->

| 不做 | 原因 |
| --- | --- |
|  |  |

## 改了什么

<!-- 按模块分组，给文件路径。写「为什么这样拆」而不只是「加了 X」。 -->

1.
2.
3.

## 影响面

- [ ] **数据库**：新增列 / 新迁移 → 同步 `tables.ts`、core schema、`schema.test.ts` 的 `user_version` 断言；写清旧库升级后历史行的默认值
- [ ] **MCP 工具**：增删 → 同步 `TOOL_MANIFEST`、`manifest.test.ts`、`ARCHITECTURE.md` §7.2 与文档中的工具数量
- [ ] **Skill**：增删或升版本 → 同步 `SKILL_REGISTRY`、`SKILL.md` frontmatter、文档中的 Skill 数量；说明是否需要重跑 `scripts/install-skills.sh` 与重启 Agent
- [ ] **API**：新增 / 变更路径 → 同步 `README.md`「本机接口」表与 `ARCHITECTURE.md` §6.2
- [ ] **Web**：新增页面 / 路由 / 展示字段 → 说明是否涉及 `lazy()` 加载与 `data-testid`（E2E 依赖）
- [ ] **文档**：`README.md`（根目录入口）与 `docs/`（PRD / ARCHITECTURE / IMPLEMENTATION 及 PR 记录）
- [ ] **E2E**：断言数量变化 → 同步 `IMPLEMENTATION.md` §9.3 的阶段表格与合计数

## 验证

```bash
npm test            # ____ 例
npm run typecheck
npm run build
npm run e2e         # P3 __ + P4 __ + P5 __ + P6 __ + P7 __ = ____ 项断言
```

<!-- 贴实际输出数字，不要写「应该通过」。若跳过某项，写明原因。 -->

## 质量红线自检

- [ ] 依赖中无 `openai` / `@anthropic-ai/*` / `langchain` / `ai`
- [ ] `.env.example` 无模型 / API Key 配置
- [ ] MCP 工具名无 `generate_*`
- [ ] 写接口校验 `provenance.skill ∈ SKILL_REGISTRY`
- [ ] `SKILL.md` 引用的工具名都在 MCP 注册表内
- [ ] 新增数据库列已同步 `tables.ts`（否则 `npm test` 会红）
- [ ] 状态变更只走 `POST /applications/:id/status`
- [ ] PATCH schema 由 `patchOf()` 生成、字段不带 `.default()`
- [ ] import `@land/resume-kit` 的页面走 `lazy()`
- [ ] 服务仍只绑定 `127.0.0.1`

## 风险与回滚

| 风险 | 触发条件 | 缓解 / 回滚 |
| --- | --- | --- |
|  |  |  |

<!-- 迁移能否回退？旧数据表现？第三方端点改版怎么办？Skill 装的是旧版会怎样？ -->

## 证据

<!-- 涉及 Web 改动贴截图；涉及采集贴来源标签与正文长度；涉及投递贴 evidence 截图路径。
     证据文件放 data/（gitignore），文档里只写路径与结论。 -->

## 后续待办

- [ ]
