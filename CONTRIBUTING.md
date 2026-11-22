# Contributing

**English** · [简体中文](./CONTRIBUTING.zh-CN.md)

Thanks for looking. This is a single-user local app, so contributions that keep it
boring and auditable are more welcome than new features.

## Setup

```bash
npm install && npm run build && npm run dev   # 5173 (HMR) + 4399 (API)
npm run typecheck && npm test && npm run check:i18n
```

Node >= 24, npm >= 10. The server creates `data/` (SQLite, token, logs) on first start.
See [README.md](./README.md) for the full command reference and
[ARCHITECTURE.md](./docs/ARCHITECTURE.md) before touching the data model.

## The rules that matter

These are enforced by tests and by the MCP write path — a PR that breaks them will
fail even if it looks reasonable:

- **No LLM SDK in the app.** Do not add `openai`, `@anthropic-ai/*`, `langchain` or
  `ai` to any dependency list. `.env.example` carries no model or API-key settings.
  AI runs as skills inside the user's own agent; the app only reads and writes local data.
- **MCP writes need provenance.** There is no `generate_*` tool. AI-written rows carry
  `provenance: {skill, skillVersion}`; the skill must exist in `SKILL_REGISTRY` and an
  outdated version is rejected with `SKILL_OUTDATED`.
- **Status changes go through `POST /applications/:id/status`** — `PATCH` refuses
  `status`, otherwise events are skipped and the timeline and funnel disagree.
- **New database columns** must be synced to `apps/server/src/db/tables.ts`, the core
  schema and the `user_version` assertion in `schema.test.ts`. This test fails on purpose.
- **PATCH schemas** come from `patchOf()` and carry no `.default()`.
- **Adding or removing a skill** means updating `SKILL_REGISTRY`, each `SKILL.md`
  frontmatter, `apps/mcp/test/manifest.test.ts`, `apps/server/test/api.test.ts`,
  `scripts/e2e/p5.mjs`, `scripts/e2e/p7.mjs`, and every documented skill count in
  README / ARCHITECTURE. Keep the §0 preamble identical across skills.
- **The server binds `127.0.0.1` only.** Never expose it.
- **UI copy** uses Chinese text as the i18n key. Add the English value under
  `apps/web/src/i18n/en/` and run `npm run check:i18n` (duplicate keys, missing `t()`,
  CJK left in English values). New form controls come from `ui.tsx`; pages importing
  `@land/resume-kit` must be `lazy()`-loaded.
- **Docs are bilingual.** Every `*.md` change needs its `*.zh-CN.md` counterpart in the
  same commit. `skills/**` is deliberately not translated.

## Good first contributions

- A new ATS source under `apps/server/src/jd/sources/` (with a fixture and a canonical-URL test)
- Filling an English/Chinese i18n gap
- A skill improvement in `skills/` — keep the §0 preamble identical across skills
- A real troubleshooting case for the docs

For anything that changes the data model, the MCP contract or the state machine, open
an issue or a Discussion **first**. Saying what you are explicitly *not* doing saves
half the review round-trips; there's a [PR template](./docs/pull-request-template.md)
with that structure.

## Verification before you open a PR

```bash
npm run typecheck
npm test
npm run build
npm run check:i18n
npm run e2e          # real server + real Chrome, staged P3 → P7
```

Paste real output numbers, never "should pass". If you skipped a step, say why.
Web changes want a screenshot; collection changes want the source label and body length.

By contributing you agree that your work is licensed under AGPL-3.0-or-later.
Security issues: see [SECURITY.md](./SECURITY.md) — please do not open a public issue.
