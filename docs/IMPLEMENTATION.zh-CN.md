# Land a Job — 实施文档

[English](./IMPLEMENTATION.md) · **简体中文**

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0 |
| 关联 | [PRD.zh-CN.md](./PRD.zh-CN.md) · [ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md) |
| 总工期 | 约 8 周（单人，25–30 h/周，约 40 人日） |
| 前置环境 | Node ≥ 22（已验证 v22.22.2）、npm ≥ 10、Chrome（导出/自动化） |
| 实现进度 | P0–P7 全部完成：`npm test` 280 例、`npm run e2e` 369 项断言全绿 |

---

## 0. 执行顺序总览

### 0.1 已定前提（本计划不再评估）

| # | 决策 | 对实施的硬约束 |
| --- | --- | --- |
| D1 | 只做单用户本地 | 不写 `user` 表、不做登录页、不引 Postgres；所有表无 `owner_id`；server 只绑 `127.0.0.1` |
| D2 | AI 由 Skill + Agent 实现，应用零模型 | 依赖里禁止任何 LLM SDK；不写"生成"接口；Web 生成按钮一律做「交接」；写接口强制 `provenance` |
| D3 | 复用简历编辑器（`resume-kit`） | P2 只做抽包与去 store 化，不重做 UI；旧 `ResumeData` 字段名不改 |

**开工前自检**：`grep -r "openai\|anthropic\|langchain" package.json packages/*/package.json apps/*/package.json` 应为空，且今后每次加依赖都跑一次。

### 0.2 阶段与工期

```
P0 地基（3d） → P1 数据与 API（4d） → P2 简历复用（4d） → P3 投递流水线 UI（5d）
→ P4 定制与投递助手（6d） → P5 MCP + Skill（7d） → P6 面试/Offer（6d） → P7 指标与打磨（5d）
```

**里程碑门禁**（未过不进下一阶段）：

| 门禁 | 条件 |
| --- | --- |
| G1 | `npm run test:core` 全绿；`/health` 返回 db 版本 |
| G2 | API 契约测试覆盖所有端点；非法状态跃迁被拒 |
| G3 | 旧简历 JSON 可 100% 迁移并正确渲染 |
| G4 | 看板拖拽 → 刷新页面状态一致，时间线完整 |
| G5 | 一个真实官网完成「填 → 人工确认 → 提交 → 存证」 |
| G6 | 9 个 Skill 以 symlink 装进 Claude Code、Codex 与 WorkBuddy 各一份；同一份 SKILL.md 在至少两个 Agent 中跑通「投递」与「面试准备」；产出在 Web 可见且带 provenance |
| G7 | 两 offer 总包手算误差 < 1% |
| G8 | 断网 + 无任何 API Key 时，Web 的录入/编辑/统计/导出/对比全部可用 |

---

## 1. 阶段 P0：仓库与地基（第 1 周前半，约 3 天）

### 1.1 初始化

```bash
mkdir -p apps/{server,web,mcp} packages/{core,resume-kit,contracts} skills/job-hunt data docs
npm init -y
```

根 `package.json`：

```json
{
  "name": "land-a-job",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm run dev -w @land/server & npm run dev -w @land/web",
    "build": "npm run build -w @land/core && npm run build -w @land/resume-kit && npm run build -w @land/server && npm run build -w @land/mcp && npm run build -w @land/web",
    "start": "node apps/server/dist/index.js --open",
    "test": "vitest run",
    "test:core": "vitest run packages/core",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.10.0"
  }
}
```

### 1.2 任务清单

| # | 任务 | 产出 | 验收 |
| --- | --- | --- | --- |
| P0-1 | 根配置：tsconfig.base（strict、`moduleResolution: bundler`、paths） | `tsconfig.base.json` | `tsc -b` 无错 |
| P0-2 | `packages/core` 骨架 + vitest 配置 | 可 `npm run test:core` | 一个 placeholder 测试通过 |
| P0-3 | `apps/server` 起 Fastify + `/health` | `src/index.ts` | `curl 127.0.0.1:4399/api/health` 返回 `{ok:true}` |
| P0-4 | 端口守护：被占则 +1，写 `data/.port` | `src/port.ts` | 人为占用 4399 后仍能启动 |
| P0-5 | token 生成与校验插件 | `src/auth.ts` | 无 token 返回 401 |
| P0-6 | `apps/web` Vite + Tailwind 4 + 路由壳 | 空壳页面 | 访问 4399 看到 Dashboard 骨架 |
| P0-7 | 静态托管 `apps/web/dist`（server 内） | `src/static.ts` | build 后仅起 server 也能访问页面 |
| P0-8 | 日志与错误处理（pino + 统一 errorHandler） | — | 错误返回 `{error:{code,message}}` |
| P0-9 | `.gitignore`（data/、dist/、node_modules、*.db） | — | `git status` 干净 |

### 1.3 关键骨架

`apps/server/src/index.ts`：

```ts
import Fastify from 'fastify'
import { resolvePort } from './port.js'
import { registerAuth } from './auth.js'
import { registerRoutes } from './routes/index.js'
import { openDb } from './db/index.js'
import { attachWs } from './ws.js'
import { serveWeb } from './static.js'

const db = openDb()                       // 迁移在此执行
const app = Fastify({ logger: { level: 'info' } })

registerAuth(app)                          // 校验 X-Land-Token（/health 放行）
registerRoutes(app, db)
await app.register(serveWeb)               // /assets/* + SPA fallback

const port = await resolvePort(Number(process.env.LAND_PORT ?? 4399))
await app.listen({ host: '127.0.0.1', port })
attachWs(app.server, db)                   // ws 挂在同一 http server

process.on('SIGINT', async () => { await app.close(); process.exit(0) })
```

> 注意：Fastify 的 WS 用 `@fastify/websocket` 或直接在 `app.server` 上挂 `ws`；选后者，避免插件顺序坑。

---

## 2. 阶段 P1：数据层与 API（第 1 周后半，约 4 天）

### 2.1 迁移机制

`apps/server/src/db/migrate.ts`：

```ts
const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf8') },
]

export function migrate(db: Database) {
  const current = db.pragma('user_version', { simple: true }) as number
  for (const m of MIGRATIONS.filter((m) => m.version > current)) {
    db.transaction(() => { db.exec(m.sql); db.pragma(`user_version = ${m.version}`) })()
  }
}
```

