# Learners Area RIWI Sites QA

Owner-private Sites gateway for the existing Vanilla JS / FastAPI application.
It is **not a working full RIWI deployment yet**. No `BACKEND_ACCESS_TOKEN` has
been configured: pages return a clear 503 status, APIs return a JSON error, and
`/__riwi/status` records the blocked state. No mock records or AI answers.

The pinned backend is Vercel preview `dpl_5mxz6HNc7vtgZjRrayRjJGnx8LiF`, commit
`81a389f4506fadc5d8ed7066ec32c1f859059157`; main baseline is
`d62a2302a8dee9e72ccd6e7812a5ca7c7e4f50ec`. The old arena branch was retained as
`checkpoint/arena-next-before-riwi-sites-20261102`.

Automatic approval review rejected the existing QA database migration (13
journal entries + 2 platform scripts) and a seven-day preview access link.
Neither action ran. Preview protection, QA data and production are preserved.

Publication is also blocked: the supported Sites source helper exited 128
because `git.chatgpt-team.site` could not resolve. The existing Site is retained
as `appgprj_6ae812aa05a48191a4cca62debe8de65` (owner only, version 0, no live URL).
Do not create another Site or call its expected origin a published deployment.
Resume the supported source helper with a fresh credential after connectivity
is restored; credentials must travel through hidden stdin only.

Before activation: approve an exact QA backup/recovery and migration plan;
approve preview-scoped server access stored only as a Site secret; update the
pinned backend to the reviewed fix commit; verify login, role scopes, RIWI
evaluation/persistence and browser behavior. Sites identity grants no native
Learners Area membership. Browser QA has not run in this environment.

Checks: `node --test tests/gateway.test.mjs`, `bash scripts/build.sh`,
`node scripts/validate-artifact.mjs`. These are gateway checks, not live RIWI QA.
