# Reference package closure ledger — 2026-10-01 (rewritten; current state)

Branch `arena/01a0f1a0-learners-area`. Integrated baseline `0f4a6ea` (ARENA-VERIFIED, not owner-verified).
This table REPLACES the earlier rows (which still said N09/N10/N14/N16 "not started"/"no source").
Sections below the table are historical appendices; where they disagree, this table wins.

Columns are separate evidence classes — one never stands in for another:
**Code** (in repo, commit) · **Local test** (node:test / jsdom / PGlite) · **QA DB** (real PostgreSQL 16,
isolated `learners_qa2` on localhost, never Preview/Production) · **Browser** (real browser on the Preview) ·
**Deploy** (Vercel commit status). The sandbox has no usable browser, so no row has browser evidence.
Nothing here is OWNER-VERIFIED and no completion percentage is claimed.

| ID | Code | Local test | QA DB | Browser | Deploy | Status | Remaining dependency |
|---|---|---|---|---|---|---|---|
| Migrations 0025–0027 → Preview QA DB | `scripts/preview-qa-migrate.mjs` (fingerprint: host/port/db/role/project ref + post-connect server identity; schema-scoped verify; non-zero exit on any verify/after-plan failure) — 53151ba, 872952a | migrator tests incl. same-pooler/different-project mismatch | 9-step simulation on `learners_preview_sim` (receipts in `docs/receipts/preview-qa-migrate-LOCAL-SIMULATION/`) | — | — | **BLOCKED — NOT RUN on Preview** | Preview DB URL is only in Vercel env; sandbox has no Vercel token. Owner runs the documented `--fingerprint` → `--plan` → `--apply` procedure |
| N07 early finish | one POST + one authoritative GET; 0db001e | matrix: GET failure, existing attempt, empty, refresh/back/bfcache, leave — no auto-write; privacy after recall | `qa2-postgres-n07-n08` pass | — | success | CODE+TEST DONE · browser UNVERIFIED | Safari/isolated browser on Preview |
| N09 Google sign-in | OIDC code+PKCE+state+nonce; no e-mail merge; d475d74 (0026) + d9d684c (case-insensitive link check, concurrent-callback safety) | `google-auth` 8/8 | `qa2-google-race` 8 parallel callbacks → 1 pending account | — | d9d684c success | CODE+TEST DONE · **live sign-in UNVERIFIED** (no PASS) | owner sets Google client id/secret in Vercel and signs in once with a real account |
| N10 Live Partner | client, WebRTC engine, `services/live-signal`, TURN creds, readiness gate; 0efacef, a7bd16b | engine + signalling + UI tests (mock/socket — not a microphone test) | 0027 schema on QA2 | — | success | CODE DONE · **audio UNVERIFIED** | signalling host with TLS + WSS origin allowlist, TURN provider (paid), two-browser real-mic test |
| N11 speaking bank | importer with `--receipt` (sha256, db name, counts, draft/notDraft); never auto-publishes; be6fcbf | receipt unit test | 880 inserted (run1), 0 inserted/880 skipped (run2); drafts invisible until published | — | success | QA DB DONE · Preview NOT imported | owner content approval + Preview import after migrations |
| N13 TED/licensed media | direct-media player for licensed files only; YouTube never shown as direct media; CSP media origins | player tests | — | — | success | CODE DONE · Safari UNVERIFIED | licensed media file + Safari check |
| N14 retention texts | 75 AI drafts, evaluator v4 (no regrade of history) — d5efd82 | canonical recall 100 on 75/75; 1444 wrong/missing-value mutations all enforced; source text 100 on 67/75, 90 on 8 (sentence-scope split) | not imported | — | success | DRAFTS — **not human-approved, not published** | owner/teacher review; known limit: exact rubric-term salad scores 100 on 65/75 |
| N16 reading-105 | importer unchanged; real source `learnersarea_reading_105.zip` (branch assets/learners-area-brand, sha256 d736cd4b…) | dry run without DB: 105 passages, 2591 senses → 2589 keys | — | — | — | **BLOCKED (content)** | one collision: "literacy" (noun), senses 8244161a… vs 0de2a7de…; owner makes the definitions identical or rewords one. Receipt `docs/receipts/N16-reading-105-dry-run.md` |
| N12 error digests 2721559850 / 149493362 | — | — | — | — | — | **BLOCKED** | PDF pp. 60/62 show only the error page (no route, no SHA); cause needs Vercel runtime logs for that deployment — not guessed |
| PDF visual evidence | all 63 pages rendered with pymupdf and viewed (7 contact sheets) | — | — | — | — | VIEWED | screenshots are reference/historical, not acceptance |
| Performance (3 nav/back rounds) | existing instant-navigation code | DOM tests | — | — | — | **UNVERIFIED** — no ms claims | Safari/isolated browser run with recorded evidence |
| PostgreSQL gates | — | without env: 30 skipped (a skip is not a PASS) | with QA2 env: 674/674, 0 skipped (one earlier run had 1 cross-file flake in `owner-invariant` from shared DB; passed alone and on rerun) | — | — | DONE on isolated DB | — |