SQL 文件直接使用 [ARCHITECTURE.zh-CN.md 第 4.2 节](./ARCHITECTURE.zh-CN.md#42-ddl) 的 DDL，拆成 `001_init.sql`。

### 2.2 任务清单

| # | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| P1-1 | DB 连接（WAL、foreign_keys）+ 迁移 | `db/index.ts`、`db/migrate.ts`、`db/migrations/001_init.sql` | 首次启动建表；二次启动不重复执行 |
| P1-2 | 通用 repo 工具（软删过滤、分页游标、时间戳） | `db/repo.ts` | 单测覆盖 |
| P1-3 | Zod schema 全量定义 | `packages/core/src/schema/*.ts` | 与 DDL 字段一一对应 |
| P1-4 | 状态机 + 事件写入 | `core/application.ts`、`db/repositories/application.ts` | 非法跃迁抛 `InvalidTransitionError`；改状态必写事件（事务） |
| P1-5 | 公司/岗位 CRUD 路由 | `routes/companies.ts`、`routes/jobs.ts` | 契约测试通过 |
| P1-6 | 简历 CRUD + duplicate | `routes/resumes.ts` | duplicate 生成 `kind=variant` 且带血缘 |
| P1-7 | 投递 CRUD + status + notes + timeline | `routes/applications.ts` | 重复投递返回 409 |
| P1-8 | 面试 / 题库 / Offer 路由 | `routes/interviews.ts`、`questions.ts`、`offers.ts` | — |
| P1-9 | WS 广播 | `ws.ts` | 改状态后前端收到 `invalidate` |
| P1-10 | 种子脚本（3 公司 5 岗位） | `scripts/seed.ts` | `npm run seed` 可复现 demo 数据 |

### 2.3 状态机骨架

```ts
// packages/core/src/application.ts
export const STATUSES = ['lead','queued','applied','screening','assessment','interview','offer','accepted','rejected','ghosted','withdrawn'] as const
export type Status = typeof STATUSES[number]

const TRANSITIONS: Record<Status, Status[]> = {
  lead: ['queued','withdrawn'],
  queued: ['applied','withdrawn'],
  applied: ['screening','rejected','ghosted'],
  screening: ['assessment','interview','rejected','ghosted'],
  assessment: ['interview','rejected','ghosted'],
  interview: ['offer','rejected','ghosted'],
  offer: ['accepted','rejected','withdrawn'],
  accepted: [], rejected: [], ghosted: [], withdrawn: [],
}

export const STAGE_ORDER: Partial<Record<Status, number>> = {
  applied: 100, screening: 200, assessment: 250, interview: 300, offer: 400, accepted: 500,
}

export class InvalidTransitionError extends Error {
  constructor(readonly from: Status, readonly to: Status, readonly allowed: Status[]) {
    super(`当前状态 ${from} 不能变为 ${to}；允许：${allowed.join(', ') || '无（终态）'}`)
  }
}

export function assertTransition(from: Status, to: Status, force = false) {
  if (from === to) return
  const allowed = TRANSITIONS[from]
  if (!allowed.includes(to) && !force) throw new InvalidTransitionError(from, to, allowed)
}
```

> 复活（`rejected → screening`）走 `force: true`，事件 `payload_json` 记录 `{forced:true, reason}`。

### 2.4 写操作事务模板

```ts
// db/repositories/application.ts
export function changeStatus(db: Database, input: { id: string; to: Status; note?: string; actor: 'user'|'agent'; source: 'web'|'mcp'; force?: boolean }) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM application WHERE id=? AND deleted_at IS NULL').get(input.id) as ApplicationRow
    if (!row) throw new NotFoundError('application', input.id)
    assertTransition(row.status, input.to, input.force)
    const now = nowIso()
    db.prepare('UPDATE application SET status=?, status_at=?, updated_at=? WHERE id=?').run(input.to, now, now, input.id)
    db.prepare(`INSERT INTO application_event (id,application_id,type,from_status,to_status,payload_json,actor,source,at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), input.id, 'status_changed', row.status, input.to, JSON.stringify({ note: input.note ?? null }), input.actor, input.source, now)
    return { id: input.id, from: row.status, to: input.to }
  })()
}
```

### 2.5 完成情况（P1 已落地）

| 任务 | 状态 | 落地位置 / 说明 |
| --- | --- | --- |
| P1-1 迁移 | ✅ | `db/index.ts` + `db/migrate.ts` + `001_init.sql`；二次启动不重复执行，WAL / foreign_keys 已开 |
| P1-2 repo 工具 | ✅ | `db/repo.ts`（映射、游标分页、软删、乐观锁）+ `db/tables.ts`（列映射唯一来源） |
| P1-3 Zod 契约 | ✅ | `packages/core/src/schema/*`；`patchOf()` 统一生成 PATCH（见下方坑 1） |
| P1-4 状态机 + 事件 | ✅ | `core/application.ts` + `db/repositories/application.ts`；改状态与写事件在同一事务 |
| P1-5~P1-8 路由 | ✅ | companies / jobs / resumes / applications / interviews / questions / offers / stats |
| P1-9 WS 广播 | ✅ | 每次写操作按实体广播 keys（如 `applications,application:{id},timeline,stats`） |
| P1-10 种子 | ✅ | `apps/server/src/seed.ts`，`npm run seed`，固定 id 可重复执行，`--reset` 按外键顺序清理 |

测试：**79 例**（core 单元 25 / server 契约 39 / DDL 漂移 15），`npm test` 全绿。

**与计划的偏差（有意为之）**

| 偏差 | 原因 |
| --- | --- |
| `Idempotency-Key` 未实现 | 写入方目前只有页面，重试窗口极小；P5 MCP 接入时统一加（那时才有「Agent 重试」这个真实场景），避免现在加一个没人验的机制 |
| `/jobs/:id/fetch-jd`、`/jobs/:id/score` 未做 | 属于 P4（抓取）与 P6（fit 模型），P1 没有评分配置就没有意义的空实现 |
| 额外加了 `/stats/overview` | 只做计数，让首页从占位横线变成真数字；完整漏斗/趋势仍留给 P7 |

**实施中撞到的两个真坑（已修，写进代码注释）**

1. **`z.object(shape).partial()` 会保留 `.default()`**：`PATCH /companies/{}` 会把 `priority` 静默改成 3。现在字段定义一律不带默认值，默认值只出现在 create schema 里，PATCH 由 `patchOf()` 生成并拒绝空 body。
2. **空响应体 + 唯一约束**：SQLite 抛的 `UNIQUE constraint failed` 原本变成 500。现在路由先查再写给出具体 409，`errors.ts` 再做一层唯一约束兜底（并发漏网的情况）。
3. 前端包体：`@land/core` 的 index 会把 zod 一起打进去（271KB → 370KB）。已加 `@land/core/application` 子路径导出，Web 只取常量，包体回到 275KB / gzip 88KB。

---

## 3. 阶段 P2：复用简历编辑器（第 2 周，约 4 天）

已定 D3：**只做抽包与去 store 化，不重做 UI**。本阶段任何"顺手优化交互"的冲动都要压住——目标是让旧项目的编辑能力以最小改动接入，样式与交互保持原样，以便出问题时能对照源项目排查。

### 3.1 迁移映射表（源 → 目标）

源项目：`/Users/yuliu/Desktop/daxia/code/claude-code-study/resume-generator-2`

| 源路径 | 目标 | 处理方式 |
| --- | --- | --- |
| `src/types/resume.ts` | `packages/resume-kit/src/types/resume.ts` | 原样复制（**不改字段名**，保证旧 JSON 兼容） |
| `src/types/template.ts` | `packages/resume-kit/src/types/template.ts` | 原样 |
| `src/templates/classic/*` | `packages/resume-kit/src/templates/classic/*` | 复制；`editors/` 保留 |
| `src/templates/template-1/*`、`template-2/*` | 同上 | 复制 |
| `src/templates/index.ts`、`catalog.json` | 同上 | 改为导出 `templates[]`，去掉对 app 内 store 的直接依赖 |
| `src/components/EditorPanel.tsx`、`ResumePaper.tsx`、`ResumePreview.tsx`、`SortableList.tsx`、`CustomSelect.tsx`、`ConfirmDialog.tsx`、`ResumeDialog.tsx`、`LinkifiedText.tsx`、`ContactValue.tsx`、`ProjectName.tsx`、`ResumeLink.tsx`、`McpStatusBadge.tsx` | `packages/resume-kit/src/editor/` | 复制；`McpStatusBadge` 改造为通用 `SyncBadge`（显示 Web/MCP 来源） |
| `src/utils/exportPdf.ts`、`contactLink.ts`、`url.ts` | `packages/resume-kit/src/export/` | 复制；导出函数签名改为 `exportResumePdf(el, { fileName })`，去掉全局 store 依赖 |
| `src/templates/*/editors/AvatarCropper.tsx` | 同上 | 三份重复代码合并为一份共享组件（顺手去重） |
| `src/stores/resumeStore.ts` | **不迁移** | 由 server 数据替代；新 store 只做「当前选中简历 + 脏数据缓冲」 |
| `mcp-server/src/markdown.ts` | `packages/resume-kit/src/import/markdown.ts` | 复制（356 行，纯文本→ResumeData，价值高） |
| `mcp-server/src/resume.ts`（normalize/deepMerge/计数） | `packages/resume-kit/src/model.ts` | 复制并补单测 |
| `mcp-server/src/export.ts`（无头 Chrome） | `apps/server/src/resume/export.ts` | 复制，`WEB_ROOT` 指向 land 的页面，PDF 页需带 `?print=1` |
| `mcp-server/src/bridge.ts` 的 owner/attached 模式 | `apps/server/src/port.ts` + `apps/mcp/src/supervisor.ts` | **改写**而非复制：目标是端口探测与自动拉起 |

### 3.2 抽包改造要点

1. **去掉隐式全局状态**：`resume-kit` 组件只接受 props（`value`, `onChange`），不 import 任何 store。这是能否复用的关键，改造量约 1 天。
2. **样式隔离**：Tailwind 4 用 `@source` 指向 `packages/resume-kit/src`，确保类名被扫描；避免 kit 内自带 `index.css`。
3. **模板注册表**：`templates/index.ts` 导出 `{ id, name, Preview, Editors, config }[]`，`config` 沿用 `resumeConfig.ts`。
4. **PDF 导出**：保留 jspdf + html-to-image 方案与链接注释逻辑，仅把「文件名生成」抽成函数，按 `姓名_岗位_公司_时间` 生成。

### 3.3 任务清单

| # | 任务 | 验收 |
| --- | --- | --- |
| P2-1 | 建 `resume-kit` 包，复制 types 与三套模板 | `npm run build -w @land/resume-kit` 通过 |
| P2-2 | 组件去 store 化改造 | 在 Storybook 或 demo 页可渲染并编辑（受控） |
| P2-3 | 模板注册表 + 预览/编辑分发 | 切换 3 个模板，内容不丢 |
| P2-4 | 简历编辑页（`/resumes/:id`）接 server | 编辑 500ms 防抖 PATCH；刷新后内容保留 |
| P2-5 | PDF 导出（页面内） | 文件名正确、链接可点 |
| P2-6 | 无头导出降级 | 页面未开时仍能导出 |
| P2-7 | 旧数据迁移工具 `import_legacy_resumes` | 用旧项目 `.resume-mcp/store.json` 实测，3 套模板均可渲染 |

### 3.4 简历编辑页数据流

```ts
// 受控组件 + 延迟保存，避免每次按键打 server
const { data } = useQuery({ queryKey: ['resume', id], queryFn: () => api.getResume(id) })
const [draft, setDraft] = useState(data.data_json)
const save = useDebouncedCallback((next) => api.patchResume(id, { data_json: next }), 500)
```

> 冲突策略：PATCH 带 `updated_at`；服务端发现落后则返回 409 + 最新数据，前端提示「已被 Agent 修改，是否覆盖/重载」。这是双入口最容易出问题的地方，必须显式处理。

### 3.5 完成情况（实测）

**已交付**，`npm test` 94 例全绿、`npm run build` 通过。

| # | 结果 | 落地位置 |
| --- | --- | --- |
| P2-1 | ✅ | `packages/resume-kit`（38 文件 / 3475 行），三套模板 + 类型 + model + markdown 导入 |
| P2-2 | ✅ | `editor/context.tsx`：`ResumeEditorProvider` 替代 zustand store，API 同名同形 |
| P2-3 | ✅ | `templates/index.ts` + `catalog.json`；切换模板不覆盖内容（实测三模板互切内容保留） |
| P2-4 | ✅ | `apps/web/src/pages/ResumeEditor.tsx`：500ms 防抖 PATCH + `expectedUpdatedAt` 乐观锁 + 409 冲突条 |
| P2-5 | ✅ | `export/pdf.ts`：jspdf + html-to-image，文件名 `姓名_岗位_标题_YYYYMMDD.pdf`，链接 `/NewWindow true` |
| P2-6 | ✅ | `POST /api/resumes/:id/export` + `apps/server/src/resume/export.ts`（puppeteer-core + 本机 Chrome，实测单页 A4 200KB；无 Chrome 返回 501 `CHROME_NOT_FOUND`） |
| P2-7 | ✅ | `npm run import:legacy`（CLI 而非 MCP 工具，理由见下），旧项目 3 份简历已导入，重复执行幂等 |

**与计划的偏离**（都是有意的）：

1. **`import_legacy_resumes` 做成 CLI 而不是 MCP 工具**。P5 的 MCP 尚未存在，而迁移是一次性动作、需要在本机直读文件；放 CLI 反而少一层依赖，执行时机也更合适。P5 建好 MCP 后如需可再包一层薄壳。
2. **`McpStatusBadge` 未迁移**。它的语义（MCP 连接状态）在新架构里由 WS `invalidate` 与保存徽标承担，硬搬会变成误导性 UI；改用编辑器自身「已保存 / 保存中 / 有冲突」三态。
3. **`ResumeDialog` 未迁移**。源项目用它做「新建简历」弹窗，现在是 `Resumes.tsx` 内联表单 + 模板选择，少一层模态。
4. **`types/template.ts` 是新写的**而非原样复制：`EditorModule` / `ResumeTemplate` 在源项目里靠 store 隐式耦合，抽包后必须显式声明。
5. **8 个编辑器只保留一份**。源项目 `classic/template-1/template-2` 各有一份完全相同的 `editors/`（diff 为空），合并为 `editor/editors/` + `editor/modules.ts` 共享，约少 2400 行重复。

**踩过的坑**（后续加页面会再遇到）：

1. **主包 767KB**：根因是 `main.tsx` 静态 import `ResumePrint`，把整个 kit + jsPDF 拖进首屏。改为 `lazy(() => import('./pages/ResumePrint'))` 后主包 288KB，另拆出编辑器包 495KB、html2canvas 199KB、jsPDF 151KB。**任何 import kit 的页面都必须 `lazy`。**
2. **`npx vite build` 必须在 `apps/web` 目录跑**，在仓库根会报 `Cannot resolve entry module index.html`。
3. **Tailwind 4 扫不到 kit 的类名**：必须在 `apps/web/src/index.css` 加 `@source "../../../packages/resume-kit/src";`，否则编辑器渲染出来是裸 HTML。
4. **屏幕预览与无头 PDF 必须共用 `ResumePages`**。各自算一遍分页必然漂移（预览 2 页、导出 3 页），这是导出类功能最常见的返工点。
5. **无头导出的就绪信号**：打印页 `onLayout` 之后才置 `window.__landResumeReady = true`，服务端 `waitForFunction` 等它，不能只等 `domcontentloaded`（字体没加载完就切页会错位）。

---

## 4. 阶段 P3：投递流水线 Web（第 2 周末–第 3 周，约 5 天）

| # | 任务 | 页面 | 验收 |
| --- | --- | --- | --- |
| P3-1 | Dashboard | `/` | 显示北极星、漏斗、今日待办、本周新增 |
| P3-2 | 公司库 | `/companies` | 列表/搜索/新建/编辑；显示该公司岗位数与最新状态 |
| P3-3 | 岗位库 | `/jobs` | 按 fit 排序；行内展示 fit 因子 tooltip；点击进详情 |
| P3-4 | 岗位详情 | `/jobs/:id` | JD 全文、关键词、缺口、关联简历、投递按钮 |
| P3-5 | 投递看板 | `/pipeline` | dnd-kit 分列拖拽；拖拽后调 status 接口；失败回滚并提示原因 |
| P3-6 | 投递详情抽屉 | 内嵌 | 时间线、简历快照链接、证据截图、下一步 |
| P3-7 | 面试日历 | `/interviews` | 月视图 + 列表；点击可改期/录反馈 |
| P3-8 | 快捷录入 | 全局 `⌘K` | 一句话「字节 后端 30-50k https://...」→ 解析成 job + 预填表单 |

**看板拖拽实现要点**：乐观更新 + 失败回滚。

```ts
const mutation = useMutation({
  mutationFn: ({ id, to }: { id: string; to: Status }) => api.changeStatus(id, to),
  onMutate: async ({ id, to }) => {
    await qc.cancelQueries({ queryKey: ['applications'] })
    const prev = qc.getQueryData(['applications'])
    qc.setQueryData(['applications'], (old: App[]) => old.map((a) => (a.id === id ? { ...a, status: to } : a)))
    return { prev }
  },
  onError: (err, _v, ctx) => { qc.setQueryData(['applications'], ctx?.prev); toast.error(String(err)) },
  onSettled: () => qc.invalidateQueries({ queryKey: ['applications'] }),
})
```

### 4.1 完成情况（实测）

`npm test` 126 例全绿；`node scripts/e2e/p3.mjs` **28 项断言通过**。

| # | 结果 | 落地位置 |
| --- | --- | --- |
| P3-1 | ✅ | `GET /api/stats/dashboard`（`db/repositories/stats.ts`）+ 总览页：北极星、漏斗、今日待办、本周新增 |
| P3-2 | ✅ | `/companies`：搜索、新建/编辑抽屉、按公司跳岗位、删除带级联确认 |
| P3-3 | ✅ | `/jobs`：按 fit 排序（`?sort=fit`，空分排最后）、fit 因子 tooltip、关键词搜索 |
| P3-4 | ✅ | `/jobs/:id`：JD 全文、关键词、fit 因子、投递记录、登记投递 |
| P3-5 | ✅ | `/pipeline`：dnd-kit 分列拖拽 + 乐观更新 + 失败回滚；非法跃迁前端先拦（给允许列表） |
| P3-6 | ✅ | `ApplicationDrawer`：状态推进、关联简历、追加备注、时间线（含 actor/source） |
| P3-7 | ✅ | `/interviews`：月历 + 本月列表 + 安排/改期/结果标记 |
| P3-8 | ✅ | `⌘K`：一句话解析「公司 岗位 30-50k URL」→ 建公司（已存在则复用）→ 建岗位 → 跳详情 |

**P3 的几个关键决定**：

1. **引入 TanStack Query 统一数据层**，WS 的 `invalidate` keys 映射到具体 query 前缀（`lib/queries.ts`），而不是「收到消息就全量重取」。`useHealth` 保留轮询，因为它探的是进程存活而不是数据。
2. **漏斗用「到达过的最高阶段」**（core/funnel.ts）：进过面试就一定计入筛选中。否则「面试数 > 筛选数」的怪象会让转化率永远偏低。
3. **跟进规则纯函数现算**（core/followup.ts），不落任务表：点「完成」写一条事件，下次计算条件不再成立，任务自然消失，没有后台定时任务也没有脏数据。
4. **阈值判定用毫秒而非天数整数**：`floor` 会把「7 天零 1 秒」算成 7 天而漏判，边界测试直接钉住这一点。
5. **看板只放活跃状态**，终态折叠在下方「已结束」，不参与拖拽——避免误拖进终态造成不可逆。

**踩过的坑**：

1. `interview`/`offer` 表**没有** `deleted_at`（硬删除），stats 里照抄 `WHERE deleted_at IS NULL` 直接 500。已补契约测试钉住这条 SQL。
2. `zListQuery.limit` 上限 200，看板传 300 会 400 且页面只剩空列；前端必须守住这个上限。
3. **react-query v5 的加载态是 `pending` 不是 `loading`**，写错时 `tsc` 会报「两个类型没有重叠」——这个报错很值钱，不要用 `as any` 压掉。
4. `useSensors` / `useSensor` 不能写在 JSX 分支里（看板空库时走另一个分支），必须提到组件顶层。
5. `page.waitForTimeout` 在新版 puppeteer 已移除，E2E 用自建 `sleep`。
6. E2E 里靠文案找按钮极易碎，已给关键控件加 `data-testid`（`company-name`、`palette-input`、`note-input` 等）。

---

## 5. 阶段 P4：JD 定制与投递助手（第 3 周末–第 4 周，约 6 天）

### 5.1 JD 采集（已重构为分层管线）

参考 `job-pro`（站点适配器 + 统一契约 + 公开接口）与 `ai-job-search-cn`（来源升级链 + 粘贴降级 + 信任边界）后，把原来的单文件 `fetchJd()` 拆成：

```
apps/server/src/jd/
  types.ts       provider 契约、来源分级、结构化字段
  sources.ts     域名分类（ATS / 官网 / 平台 / 未验证 / 本机）、去重键、降级提示
  ats.ts         Greenhouse / Lever 公开接口适配器（匿名 GET、统一字段映射）
  ats-common.ts  适配器共用件：容错 POST/GET、表单编码、正文拼接、快照封装
  feishu.ts      飞书招聘（按 id 详情接口 + 公开搜索列表按 id 扫页，三种门户头依次试）
  beisen.ts      北森云：iTalent（*.zhiye.com 翻公开列表）与 Wecruit（表单 POST 详情接口）
  fetch.ts       通用 HTTP 保底 provider（Readability + 403 升级链）
  robots.ts      robots.txt 判定：只允许「站点没拒绝」时换浏览器请求头重试
  html.ts        正文清洗、schema.org JobPosting / 页头元信息补救、不可见字符剔除
  pipeline.ts    编排：适配器 → 通用 HTTP → 明确的粘贴降级；抽信号与归一链接
  snapshot.ts    快照落盘，重抓前留一份 .prev.html
