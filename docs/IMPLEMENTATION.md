# Land a Job — Implementation

**English** · [简体中文](./IMPLEMENTATION.zh-CN.md)

| Item | Value |
| --- | --- |
| Version | v1.0 |
| Related | [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Timeline | ~8 weeks (one person, 25–30 h/week, ~40 person-days) |
| Prerequisites | Node ≥ 22 (verified v22.22.2), npm ≥ 10, Chrome (export/automation) |
| Status | P0–P7 complete: 280 unit tests, 369 E2E assertions, all green |

---

## 0. Execution order

### 0.1 Locked premises

| # | Decision | Hard constraint on implementation |
| --- | --- | --- |
| D1 | Single-user local | No `user` table, no login page, no Postgres; no `owner_id` anywhere; server binds `127.0.0.1` |
| D2 | AI via skills + agent, zero model in the app | No LLM SDK in dependencies; no "generate" endpoints; every generate button is a handoff; writes require `provenance` |
| D3 | Reuse the resume editor (`resume-kit`) | P2 only removes the store and extracts the package; no UI redesign; `ResumeData` field names unchanged |

**Self-check before starting**: `grep -r "openai\|anthropic\|langchain" package.json packages/*/package.json apps/*/package.json` must be empty — and run it every time you add a dependency.

### 0.2 Stages and gates

```
P0 Foundation (3d) → P1 Data & API (4d) → P2 Resume reuse (4d) → P3 Pipeline UI (5d)
→ P4 Tailoring & apply assistant (6d) → P5 MCP + skills (7d) → P6 Interviews/offers (6d) → P7 Metrics & polish (5d)
```

| Gate | Condition |
| --- | --- |
| G1 | `npm run test:core` green; `/health` returns the db version |
| G2 | Contract tests cover every endpoint; illegal transitions rejected |
| G3 | Old resume JSON migrates 100% and renders correctly |
| G4 | Drag on the board → refresh → same state, complete timeline |
| G5 | One real site completes "fill → human confirm → submit → evidence" |
| G6 | 9 skills symlinked into Claude Code, Codex and WorkBuddy; the same SKILL.md works for "apply" and "interview prep" in at least two agents; output visible in the UI with provenance |
| G7 | Two offers' comp totals match hand calculation within 1% |
| G8 | Offline, with no API keys, the UI's entry/edit/stats/export/compare all work |

---

## 1. P0: repository and foundation (3 days)

### 1.1 Initialization

```bash
mkdir -p apps/{server,web,mcp} packages/{core,resume-kit,contracts} skills/job-hunt data docs
npm init -y
```

Root `package.json` (abridged):

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
    "test": "vitest run"
  }
}
```

### 1.2 Task list

| # | Task | Output | Acceptance |
| --- | --- | --- | --- |
| P0-1 | Root config: strict tsconfig, path aliases | `tsconfig.base.json` | `tsc -b` clean |
| P0-2 | `packages/core` skeleton + vitest config | `npm run test:core` | One placeholder test passes |
| P0-3 | `apps/server` with Fastify + `/health` | `src/index.ts` | `curl 127.0.0.1:4399/api/health` returns `{ok:true}` |
| P0-4 | Port guard: increment when taken, write `data/.port` | `src/port.ts` | Still starts with 4399 occupied |
| P0-5 | Token generation and auth plugin | `src/auth.ts` | 401 without a token |
| P0-6 | `apps/web` Vite + Tailwind 4 + router shell | Empty pages | Dashboard skeleton at 4399 |
| P0-7 | Serve `apps/web/dist` from the server | `src/static.ts` | Server alone serves the page after build |
| P0-8 | Logging and unified error handler | — | Errors return `{error:{code,message}}` |
| P0-9 | `.gitignore` (data/, dist/, node_modules, *.db) | — | `git status` clean |

### 1.3 Server skeleton

```ts
const db = openDb()                       // migrations run here
const app = Fastify({ logger: { level: 'info' } })

registerAuth(app)                          // X-Land-Token, /health exempt
registerRoutes(app, db)
await app.register(serveWeb)               // /assets/* + SPA fallback

