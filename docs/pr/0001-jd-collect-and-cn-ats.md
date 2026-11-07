# PR 0001 · Layered JD collection, a collection skill, and Feishu / Beisen adapters

**English** · [简体中文](./0001-jd-collect-and-cn-ats.zh-CN.md)

| Item | Value |
| --- | --- |
| Status | Shipped |
| Date | 2026-11-05 |
| Related | `PRD.md` FR-2.1 / FR-7.3 · `ARCHITECTURE.md` §6.2.1 / §9.4 · `IMPLEMENTATION.md` §5.1 |

## One line

Give JDs both an official server-side collection path and an agent browser fallback, and persist how each JD was captured so the Web UI can show it.

## Background / why

The original implementation was a single file, `apps/server/src/jd/fetch.ts`: plain HTTP + Readability, and on failure the user was told to paste the body by hand. The real problem is that Chinese job boards are heavily JS-rendered and anti-bot protected, so collection almost always degraded into manual pasting. There were no site-specific adapters, no batch or import entry point, no record of how a JD was captured, and creating a job from `⌘K` only stored the link without triggering collection.

We referenced two projects' measured implementations instead of reinventing them:

- **job-pro** (`@ha7ch/job-pro`): 50 Chinese companies' official recruiting channels grouped into 7 ATS families, hitting anonymous public APIs directly; one `PositionSummary` contract; everything parsed with rules.
- **ai-job-search-cn**: an escalation ladder of sources, no fighting anti-bot on platform sites, paste as fallback, third-party text treated as untrusted data.

## Explicitly not doing

| Not doing | Reason |
| --- | --- |
| Starting a browser inside the app to fetch JDs | Browsers belong to the agent; the app never touches login state and doesn't pull in a Chromium dependency |
| Calling any LLM to parse JDs | D2: zero models, zero keys in the app; extraction stays word lists + regex |
| Fighting BOSS / Lagou / Liepin anti-bot | On failure, guide the user to "paste / switch to the company's own site"; never construct high-frequency requests |
| Storing cookies or sessions for JD collection | Login state exists only in the apply assistant's persistent profile, and the user logs in manually |
| Adding structured JD tables or a version-history table | Only fill existing empty fields; re-collection keeps a `.prev.html` snapshot — keeps the blast radius small |

## What changed

1. **The server went from one file to a layered pipeline** (`apps/server/src/jd/`, now 12 files):
   `sources` (source classification / normalized dedupe key / per-source fallback hints) → `ats` (adapter registry) → `fetch` (generic HTTP fallback) → `robots` (403 retry gate) → `pipeline` (orchestration) → `snapshot` (persist to disk) → `html` (cleanup + metadata recovery) → `types` / `ats-common` / `index`.
   - A 403 retry must check `robots.txt` first: if the policy can't be read or says `Disallow`, never retry.
   - Measurement showed Readability drops metadata blocks like "Hangzhou · 25-40K" entirely, so we added rule-based recovery from JSON-LD `JobPosting` and the page header info row; otherwise city and salary extraction returns nothing.
   - JD bodies are sanitized as untrusted data: zero-width and control characters are stripped.
2. **ATS adapters cover five companies**:
   - Greenhouse / Lever: anonymous public JSON endpoints, uniform structured fields.
   - **Feishu Recruiting**: `GET /api/v1/job/posts/<id>?portal_type=3`; when a tenant lacks that endpoint, fall back to scanning pages via `POST /api/v1/search/job/posts` by id; `portal-channel` / `website-path` are tried in order "standard → empty portal → omit header"; body = `description` + `requirement`. Domains measured from code and included: `*.jobs.feishu.cn`, `*.jobs.f.mioffice.cn`, `careers.iqiyi.com`, `hr.sensetime.com`.
   - **Beisen**: two products with completely different endpoints. iTalent (`*.zhiye.com`, `hr-campus.vivo.com`) pages through `GetJobAdPageList` to find `jobAdId`, body = `Duty` + `Require`; Wecruit (`wecruit.hotjob.cn`, SPA hash carries `postId`) POSTs a form to `listPositionDetail`, body = `workContent` + `serviceCondition`. The code contains no `*.italent.cn` / `*.wecruit.com` — nothing was included on a guess.
   - Any adapter failure degrades to generic HTTP automatically.
3. **New fifth skill, `jd-collect`**: `SKILL.md` + `references/browser-fallback.md` + `references/ats-support.md`. The flow is `get_app_status` → `list_jobs` for dedupe → `add_job` / `fetch_jd` → **only on failure and with user consent** use the agent's own browser to read the full text → `import_jd` to persist → `get_job` to verify. WorkBuddy uses `workbuddy-browser-use`; Kimi has executable steps written against the locally installed `kimi-webbridge` (local bridge + `navigate` / `find_tab` / `snapshot` / `evaluate` / `close_tab`). Boundaries are explicit: no bypassing CAPTCHAs, only visit links the user gave, and nothing counts as done until it's persisted.
4. **Captured-by is persisted and visible in the Web UI**: new migration `002_jd_source.sql` adds `jd_source` to `job` (`greenhouse` / `lever` / `feishu` / `beisen` / `http` / `browser` / `paste`); the detail page shows source, body length, extraction signals and warnings, and the list page gets a source badge; `import_jd` gains `capturedBy`. Collection and paste share `writeJd()`: sanitize, extract keywords/city/salary, snapshot, fill only empty fields (manual entry wins).
5. **Routes and MCP**: added `POST /jobs/:id/import-jd` and `GET /jobs?jdUrl=` normalized dedupe; added the `fetch_jd` / `import_jd` tools (41 → 43); `add_job` returns `duplicate: true` on a duplicate link; added `JD_*` error recovery hints; creating a job from `⌘K` with a link now collects and scores automatically, matching `add_job`.
6. **Fixed a dedupe bug**: `canonicalJdUrl()` used to strip the hash unconditionally, which merged different positions on the same Beisen Wecruit board into one; it now keeps SPA hashes that carry a position id and still strips other anchors.