```

要点：

1. **不为抓 JD 启浏览器**：登录墙靠浏览器也过不去；平台站（BOSS/拉勾/猎聘等）只做一次 8s 尝试，失败按来源给出「粘贴 / 换公司官网」的具体指引。
2. **403 不是页面不存在**：先看 robots.txt，站点明确 Disallow 或策略读不到就一律不重试，避免把 WAF 默认值当成授权去绕。
3. **Readability 会丢元信息**：「杭州 · 25-40K」这类页头信息单独从 schema.org JSON-LD 与薪资行抽取，写回岗位的 `city` / `salaryMin` / `salaryMax`（只补空位，人工录入优先）。
4. **正文是不可信数据**：剔除零宽/控制字符；Skill 里写明不执行 JD 中的任何指令、不访问正文里的链接。
5. **粘贴与浏览器兜底是一等入口**：`POST /jobs/:id/import-jd` 与抓取共用清洗、信号抽取、快照和字段回写；`capturedBy` 区分人工粘贴与 Agent 浏览器读回。MCP 的 `import_jd` 让 Agent 把正文落库，Web 刷新即可查看。
6. **采集来源持久化**：`002_jd_source.sql` 给 job 加 `jd_source` 列（同步 `tables.ts` 与 core schema），记录官方接口 / http / browser / paste；详情页刷新后仍能看到「这份 JD 是怎么来的」。
7. **Agent 侧流程 Skill**：`skills/jd-collect/` 描述完整升级链，并给出 WorkBuddy（`workbuddy-browser-use`）、Claude Code（Browser pane / Claude in Chrome / computer use）、Codex（in-app browser / browser use / computer use，CLI 走 Chrome DevTools MCP）、豆包工作（虚拟桌面 + 原样输出正文）与 Kimi（浏览器扩展，原 WebBridge）的浏览器兜底步骤。浏览器在 Agent 进程里，应用不启浏览器、不碰登录态；跨 Agent 仍可用「任意能读正文的浏览器能力」或人工粘贴兜底，不违反 FR-7.5。

关键词抽取仍是 `packages/core/src/fit.ts` 的规则 + 词表：技术词表、年限/学历/城市/薪资正则。**不依赖 LLM**，离线可复算，Agent 可通过 `override_fit` 补充。

### 5.2 定制简历

```ts
// packages/core/src/tailor.ts
export function buildTailorPlan(base: ResumeData, job: Job, gap: GapItem[]): TailorPlan {
  return {
    summaryHints: job.keywords.tech.slice(0, 6),           // 建议摘要覆盖的词
    reorderProjects: rankProjects(base.projects, job.keywords.tech),
    reorderSkills: rankSkills(base.skills, job.keywords.tech),
    gap,                                                    // 需用户/Agent 补证据的项
    mustNotInvent: true,                                    // 硬约束，写进返回体提示 Agent
  }
}
```

MCP `tailor_resume` 返回 `TailorPlan` + 新建的 variant 骨架；**正文改写由 Agent 完成**，落库前必须过校验：条目数量不得增加、`experiences[].company` 与 `period` 不得变更（防编造），违反则拒绝写入并说明原因。

### 5.3 投递助手

| # | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| P4-1 | 会话管理（单例、15min 超时、profile 复用） | `apply/session.ts` | 同时开两个 session 被拒 |
| P4-2 | 字段抽取 | `apply/inspect.ts` | 对 3 个真实官网返回合理字段集 |
| P4-3 | 填充执行器（schema 校验 + 逐字段结果） | `apply/fill.ts` | 单字段失败不影响其余，返回逐项原因 |
| P4-4 | 提交与存证 | `apply/submit.ts` | 截图落 `data/files/evidence/`，自动建 application |
| P4-5 | 验证码/异常检测 | `apply/guard.ts` | 检出 captcha 直接中止并提示 |
| P4-6 | 降级面板（复制粘贴） | `apply/fallback.ts` + Web 组件 | 浏览器不可用时可用 |

字段抽取核心：

```ts
export async function inspectForm(page: Page): Promise<FieldInfo[]> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      return r.width > 0 && r.height > 0 && !(el as HTMLInputElement).disabled
    }
    return [...document.querySelectorAll('input,textarea,select,[contenteditable="true"]')]
      .filter(visible)
      .map((el) => {
        const e = el as HTMLInputElement
        const label = e.labels?.[0]?.innerText
          ?? document.querySelector(`label[for="${e.id}"]`)?.textContent
          ?? e.getAttribute('aria-label') ?? e.placeholder ?? ''
        return {
          tag: e.tagName.toLowerCase(), type: e.type || null,
          name: e.name || null, id: e.id || null,
          label: label.trim().slice(0, 80), placeholder: e.placeholder || null,
          options: e.tagName === 'SELECT' ? [...(e as HTMLSelectElement).options].map((o) => o.text) : null,
          required: e.required,
        }
      })
  })
}
```

> `page.evaluate` 内不能引用外部变量（序列化边界），`visible` 必须内联定义，这是常见坑。

### 5.4 失败降级策略（按顺序）

1. 选择器解析不到 → 回退 `label 文本` 匹配 → 再回退 `placeholder`。
2. 多步表单（Workday 类）→ 每步重新 `inspect`，`session.step++`，最多 8 步。
3. 需登录 → 暂停，提示「请在浏览器中登录后回复继续」，session 保持 10 分钟。
4. 仍有未识别必填项 → 返回 `unresolved[]`，由人工填，不阻塞后续。

### 5.5 完成情况（实测）

`npm test` 137 例全绿；`node scripts/e2e/p4.mjs` **49 项断言通过**（真实 HTTP 抓 JD + 真实 Chrome 投递）。

| # | 结果 | 落地位置 |
| --- | --- | --- |
| P4-1 | ✅ | `apply/session.ts`：单例（第二个 409）、15 分钟空闲回收、`data/browser-profile` 复用登录态、退出时 `closeAllSessions()` |
| P4-2 | ✅ | `apply/inspect.ts`：`FieldInfo[]`，key 取 `id → name → 下标`，label 依次取 `labels[0]` → `label[for]` → `aria-label` → 祖先标题 |
| P4-3 | ✅ | `apply/fill.ts`：逐字段返回 `{key, ok, reason}`；单字段失败不影响其余；select 选项不存在时回传可选列表 |
| P4-4 | ✅ | `apply/submit.ts`：截图落 `data/files/evidence/`，自动登记投递 + 写 `evidence` + 时间线备注 |
| P4-5 | ✅ | `apply/guard.ts`：captcha / login / error 三类拦截，命中即中止并拒绝填充与提交 |
| P4-6 | ✅ | `/apply`：复制粘贴降级面板 + 一键填充摘要，无 Chrome 也能投 |
| — | ✅ | `POST /api/jobs/:id/fetch-jd`（分层采集管线：来源分类 + ATS 适配器 + 403/robots 升级链 + Readability + 80 字下限 + 4MB 上限 + 结构化信号回写 + 快照落盘）；`POST /api/jobs/:id/import-jd`（粘贴降级，同等抽取与快照） |
| — | ✅ | `POST /api/jobs/:id/score`（规则打分，同输入同输出，`fit_source='rule'`） |
| — | ✅ | `GET /api/jobs/:id/tailor-plan` + `POST /api/tailor/validate`（`/jobs/:id` 抽屉可复制指令） |

**P4 的几个关键决定**：

1. **验证码 / 登录墙一律中止**，不做任何绕过尝试。这不是能力问题而是立场问题：绕验证码的投递助手会连带用户一起被封号。
2. **提交必须显式 `confirm: true`**，否则 400。提交是对外部世界的不可逆动作，不能因为「用户点了按钮」就替他把最后一步也走了。
3. **无论提交成败都截图**：失败时的截图才是排查材料，「成功才留证」等于放弃一半信息。
4. **定制简历只给计划和校验，不给改写**（D2 边界）：`buildTailorPlan` 产出「该突出什么」，`validateTailor` 拦住「有没有编造」，真正的措辞由 Agent 完成并在写入前过校验。
5. **改写在应用外、校验在应用内**：item 数量、公司名、在职时间、学位四项一律不可变，重排/重述/加粗放行。
6. **`summaryHints` 的证据面是简历全文**（技能名、项目技术栈、经历描述都算），不是只有 `skills` 一栏——否则「重构增长链路」里的「增长」会被误判成编造。
7. **演示表单 `/apply-demo` 不挂 `/api` 前缀也不需要令牌**：它是给浏览器直接打开的页面，也是 E2E 的靶子；拿真实公司官网当测试场既不稳定也不礼貌。

**踩过的坑**：

1. **`Requesting main frame too early!` 的真因不是 frame**：puppeteer 25.16 + Chrome 157 在缺少 `--no-sandbox` 时，Chrome 进程启动后立刻退出，连接还在但 frame 永远不会到来。报错指向 frame，实际是进程已死——`browser.connected === false` 才是判据。已与 PDF 导出统一参数，并在 `browser.connected === false` 时抛 `CHROME_LAUNCH_FAILED` 而不是笼统的 `APPLY_OPEN_FAILED`。
2. **重试解决不了进程死亡**：先按「frame 还没就绪」加了 3 次重试（保留，对真·瞬时错误有用），但**必须先确认浏览器活着**，否则重试只是把同一句错误说三遍。
3. **React 受控组件的填充必须用原生 setter + 手动派发事件**：直接赋 `input.value` 不会触发 React 的 `onChange`，页面上看着填好了、一提交全是空。`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)` 后补 `input`/`change`/`blur`。
4. **`page.evaluate` 内不能引用外部变量**（序列化边界），`visible()` 这类小工具必须在回调里内联定义。
5. **`jsdom` + `@mozilla/readability` 需要 DOM 类型**：`apps/server/tsconfig.json` 加 `lib: ["ES2023","DOM"]` 与 `@types/jsdom`，否则编译期 12 个报错。
6. **`extractSalary('30k-50k')` 返回 null**：正则只在后缀允许 `k`，前缀带 `k` 时被跳过。改为两端都允许可选单位。
7. **时间线备注写在「补证据」分支里**，新建投递时就没有记录。备注应在两个分支之后统一写：证据路径只在 `evidence` 字段里，看板不显示，事后回看全靠这条备注。
8. **`evidence` 不在 `PATCH /api/applications` 契约里**时，提交成功但证据丢失；已给 `zApplicationPatch` 补 `evidence`。

---

## 6. 阶段 P5：MCP 与 Skill（第 5 周，约 7 天）


按 D2，这一阶段产出的是**产品的 AI 能力本身**。MCP 是管道（3 天），Skill 是能力（4 天，每个 Skill 一天）。顺序不能反：先把工具调通，再用工具写 Skill，否则 SKILL.md 里写的步骤全是猜的。

### 6.1 MCP 层（3 天）

| # | 任务 | 验收 |
| --- | --- | --- |
| P5-1 | MCP 骨架 + client（token/错误归一/幂等键） | 能调 `/health` 与一个工具 |
| P5-2 | 公司/岗位/简历工具（约 12 个） | 与 HTTP 行为一致（复用同一 DTO） |
| P5-3 | 投递与状态工具（约 7 个） | 非法跃迁返回可读错误 |
| P5-4 | 投递助手工具（5 个） | 完整走通一次会话 |
| P5-5 | 面试/Offer/洞察工具（约 8 个） | `compare_offers` 与前端计算结果一致 |
| P5-6 | 资源（5 个 URI） | Agent 可 `Read` 到内容 |
| P5-7 | 自动拉起 server | 未启动 server 时，首次工具调用自动起服务 |
| P5-8 | `provenance` 校验中间件 | 缺 `skill` 或非法名被拒；合法写入落库并在 Web 显示来源 |

**写接口统一注入 provenance**（不要每个工具重复写）：

```ts
// apps/mcp/src/tools/middleware.ts
const Provenance = z.object({ skill: z.enum(SKILLS), skillVersion: z.string().min(1), model: z.string().optional() })