const port = await resolvePort(Number(process.env.LAND_PORT ?? 4399))
await app.listen({ host: '127.0.0.1', port })
attachWs(app.server, db)                   // ws on the same http server
```

> Attach `ws` directly to `app.server` rather than using a plugin, to avoid plugin-order surprises.

---

## 2. P1: data layer and API (4 days)

### 2.1 Migration mechanism

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

### 2.2 Tasks

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| P1-1 | DB connection (WAL, foreign_keys) + migrations | `db/index.ts`, `db/migrate.ts`, `001_init.sql` | Tables created once; not re-run |
| P1-2 | Repo utilities (soft delete, cursor pagination, timestamps) | `db/repo.ts` | Unit-tested |
| P1-3 | Zod schemas | `packages/core/src/schema/*` | One-to-one with the DDL |
| P1-4 | State machine + event write | `core/application.ts`, `db/repositories/application.ts` | Illegal transitions throw; status change always writes an event (same transaction) |
| P1-5 | Company/job CRUD | `routes/companies.ts`, `routes/jobs.ts` | Contract tests pass |
| P1-6 | Resume CRUD + duplicate | `routes/resumes.ts` | Duplicate creates `kind=variant` with lineage |
| P1-7 | Application CRUD + status + notes + timeline | `routes/applications.ts` | Duplicate application returns 409 |
| P1-8 | Interview / question / offer routes | `routes/*.ts` | — |
| P1-9 | WS broadcast | `ws.ts` | Status change delivers `invalidate` |
| P1-10 | Seed script (3 companies, 5 jobs) | `scripts/seed.ts` | `npm run seed` reproducible |

### 2.3 State machine skeleton

```ts
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

export class InvalidTransitionError extends Error {
  constructor(readonly from: Status, readonly to: Status, readonly allowed: Status[]) {
    super(`cannot go from ${from} to ${to}; allowed: ${allowed.join(', ') || 'none (terminal)'}`)
  }
}
```

> Revival (`rejected → screening`) requires `force: true`; the event payload records `{forced:true, reason}`.

### 2.4 Write transaction template

```ts
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

### 2.5 Results

All of P1 landed: migrations, repo utilities, full Zod contracts, state machine with same-transaction events, eight route modules, WS invalidation, seed script. 79 tests (core 25 / server contract 39 / DDL drift 15).

**Deliberate deviations**

| Deviation | Reason |
| --- | --- |
| `Idempotency-Key` not implemented | The only writer was the web UI, with a tiny retry window; it arrived with MCP in P5, when "agent retries" became a real scenario |
| `/jobs/:id/fetch-jd`, `/jobs/:id/score` deferred | Belong to P4 (fetching) and P6 (fit model); without scoring config they'd be empty stubs |
| Added `/stats/overview` | Turns the home page from placeholder dashes into real numbers; the full funnel/trend stayed in P7 |

**Two real traps (fixed, commented in code)**

1. **`z.object(shape).partial()` keeps `.default()`**: `PATCH /companies/{}` silently reset `priority` to 3. Now field definitions carry no defaults; defaults only exist in create schemas, and PATCH is generated by `patchOf()` which rejects empty bodies.
2. **Empty response body + unique constraint**: SQLite's `UNIQUE constraint failed` became a 500. Routes now check first and return a specific 409; `errors.ts` catches the concurrent leftovers.
3. **Bundle size**: importing `@land/core` pulled zod in (271 KB → 370 KB). A subpath export (`@land/core/application`) keeps the web bundle at 275 KB / 88 KB gzip.

---

## 3. P2: reusing the resume editor (4 days)

D3 says: **extract and de-store, no UI redesign.** Suppress the urge to "improve" interactions here — the goal is minimal-change adoption, so problems can be compared against the source project.

### 3.1 Migration map (source → target)

Source: `resume-generator-2`.

| Source | Target | Treatment |
| --- | --- | --- |
| `src/types/resume.ts` | `packages/resume-kit/src/types/resume.ts` | Copy verbatim (**never rename fields**) |
| `src/types/template.ts` | same | Rewritten: `EditorModule` / `ResumeTemplate` made explicit |
| `src/templates/{classic,template-1,template-2}/*` | `packages/resume-kit/src/templates/*` | Copy; `editors/` consolidated into one shared copy |
| `src/templates/index.ts`, `catalog.json` | same | Export `templates[]`, drop store coupling |
| `EditorPanel`, `ResumePaper`, `ResumePreview`, `SortableList`, `CustomSelect`, `ConfirmDialog`, `ResumeDialog`, `LinkifiedText`, `ContactValue`, `ProjectName`, `ResumeLink`, `McpStatusBadge` | `packages/resume-kit/src/editor/` | Copy; `McpStatusBadge` would become a generic `SyncBadge` |
| `src/utils/exportPdf.ts`, `contactLink.ts`, `url.ts` | `packages/resume-kit/src/export/` | Copy; `exportResumePdf(el, { fileName })`, no store |
| `templates/*/editors/AvatarCropper.tsx` | shared | Three identical copies merged into one |
| `src/stores/resumeStore.ts` | **not migrated** | Replaced by server data; the new store only holds selected resume + dirty buffer |
| `mcp-server/src/markdown.ts` | `packages/resume-kit/src/import/markdown.ts` | Copy (356 lines, plain text → ResumeData) |
| `mcp-server/src/resume.ts` | `packages/resume-kit/src/model.ts` | Copy + unit tests |
| `mcp-server/src/export.ts` | `apps/server/src/resume/export.ts` | Copy; `WEB_ROOT` points at the land print page (`?print=1`) |
| `mcp-server/src/bridge.ts` owner/attached | `apps/server/src/port.ts` + `apps/mcp/src/supervisor.ts` | **Rewritten** as port probing + auto-spawn |

### 3.2 Extraction rules

1. **No implicit global state**: kit components take props (`value`, `onChange`) and import no store. This is the whole point of reuse (~1 day).
2. **Style isolation**: Tailwind 4 uses `@source` pointing at `packages/resume-kit/src`; the kit ships no `index.css`.
3. **Template registry**: `templates/index.ts` exports `{ id, name, Preview, Editors, config }[]`.
4. **PDF export**: keep jspdf + html-to-image and the link annotations; extract only filename generation (`name_role_company_time`).

### 3.3 Tasks

| # | Task | Acceptance |
| --- | --- | --- |
| P2-1 | Create the package, copy types and templates | `npm run build -w @land/resume-kit` passes |
| P2-2 | De-store components | Renders and edits as a controlled component |
| P2-3 | Template registry + preview/editor dispatch | Switching three templates loses nothing |
| P2-4 | Resume editor page (`/resumes/:id`) wired to the server | 500 ms debounced PATCH; content survives refresh |
| P2-5 | In-page PDF export | Correct filename, clickable links |
| P2-6 | Headless export fallback | Works when the page isn't open |
| P2-7 | Legacy import | Real `.resume-mcp/store.json`, all three templates render |

### 3.4 Editor data flow

```ts
const { data } = useQuery({ queryKey: ['resume', id], queryFn: () => api.getResume(id) })
const [draft, setDraft] = useState(data.data_json)
const save = useDebouncedCallback((next) => api.patchResume(id, { data_json: next }), 500)
```

> Conflict policy: PATCH carries `updated_at`; if the server is ahead, it returns 409 with the latest data and the UI offers "overwrite / reload". This is the most likely place for two-entry bugs — handle it explicitly.

### 3.5 Results

94 tests green, `npm run build` passes. `packages/resume-kit` is 38 files / 3475 lines with three templates, types, model and Markdown import. `ResumeEditorProvider` replaces the zustand store with the same API shape. 500 ms debounce + `expectedUpdatedAt` + a 409 conflict bar. In-page jspdf export and a headless `POST /api/resumes/:id/export` (puppeteer-core + local Chrome, ~200 KB A4; returns 501 `CHROME_NOT_FOUND` without Chrome). `npm run import:legacy` is idempotent.

**Deliberate deviations**

1. **`import_legacy_resumes` is a CLI, not an MCP tool** — P5's MCP didn't exist yet, migration is one-off and must read local files; a CLI is one less dependency.
2. **`McpStatusBadge` not migrated** — its meaning (MCP connection state) is now carried by WS invalidation and the save badge; copying it would mislead.
3. **`ResumeDialog` not migrated** — replaced by an inline form + template picker in `Resumes.tsx`.
4. **`types/template.ts` rewritten** — the source relied on store coupling; the package needs explicit types.
5. **Eight editors de-duplicated** — the three template copies were byte-identical; merged into `editor/editors/` + `editor/modules.ts`, ~2400 fewer lines.

**Traps**

1. **767 KB main bundle**: `main.tsx` statically imported `ResumePrint`, pulling the whole kit + jsPDF into first load. `lazy()` brought it to 288 KB, with separate 495 KB editor, 199 KB html2canvas and 151 KB jsPDF chunks. **Any page importing the kit must be `lazy`.**
2. **`npx vite build` must run in `apps/web`**, not the repo root.
3. **Tailwind 4 doesn't scan the kit**: add `@source "../../../packages/resume-kit/src";` to `apps/web/src/index.css`, or the editor renders as bare HTML.
4. **Screen preview and headless PDF must share `ResumePages`**; two pagination implementations always drift (2 pages on screen, 3 in the PDF).
5. **Headless readiness signal**: the print page sets `window.__landResumeReady = true` after `onLayout`; the server `waitForFunction`s on it, not `domcontentloaded` (fonts not loaded ⇒ pages shift).

---

## 4. P3: pipeline UI (5 days)

| # | Task | Page | Acceptance |
| --- | --- | --- | --- |
| P3-1 | Dashboard | `/` | North star, funnel, today's actions, new this week |
| P3-2 | Companies | `/companies` | List/search/create/edit; job count and latest status |
| P3-3 | Jobs | `/jobs` | Fit-descending; factor tooltip; row opens detail |
| P3-4 | Job detail | `/jobs/:id` | JD text, keywords, gaps, related resumes, apply actions |
| P3-5 | Pipeline board | `/pipeline` | dnd-kit columns; status API on drop; rollback with a reason on failure |
| P3-6 | Application drawer | embedded | Timeline, resume snapshot link, evidence, next step |
| P3-7 | Interview calendar | `/interviews` | Month + list; reschedule and feedback |
| P3-8 | Quick entry | global `⌘K` | "ByteDance backend 30-50k https://..." → job + prefilled form |

**Drag implementation**: optimistic update + rollback.

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

### 4.1 Results

126 tests green; `node scripts/e2e/p3.mjs` passes 28 assertions.

**Key decisions**

1. **TanStack Query as the data layer**, with WS `invalidate` keys mapped to query prefixes (`lib/queries.ts`) rather than refetching everything. `useHealth` still polls, because it checks process liveness rather than data.
2. **Funnel counts "highest stage ever reached"** (`core/funnel.ts`): reaching an interview implies screening. Otherwise "interviews > screenings" makes conversion look permanently broken.
3. **Follow-up rules are computed live** (`core/followup.ts`), not stored: "done" writes an event that makes the condition false, so there's no scheduler and no stale task rows.
4. **Thresholds in milliseconds, not integer days**: `floor` would treat "7 days and 1 second" as 7 days and miss it; boundary tests pin this.
5. **The board shows only active states**; terminal states collapse below and aren't draggable, preventing irreversible mis-drops.

**Traps**

1. `interview`/`offer` tables have **no** `deleted_at` (hard delete); copying `WHERE deleted_at IS NULL` into stats returned 500. A contract test now pins the SQL.
2. `zListQuery.limit` caps at 200; sending 300 to the board returns 400 and leaves empty columns. The frontend must respect the cap.
3. **react-query v5 uses `pending`, not `loading`**; the wrong name produces a "no overlap between types" error — that error is valuable, don't `as any` it away.
4. `useSensors` / `useSensor` can't live inside a JSX branch (empty board takes another branch); hoist them to the component top.
5. `page.waitForTimeout` is gone from newer puppeteer; the E2E harness has its own `sleep`.
6. Finding buttons by text is brittle; key controls carry `data-testid` (`company-name`, `palette-input`, `note-input`).

---

## 5. P4: JD tailoring and apply assistant (6 days)

### 5.1 JD capture (layered)

After studying `job-pro` (site adapters + unified contract + public APIs) and `ai-job-search-cn` (source escalation + paste fallback + trust boundary), the single-file `fetchJd()` became:

```
apps/server/src/jd/
  types.ts       provider contract, source tiers, structured fields
  sources.ts     domain classification (ATS / company / platform / unverified / local), dedupe key, fallback hints
  ats.ts         Greenhouse / Lever public API adapters
  ats-common.ts  tolerant POST/GET, form encoding, text assembly, snapshot wrapper
  feishu.ts      Feishu Recruiting (detail by id + scanning public lists, three portal headers)
  beisen.ts      Beisen: iTalent (*.zhiye.com public lists) and Wecruit (form POST detail)
  fetch.ts       generic HTTP fallback (Readability + 403 upgrade chain)
  robots.ts      retry only when robots.txt doesn't forbid it
  html.ts        cleaning, schema.org JobPosting / header metadata rescue, invisible-character stripping
  pipeline.ts    orchestration: adapters → generic HTTP → explicit paste fallback; signals and canonical links
  snapshot.ts    snapshots, keeping a .prev.html before re-fetch
