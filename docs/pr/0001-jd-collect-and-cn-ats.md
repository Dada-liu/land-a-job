# PR 0001 · JD 采集分层重构、流程 Skill 与飞书 / 北森云适配器

| 项 | 值 |
| --- | --- |
| 状态 | 已交付 |
| 日期 | 2026-11-05 |
| 关联 | `PRD.md` FR-2.1 / FR-7.3 · `ARCHITECTURE.md` §6.2.1 / §9.4 · `IMPLEMENTATION.md` §5.1 |

## 一句话

让 JD 既有服务端官方渠道采集，也有 Agent 浏览器兜底，并把采集方式持久化到 Web 可查看。

## 背景 / 为什么

原实现是 `apps/server/src/jd/fetch.ts` 一个文件：纯 HTTP + Readability，失败就让用户手贴正文。实际问题是国内招聘站多为强 JS 渲染 + 反爬，抓取几乎必然退化成手工粘贴；且没有站点专用适配器、没有批量/导入入口、采集方式不留痕、`⌘K` 建岗只存链接不触发抓取。

参考两个项目的实测实现，而不是重新发明：

- **job-pro**（`@ha7ch/job-pro`）：50 家中国大厂官方招聘渠道按 ATS 家族分 7 类，直连匿名公开 API；统一 `PositionSummary` 契约；解析全部规则式。
- **ai-job-search-cn**：来源升级链、平台站不强攻反爬、粘贴降级、第三方文本按不可信数据处理。

## 明确不做

| 不做 | 原因 |
| --- | --- |
| 应用内启浏览器抓 JD | 浏览器属于 Agent；应用不碰登录态、不引入 Chromium 依赖 |
| 调用任何 LLM 解析 JD | D2：应用零模型、零 Key；抽取仍是词表 + 正则 |
| 硬刚 BOSS / 拉勾 / 猎聘反爬 | 失败按来源引导「粘贴 / 换公司官网」，不构造高频请求 |
| 为抓 JD 存 cookie / session | 登录态只在投递助手的持久化 profile 里，且由用户手动登录 |
| 新增结构化 JD 表 / 历史版本表 | 只补现有空字段，快照重抓留 `.prev.html`，控制改动面 |

## 改了什么

1. **服务端从单文件拆成分层管线**（`apps/server/src/jd/`，现 12 个文件）：
   `sources`（来源分类 / 归一化去重键 / 按来源的降级提示）→ `ats`（适配器注册）→ `fetch`（通用 HTTP 兜底）→ `robots`（403 重试闸门）→ `pipeline`（编排）→ `snapshot`（落盘）→ `html`（清洗 + 元信息补救）→ `types` / `ats-common` / `index`。
   - 403 重试前必须查 `robots.txt`：策略读不到或 `Disallow` 一律不重试。
   - 实测发现 Readability 会把「杭州 · 25-40K」这类元信息整块丢掉，补了 JSON-LD `JobPosting` 与页头信息行的规则式补救，否则城市与薪资抽不到。
   - JD 正文按不可信数据清洗：剔除零宽与控制字符。
2. **ATS 适配器覆盖 5 家**：
   - Greenhouse / Lever：匿名公开 JSON 接口，统一结构化字段。
   - **飞书招聘**：`GET /api/v1/job/posts/<id>?portal_type=3`，租户无该端点时降级到 `POST /api/v1/search/job/posts` 按 id 扫页；`portal-channel` / `website-path` 按「标准 → 空门户 → 省略头」依次尝试；正文 = `description` + `requirement`。域名按代码实测收录 `*.jobs.feishu.cn`、`*.jobs.f.mioffice.cn`、`careers.iqiyi.com`、`hr.sensetime.com`。
   - **北森云**：两套产品端点完全不同。iTalent（`*.zhiye.com`、`hr-campus.vivo.com`）翻 `GetJobAdPageList` 按 `jobAdId` 找，正文 = `Duty` + `Require`；Wecruit（`wecruit.hotjob.cn`，SPA hash 里带 `postId`）用表单 POST `listPositionDetail`，正文 = `workContent` + `serviceCondition`。代码里并不存在 `*.italent.cn` / `*.wecruit.com`，未凭猜测收录。
   - 任一适配器失败自动降级到通用 HTTP。
3. **新增第 5 个 Skill `jd-collect`**：`SKILL.md` + `references/browser-fallback.md` + `references/ats-support.md`。流程是 `get_app_status` → `list_jobs` 去重 → `add_job` / `fetch_jd` → **失败且用户同意**才启用 Agent 自带浏览器读回完整原文 → `import_jd` 落库 → `get_job` 核对。WorkBuddy 走 `workbuddy-browser-use`；Kimi 按本机已装的 `kimi-webbridge` 写了可执行步骤（本地桥接 + `navigate` / `find_tab` / `snapshot` / `evaluate` / `close_tab`）。边界写死：不绕验证码、只访问用户给的链接、没落库等于没完成。
4. **采集来源持久化与 Web 可查看**：新迁移 `002_jd_source.sql` 给 `job` 加 `jd_source`（`greenhouse` / `lever` / `feishu` / `beisen` / `http` / `browser` / `paste`）；详情页显示来源、正文长度、抽取信号与警告，列表页加来源角标；`import_jd` 新增 `capturedBy`。抓取与粘贴共用 `writeJd()`：清洗、关键词/城市/薪资抽取、快照、只补空字段（人工录入优先）。
5. **路由与 MCP**：新增 `POST /jobs/:id/import-jd`、`GET /jobs?jdUrl=` 归一化去重；新增 `fetch_jd` / `import_jd` 工具（41 → 43）；`add_job` 命中重复链接返回 `duplicate: true`；补 `JD_*` 错误恢复提示；`⌘K` 带链接建岗自动抓取并打分，与 `add_job` 对齐。
6. **修了一个去重 bug**：`canonicalJdUrl()` 原先无条件去掉 hash，会把北森 Wecruit 同一看板的不同岗位判成同一条；改为保留带岗位号的 SPA hash，其余锚点照旧去掉。