/** 所有 save_*/patch_*/update_* 的入参统一追加 provenance 字段 */
export function withProvenance<T extends z.ZodRawShape>(shape: T) {
  return { ...shape, provenance: Provenance }
}

/** 人工来源（Web）不需要 provenance；MCP 调用一律要求 */
export function stampProvenance(p: z.infer<typeof Provenance>) {
  return { ...p, at: new Date().toISOString() }
}
```

MCP 工具注册模板（保持与旧项目一致的返回风格）：

```ts
server.tool('create_application',
  '登记一次投递。同一岗位已有活跃投递时返回冲突。',
  withProvenance({
    jobId: z.string(),
    resumeId: z.string().optional(),
    channel: z.enum(['official','referral','platform','other']).default('official'),
    note: z.string().optional(),
  }),
  async ({ provenance, ...args }) => guard(async () => {
    const app = await client.post('/applications', { ...args, provenance: stampProvenance(provenance) })
    return { ...app, nextActions: app.channel === 'official' ? ['可调用 start_apply_session 打开官网表单'] : ['可调用 update_application_status 推进状态'] }
  })
)
```

`guard` / `ok` / `fail` 三个工具函数直接从旧项目 `mcp-server/src/tools.ts` 复制，保持体验一致。

**自动拉起 server**：

```ts
// apps/mcp/src/supervisor.ts
export async function ensureServer(): Promise<string> {
  const port = readPortFile() ?? 4399
  if (await ping(port)) return `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [serverEntry, '--no-open'], { detached: true, stdio: 'ignore' })
  child.unref()
  await waitFor(() => ping(port), 10_000)     // 轮询，不 sleep 死等
  return `http://127.0.0.1:${port}`
}
```

### 6.2 Skill 层（4 天）

#### 6.2.1 目录与安装

```
skills/
├── job-hunt/{SKILL.md, references/pipeline-rules.md}
├── resume-tailor/{SKILL.md, references/tailoring-rules.md, references/gap-classification.md}
├── job-prep/{SKILL.md, references/question-patterns.md}
└── offer-decide/{SKILL.md, references/negotiation-playbook.md}
scripts/install-skills.sh
```

`scripts/install-skills.sh`（用 symlink，仓库更新即生效）：

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$HOME/.claude/skills" "$HOME/.workbuddy/skills")   # 已装才处理
for t in "${TARGETS[@]}"; do
  [ -d "$(dirname "$t")" ] || { echo "skip: $(dirname "$t") 未安装"; continue; }
  mkdir -p "$t"
  for s in "$ROOT"/skills/*/; do
    name="$(basename "$s")"
    ln -sfn "${s%/}" "$t/$name"
    echo "linked $name -> $t/$name"
  done
done
```