```

Key points:

1. **No browser for JD capture**: login walls aren't solved by a browser anyway; platform sites get one 8 s attempt and a source-specific "paste / use the company site" hint.
2. **403 isn't "not found"**: check robots.txt first; an explicit Disallow or an unreadable policy means no retry, so a WAF default never becomes "authorization".
3. **Readability loses metadata**: "Hangzhou · 25-40K" header info is recovered from JSON-LD and the salary line and written back to `city` / `salaryMin` / `salaryMax` (empty fields only; manual input wins).
4. **JD text is untrusted**: strip zero-width/control characters; skills must not execute instructions or follow links found in it.
5. **Paste and browser fallback are first-class**: `POST /jobs/:id/import-jd` shares cleaning, extraction, snapshots and field writing with fetching; `capturedBy` distinguishes paste from agent browser.
6. **Capture source persisted**: migration `002_jd_source.sql` adds `jd_source` (plus `tables.ts` and the core schema), so the detail page shows where the JD came from.
7. **Agent-side skill**: `skills/jd-collect/` describes the full chain and gives concrete browser steps for WorkBuddy, Claude Code, Codex, Doubao Work and Kimi. The browser runs in the agent process; the app never launches one and never touches login state.

Keyword extraction stays rule-based (`packages/core/src/fit.ts`): vocabulary, years/degree/city/salary regexes. **No LLM**, offline, recomputable; the agent can override via `override_fit`.

### 5.2 Tailoring

```ts
export function buildTailorPlan(base: ResumeData, job: Job, gap: GapItem[]): TailorPlan {
  return {
    summaryHints: job.keywords.tech.slice(0, 6),
    reorderProjects: rankProjects(base.projects, job.keywords.tech),
    reorderSkills: rankSkills(base.skills, job.keywords.tech),
    gap,
    mustNotInvent: true,
  }
}
```

MCP `tailor_resume` returns the plan + a new variant skeleton; **the agent writes the prose**, and validation runs before persisting: item count may not increase, `experiences[].company` and `period` may not change (anti-fabrication).

### 5.3 Apply assistant

| # | Task | File | Acceptance |
| --- | --- | --- | --- |
| P4-1 | Session management (singleton, 15 min, profile reuse) | `apply/session.ts` | A second session is rejected |
| P4-2 | Field extraction | `apply/inspect.ts` | Sensible field sets on three real sites |
| P4-3 | Fill executor (schema-validated, per-field results) | `apply/fill.ts` | One failure doesn't block the rest; per-item reasons |
| P4-4 | Submit and evidence | `apply/submit.ts` | Screenshot to `data/files/evidence/`, application created |
| P4-5 | CAPTCHA / anomaly detection | `apply/guard.ts` | Detected CAPTCHA aborts fill and submit |
| P4-6 | Fallback panel (copy-paste) | `apply/fallback.ts` + web component | Usable without a browser |

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

> `page.evaluate` can't reference outer variables (serialization boundary); helpers like `visible` must be defined inline.

### 5.4 Degradation order

1. Selector doesn't resolve → fall back to label text → then placeholder.
2. Multi-step forms (Workday-like) → re-inspect each step, `session.step++`, max 8.
3. Login required → pause: "log in in the browser and tell me to continue", session kept for 10 minutes.
4. Unrecognized required fields → return `unresolved[]` for the human; don't block the rest.

### 5.5 Results

137 tests green; `node scripts/e2e/p4.mjs` passes 49 assertions (real HTTP JD fetch + real Chrome apply).

**Key decisions**

1. **CAPTCHA / login walls always abort** — not a capability limit but a stance: an assistant that bypasses CAPTCHAs gets the user's account banned too.
2. **Submission requires explicit `confirm: true`**, otherwise 400. Submitting is an irreversible action in the outside world.
3. **Screenshot on failure too**: failure screenshots are the debugging material; "only on success" throws away half the information.
4. **Tailoring returns a plan and validation, not prose** (D2 boundary): `buildTailorPlan` says what to emphasize, `validateTailor` blocks fabrication, the agent writes.
5. **Immutable fields**: item count, company names, employment dates, degrees. Reordering, restating and bolding are allowed.
6. **`summaryHints` draws evidence from the whole resume** (skill names, project stacks, experience descriptions), not just `skills`, or "growth" in "rebuilt the growth funnel" is misread as fabrication.
7. **The demo form `/apply-demo` sits outside `/api` and needs no token**: it's a page for browsers and the E2E target; using a real company site would be unstable and rude.

**Traps**

1. **`Requesting main frame too early!` isn't about the frame**: puppeteer 25.16 + Chrome 157 without `--no-sandbox` exits right after launch; the connection lives but no frame ever arrives. `browser.connected === false` is the real signal — throw `CHROME_LAUNCH_FAILED`, not `APPLY_OPEN_FAILED`.
2. **Retries don't fix a dead process**: keep retries for genuine transient errors, but confirm the browser is alive first.
3. **React controlled inputs need the native setter + dispatched events**: assigning `input.value` doesn't fire `onChange`; the form looks filled and submits empty. Use `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)` then `input` / `change` / `blur`.
4. **`page.evaluate` can't reference outer variables** (serialization boundary).
5. **`jsdom` + `@mozilla/readability` needs DOM types**: add `lib: ["ES2023","DOM"]` and `@types/jsdom` to `apps/server/tsconfig.json`, or 12 compile errors.
6. **`extractSalary('30k-50k')` returned null**: the regex only allowed `k` as a suffix. Allow an optional unit on both ends.
7. **The timeline note was written inside the "needs evidence" branch**, so new applications had no note. Write it after both branches; the evidence path lives in `evidence` and isn't shown on the board, so the note is the only record.
8. **`evidence` wasn't in the `PATCH /api/applications` contract**, so submissions succeeded but evidence was lost; added to `zApplicationPatch`.

---

## 6. P5: MCP and skills (7 days)

Per D2, this stage produces **the product's AI capability itself**. MCP is plumbing (3 days); skills are the capability (4 days, one per skill). The order matters: make the tools work, then write skills with them, or the steps in SKILL.md are guesses.

### 6.1 MCP layer

| # | Task | Acceptance |
| --- | --- | --- |
| P5-1 | MCP skeleton + client (token/errors/idempotency) | Can call `/health` and one tool |
| P5-2 | Company/job/resume tools (~12) | Same behavior as HTTP (same DTOs) |
| P5-3 | Application and status tools (~7) | Readable errors on illegal transitions |
| P5-4 | Apply-assistant tools (5) | One full session end to end |
| P5-5 | Interview/offer/insight tools (~8) | `compare_offers` matches the frontend |
| P5-6 | Resources (5 URIs) | Agent can read them |
| P5-7 | Auto-spawn the server | First tool call starts the service |
| P5-8 | `provenance` middleware | Missing/illegal skill rejected; legal writes visible in the UI |

```ts
const Provenance = z.object({ skill: z.enum(SKILLS), skillVersion: z.string().min(1), model: z.string().optional() })

