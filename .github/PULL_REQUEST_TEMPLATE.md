# Pull request

> Full version with examples: [docs/pull-request-template.md](./docs/pull-request-template.md)
> (中文：[docs/pull-request-template.zh-CN.md](./docs/pull-request-template.zh-CN.md)).
> For page-by-page PR records, copy that file to `docs/pr/NNNN-short-title.md`.

## One line

<!-- What changed, in one sentence. -->

## Background / why

<!-- What exists today, where it falls short, what you measured or referenced. -->

## Explicitly not doing

| Not doing | Reason |
| --- | --- |
|  |  |

## What changed

1.
2.
3.

## Blast radius

- [ ] **Database**: new column / migration → sync `tables.ts`, core schema, `user_version` assertion in `schema.test.ts`; state the default for old rows
- [ ] **MCP tools**: added / removed → sync `TOOL_MANIFEST`, `manifest.test.ts`, ARCHITECTURE §7.2, every documented tool count
- [ ] **Skills**: added / removed / version bump → sync `SKILL_REGISTRY`, `SKILL.md` frontmatter, 5 count assertions, README / ARCHITECTURE; say whether `install-skills.sh` must be rerun
- [ ] **API**: new / changed paths → sync the README API table and ARCHITECTURE §6.2
- [ ] **Web**: new page / field → confirm `lazy()` for `resume-kit` imports and `data-testid` for E2E
- [ ] **i18n**: new UI copy added to `apps/web/src/i18n/en/`, `npm run check:i18n` clean
- [ ] **Docs**: **both** `*.md` and `*.zh-CN.md` updated in this same commit
- [ ] **E2E**: assertion count changed → sync the stage table in IMPLEMENTATION §9.3

## Verification

```bash
npm run typecheck
npm test            # ____ cases
npm run build
npm run check:i18n
npm run e2e         # P3 __ + P4 __ + P5 __ + P6 __ + P7 __ = ____ assertions
```

<!-- Paste real numbers; never "should pass". Explain any skipped step. -->

## Hard rules self-check

- [ ] No `openai` / `@anthropic-ai/*` / `langchain` / `ai` in dependencies
- [ ] `.env.example` has no model or API-key settings
- [ ] No `generate_*` MCP tool; write endpoints validate `provenance.skill ∈ SKILL_REGISTRY`
- [ ] Status changes only via `POST /applications/:id/status`
- [ ] PATCH schemas from `patchOf()` with no `.default()`
- [ ] Server still binds `127.0.0.1` only
- [ ] No personal data, real resumes or real company names in this PR

## Risks and rollback

| Risk | Trigger | Mitigation / rollback |
| --- | --- | --- |
|  |  |  |

## Evidence & follow-ups

<!-- Screenshots go in data/ (gitignored); documents carry only the path and conclusion. -->