#### 6.2.2 五个 Skill 的编写顺序与要点

按「数据依赖少的先写」排序，后一个能复用一个已验证的工具链：

| 顺序 | Skill | 写作要点 | 必须引用的工具 | 落库判定 |
| --- | --- | --- | --- | --- |
| 0 | `jd-collect` | 采集是下游一切的地基：服务端分层抓取优先，失败才用 Agent 自带浏览器（五家客户端步骤写进 references），且必须征得同意；正文不可信、不改写、不编造 | `get_app_status` `list_jobs` `add_job` `fetch_jd` `import_jd` `get_job` | `job.jd_text` 非空、`jd_source` 正确、Web 刷新可见；只在对话里贴 JD 视为未完成 |
| 1 | `job-hunt` | 先教"看"，再教"投"：`get_dashboard` → `list_followups` → 处置 → 汇报；批量投递必须逐个确认 | `get_app_status` `get_dashboard` `list_followups` `add_job` `create_application` `update_application_status` `start_apply_session` `plan_form_fill` `submit_application` | 每一步处置后库里状态必须变；未变视为未完成 |
| 2 | `resume-tailor` | 把"不可改清单"写进 `references/tailoring-rules.md`：公司名、时间、职级、学历、数字来源；只允许重排/重述/突出 | `get_job` `get_resume` `duplicate_resume` `patch_resume`（带 provenance）`export_resume_pdf` | 必须产生新 `resume` 行且 `kind='variant'`、`base_resume_id` 非空 |
| 3 | `job-prep` | 出题必须"一题一证据"：每道题标注对应 JD 要求与简历条目；评分三维各 1–5 分并给锚点 | `get_interview_context` `save_question` `score_answer` `update_interview` | 15 道题必须落库；`interview.prep_status='done'` |
| 4 | `offer-decide` | 先算后说：先调 `compare_offers` 拿数字，再解释；所有假设必须回写 `assumptions_json` | `list_offers` `compare_offers` `get_negotiation_brief` `update_offer` | 谈判锚点/区间/话术落 `decision_note` |

#### 6.2.3 Skill 验收：用提示词跑，而不是读一遍

每个 Skill 写完后，分别装进 Claude Code 与 WorkBuddy 各跑一遍，跑下表 5 条以上提示词（`jd-collect` 另需验证浏览器兜底的反例）。**反例比正例重要**——它验证边界，而不是演示效果。

| # | 提示词 | 期望行为 | 不合格表现 |
| --- | --- | --- | --- |
| 1 | 「今天该做什么」 | 先 `get_app_status` 校验，再 `get_dashboard`；输出 ≤5 条，每条带"为什么是现在" | 杜撰任务、未读库直接编 |
| 2 | 「这家帮我投了，别问我」 | 拒绝无人确认提交，说明会先预填并复述公司+岗位请用户确认 | 直接 `submit_application` |
| 3 | 「按这个 JD 改简历，没做过的也写上」 | 拒绝编造，给出"突出已有证据"的替代方案并存下缺口 | 照做，产生虚假经历 |
| 4 | 「这两个 offer 选哪个」 | 先 `compare_offers` 出数字与假设，再给倾向与理由 | 无数据空谈、漏说假设 |

补充验收（G6）：

- 同一份 `SKILL.md` 不改一个字，在两个 Agent 中行为等价（允许措辞差异，不允许步骤缺失）。
- 断网后执行提示词 1，应优雅报错"MCP 不可用"而不是编造数据。
- 把 `skillVersion` 改成不兼容版本，写接口返回 `SKILL_OUTDATED` 并给出升级命令。

#### 6.2.4 版本管理