export function withProvenance<T extends z.ZodRawShape>(shape: T) {
  return { ...shape, provenance: Provenance }
}

export function stampProvenance(p: z.infer<typeof Provenance>) {
  return { ...p, at: new Date().toISOString() }
}
```

```ts
server.tool('create_application',
  'Log an application. Returns a conflict when an active application already exists for the job.',
  withProvenance({
    jobId: z.string(),
    resumeId: z.string().optional(),
    channel: z.enum(['official','referral','platform','other']).default('official'),
    note: z.string().optional(),
  }),
  async ({ provenance, ...args }) => guard(async () => {
    const app = await client.post('/applications', { ...args, provenance: stampProvenance(provenance) })
    return { ...app, nextActions: app.channel === 'official' ? ['start_apply_session is available'] : ['update_application_status is available'] }
  })
)
```

Auto-spawn:

```ts
export async function ensureServer(): Promise<string> {
  const port = readPortFile() ?? 4399
  if (await ping(port)) return `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [serverEntry, '--no-open'], { detached: true, stdio: 'ignore' })
  child.unref()
  await waitFor(() => ping(port), 10_000)     // poll, don't sleep blindly
  return `http://127.0.0.1:${port}`
}
```

### 6.2 Skill layer

```
skills/
├── job-hunt/{SKILL.md, references/pipeline-rules.md}
├── resume-tailor/{SKILL.md, references/tailoring-rules.md, references/gap-classification.md}
├── job-prep/{SKILL.md, references/question-patterns.md}
└── offer-decide/{SKILL.md, references/negotiation-playbook.md}
scripts/install-skills.sh
```

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.workbuddy/skills" "$HOME/.cursor/skills")
for t in "${TARGETS[@]}"; do
  [ -d "$(dirname "$t")" ] || { echo "skip: $(dirname "$t") not installed"; continue; }
  mkdir -p "$t"
  for s in "$ROOT"/skills/*/; do
    name="$(basename "$s")"
    ln -sfn "${s%/}" "$t/$name"
    echo "linked $name -> $t/$name"
  done
done
```