## 影响面

- [x] **数据库**：迁移 `002_jd_source.sql` → `user_version = 2`；同步 `migrate.ts` 的 `MIGRATIONS`、`tables.ts`、`packages/core/src/schema/job.ts`、`schema.test.ts` 的版本断言。旧库自动升级，历史行 `jd_source` 为 `NULL`，Web 显示「来源未记录」。
- [x] **MCP 工具**：`TOOL_MANIFEST` 41 → 43，`manifest.test.ts` 与 `ARCHITECTURE.md` §7.2 同步。
- [x] **Skill**：`SKILL_REGISTRY` 4 → 5，`apps/mcp/src/errors.ts` 的提示文案、`server.ts` 的工作流指令、文档里的数量与列表同步；已跑 `bash scripts/install-skills.sh` 软链到 `~/.claude/skills` 与 `~/.workbuddy/skills`，**需重启 Agent 生效**。
- [x] **API**：`README.md`「本机接口」表与 `ARCHITECTURE.md` §6.2 同步新增两条路径。
- [x] **Web**：详情页 / 列表页 / `⌘K` 改动；新增 `job-jd-source` 测试角标。
- [x] **E2E**：`p4.mjs` 补了浏览器来源、粘贴降级、元信息回写断言；`p5.mjs` / `p7.mjs` 的 Skill 数量断言由 4 改 5。
- [x] **文档**：`PRD.md`、`ARCHITECTURE.md`、`IMPLEMENTATION.md`、`README.md` 全部同步。
- [x] **其它**：`vitest.config.ts` 的 `testTimeout` 20s → 45s（并行 worker 下 jsdom 首次动态 import 会超时误判）。

## 验证

```bash
npm test            # 244 例全绿
npm run typecheck   # 通过
npm run build       # 通过
npm run e2e         # P3 28 + P4 64 + P5 92 + P6 62 + P7 60 = 306 项断言全绿
```

红线复核：依赖无 LLM SDK、无 `generate_*` 工具、`.env.example` 无模型配置、SKILL.md 工具名静态检查通过；工具 43 / Skill 5 三方一致。

## 质量红线自检

- [x] 依赖中无 `openai` / `@anthropic-ai/*` / `langchain` / `ai`
- [x] `.env.example` 无模型 / API Key 配置
- [x] MCP 工具名无 `generate_*`
- [x] 写接口校验 `provenance.skill ∈ SKILL_REGISTRY`
- [x] `SKILL.md` 引用的工具名都在 MCP 注册表内
- [x] 新增数据库列已同步 `tables.ts`
- [x] 状态变更只走 `POST /applications/:id/status`（本次未改动状态机）
- [x] import `@land/resume-kit` 的页面仍走 `lazy()`（本次未涉及）
- [x] 服务仍只绑定 `127.0.0.1`

## 风险与回滚

| 风险 | 触发条件 | 缓解 / 回滚 |
| --- | --- | --- |
| 第三方端点改版 | 飞书 / 北森调整公开 API 或加 WAF | 端点形状来自 job-pro 的探测记录，需重新探测；适配器失败会自动降级到通用 HTTP，再失败走粘贴，不会写坏数据 |
| 旧库升级 | 已有 `land.db` 首次启动 | `002` 是 `ADD COLUMN`，旧代码忽略新列仍可运行；历史行显示「来源未记录」，无需回填 |
| Skill 装的是旧版 | 未重跑安装脚本 / 未重启 Agent | Web 顶部 Skill 状态条变红；`get_app_status` 回报版本，写接口按 `SKILL_OUTDATED` 拒绝并给升级命令 |
| 浏览器兜底被误用为爬虫 | Agent 擅自批量访问 | Skill 写死「先征得用户同意、只访问用户给的链接、不绕验证码」；浏览器不进应用进程 |
| 快照覆盖 | 重抓同一岗位 | `snapshot.ts` 重抓前留 `.prev.html`，可回看上一次正文 |

回滚顺序：删除 `jd-collect` 软链 → 回退 `SKILL_REGISTRY` 与工具注册 → 回退 `jd/` 目录与路由（数据库列可保留，不影响读写）。无破坏性数据改写。

## 证据

- Web 岗位详情展示采集来源标签、正文长度与抽取出的年限 / 学历 / 城市 / 薪资；列表页 `job-jd-source` 角标。
- `data/files/jd/{jobId}.html` 为正文快照，重抓时生成 `.prev.html`（运行期数据，已在 `.gitignore`）。
- E2E `p4.mjs` 用本地 fixture 服务覆盖「官方来源 / 粘贴降级 / 浏览器来源 / 元信息回写」，不依赖外网。

## 后续待办

- [ ] 继续扩适配器：Moka（AES 信封）、Workday、公司自有 API（腾讯 / 字节 / 阿里等 bespoke 端点）。
- [ ] 定期用探测脚本复验飞书 / 北森端点，站改版后更新 `references/ats-support.md`。
- [ ] JD 定时刷新与岗位关闭感知（当前是按需一次性抓取，无历史版本表）。