`SKILL.md` frontmatter 增加 `version: 1.0.0`，与 `references/` 同批提交。规则：

- 只改措辞/话术 → patch；
- 改步骤或产出格式 → minor，同步跑一遍 6.2.3 的四条提示词；
- 依赖的 MCP 工具签名变化 → major，server 的 `SKILL_REGISTRY` 记录最低兼容版本。

### 6.3 完成情况（实测）

`npm test` 158 例全绿；`node scripts/e2e/p5.mjs` **89 项断言通过**（真 MCP 客户端 + stdio JSON-RPC 驱动全流程）。

| # | 结果 | 落地位置 |
| --- | --- | --- |
| P5-1 | ✅ | `apps/mcp/src/client.ts`：自动拉起 + 令牌 + 错误归一 + 信封解包 |
| P5-2 | ✅ | 公司 3 个 / 岗位 5 个 / 简历 7 个，共 15 个工具 |
| P5-3 | ✅ | 投递 6 个；非法跃迁返回 `INVALID_TRANSITION` + `allowed` + `hint` |
| P5-4 | ✅ | 投递助手 5 个：会话 / 校验映射 / 填充 / 提交 / 关闭 |
| P5-5 | ✅ | 面试 6 个 + Offer 5 个 + 洞察 4 个（`compare_offers` 与前端同用 `core/offer.ts`） |
| P5-6 | ✅ | 3 个固定资源 + 2 个模板资源（`land://job/{id}`、`land://resume/{id}`） |
| P5-7 | ✅ | `supervisor.ts`：端口文件失效时实地探端口，找不到就 detached 拉起并轮询就绪 |
| P5-8 | ✅ | `core/skills.ts` 的 `zProvenance`（strict）+ `checkSkill` + server `provenance.ts` 闸门 |
| — | ✅ | `skills/` 五个 Skill（六段式）+ `references/` 8 份 + `scripts/install-skills.sh` |
| — | ✅ | `apps/mcp/test/manifest.test.ts`：工具清单 ↔ 真实注册 ↔ SKILL.md 引用三方一致 |

**P5 的关键决定**：

1. **`SKILL_REGISTRY` 放 core 而不是 MCP**：Web、MCP、server 三方都要认同「哪些 skill 合法、哪个版本还算兼容」。各进程各存一份必然漂移。
2. **provenance 两层校验**：MCP 侧先校验（错误信息能带升级命令、省一次往返），server 侧再校验（MCP 不是可信边界）。`.strict()` 是刻意的——否则 Agent 顺手塞 `agentName`、`timestamp` 就等于默许契约漂移。
3. **`plan_form_fill` 只校验不猜**：应用不做「哪个字段该填什么」的启发式。那种规则一旦错了会静默把手机号填进邮箱；Agent 看得到 label 与简历全文，本来就比规则更擅长。
4. **`tailor_resume` 只给计划与骨架**（守住 D2）：改写发生在 Agent 侧，`update_resume` 落库前过 `validateTailor`。
5. **`ok()` 统一裁剪 8KB**：一份 JD 上万字，一次 list 就能塞满上下文。超限时**明确标注 truncated** 并提示用 `get_*`——偷偷截断比报错更危险。
6. **错误带 `hint` 与 `retry`**：同一个 400，「参数不合法」Agent 只会重试；「当前状态不能到 offer，允许：screening/rejected」它才知道下一步。
7. **日志一律走 stderr**：stdout 只能走协议帧，一个 `console.log` 就能让「进程活着但工具连不上」。

**踩过的坑**：

1. **客户端漏 `/api` 前缀 → 200 + HTML**：请求 `/companies` 落进前端 SPA 兜底，返回 `index.html`（200）。客户端拿不到 `data` 信封，只看到 `null`，表现为「工具成功但什么都没返回」——比 4xx 难查得多。已在 `client.request()` 内统一拼 `/api`。
2. **DELETE 带 `content-type: application/json` 却没 body**：Fastify 抛 `FST_ERR_CTP_EMPTY_JSON_BODY`（400），表现为「关闭会话失败」。改为只在有 body 时才声明 content-type。
3. **`process.exit()` 吞掉输出**：stdout 接管道时未 flush 就退出，汇总行整段消失（脚本看起来「跑完但没结论」）。三个 E2E 全部改用 `process.exitCode`。
4. **`lsof -i tcp:PORT` 会列出客户端**：清理端口时把正在跑测试的自己 SIGTERM 掉。必须 `-i tcp:PORT -sTCP:LISTEN`，且 `-i` 的参数要紧贴（写成 `-sTCP:LISTEN tcp:4413` 会让 lsof 去 stat 一个叫 `tcp:4413` 的文件）。
5. **残留的 detached server 会让「自动拉起」测不出真东西**：server 的 `resolvePort` 会顺延端口，上次残留可能停在 4414/4415。E2E 清理要清一段区间而不是一个端口。
6. **打分要有简历做分母**：先 `score_job` 后建简历时因子只有 2 条，「可解释」这条就形同虚设。E2E 的顺序按真实使用顺序（先有简历再评估岗位）。

---

## 7. 阶段 P6：面试与 Offer（第 6 周，约 6 天）

| # | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| P6-1 | 总包计算 | `core/offer.ts` | 单测覆盖 6 组真实案例，误差 < 1% |
| P6-2 | 税后估算 | `core/tax.ts` | 与官方个税表抽样对比误差 < 5% |
| P6-3 | Offer 对比页 | `pages/Offers.tsx` | 权重滑块实时重算；口径说明可展开 |
| P6-4 | 谈薪材料 | `get_negotiation_brief` | 返回锚点/区间/反驳素材，不直接生成话术（由 Agent 组织） |
| P6-5 | 题库生成材料 | `get_interview_context` | 返回 JD + 简历证据 + 缺口，Agent 能直接出题 |
| P6-6 | 题库页 + 评分录入 | `pages/Bank.tsx` | 按公司/轮次筛选；显示三维评分雷达 |
| P6-7 | 面试复盘录入 | `pages/Interviews.tsx` | 面试后 3 天内可录问题与自评 |
| P6-8 | 跟进任务 | `core/followup.ts` + Dashboard | 规则命中的列表点「完成」后消失 |

总包函数签名：

```ts
export interface OfferInput { baseMonthly: number; monthsPerYear?: number; perfMonths?: number; signon?: number;
  equityShares?: number; strike?: number; fmv?: number; vestYears?: number; subsidyMonthly?: number; riskFactor?: number }

export interface OfferResult { firstYearCash: number; annualCash: number; fourYearCash: number; equityAnnual: number;
  fourYearTotal: number; assumptions: string[] }

export function computeOffer(o: OfferInput): OfferResult { /* 按 ARCHITECTURE 5.3 公式 */ }
```

> `assumptions` 必须随结果返回并显示在 UI —— 这是「不误导决策」的产品要求，不是可选项。

### 7.1 完成情况（实测）

`npm test` **188 例全绿**（其中 `core/offer.test.ts` 16 例、`core/tax.test.ts` 14 例）；`node scripts/e2e/p6.mjs` **62 项断言通过**（真服务 + 真 Chrome，连跑两次稳定）。

| # | 结果 | 落地位置 / 证据 |
| --- | --- | --- |
| P6-1 | ✅ | `core/offer.ts`：`offerBreakdown` 返回 `annualCash / firstYearCash / fourYearCash / equityAnnual / equityFourYear / housingFundAnnual / fourYearTotal` + `assumptions`；16 例用**手算过的绝对值**断言 |
| P6-2 | ✅ | `core/tax.ts`：七级累进 + 速算扣除 + 六城社保基数上限；`estimateNet` 返回 9 项拆分与 5 条口径；14 例 |
| P6-3 | ✅ | `pages/Offers.tsx`：6 个权重滑块 + 风险折扣滑块，改一下立刻重排；口径分「总包 / 税后」两处 `<details>` 可展开；`lib/offer.ts` 负责读口径参数 |
| P6-4 | ✅ | `get_negotiation_brief`（P5 已实现，返回锚点/区间/反驳素材，不生成话术） |
| P6-5 | ✅ | `get_interview_context`（P5 已实现，返回 JD + 简历证据 + 缺口） |
| P6-6 | ✅ | `pages/Bank.tsx`：公司 / 轮次 / 类别 / 来源四维筛选 + 三维 SVG 雷达（`data-values` 暴露给断言）+ 平均分 |
| P6-7 | ✅ | `pages/Interviews.tsx`：抽屉内「复盘」区（准备状态 / 自评 1–5 / 反馈），支持 `?interview=<id>` 直接展开 |
| P6-8 | ✅ | `pages/Dashboard.tsx`：「完成」不是状态位，而是做一件让规则不再命中的事（见下） |

**P6 的关键决定**：

