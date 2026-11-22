# 贡献指南

[English](./CONTRIBUTING.md) · **简体中文**

谢谢点进来。这是一个单用户本地应用，「让它保持无聊、可审计」的贡献比加新功能更受欢迎。

## 本地跑起来

```bash
npm install && npm run build && npm run dev   # 5173（HMR）+ 4399（接口）
npm run typecheck && npm test && npm run check:i18n
```

Node >= 24、npm >= 10。首次启动会创建 `data/`（SQLite、token、日志）。
完整命令见 [README.zh-CN.md](./README.zh-CN.md)，改数据模型前先读
[ARCHITECTURE.zh-CN.md](./docs/ARCHITECTURE.zh-CN.md)。

## 几条硬规矩

下面这些由测试和 MCP 写入链路强制校验，看起来合理但破坏约定的 PR 一样会红：

- **应用里不许出现 LLM SDK**：任何依赖清单都不能加 `openai`、`@anthropic-ai/*`、
  `langchain`、`ai`；`.env.example` 不提供模型或 API Key 配置。AI 由用户自己 Agent
  里的 Skill 执行，应用只读写本地数据。
- **MCP 写入要带 provenance**：没有 `generate_*` 工具。AI 写入的行必须带
  `provenance: {skill, skillVersion}`，且 skill 名在 `SKILL_REGISTRY` 里；版本过旧返回
  `SKILL_OUTDATED`。
- **改状态只走 `POST /applications/:id/status`**：`PATCH` 拒绝 `status`，否则事件会漏记，
  时间线和漏斗对不上。
- **新增数据库列**必须同步 `apps/server/src/db/tables.ts`、core schema 与
  `schema.test.ts` 的 `user_version` 断言（这条测试是故意设计成会红的）。
- **PATCH schema** 由 `patchOf()` 生成，字段不带 `.default()`。
- **增删 Skill** 要同步 `SKILL_REGISTRY`、各 `SKILL.md` frontmatter、
  `apps/mcp/test/manifest.test.ts`、`apps/server/test/api.test.ts`、
  `scripts/e2e/p5.mjs`、`scripts/e2e/p7.mjs`，以及 README / ARCHITECTURE 里所有 Skill
  数量口径；后四个 Skill 的 §0 前置检查逐字相同。
- **服务只绑 `127.0.0.1`**，不要暴露到网络。
- **界面文案**以中文原文作 i18n key：英文值加到 `apps/web/src/i18n/en/`，跑
  `npm run check:i18n`（查重复 key、缺失 `t()`、英文值残留中文）。表单控件只用
  `ui.tsx`；import `@land/resume-kit` 的页面必须 `lazy()`。
- **文档双语**：改 `*.md` 就要同一次提交改 `*.zh-CN.md`。`skills/**` 刻意不翻译。

## 适合上手的贡献

- 在 `apps/server/src/jd/sources/` 下加一个 ATS 来源（带 fixture 与 canonical URL 测试）
- 补一处中英文 i18n 缺口
- 改进 `skills/` 里某个 Skill（记得保持 §0 前置检查一致）
- 给文档补一个真实踩过的排障案例

凡是要动数据模型、MCP 契约或状态机的，先开 issue 或 Discussion 讨论。写清楚「明确不做什么」
能省掉一半来回，[PR 模板](./docs/pull-request-template.zh-CN.md)就是这个结构。

## 提 PR 前自检

```bash
npm run typecheck
npm test
npm run build
npm run check:i18n
npm run e2e          # 真服务 + 真 Chrome，按 P3 → P7 分阶段
```

贴真实输出数字，别写「应该能过」；跳过的步骤说明原因。改 Web 附截图，改采集附来源标记与正文长度。

提交即表示同意你的贡献以 AGPL-3.0-or-later 授权。
安全问题请看 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md)，不要开公开 issue。