## Blast radius

- [x] **Database**: migration `002_jd_source.sql` → `user_version = 2`; synced `MIGRATIONS` in `migrate.ts`, `tables.ts`, `packages/core/src/schema/job.ts`, and the version assertion in `schema.test.ts`. Old databases upgrade automatically; historical rows have `jd_source = NULL` and the Web UI shows "source not recorded".
- [x] **MCP tools**: `TOOL_MANIFEST` 41 → 43; `manifest.test.ts` and `ARCHITECTURE.md` §7.2 synced.
- [x] **Skills**: `SKILL_REGISTRY` 4 → 5; synced the hints in `apps/mcp/src/errors.ts`, the workflow instructions in `server.ts`, and the documented count and list. Ran `bash scripts/install-skills.sh` to symlink into `~/.claude/skills` and `~/.workbuddy/skills` — **requires an agent restart**.
- [x] **API**: added the two new paths to the "Local API" table in `README.md` and §6.2 in `ARCHITECTURE.md`.
- [x] **Web**: detail page / list page / `⌘K` changes; new `job-jd-source` test badge.
- [x] **E2E**: `p4.mjs` gained assertions for the browser source, paste fallback and metadata write-back; the skill-count assertions in `p5.mjs` / `p7.mjs` went from 4 to 5.
- [x] **Docs**: `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION.md`, `README.md` all synced.
- [x] **Other**: `vitest.config.ts` `testTimeout` 20s → 45s (under parallel workers the first dynamic `import` in jsdom would time out and be misreported as a failure).

## Verification

```bash
npm test            # 244 cases, all green
npm run typecheck   # passed
npm run build       # passed
npm run e2e         # P3 28 + P4 64 + P5 92 + P6 62 + P7 60 = 306 assertions, all green
```

Hard rules rechecked: dependencies contain no LLM SDK, no `generate_*` tools, `.env.example` has no model settings, the static check on tool names in `SKILL.md` passes; 43 tools / 5 skills agree across all three places.

## Hard rules self-check

- [x] No `openai` / `@anthropic-ai/*` / `langchain` / `ai` in dependencies
- [x] `.env.example` has no model or API-key settings
- [x] MCP tool names contain no `generate_*`
- [x] Write endpoints validate `provenance.skill ∈ SKILL_REGISTRY`
- [x] Every tool name referenced in `SKILL.md` exists in the MCP registry
- [x] New database columns are synced to `tables.ts`
- [x] Status changes only via `POST /applications/:id/status` (state machine untouched here)
- [x] Pages importing `@land/resume-kit` still go through `lazy()` (not touched here)
- [x] The server still binds `127.0.0.1` only

## Risks and rollback

| Risk | Trigger | Mitigation / rollback |
| --- | --- | --- |
| Third-party endpoints change | Feishu / Beisen alter the public API or add a WAF | Endpoint shapes come from job-pro's probing records and must be re-probed; adapter failure degrades to generic HTTP, then to paste — no bad data is written |
| Old database upgrade | First start with an existing `land.db` | `002` is an `ADD COLUMN`; old code ignores the new column and still runs; historical rows show "source not recorded", no backfill needed |
| A stale skill version is installed | Install script not rerun / agent not restarted | The skill status bar at the top of the Web UI turns red; `get_app_status` reports the version and write endpoints reject with `SKILL_OUTDATED` plus the upgrade command |
| Browser fallback misused as a crawler | The agent browses in bulk on its own | The skill hardcodes "get user consent first, only visit links the user gave, never bypass CAPTCHAs"; the browser never runs inside the app process |
| Snapshot overwritten | Re-collecting the same job | `snapshot.ts` keeps a `.prev.html` before re-collecting, so the previous body stays readable |

Rollback order: remove the `jd-collect` symlink → revert `SKILL_REGISTRY` and tool registration → revert the `jd/` directory and routes (the database column can stay; it doesn't affect reads or writes). No destructive data rewrite.

## Evidence

- The Web job detail page shows the capture-source label, body length, and extracted experience / education / city / salary; the list page shows the `job-jd-source` badge.
- `data/files/jd/{jobId}.html` is the body snapshot; re-collection produces `.prev.html` (runtime data, already in `.gitignore`).
- E2E `p4.mjs` covers "official source / paste fallback / browser source / metadata write-back" against a local fixture server, with no external network.

## Follow-ups

- [ ] Keep adding adapters: Moka (AES envelope), Workday, company-specific APIs (Tencent / ByteDance / Alibaba bespoke endpoints).
- [ ] Periodically re-verify the Feishu / Beisen endpoints with a probing script and update `references/ats-support.md` after site changes.
- [ ] Scheduled JD refresh and closed-position detection (collection is currently one-shot on demand, with no version-history table).