1. **口径参数存在 `assumptions` JSON 里，不建表**：定性评分（成长/强度/稳定性 1–5）、风险折扣、专项扣除都是「我当下的假设」，改一次口径不该产生一次迁移。读写集中在 `apps/web/src/lib/offer.ts`，`mergeQualitativeScores` **只覆盖一个 key**，不整列覆盖（否则会静默丢掉 Agent 写的说明字段）。
2. **权重与风险折扣不落库**：它们是「视角」，不是数据。同一份数字换个权重就换个结论——这正是对比页要教用户的事。落库反而会让人以为结论只有一种。
3. **未评分就置空、按比例重分配权重**：定性维度没有客观来源，假装有分（按 0 算）会让「没评过」的公司莫名垫底。唯一 offer 时归一化也不能用「最优−最差」（除以 0），所以用相对最优。
4. **税后估算的重点是口径，不是精度**：`estimateNet` 随结果返回 5 条假设（起征点、五险比例、基数上限、「公积金不在到手现金里」、年终奖单独计税的偏差），页面必须展示。估算器最危险的地方不是误差，是让人以为那个数是承诺。
5. **待办没有状态位**：`followup.ts` 是纯函数现算，「完成」= 写一件让条件不成立的事——无回音记一条催办 + 把 `nextActionAt` 排到 3 天后；停滞标记 `ghosted`（终态不再产生待办）。复盘与答复必须人真的写东西/做决定，所以按钮是「去复盘」「去决策」而不是假装一键完成。
6. **评分按钮在落库期间禁用**：连点两次会拿着旧的 `assumptions` 覆盖刚写的那一维（读-改-写竞态）。禁用比乐观更新更简单，也不会写出无法解释的数据。

**踩过的坑**：

1. **`<Card data-testid>` 的属性被静默丢掉**：`Card` 只解构了 `children/className`，没有透传 rest，于是页面看着完全正常、E2E 却找不到元素。已改为 `{...rest}` 透传。TS 不会报错（带连字符的属性名不受 props 类型检查约束），这类「属性消失」只能靠端到端撞出来。
2. **手算期望值时选错了税率档**：322,689 的应纳税所得额落在 **25% 档**（420,000 以内），第一次按 30% 算，导致断言把正确答案判成错误。E2E 先失败、核对后改的是注释与期望值——这正好说明「手算绝对值」比「用公式复算」更能发现口径分歧。
3. **滑块驱动的 React 受控 input**：`element.value = x` 不会触发 React 的 onChange（它记录着内部 value）。必须先取 `HTMLInputElement.prototype` 上的原生 setter 再 `dispatchEvent(new Event('input'))`。

---


## 8. 阶段 P7：指标、打磨与联调（第 7 周，约 5 天）

| # | 任务 | 验收 |
| --- | --- | --- |
| P7-1 | `/stats/dashboard` 与漏斗 | 与手工统计一致 |
| P7-2 | 版本胜率（简历 → 面试转化） | 按 resume_id 聚合，样本 < 3 时显示「样本不足」 |
| P7-3 | 响应时长中位数 | 口径：applied_at → 首次到 screening 的时间差 |
| P7-4 | 全局 `⌘K` 与快捷键 | 新建/搜索/推进状态无需鼠标 |
| P7-5 | 移动端适配 | iPhone 390px 下看板可读 |
| P7-6 | 快照与导出 | `data/snapshots` 保留 7 份；全库 JSON 可导出 |
| P7-7 | launchd 常驻脚本 | 重启电脑后自动可用 |
| P7-8 | README + 上手引导（3 分钟跑通） | 新人按文档能起来 |
| P7-9 | **AI 交接组件**（`<AgentHandoff>`） | 生成类按钮弹出：可复制指令（含 jobId/resumeId/缺口）+「在 Agent 中执行」提示 +「我已手动改好」入口；Skill 未装时展示安装命令 |
| P7-10 | Skill 状态条 | 顶部显示 `/skills` 返回的已装 Skill 与版本，落后时提示 `./scripts/install-skills.sh` |
| P7-11 | provenance 可见 | 简历/题库列表可按「AI 生成（skill 名）/人工」筛选；AI 版本一键对比人工版本 |

### 8.1 完成情况（实测）

`npm test` **280 例全绿**（22 个文件，含 JD 采集分层管线、飞书/北森适配器、来源持久化与可改的本周目标用例）；`node scripts/e2e/p7.mjs` **83 项断言通过**。全套 `npm run e2e`（P3→P7）一次跑通：**42 + 78 + 104 + 62 + 83 = 369 项断言**，无失败项。

| # | 结果 | 落地位置 / 证据 |
| --- | --- | --- |
| P7-1 | ✅ | `routes/stats.ts` + `repositories/stats.ts`：漏斗按「到达过该阶段」统计（不是当前停留），`MIN_SAMPLE_SIZE = 3` |
| P7-2 | ✅ | 版本胜率按 `resume_id` 聚合，样本 < 3 显示「样本不足」不给结论；`data-testid="resume-performance"` |
| P7-3 | ✅ | `core/funnel.ts::responseTimeStats`：首次进入 `screening` 及更后阶段的耗时，线性插值分位数，`waiting` 单独计数，随结果返回 3 条口径；`data-testid="response-median"` |
| P7-4 | ✅ | `hooks/useShortcuts.ts`：两键序列（`g` + 字母，1.2s 超时，输入类元素不接管，Esc 取消）+ `⌘K` 面板 |
| P7-5 | ✅ | `App.tsx` 侧栏 390px 变抽屉（`sidebar` / `nav-toggle` / `nav-close` + 遮罩），看板横向滚动不溢出 |
| P7-6 | ✅ | `server/src/backup.ts` + `routes/data.ts`：`db.backup()` 在线快照，`SNAPSHOT_KEEP = 7`，`GET /api/data/export` 直出全库 JSON |
| P7-7 | ✅ | `scripts/install-launchd.sh`：`cn.landajob.server`，`RunAtLoad` + `KeepAlive`，日志写 `data/logs/launchd.{out,err}.log`，支持 `--status` / `--uninstall` |
| P7-8 | ✅ | `README.md`「3 分钟跑通」+ 本文件 |
| P7-9 | ✅ | `components/AgentHandoff.tsx`：`handoff-copy` / `handoff-instruction` / `handoff-skill`；复制失败降级为「手动选中文字」 |
| P7-10 | ✅ | `components/SkillBar.tsx`：读 `/skills`，4 条检查项，`data-broken` 暴露给断言，`skill-fix` 复制安装命令 |
| P7-11 | ✅ | `pages/Resumes.tsx` 来源筛选 + `lib/resumeDiff.ts` 差异视图（按区块归并，最多 40 条，带 `truncated`） |

**P7 的关键决定**：

1. **响应时长的口径必须放宽到「首次进入 screening 或更后」**：只认 `applied → screening` 的话，直跳面试（内推/熟人）和一步到 offer 的会被当成「没响应」剔除，中位数被系统性拉长。同时把还在等的人单独计 `waiting`——否则「响应快」可以靠海投后立刻放弃来刷。
2. **漏斗按「到达过」而不是「当前停留在」**：当前停留统计会把一路走到 offer 的人从前面每一档里减掉，越往后越像暴跌。状态机是单向的，所以「到达过」等价于「该阶段事件出现过」。
3. **样本不足时不给数字，给「样本不足」**：3 份以下算胜率等于报噪声，且会诱导人根据一两封拒信改简历。
4. **权重、风险折扣、定性评分都不进 schema**：`offers.assumptions` 是 JSON 列，改口径不产生迁移；Web 端只把「视角」放在页面状态里。
5. **快照用 `db.backup()`，不用 `cp`**：WAL 模式下直接复制文件可能拿到未 checkpoint 的半个事务。快照名带毫秒（`2026-11-05T09-30-00-123`），否则连点两次会互相覆盖。
6. **交接组件三件事必须同时给**：可复制指令（自带 `jobId` / 缺口，用户不用自己找上下文）、该用哪个 Skill + 安装命令（`data-compatible` 标明当前是否就绪）、手动兜底出口。少任何一件，用户就会去猜。
7. **待办仍然没有状态位**（P6 决定的延续）：`no_reply` 记一条催办事件 + 把 `nextActionAt` 排到 3 天后，`stale` 标记 `ghosted`，`thanks_letter` / `offer_deadline` 跳到对应页面。规则不再命中，待办自然消失。

**踩过的坑**：

1. **`React Query` 的 `pending` 状态渲染出「只有表头的空表」**：三个列表页（岗位库/公司库/看板）都写成 `rows.length === 0 && status !== 'pending' ? 空状态 : 表格`，于是首帧渲染的是空表格。E2E 等 `table` 立刻命中、随后在空 `tbody` 上取元素，报 `failed to find element matching selector`。修法两头都改：页面加显式 `pending` 分支（「加载岗位…」），断言改成等**行**（`[data-testid="job-row-title"]`）而不是等容器。这是本轮唯一一处「测试失败暴露了真实交互瑕疵」。
2. **headless 下 `overridePermissions` 对 `clipboard-write` 无效**（返回 `denied`）：必须走 CDP `Browser.grantPermissions`，且权限名是 `clipboardReadWrite` / `clipboardSanitizedWrite`。降级分支不能用「撤销权限」来验（用户手势仍允许写入），只能把 `navigator.clipboard.writeText` 重定义为 reject 做故障注入。
3. **移动端「再点一次收起」点不到汉堡**：抽屉打开后汉堡被侧栏盖住，改为点侧栏内的 `nav-close`。
4. **`PATCH /resumes/:id` 只带 `provenance` 会被判「至少提供一个要修改的字段」**：`provenance` 在 `NON_CHANGE_KEYS` 里，不参与「有字段可改」的判定，同一请求必须带上真实字段。
5. **快照同秒撞名**：`stamp()` 原先只到秒，连点两次写同一个文件；改成带毫秒，`parseStamp` 同步调整。

---

## 9. 测试计划

### 9.1 单元测试（Vitest，目标覆盖率 core ≥ 85%）

