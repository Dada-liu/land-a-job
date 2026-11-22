# Security policy

**English** · [简体中文](./SECURITY.zh-CN.md)

## Threat model

Land a Job is a **single-user local application**, not a service. There is no account,
no multi-tenancy, no cloud sync and no telemetry. The security boundary is your machine.

- The Fastify service binds **`127.0.0.1` only** (default port 4399). It is never exposed
  to a LAN or the internet. Check your own supervisor config if you changed the port.
- All data lives in `data/land.db` (SQLite, WAL) plus `data/.token` and `data/logs/`.
  `data/` is gitignored. Whoever can read your home directory can read your applications,
  resumes and salary notes — use OS file permissions and disk encryption for that threat.
- The `X-Land-Token` header required on `/api/*` (except `/api/health` and
  `/api/bootstrap`) is **CSRF protection, not authentication**. It exists because a
  random web page cannot attach custom headers cross-origin. It is not a password and
  must not be treated as one.
- The browser extension bridge is allowlisted by extension ID via
  `LAND_EXTENSION_ORIGINS`; it is empty (disabled) by default.
- **Job posting text is untrusted input.** The JD pipeline never executes instructions
  found in a JD, never follows links from it, and never treats it as commands. Content
  fetched from ATS endpoints is stored as data only.

## What the app deliberately does not do

- No outbound model calls, no API keys, no third-party analytics or crash reporting.
- No browser launched by the app for JD collection — the agent-side browser fallback
  belongs to the user's own agent and is explicitly invoked.
- No automatic application submission. Writing an application requires `confirm: true`;
  browser-assisted applying always leaves the final click to the user.
- No fighting anti-bot systems. The JD pipeline checks `robots.txt` before retrying a
  403 and falls back to asking the user to paste the body.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use the repository's
"Report a vulnerability" button under **Security → Advisories** (private vulnerability
reporting) so the details stay private until a fix is available. If that is not enabled
yet, open a Discussion with no technical details and ask the maintainer to enable it.

Include: affected version / commit, reproduction steps, impact (what an attacker can
actually reach given the localhost-only binding), and any suggested fix. Reports about
"the token is stored in plaintext" or "there is no login" are expected behaviour for a
single-user local app — but if you found a way for a remote page or another local user
to cross the boundary, that is a real finding.

## Supported versions

| Version | Supported |
| --- | --- |
| `main` / latest release | ✅ |
| older tags | ❌ — please upgrade |

There is no hosted deployment, so there is no server-side patching schedule; fixes ship
as a new commit/release and you rebuild locally.