## Final local validation (HEAD after d9d684c; ledger-only change on top)
- `npm run typecheck` 0 · `npm run lint` 0 · `git diff --check` clean · `verify-retention-schema` 11/0
- `npm test`: 674 tests, 644 pass, 0 fail, 30 skipped (QA2 gates) · with QA2 env: 674/674, 0 skipped
- UI suite: 96/96 · `npm run build`: success

## N10 — Speaking / Live Partner (2026-10-01)

| gate | evidence | status |
|---|---|---|
| model + migration | `src/db/schema.ts` live_partner_* tables; `drizzle/0027_live_partner.sql` (additive). Applied to isolated learners_qa2 only | PASS (local) |
| state machine | `src/lib/data/live-partner.ts`: per-user row locks in uuid order; explicit Go Online (rules v1 + active + gender); 45 s heartbeat freshness; 30 s invite TTL; 60 s reconnect grace; practice-start → OFFLINE, refused (409) during a call | PASS (local) |
| races (PGlite, logic only) | `tests/live-partner-db.test.ts` 9/9: mutual invite, second inviter, duplicate accept → same room, expiry, decline, blocking both directions, vanished participant, no media columns | PASS (not concurrency proof) |
| races (real PostgreSQL 18.4, separate pool connections) | `tests/qa2-live-partner.test.ts` 1/1: 6 concurrent invites → 1 wins; simultaneous A↔B → 1 wins; 5 concurrent accepts → 1 session | PASS (local isolated DB) |
| canonical bank | Practice and Live Partner read the same `speaking_prompts` rows, filtered by `available_in`; QA2: 880/880 imported rows carry both channels (still draft, unpublished) | PASS (local) |
| API | `src/app/api/live-partner/route.ts`: GET state+online (private, no-store); POST actions; the user id always comes from the session, never the request body; no auto-retry on the client | code + typecheck |
| signalling token | `src/lib/live-partner/signal-token.ts`: HS256, aud `learners-area-live-signal`, 120 s lifetime, issued only to the session's participants | PASS (tests) |
| UI | `/speaking/live-partner`: YOU (system avatar, S score or "S —"), QUESTIONS (search + Part 1/2/3 accordions), ONLINE USERS; rules modal → local mic level meter (no upload) → Go Online | build PASS; browser UNVERIFIED |
| realtime audio (WebRTC media) | needs an external signalling service (`LIVE_PARTNER_SIGNAL_URL` wss + `LIVE_PARTNER_SIGNAL_SECRET`) and TURN relay credentials. Not provisioned; the UI says audio is not configured and offers End call. No fake call | BLOCKED — external dependency |

Changed test: `tests/video-standalone.test.ts` W11 — old: `journal.entries.at(-1).tag === "0024_video_lessons_standalone"` and `idx === 24`; new: the entry with that tag has `idx === 24` and the journal indexes are contiguous 0..n. This was failing since 0025 was added.


## Independent owner QA supersession — 2026-10-01

Do not interpret the earlier Arena rows as end-to-end completion. See [OWNER-INDEPENDENT-QA-2026-10-01.md](OWNER-INDEPENDENT-QA-2026-10-01.md). Functional commits 12eaa93 and 56cda51 fix independently reproduced defects. Final automated rounds: 656 passed / 30 skipped and 98 UI passed, twice. Preview login, 15 settled navigation transitions, Retention recovery, Progress Dashboard destination, Retention bank/builder and TED notes have bounded browser evidence. Speaking Practice still failed; the QA journal has a missing 0021 entry and backups are unavailable on the observed Free plan. Broader Listening/Progress/source-scoping code work, live service activation, real PostgreSQL gates, all-device acceptance and human content review remain open. No complete status or invented completion percentage is assigned.