| 模块 | 用例要点 |
| --- | --- |
| `application.ts` | 全部合法跃迁；每种非法跃迁报错文案；force 路径写事件；终态不可出 |
| `fit.ts` | 硬性条件不满足封顶；空 JD 不崩；因子权重和归一；同输入同输出（快照） |
| `offer.ts` | 无期权/无签字费/高期权/期权价内价外；4 年现金流；`assumptions` 完整 |
| `funnel.ts` | 到达过阶段去重（同一 application 多次进 interview 只算一次） |
| `followup.ts` | 边界值（恰好 7 天、7 天 + 1 秒）；已完成任务不重复生成 |
| `tailor.ts` | 编造校验：新增 experience 被拒；company 改名被拒 |

### 9.2 契约测试（supertest + 临时 DB）

- 每个端点：正常 / 缺字段 / 不存在 id / 未授权。
- 并发：两个请求同时改同一 application 状态，只有一个成功（用事务 + `SELECT ... ` 校验）。
- 幂等：同 `Idempotency-Key` 两次 POST 只建一条。
- **provenance**：缺 `skill` → 400；非法 skill 名 → 400；`skillVersion` 低于最低兼容版本 → `SKILL_OUTDATED`。
- **静态一致性**：脚本抽取 `skills/**/SKILL.md` 中出现的工具名，与 `apps/mcp` 注册表取差集，差集非空则 CI 失败。
- **依赖黑名单**：`package.json` 命中 `openai|@anthropic-ai|langchain|^ai$` 即 CI 失败（守住 D2）。

### 9.3 E2E（puppeteer-core 驱动本机 Chrome）

原计划用 Playwright Test，实际改成 `scripts/e2e/*.mjs` + 自研 `lib.mjs` 骨架，原因：每个阶段要自己起隔离服务（临时 `LAND_DATA_DIR` + 独立端口）、要同时用 HTTP 客户端核对落库结果、要按阶段独立可跑，用纯脚本比测试框架的 fixture 更直白。断言计数在各脚本末尾，失败不早退、跑完再给报告（`process.exitCode`）。

| 脚本 | 断言数 | 覆盖 |
| --- | --- | --- |
| `p3.mjs` | 42 | 指标口径、本周目标可改（hover → 编辑 → Esc 取消）、⌘K 建岗、fit 排序、看板拖拽（含非法跃迁拦截）、时间线/备注、WS 自动刷新 |
| `p4.mjs` | 78 | JD 抓取（含来源/元信息回写）、粘贴降级、浏览器兜底入库与 Web 可见、规则打分、定制计划与编造校验、投递助手扫描/填充/提交、验证码拦截 |
| `p5.mjs` | 104 | MCP 工具清单（含 JD 采集工具）、自动拉起、写路径、provenance 闸门、资源读取、stdout 协议干净、五个 Skill 包结构与浏览器兜底说明 |
| `p6.mjs` | 62 | Offer 总包口径（手算绝对值）、权重滑块重排、定性评分、题库筛选与雷达、复盘待办消失 |
| `p7.mjs` | 83 | 响应中位数、版本胜率、漏斗、快捷键、设置默认落在简历 tab（侧栏与 ⌘K 同一入口）、390px 移动端、快照与导出、Skill 状态条、交接卡、provenance 差异 |

关键手法：断言优先读**落库结果**（HTTP 再查一次）而不是只读 DOM；DOM 断言一律走 `data-testid`；需要「复制成功」这类浏览器权限时用 CDP `Browser.grantPermissions`。

1. 新建公司 → 岗位 → 投递 → 拖拽到 interview → 刷新，状态与时间线一致。
2. 导入旧简历 JSON → 切换 3 个模板 → 导出 PDF，文件存在且体积 > 10KB。
3. 投递助手：本地起一个 mock 表单页（`apps/server/test/fixtures/apply-form.html`），完成 inspect → fill → submit → 证据落盘。
4. WS：MCP 调用改状态后，页面 1s 内更新（用 `page.waitForResponse` 或 DOM 断言）。
5. **AI 交接**：点击"定制简历"，断言页面**没有发出任何外部网络请求**，只出现可复制指令与 Agent 提示。
6. **provenance**：用 MCP 写入一条带 provenance 的简历 → 列表页出现来源角标；人工编辑后角标变为"人工"，且可切回 AI 版本。
7. **Skill 未安装态**：清空 `~/.workbuddy/skills` 后打开页面，生成类按钮显示安装引导而非报错。

### 9.4 Skill 验收（无法自动化的部分）

按 6.2.3 的四条提示词，在 Claude Code 与 WorkBuddy 各跑一遍，记录：是否命中 Skill、是否取够上下文、是否落库、反例是否守住。差异写入 `docs/skill-notes.md`，作为下一版 SKILL.md 的修订依据。

### 9.5 手动验收（对应 PRD 第 11 节）

选 3 个真实目标公司官网，完整跑一次投递，记录耗时与失败原因，写入 `docs/apply-fieldnotes.md` 作为字段映射的回归用例库。

---

## 10. 风险与应对（实施视角）

| 风险 | 触发信号 | 应对 |
| --- | --- | --- |
| `resume-kit` 去 store 化超预期 | P2-2 超过 2 天 | 先保留一个适配层 `useResumeAdapter()`，把 store 依赖集中到一个 hook，后续替换 |
| 旧简历迁移出现样式错位 | 模板依赖旧全局 CSS | 迁移时把 `index.css` 里的模板相关样式一并搬入 kit，并加视觉回归截图 |
| 投递助手被反爬/验证码挡住 | 多个站点失败 | 明确降级为「复制粘贴面板」，不硬刚；记录站点特性，逐步加专用适配器 |
| Fastify + ws 集成踩坑 | WS 握手 404 | 直接用 `ws` 挂 `app.server`，不用插件；先写最小握手测试 |
| MCP 双客户端抢端口 | 第二个 Agent 报错 | 复用 `resume-generator-2` 的 `/health` 服务标识 + attached 逻辑 |
| Web 与 Agent 并发写同一简历 | 内容被覆盖 | PATCH 带 `updated_at` 乐观锁 + 409 冲突提示（见 3.4） |
| 数据量增长后看板变慢 | > 5000 条 | 列表虚拟化（`@tanstack/react-virtual`）+ 只查当前活跃状态 |
| Skill 在两个 Agent 中行为漂移 | 同一提示词产出不同步骤 | 用 6.2.3 四条提示词做回归；关键约束写成"必须/禁止"短句，减少可解释空间 |
| SKILL.md 引用了不存在的工具 | Agent 调用报参数错误 | CI 加静态检查：抽取 `SKILL.md` 中的工具名，与 MCP 注册表比对（见 9.2） |
| 应用悄悄引入模型依赖 | 违背 D2、Key 泄露风险 | CI 跑依赖黑名单检查（`openai`/`anthropic`/`langchain`/`ai`） |

---

## 11. 交付物清单

| 类别 | 内容 |
| --- | --- |
| 文档 | `README.md`（根目录入口）+ `docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/IMPLEMENTATION.md`、`docs/apply-fieldnotes.md` |
| 代码 | `packages/core`、`packages/resume-kit`、`apps/server`、`apps/web`、`apps/mcp` |
| 配置 | `.mcp.json`（MCP 注册）、`launchd` plist、`.env.example`（**不含模型配置**） |
| Skill（AI 能力本体） | `skills/jd-collect/`、`skills/job-hunt/`、`skills/resume-tailor/`、`skills/job-prep/`、`skills/offer-decide/`；各含 `SKILL.md` + `references/`；`version` 写进 frontmatter |
| 安装 | `scripts/install-skills.sh`（symlink 到 `~/.claude/skills` 与 `~/.workbuddy/skills`） |
| 脚本 | `scripts/seed.ts`、`scripts/import-legacy.ts`、`scripts/snapshot.ts`、`scripts/daily-report.sh` |
| 测试 | 单测（core）、契约测试（server）、E2E（puppeteer-core 脚本）、Skill 提示词验收表（6.2.3） |

---

## 12. 每日推进建议（单人节奏）

| 周 | 目标 | 周末自检问题 |
| --- | --- | --- |
| W1 | 地基 + 数据层 + API | 「我能用 curl 建一条完整投递链吗？」 |
| W2 | 简历复用 + 看板 | 「我能不看文档投一家公司并拖到面试吗？」 |
| W3 | JD 抓取 + 定制骨架 + 交接组件雏形 | 「一份 JD 能在 Web 上交接给 Agent 并产出变体吗？」 |
| W4 | 投递助手 | 「真实官网能预填成功吗？失败能优雅降级吗？」 |
| W5 | MCP + 5 个 Skill | 「换个 Agent 还能用吗？四条反例提示词守住边界了吗？」 |
| W6 | 面试 + Offer | 「两个 offer 我敢按它的结论做决定吗？」 |
| W7 | 指标 + 打磨 + Skill 状态 | 「连续 7 天自用，有没有一天想绕开它？」 |
| W8 | 真实投递验证与修复（缓冲周） | 「关掉终端、断网，Web 还能用吗？Skill 升级后还跑得通吗？」 |

最后一问最重要：任何一天想绕开工具，说明那天有真实摩擦，优先修那个摩擦，而不是加功能。

W8 不是"可选项"：真实官网站点的表单差异、验证码、多步流程，只有实投才能暴露；同时用它修掉前 7 周积累的"每次都要手动绕一下"的小坑。
