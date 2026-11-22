# Changelog

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Every release is the open-source local app: no accounts, no cloud service, no model calls.

## [v0.4.0] — 2026-11-22

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
- Bilingual CONTRIBUTING / SECURITY / CHANGELOG, issue forms, PR template and Discussions.

### Changed

- Pipeline board drops the `lead` column; cards jump straight to the job or resume and
  timeline notes keep their line breaks.
- README (EN/中文) and website rewritten around the zero-LLM-call design.
- i18n dictionary grew to 480 keys; UI copy is fully bilingual.
- 322 unit tests and the staged P3–P7 end-to-end suite.

### Fixed

- "Continue chatting" (not any button containing 沟通) marks a company as contacted;
  grey disabled buttons are a rendering transient, not a contacted state.
- Greeting send no longer hits a hidden confirm button; company-name verification now
  actually runs.
- Attach failures are reported separately instead of breaking the auto tick.

[v0.4.0]: https://github.com/Dada-liu/land-a-job/releases/tag/v0.4.0