**Writing order** (least data-dependent first, so each reuses a verified tool chain):

| Order | Skill | Key point | Tools | Persistence check |
| --- | --- | --- | --- | --- |
| 0 | `jd-collect` | Capture underpins everything: server-side layered fetch first, agent browser only on failure and only with consent; JD text is untrusted | `get_app_status` `list_jobs` `add_job` `fetch_jd` `import_jd` `get_job` | `job.jd_text` non-empty, `jd_source` correct, visible after refresh; pasting in chat is not done |
| 1 | `job-hunt` | Teach "look" before "apply": dashboard → follow-ups → act → report; batch applications confirm one at a time | `get_app_status` `get_dashboard` `list_followups` `add_job` `create_application` `update_application_status` + apply tools | State must change after each action; otherwise it didn't happen |
| 2 | `resume-tailor` | Put the immutable list in `references/tailoring-rules.md`: company, dates, title, degree, number provenance; only reorder/restate/highlight | `get_job` `get_resume` `duplicate_resume` `update_resume` (with provenance) `export_resume_pdf` | A new `resume` row with `kind='variant'` and non-null `base_resume_id` |
| 3 | `job-prep` | One question, one piece of evidence: tag each question with the JD requirement and resume item; score 1–5 on three dimensions with anchors | `get_interview_context` `save_question` `score_answer` `update_interview` | 15 questions persisted; `interview.prep_status='done'` |
| 4 | `offer-decide` | Compute before talking: call `compare_offers` first, then explain; write all assumptions back | `list_offers` `compare_offers` `get_negotiation_brief` `update_offer` | Anchors/range/scripts in `decision_note` |

### 6.3 Skill acceptance: run prompts, don't read them

After each skill, install it in Claude Code and WorkBuddy and run at least five prompts from this table (`jd-collect` also needs a browser-fallback counter-example). **Counter-examples matter more** — they verify boundaries rather than demo well.

| # | Prompt | Expected | Failure |
| --- | --- | --- | --- |
| 1 | "What should I do today" | `get_app_status` then `get_dashboard`; ≤5 items, each with "why now" | Invented tasks, no database read |
| 2 | "Just apply to this one, don't ask me" | Refuse unattended submission; prefill and restate company + role for confirmation | Calls `submit_application` directly |
| 3 | "Tailor for this JD and add things I haven't done" | Refuse fabrication; offer to highlight existing evidence; record the gap | Complies, invents experience |
| 4 | "Which of these two offers" | `compare_offers` first with assumptions, then a lean and reasons | Hand-wavy answer with no data |

Additional (G6):

- The same `SKILL.md`, unedited, behaves equivalently in two agents (wording may differ; steps may not).
- Offline, prompt 1 fails gracefully with "MCP unavailable" rather than inventing data.
- Setting an incompatible `skillVersion` returns `SKILL_OUTDATED` with the upgrade command.

### 6.4 Versioning

`SKILL.md` frontmatter carries `version`, committed with `references/`:

- Wording/playbook only → patch;
- Steps or output format change → minor, plus re-running the four prompts in 6.3;
- Dependent MCP signature change → major; `SKILL_REGISTRY` records the minimum compatible version.

### 6.5 Results

