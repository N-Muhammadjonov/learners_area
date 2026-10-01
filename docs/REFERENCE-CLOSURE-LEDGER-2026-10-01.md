# Reference package closure ledger — 2026-10-01

Baseline: `dd23e0a3e1d31bb1ac3e68ca7ca016b063905621`. Package artifacts persisted in
`docs/arena-package/2026-10-01/` (from reference commit `056212c4`; patch SHA256
`6e3fc305…b303e0` verified before `git apply --check` + `git apply`).

Evidence classes: **code** (file in repo) · **test** (local node:test / jsdom / PGlite) ·
**browser** (real browser on Preview) · **deploy** (Vercel commit status).
No item below has browser evidence: the sandbox has no usable browser and cannot reach
the Preview over TLS. Local tests are not live PASS. Nothing here is OWNER-VERIFIED.

| ID | Change + path | Test | Browser | Deploy | Status | Dependency |
|---|---|---|---|---|---|---|
| PATCH 23 files | applied as-is, commit aa94e85 | full suites green (see below); one source-contract test updated because the structure textarea moved into `RetentionMeasurementEditor` (assertion kept, retargeted) | none | aa94e85: Vercel "Deployment has completed" | PARTIAL | browser proof |
| N03 measurement builder | `src/components/admin/RetentionMeasurementEditor.tsx`, `src/lib/retention/measurement-draft.ts` | `tests/reference-package-policy.test.ts`, `tests/ui/reference-package-dom.test.tsx` (form add-claim, raw-mode preservation) | none | aa94e85 | PARTIAL | browser |
| N04 fonts/welcome | `src/lib/ui/fonts.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `globals.css` | `tests/ui/reference-package-dom.test.tsx` (font roles, single CTA, reduced motion) | none | aa94e85 (local `next build` cannot fetch Google Fonts: sandbox TLS block) | PARTIAL | browser |
| N05 utility launcher | `ShellUtilities.tsx` | existing shell UI tests pass | none | aa94e85 | PARTIAL | browser |
| N06 intent prefetch | `src/lib/interaction/intent-prefetch.ts`, `InstantLink.tsx`, `SidebarNav.tsx` | policy test + DOM test (90 ms dispatch, early-leave cancel, admin/explicit-false/non-opted rejected) | none | aa94e85 | PARTIAL | browser |
| N07 early reading finish | `finishReadingEarly` in `src/lib/data/retention-attempts.ts`; `POST /api/retention/attempts/[id]/finish-reading`; "I've finished" button + confirm in `RetentionSession.tsx`; en/uz strings | `tests/retention-finish-reading-db.test.ts` (owned, server-moved deadlines, fixed 3:00 recall, no source/rubric in payload, idempotent repeat never extends, persisted on resume, late submit → timed_out, terminal refused, two concurrent calls → one transition); `tests/ui/retention-session.test.tsx` (confirm, source leaves DOM, single POST, no auto-retry on failure) | none | this commit | PARTIAL | browser; concurrency proven on single-connection PGlite only (real PG = N15) |
| N08 progress trends | `src/lib/progress/trends.ts`, `src/lib/data/progress-trends.ts`, `src/components/progress/ProgressTrends.tsx`, progress page | `tests/progress-trends.test.ts` (Tashkent week edges, null-not-zero weeks, heatmap 12×7, Retention last-5 per level, source guard: user-scoped, bounded, no self-estimates/source/rubric, uncached); DOM render test with tables | none | this commit | PARTIAL | browser; no DB-level test of the SQL against PostgreSQL |
| N09 Google OAuth | — | — | — | — | BLOCKED | provider secrets + owner config |
| N10 Live Partner | — | — | — | — | BLOCKED (not started) | schema/presence design approval; large scope |
| N11 speaking bank | `scripts/speaking-bank-dry-run.mjs` (dry run only, no DB, no --apply) | `tests/speaking-bank-dry-run.test.ts`; receipt `docs/receipts/N11-speaking-bank-dry-run.json`: 880 rows, 880 unique IDs, parts 285/85/510, 0 errors | n/a | n/a | PARTIAL | import needs a migration adding a stable external key to `speaking_prompts` (owner approval) |
| N12 remainings.zip | screenshots in PDF pp. 57–63 (persisted) | — | — | — | RESOLVED INPUT | digests 149493362 / 2721559850 need Vercel log access |
| N13 TED native embed | unchanged | — | — | — | BLOCKED (documented exception) | authorized direct media |
| N14 retention texts | — | — | — | — | BLOCKED | 75 genuine texts |
| N15 PostgreSQL gates | — | 24 skipped (guarded) | — | — | BLOCKED | isolated PostgreSQL |
| N16 reading-105 dry run | script inspected; run stops: `DATABASE_URL is not set`; source zip not present in sandbox or reference branch | — | — | — | BLOCKED | source package + DB URL |
| N17 / N18 browser | — | — | — | — | UNVERIFIED | Safari/isolated browser on Preview |
| N19 present sources | preserved | existing tests pass | — | — | PARTIAL | browser |

## Local validation at this commit
- `npm run typecheck` pass · `npm run lint` pass
- `npm test`: 607 tests, 583 passed, 0 failed, 24 skipped (PostgreSQL gates)
- UI suite: 83/83 pass · `verify-retention-schema`: 11 passed, 0 failed · `git diff --check` clean
- `npm run build`: fails locally only because `next/font/google` cannot reach Google Fonts from the sandbox; Vercel built aa94e85 successfully.
