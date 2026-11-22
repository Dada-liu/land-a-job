# Changelog

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are the open-source local app on `main`; the Tauri desktop build is released
separately from the `desktop/tauri` branch.

## [Unreleased]

### Added

- BOSS bridge extension: staged capture keyed by `encryptJobId`, real CDP wheel paging,
  randomized intervals, automatic greeting send with conversation-header verification.
- Salary captured from listing cards (`12-18K` → 12000/18000), with `salary_source`
  (listing / jd / manual) and `salary_months` (`·13薪` → 13). Daily rates and
  "negotiable" stay `NULL` rather than being guessed.
- Resume tailoring writes a gap note (variant id, hit rate, missing evidence by severity)
  into the application timeline.
- Public job library and favourites, served through a server-side proxy so the upstream
  token never reaches the browser.
- `open-boss-browser`, the 10th registered skill.

### Changed

- Pipeline board drops the `lead` column; cards jump straight to the job or resume and
  timeline notes keep their line breaks.
- i18n dictionary grew to 480 keys; UI copy is fully bilingual.
- 322 unit tests and the staged P3–P7 end-to-end suite.

### Fixed

- "Continue chatting" (not any button containing 沟通) marks a company as contacted;
  grey disabled buttons are a rendering transient, not a contacted state.
- Greeting send no longer hits a hidden confirm button; company-name verification now
  actually runs.
- Attach failures are reported separately instead of breaking the auto tick.

## [v0.3.0] — 2026-11-16

- Tauri desktop build with an embedded server sidecar, released on `desktop/tauri`
  with a per-device activation gate. **The `main` branch app needs no activation.**

## [v0.2.2] — 2026-11-16

- Desktop packaging fixes; desktop build artifacts kept off `main`.

## [v0.2.1] — 2026-11-16

- Skill version and docs sync (JD batch search 1.3.0, classic resume template).

## [v0.2.0] — 2026-11-15

- First public release: bilingual README and website, screenshots and demo GIF,
  English UI, `llms.txt` and the agent install guide, AGPL-3.0.
- Full P1–P7 pipeline with MCP tools, skills, metrics and the application state machine.

[Unreleased]: https://github.com/Dada-liu/land-a-job/compare/v0.3.0...HEAD
[v0.3.0]: https://github.com/Dada-liu/land-a-job/releases/tag/v0.3.0
[v0.2.2]: https://github.com/Dada-liu/land-a-job/releases/tag/v0.2.2
[v0.2.1]: https://github.com/Dada-liu/land-a-job/releases/tag/v0.2.1
[v0.2.0]: https://github.com/Dada-liu/land-a-job/releases/tag/v0.2.0