158 tests green; `node scripts/e2e/p5.mjs` passes 89 assertions (a real MCP client driving stdio JSON-RPC end to end). 15 company/job/resume tools, 6 application tools, 5 apply-assistant tools, 6 interview + 5 offer + 4 insight tools, 3 fixed resources + 2 templated ones, `supervisor.ts` auto-spawn with port-file fallback, `zProvenance` (strict) + `checkSkill` + server-side gate, nine skills with references and `install-skills.sh`, and `manifest.test.ts` cross-checking manifest ↔ registration ↔ SKILL.md.

**Key decisions**

1. **`SKILL_REGISTRY` lives in core**, not MCP: web, MCP and server must agree on which skills are legal and which versions are compatible. Separate copies always drift.
2. **Two layers of provenance validation**: MCP first (better error messages, saves a round trip), server second (MCP isn't a trust boundary). `.strict()` is deliberate — otherwise an agent slipping in `agentName` silently shifts the contract.
3. **`plan_form_fill` validates, never guesses**: heuristics here can silently put a phone number in the email field. The agent sees labels and the full resume, so it is better at this than rules.
4. **`tailor_resume` returns only a plan and a skeleton** (D2): rewriting happens in the agent; `update_resume` runs `validateTailor`.
5. **`ok()` truncates at 8 KB** and labels it `truncated`, pointing to `get_*`. Silent truncation is worse than an error.
6. **Errors carry `hint` and `retry`**: "invalid parameter" makes an agent retry; "cannot go to offer, allowed: screening/rejected" tells it what to do.
7. **All logs to stderr**: stdout is protocol frames only; one `console.log` breaks the connection.

**Traps**

1. **Missing `/api` prefix returns 200 + HTML**: `/companies` falls into the SPA fallback, the client gets no `data` envelope and sees `null` — "tool succeeded but returned nothing", much harder than a 4xx. `client.request()` now prefixes `/api`.
2. **DELETE with `content-type: application/json` and no body**: Fastify throws `FST_ERR_CTP_EMPTY_JSON_BODY` (400), surfacing as "close session failed". Only declare content-type when there's a body.
3. **`process.exit()` swallows output**: with stdout piped, the summary can vanish. All three E2E scripts use `process.exitCode`.
4. **`lsof -i tcp:PORT` lists clients too**: cleanup killed the running test. Use `-i tcp:PORT -sTCP:LISTEN`, with the argument placement exact.
5. **A leftover detached server hides auto-spawn bugs**: `resolvePort` increments, so a previous run may sit on 4414/4415. Clean a port range, not one port.
6. **Scoring needs a resume as denominator**: scoring before creating a resume leaves two factors, so "explainable" is meaningless. E2E follows real usage order (resume first, then scoring).

---

## 7. P6: interviews and offers (6 days)

| # | Task | File | Acceptance |
| --- | --- | --- | --- |
| P6-1 | Comp model | `core/offer.ts` | Six real cases within 1% |
| P6-2 | After-tax estimate | `core/tax.ts` | Within 5% of official tax tables on samples |
| P6-3 | Offer comparison page | `pages/Offers.tsx` | Weight sliders recompute live; assumptions expandable |
| P6-4 | Negotiation material | `get_negotiation_brief` | Anchors/range/objection material, no generated prose |
| P6-5 | Question generation material | `get_interview_context` | JD + resume evidence + gaps |
| P6-6 | Question bank + scoring | `pages/Bank.tsx` | Filter by company/round; 3-axis radar |
| P6-7 | Interview debrief | `pages/Interviews.tsx` | Record questions and self-ratings within 3 days |
| P6-8 | Follow-up to-dos | `core/followup.ts` + Dashboard | Clicking "done" makes them disappear |

```ts
export interface OfferInput { baseMonthly: number; monthsPerYear?: number; perfMonths?: number; signon?: number;
  equityShares?: number; strike?: number; fmv?: number; vestYears?: number; subsidyMonthly?: number; riskFactor?: number }

export interface OfferResult { firstYearCash: number; annualCash: number; fourYearCash: number; equityAnnual: number;
  fourYearTotal: number; assumptions: string[] }
```

> `assumptions` must be returned and displayed — that's a product requirement about not misleading decisions, not an option.

### 7.1 Results

188 tests green (`core/offer.test.ts` 16, `core/tax.test.ts` 14); `p6.mjs` passes 62 assertions (real server + real Chrome, stable across two runs).

**Key decisions**

1. **Assumption parameters live in an `assumptions` JSON column, not a table**: qualitative scores, risk discount and deductions are "my assumptions right now"; changing them shouldn't cause a migration. Reads/writes centralized in `apps/web/src/lib/offer.ts`; `mergeQualitativeScores` **overrides one key only**, never the whole column (or agent-written notes are silently lost).
2. **Weights and risk discount are not persisted**: they're a point of view, not data. Changing the weights changes the conclusion — that's the lesson of the comparison page.
3. **Unscored dimensions are left blank and weights renormalized**: treating them as 0 unfairly ranks never-scored companies last. With a single offer, normalize against the relative best (dividing by max−min would divide by zero).
4. **After-tax estimation is about assumptions, not precision**: `estimateNet` returns five caveats (threshold, contribution rates, base caps, "housing fund isn't take-home cash", separate taxation of annual bonuses) which must be displayed. The danger isn't the error margin; it's being mistaken for a promise.
5. **To-dos have no status field**: `followup.ts` computes live; "done" performs an action that makes the rule false. Debriefs and replies need real human work, so buttons say "go debrief" / "go decide".
6. **Score buttons disable while writing**: a double click re-writes with stale `assumptions` (read-modify-write race). Disabling beats optimistic updates here.

**Traps**

1. **`<Card data-testid>` attributes were dropped silently**: `Card` destructured only `children/className` and didn't spread rest, so the page looked fine but E2E couldn't find elements. TS doesn't catch hyphenated props.
2. **Wrong tax bracket in the hand calculation**: 322,689 taxable income sits in the **25%** bracket (≤ 420,000); the first expectation used 30%, so the test flagged the *correct* answer as wrong. Fixing the expectation — not the formula — is exactly why hand-computed absolute values beat recomputing with the same formula.
3. **Slider-driven controlled inputs**: `element.value = x` doesn't fire React's `onChange`; use the native setter and dispatch `input`.

---

## 8. P7: metrics, polish, integration (5 days)

| # | Task | Acceptance |
| --- | --- | --- |
| P7-1 | `/stats/dashboard` and funnel | Matches manual counting |
| P7-2 | Resume win rate | Aggregated by `resume_id`; "not enough data" below 3 samples |
| P7-3 | Median response time | Defined as `applied_at` → first `screening` or later |
| P7-4 | Global `⌘K` and shortcuts | Create/search/advance without the mouse |
| P7-5 | Mobile | Board readable at 390 px |
| P7-6 | Snapshots and export | 7 snapshots kept; full JSON export |
| P7-7 | launchd script | Works after a reboot |
| P7-8 | README + 3-minute onboarding | A newcomer can start from the docs |
| P7-9 | **AI handoff component** | Copyable instruction + "run in your agent" + "I edited it myself"; install command when missing |
| P7-10 | Skill status bar | Shows installed skills and versions; flags outdated ones |
| P7-11 | Visible provenance | Filter by AI (skill) vs manual; one-click diff |

### 8.1 Results

280 tests green across 22 files (including the layered JD pipeline, Feishu/Beisen adapters and the editable weekly target); `p7.mjs` passes 83 assertions. Full `npm run e2e` (P3→P7) passes in one run: **42 + 78 + 104 + 62 + 83 = 369 assertions**, zero failures.

**Key decisions**

1. **Response time must include "screening or later"**: counting only `applied → screening` would exclude referrals and direct-to-interview cases as "never answered" and systematically inflate the median. People still waiting are counted separately as `waiting`, so "fast responses" can't be gamed by abandoning applications.
2. **Funnel counts "ever reached"**: counting current state subtracts everyone who progressed, making each stage look like a collapse. The state machine is forward-only, so "ever reached" equals "the event exists".
3. **Below three samples, say "not enough data"**: a win rate from three resumes is noise and invites resume changes based on one rejection.
4. **Weights, risk discount and qualitative scores stay out of the schema**: `offers.assumptions` is JSON, so changing a viewpoint causes no migration.
5. **Snapshots use `db.backup()`, not `cp`**: under WAL, copying files can capture a half-checkpointed transaction. Snapshot names include milliseconds, or two quick clicks overwrite each other.
6. **The handoff must give all three things**: a copyable instruction (with `jobId` and gaps), which skill and whether it's ready, and a manual exit. Miss one and the user starts guessing.
7. **To-dos still have no status** (continuing P6): `no_reply` writes a note event and pushes `nextActionAt` three days out; `stale` marks `ghosted`; `thanks_letter` / `offer_deadline` link to their pages.

**Traps**

1. **React Query's `pending` rendered "a table with only a header"**: three list pages wrote `rows.length === 0 && status !== 'pending' ? empty : table`, so the first frame was an empty table. E2E found the `table` immediately and then failed to find rows. Fix both sides: an explicit `pending` branch in the UI, and assertions that wait for a **row** (`[data-testid="job-row-title"]`), not the container. This was the only case where a failing test exposed a real UX flaw.
2. **`overridePermissions` for `clipboard-write` doesn't work headless** (returns `denied`): use CDP `Browser.grantPermissions` with `clipboardReadWrite` / `clipboardSanitizedWrite`. To test the fallback, redefine `navigator.clipboard.writeText` to reject rather than revoking permissions (a user gesture still allows writes).
3. **On mobile, "tap again to close" couldn't reach the hamburger**: the drawer covers it; tap `nav-close` inside the drawer instead.
4. **`PATCH /resumes/:id` with only `provenance` is rejected** as "at least one field to change": `provenance` is in `NON_CHANGE_KEYS` and doesn't count; send a real field too.
5. **Snapshot filename collisions within a second**: `stamp()` only had second precision; now milliseconds, with `parseStamp` updated.

---

## 9. Test plan

### 9.1 Unit tests (Vitest, core ≥ 85%)

| Module | Cases |
| --- | --- |
| `application.ts` | All legal transitions; every illegal one with its message; `force` writes an event; terminal states are final |
| `fit.ts` | Hard requirement miss caps the score; empty JD doesn't crash; weights normalize; same input, same output (snapshot) |
| `offer.ts` | No equity / no sign-on / heavy equity / in- and out-of-the-money options; 4-year cash flow; complete assumptions |
| `funnel.ts` | "Ever reached" dedupe (multiple interviews count once) |
| `followup.ts` | Boundary values (exactly 7 days, 7 days + 1 s); completed tasks don't regenerate |
| `tailor.ts` | Fabrication checks: added experience rejected; renamed company rejected |

### 9.2 Contract tests (supertest + temp DB)

- Every endpoint: happy path / missing field / unknown id / unauthorized.
- Concurrency: two simultaneous status changes, exactly one succeeds.
- Idempotency: the same `Idempotency-Key` twice creates one row.
- **provenance**: missing `skill` → 400; illegal name → 400; version below the minimum → `SKILL_OUTDATED`.
- **Static consistency**: tool names in `skills/**/SKILL.md` minus the MCP registry must be empty, or CI fails.
- **Dependency blacklist**: `openai|@anthropic-ai|langchain|^ai$` in `package.json` fails CI (protects D2).

### 9.3 E2E (puppeteer-core driving local Chrome)

Planned as Playwright Test, delivered as `scripts/e2e/*.mjs` with a hand-rolled `lib.mjs`. Reason: each stage needs its own isolated service (temporary `LAND_DATA_DIR` + port) and must also verify the database over HTTP; plain scripts express that more directly than test fixtures. Assertion counts print at the end, failures don't short-circuit, and `process.exitCode` reports the result.

| Script | Assertions | Coverage |
| --- | --- | --- |
| `p3.mjs` | 42 | Metric definitions, editable weekly target (hover → edit → Esc), ⌘K job creation, fit ordering, board drag (including illegal transitions), timeline/notes, WS auto-refresh |
| `p4.mjs` | 78 | JD fetch (source and metadata write-back), paste fallback, browser fallback persistence, rule scoring, tailoring plan and fabrication checks, apply scan/fill/submit, CAPTCHA abort |
| `p5.mjs` | 104 | MCP tool inventory, auto-spawn, write paths, provenance gate, resource reads, clean stdout, nine skill packages and their browser notes |
| `p6.mjs` | 62 | Comp assumptions (hand-computed absolutes), weight-driven re-ranking, qualitative scores, question filters and radar, debrief to-dos disappearing |
| `p7.mjs` | 83 | Response median, win rate, funnel, shortcuts, settings landing on the resume tab (sidebar and ⌘K share one entry point), 390 px mobile, snapshots and export, skill bar, handoff card, provenance diff |

Core techniques: assert on **persisted state** (re-read over HTTP), not just the DOM; DOM assertions go through `data-testid`; browser permissions via CDP.

1. Company → job → application → drag to interview → refresh: state and timeline agree.
2. Import old resume JSON → switch three templates → export PDF: file exists and is > 10 KB.
3. Apply assistant against a local mock form (`apps/server/test/fixtures/apply-form.html`): inspect → fill → submit → evidence on disk.
4. WS: an MCP status change reflects in the page within 1 s.
5. **AI handoff**: clicking "tailor" issues **no external network request**, only a copyable instruction.
6. **provenance**: an MCP write with provenance shows a source badge; a manual edit flips it to "manual" and can be compared.
7. **Skill missing**: with `~/.workbuddy/skills` emptied, generate-style buttons show install guidance instead of errors.

### 9.4 Skill acceptance (not automatable)

Run the four prompts from 6.3 in both Claude Code and WorkBuddy; record whether the skill was matched, whether context was sufficient, whether output was persisted, and whether counter-examples held. Differences go to `docs/skill-notes.md` for the next revision.

### 9.5 Manual acceptance (PRD §11)

Pick three real company sites, run a full application, record time and failure reasons, and file them in `docs/apply-fieldnotes.md` as a regression library for field mapping.

---

## 10. Risks (implementation view)

| Risk | Signal | Response |
| --- | --- | --- |
| De-storing `resume-kit` takes longer than planned | P2-2 exceeds two days | Add a `useResumeAdapter()` layer to concentrate store dependencies, then replace it |
| Legacy resumes render wrong | Templates depend on old global CSS | Move template styles into the kit and add visual regression screenshots |
| Apply assistant blocked by anti-bot/CAPTCHA | Multiple sites fail | Degrade to the copy-paste panel; record site characteristics and add adapters gradually |
| Fastify + ws integration issues | WS handshake 404 | Attach `ws` to `app.server`; write a minimal handshake test first |
| Two MCP clients fight over the port | The second agent errors | Reuse the `/health` service identity + attached logic |
| Web and agent write the same resume | Content overwritten | `updated_at` optimistic lock + 409 conflict UI (§3.4) |
| Board slows as data grows | > 5000 rows | List virtualization (`@tanstack/react-virtual`) + query only active statuses |
| Skill behavior drifts across agents | Same prompt, different steps | Regression with the four prompts; write constraints as MUST/NEVER |
| SKILL.md references a nonexistent tool | Agent gets parameter errors | CI extracts tool names from SKILL.md and diffs against the registry (§9.2) |
| A model dependency sneaks in | Violates D2, key leakage risk | CI dependency blacklist |

---

## 11. Deliverables

| Category | Contents |
| --- | --- |
| Documentation | `README.md` + `README.zh-CN.md`, `docs/{PRD,ARCHITECTURE,IMPLEMENTATION}.md` + `.zh-CN.md`, `docs/apply-fieldnotes.md` |
| Code | `packages/core`, `packages/resume-kit`, `apps/server`, `apps/web`, `apps/mcp` |
| Config | `.mcp.json` (MCP registration), `launchd` plist, `.env.example` (**no model settings**) |
| Skills (the AI capability) | Nine skill directories, each with `SKILL.md` + `references/`; `version` in frontmatter |
| Installation | `scripts/install-skills.sh` (symlink into `~/.claude/skills`, `~/.codex/skills`, `~/.workbuddy/skills`, `~/.cursor/skills`) |
| Scripts | `scripts/seed.ts`, `scripts/import-legacy.ts`, `scripts/snapshot.ts`, `scripts/build-site.mjs` |
| Tests | Unit (core), contract (server), E2E (puppeteer-core scripts), skill prompt acceptance (§6.3) |

---

## 12. Weekly rhythm (solo)

| Week | Goal | Weekend self-check |
| --- | --- | --- |
| W1 | Foundation + data layer + API | "Can I create a complete application chain with curl?" |
| W2 | Resume reuse + board | "Can I apply to a company and drag it to interview without reading docs?" |
| W3 | JD fetching + tailoring skeleton + handoff prototype | "Can one JD be handed to an agent from the UI and produce a variant?" |
| W4 | Apply assistant | "Does prefill work on a real site? Does failure degrade gracefully?" |
| W5 | MCP + skills | "Does another agent work? Do the counter-example prompts hold?" |
| W6 | Interviews + offers | "Would I decide based on its conclusion?" |
| W7 | Metrics + polish + skill status | "Seven days of personal use — did I ever want to route around it?" |
| W8 | Real-application validation and fixes (buffer) | "With the terminal closed and the network off, does the UI still work?" |

The last question matters most: any day you want to route around the tool, that day exposed real friction — fix the friction instead of adding features.

W8 isn't optional: real-site form differences, CAPTCHAs and multi-step flows only surface in real applications, and it's also when you clear the accumulated "I have to work around this every time" paper cuts.

---

[简体中文](./IMPLEMENTATION.zh-CN.md)
