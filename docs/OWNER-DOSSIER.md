# Learners Area — closure dossier

Prepared for the owner. Every result below carries exactly one status label from the mandated set.
No completion percentages are used anywhere in this document, deliberately: a percentage would
imply the remaining work is known and small, and the honest position is that three requirements are
blocked on assets only the owner can supply and one is blocked on an owner decision.

Status labels used: `IMPLEMENTED_AND_VERIFIED` · `IMPLEMENTED_NOT_RUNTIME_VERIFIED` ·
`REPRODUCED_DEFECT` · `FIXTURE_DEFECT` · `ENVIRONMENT_BLOCKED` · `OWNER_ASSET_REQUIRED` ·
`EXTERNAL_ACCEPTANCE_REQUIRED` · `OWNER_DECISION_REQUIRED` · `NOT_YET_EXECUTED`.

## 1. Repository identity

| item | value |
| --- | --- |
| Branch | `arena/1052c0fd-learners-area` |
| Starting SHA (session base) | `31e10bd91667c6f8940e16834d7f7bc3e011b1f5` |
| Final SHA (local HEAD) | `9fca98e1e6ec5481d46e5e9bb4887fd54ee7b7ee` |
| Remote SHA (`origin`) | `9fca98e1e6ec5481d46e5e9bb4887fd54ee7b7ee` |
| Remote SHA (`git ls-remote`, independent of the local tracking ref) | `9fca98e1e6ec5481d46e5e9bb4887fd54ee7b7ee` |
| Tree SHA | `4a590237041a4276fa0fa5b792afa8a10b2a2fce` |
| Local == remote | yes, verified by `git rev-parse` on both after every push |
| Worktree | clean — 0 modified, 0 untracked |
| Commits this session | 309 on top of the base |
| Migrations on disk | 53 (`drizzle/meta/_journal.json`), tip `drizzle/0052` |
| Migrations applied to QA database | 53 of 53, verified by counting `drizzle.__drizzle_migrations` |
| Build identity of the last verified build | `D-0uxyL3rXTNPEboduCe9` |
| Whole-database row total after every probe and suite run | 128 — the post-seed baseline, measured by counting all 119 base tables |

The identity figures above are as of `9fca98e`, the last commit containing production or test code.
Committing this revision of the dossier necessarily advances HEAD and the tree by one further commit
whose only changed file is `docs/OWNER-DOSSIER.md` — a document cannot contain its own SHA. No source
file, migration, test or probe differs between `9fca98e` and the commit carrying this sentence, which
is verifiable with `git diff --stat 9fca98e..HEAD`. Every measurement in section 9 was taken on the
`9fca98e` tree and remains valid on it.
| Mutant build used to kill the reading-seal mutation test | `k_fNBk6tzzGtgxjjcbS23` (source restored byte-exact afterwards) |

Commits added since the previous revision of this dossier, each pushed normally and verified with
`git rev-parse` on both local and remote:

| SHA | package |
| --- | --- |
| `eb0180c` | §4 real-browser Academic Reading journey, PostgreSQL evidence per step |
| `8860d08` | §11 mutation test that kills the reading attempt seal |
| `f6c9b60` | §5 Listening journey plus the `Score: null/null` fix (EN and UZ) |
| `492da8b` | §15 verifier-quality fix: the listening reachability survey could report a false PASS |
| `0129a5b` | §7 security fix: a teacher could rewrite any other teacher's live class, plus the attendance N+1 |
| `f22574b` | §10 measurement: both learner-facing speaking prompt reads are unbounded at 10 000 prompts |

Commits added by the revision dated 2026-10-11, which supersedes the figures in sections 2 and 3
below wherever they disagree. Packages A, B, C, E and F closed between `f22574b` and `54fc194`
(`c7a994b`, `14d832d`, `c2c053c`, `d3c44e9`, `8ebc0f7`, `b845824`, `261d5b2`, `29519c5`, `97aea43`,
`bc34965`, `3d39843`, `ce32279`, `04cae3d`, `60af4ef`, `6f2276a`, `54fc194`) are recorded in
section 9. The five commits of this revision are:

| SHA | what it is |
| --- | --- |
| `e14f128` | §9 a11y fix: the report form's message field had no accessible name; plus `scripts/verify-report-control.mjs` |
| `5edfe14` | Package G triaged: `docs/THEME-PALETTE-FINDINGS.md`, and the fixed-palette failure message now reports true scope |
| `3f7ea34` | §10 unblocked: the QA cluster preloads `pg_stat_statements` so the measurement probes can run at all |
| `ff1a684` | §15 verifier-quality fix: probe regeneration no longer deletes the analysis appended to its document |
| `53d2f2f` | §3-class fix: `verify-report-control` left an `audit_log` row behind and its own cleanup check passed |
| `9fca98e` | browser matrix re-run on the rebuilt cluster, 90 PASS / 0 NOT-PASS |

No pushed commit was amended or rewritten at any point in this round. Every fix to an earlier
commit message was made by a new ordinary commit followed by a normal push and a remote-HEAD
verification. Commit messages were supplied through `git commit -F` to prevent shell interpolation.

## 2. Vercel, by exact SHA

Queried through the commit-status API, not the Deployments API (which previously answered 403) and
not Preview Comments (which are not deployment evidence).

| SHA | Vercel |
| --- | --- |
| `e710ff8b354bc9271301d6bd7f6be20dbbed83f6` | success |
| `4829bed7554dba5916728dd33cf152f98fb0d374` | success |
| `18ca474024cdd292242595cfcd241f2851ca5474` | success |
| `a57dca1b87d9c4bf7098ed57ba3dd4470f3b2836` | success |
| `301af54f6ce76ffd238669863531d90c00567457` | success |
| `e3d37eeba4ab950d66a3aa6509a405aa6ed983b2` | success |
| `794cd5b45c810ef95403486965e8a69244056e13` | success |
| `536636378d590e7a45ba9a0f42758eda3722db7f` | success |
| `c23fc08d1bf25b2d76dd045b6fe8d8d16d63d3b4` | success |
| `5da07dcba6bb21b389e5aa3160c89b3e4ca6e384` | success |
| `b4c4be6b16b9a3843c93c3a130b54a24f403f1eb` | success |
| `94af2af13340712a888c89572b4dadfe3f6c9f0b` | success (was **pending** when first queried) |
| `9e14b1bd6bf9d58776a0eb545eaec0d9ecc62684` | success |
| `eb0180ceb0537db125efa6c81556a0774475ab7f` | success |
| `8860d0825986c8cff8185a57899b3f4b81be377c` | success |
| `f6c9b60ea2242b365ceaa1fa424d642e055bf71f` | success |
| `492da8bb7cafbfb3349f74292901bd6328bdf3e0` | success |
| `0129a5b55c82d5fcd104da0595e85f479a989b47` | success |
| `f22574b2b847e5c54f004e427aefe81cf88b2c87` | success |
| `60af4ef` · `6f2276a` · `54fc194` | success |
| `e14f128` · `5edfe14` · `ff1a684` · `53d2f2f` | success |
| `3f7ea34` | pending — pushed in the same batch as `ff1a684`, which is success; Vercel builds the tip, so this intermediate commit was never deployed on its own. Recorded as pending rather than claimed as success |
| `9fca98e1e6ec5481d46e5e9bb4887fd54ee7b7ee` (HEAD) | success — pending when first queried, re-queried and confirmed |

Vercel `success` does not authorise cutover, and none of the above is offered as cutover evidence.

## 3. Test totals, measured

All figures below were re-measured on `9fca98e` / build `D-0uxyL3rXTNPEboduCe9` against a real
PostgreSQL 18.4 cluster with all 53 migrations applied and the 7-actor seed loaded.

| suite | tests | pass | fail | skipped |
| --- | --- | --- | --- | --- |
| Full unit suite, `QA2_DATABASE_TESTS` unset (`npm test`) | 1608 | 1509 | 0 | 99 |
| Full suite serialized with the gate set (`npm run test:qa2`) | 1626 | 1620 | 0 | 6 |
| Security matrix (Package D), 74 rows | 66 PASS | — | 0 FAIL | 5 `OWNER_ASSET_REQUIRED`, 3 `STATUS_DEFECT` |
| Browser matrix (Package F), 90 rows | 90 PASS | — | 0 FAIL | 0 a11y, 0 i18n, 0 perf defects |
| Journey matrix (Package E), 37 steps | 36 PASS | — | 0 product failures | 1 blocked step (E2) |
| Assignment journey (§6), 44 checks | 44 PASS | 44 | 0 | 0 |
| Assignment B3 (both creation paths, 7 actors), 55 checks | 55 PASS | 55 | 0 | 0 |
| Report control reachability (§9), 19 checks | 19 PASS | 19 | 0 | 0 |
| Scale measurement (Packages B2 + G), 19 measurements | 19 | — | 0 defects | — |
| Unbounded reads (§10), 6 measurements | 4 within bound | — | 2 `REPRODUCED_DEFECT` | — |
| Theme and responsive surfaces, 32 checks | 28 PASS | — | 4 fail | see section 9, Package G |
| Brand surfaces, 33 checks | 33 PASS | — | 0 fail | — |
| Listening verdicts, 40 checks | 40 PASS | — | 0 fail | — |
| Teacher feedback authority, 10 checks | 10 PASS | — | 0 fail | — |

The security matrix prints `FAIL 8` in its own summary. That label is the sum of 3 `STATUS_DEFECT`
rows (where privacy held and only the HTTP status code is at issue) and 5 `OWNER_ASSET_REQUIRED`
rows; it is not 8 failed security properties, and no row is a real `FAIL`.

Two consecutive full QA2 runs against the same database with no reseed in between both returned
1620 pass / 0 fail, and the whole-database row total measured 128 before and after each. That is the
evidence the Package C residue guard holds; see section 9.

## 4. Per-requirement skip classification

`docs/SKIPPED-TEST-INVENTORY.md`, produced by `scripts/inventory-skips.mjs`, which resolves each
`skip` to the condition that caused it rather than recording the call site.

Of the 96 skips in the full suite, **93 were avoidable**: they are gated on `QA2_DATABASE_TESTS=1`
and run green when it is set. The prior assumption that the skips represented missing owner assets
was wrong, and the inventory is what overturned it. Running all 23 gated files with the flag gives
100 pass / 0 fail.

The 3 genuine blockers:

| skip | requirement | dependency | classification |
| --- | --- | --- | --- |
| dictionary frozen-catalogue release test | the shipped dictionary must match the owner's verified catalogue | `DICTIONARY_RELEASE_TESTS=1` plus a verified `nested.json.gz`, applied through `scripts/dictionary/bootstrap.ts` | `OWNER_ASSET_REQUIRED` |
| speaking bank import ×2 | the speaking bank must load from the owner's source | `SPEAKING_BANK_SOURCE=<bank.jsonl>` | `OWNER_ASSET_REQUIRED` |

A skip is not a pass, and none of the three is counted as one anywhere in this dossier.

## 5. Package results

**Package A — Shadowing removal.** `IMPLEMENTED_AND_VERIFIED`. Re-verified this round rather than
taken on trust: `ShadowingStudio.tsx` does not exist, no file under `src/` imports it,
`content-identity.test.ts` and `speaking-canonical-identity.test.ts` assert its absence, and
`speaking/lessons/page.tsx` filters the retired category out of the lesson list. Historical data is
preserved — the `shadowing` enum literal still exists in `speaking_category` and no row was deleted.
The claim in an earlier round that `src/` still imported `ShadowingStudio` was stale prose and was
corrected in `a57dca1`.

**Package B.** B1 `IMPLEMENTED_AND_VERIFIED` (18/18, three mutations killed). B3
`IMPLEMENTED_AND_VERIFIED` this round — see below. B4 `IMPLEMENTED_AND_VERIFIED` with a documented
deployment boundary. B2 `IMPLEMENTED_AND_VERIFIED` this round as a real measurement.

B3 was owed tests, and a test that has never been seen to fail is not evidence. The event write was
deliberately broken — moved out of the assignment transaction and written after commit, which is the
original defect — the server was **rebuilt** so the mutation was actually live, and the test was
re-run:

```
not ok 5 - ROLLBACK: neither the assignment nor its target survived   expected 0, actual 1
not ok 6 - RETRY ... creates exactly ONE assignment                   expected 1, actual 2
not ok 9 - the injected fault really was what broke the first request expected 0, actual 1
```

Subtest 6 failing with `actual 2` is the defect reproduced exactly: a committed assignment behind a
500, then a duplicate on retry. The source was restored byte-equal (`cmp` against the pre-mutation
copy, `git diff` empty), rebuilt clean, and the test returned to 10/10. Mutant build
`x0YcIlQD4y-Ek7lGnbP2z`, clean build `QbscvB7sVqLmWmVrItoJU`.

An earlier attempt at this mutation test passed 10/10 against mutated source and was **invalid**:
`next start` serves the compiled build, so mutating a source file without rebuilding tests nothing.
That is recorded here because it is the kind of error that produces a false assurance, and build
identity is now part of the evidence for every runtime claim in this dossier.

**Package C — fixture safety.** C1, C3, C4 previously closed. This round added the per-file residue
audit, `scripts/audit-test-residue.mjs`, and it found a real defect: **8 of the 24 QA2-gated test
files leave rows behind**, 1 155 rows in total, with two files accounting for 1 067 of them
(`general-reading-qa2` +786 across 19 tables, `vocabulary-architecture-qa2` +281 across 19 tables).
`REPRODUCED_DEFECT` — test hygiene, not production behaviour, but consequential: `lexemes` grows
4 → 177 across the series, so any count-based or first-match assertion in a later file is
order-dependent. `docs/TEST-RESIDUE-AUDIT.md`. Not yet fixed; the two large files are where
remediation should start.

The audit also caught a false alarm worth recording. `retention-db.test.ts` reported `test-failed`,
which was neither a product defect nor an order dependency: line 16 is
`assert.equal(process.env.STORAGE_PROVIDER, "local")`, a correct precondition guard, and the auditor
was not supplying that variable. A file that throws on line 16 has written nothing and cleaned
nothing, so its residue is unmeasurable — and retention is precisely the file whose subject is
deletion. The auditor now fails closed, naming the missing variables and exiting 2. Re-run
correctly, the file executes and leaves `audit_log +2`.

`fixture-safety.mjs` now validates its table list against `information_schema` and **fails closed**
when introspection returns zero rows, because a silent drop would sweep nothing and report zero
residue. 15/15 tests.

**Package D — six-actor security matrix.** `IMPLEMENTED_AND_VERIFIED`, with 5 rows
`OWNER_ASSET_REQUIRED` and 3 `STATUS_DEFECT`. `docs/SECURITY-MATRIX.md`, 74 rows across ANONYMOUS,
STUDENT_A, STUDENT_B, TEACHER, ADMINISTRATOR and OWNER: D1 22/26 · D2 12/15 · D3 6/6 · D4 12/12 ·
D5 10/10 · D6 8/9. Zero FAIL and zero probe defects.

The methodology is recorded because it is what makes the green trustworthy. A status code is not a
privacy proof, so leakage and status correctness are judged on separate axes. **405 and 400
`invalid_input` are probe defects, never denials** — zod validation runs before the ownership check
in this codebase, so an invalid payload never reaches the boundary; an earlier draft of this matrix
used GET against POST-only routes and reported six green rows that had tested only a
method-not-allowed table. A concurrency row must require the accepted calls to have produced their
rows, otherwise N × 400 passes as "no 5xx".

The 5 blocked rows are `/api/listening/full/*` and `/api/listening/mcq/*`: `listening_packages`
holds 0 rows, so they answer 404 for any test id. `OWNER_ASSET_REQUIRED`.

Three apparent findings were investigated and **disproved** rather than reported: `POST
/api/assignments/[id]/evaluate` is the learner-facing AI evaluation trigger that the target student
may call by design, not teacher-only grading; `GET /api/vocabulary/folders` answering 200 to student
B is correct because it is a per-user route; and the writing-page privacy rows were vacuous because
the page renders the body only when `status='draft'` — measured directly before being fixed, since
with a submitted fixture the secret was absent for the owner too.

**Package E — vertical-slice journeys.** `IMPLEMENTED_AND_VERIFIED` for E1, E3, E4, E5; E2
`OWNER_ASSET_REQUIRED`. 36 of 37 steps pass, 0 product failures. `docs/JOURNEY-MATRIX.md`.

E3 is the strongest result: 640 tagged prompts, walked to exhaustion against an **independent
ordering oracle** queried straight from PostgreSQL, returned every prompt exactly once — 0
duplicates, 0 unreachable, 0 unexpected — in a sequence byte-identical to the oracle, with pages
capped at 500 and four malformed cursors refused as 400 `invalid_cursor` rather than silently
restarting at page 1. Before any of that was claimed, the probe proved the adversarial shapes are
actually present (NULL `external_id`, timestamp groups holding duplicates), because otherwise it
would be testing an easy corpus and reporting a hard one.

E1 preserves the SEC-12 exam seal and measures it: dictionary search 409, vocabulary save refused,
`user_vocabulary` 10 → 10 during a live sealed exam; a resubmission with every answer wrong is
refused 409 `already_submitted` and the recorded grade stays 6/6. E5 resumes a draft in a **new
session**, proving persistence rather than client state, and confirms a submitted essay cannot be
silently rewritten (404 `not_found_or_locked`). E4 proves the target-user mapping through
`assignment_targets.student_user_id`, not merely that a row appeared.

Three probe defects were found and fixed in my own harness, each of which had produced a green step
that measured nothing: a draft-lesson control asserting against a manifest id that did not exist
(so any 404 satisfied it); a second-completion control asserting only "timestamp unchanged", which
also passes when both requests are refused; and a progress journey pointed at a lesson whose
`default_state` is `locked`, so it measured the lock. The corrected controls are stronger than the
vacuous ones — the draft-lesson page returns HTTP 200 and still withholds the draft content.

**Package F — real browser matrix.** `IMPLEMENTED_AND_VERIFIED` with 6 recorded defects.
`docs/BROWSER-MATRIX.md`, 90 rows: 84 PASS, 0 FAIL, 3 a11y defects, 3 perf defects, **0 i18n
defects**. Real Chromium 153 at 320 / 390 / 768 / 1440, EN and UZ, across 34 surfaces.

Established by measurement: no page-level horizontal overflow at any viewport on any surface, no
table that cannot scroll horizontally, keyboard focus reaching inside `<main>` on every page with a
visible indicator at every stop, staff admin 9/9. In Uzbek every surface differs from its English
render with no Cyrillic, no untranslated keys and no new overflow at 320 px, and locale persists
across navigation.

Two real defects were found and **fixed**, each with a browser-measured RED → GREEN:

* `REPRODUCED_DEFECT` → fixed. Four word-selection chips on `/app/vocabulary` measured **22 px**
  tall against the WCAG 2.5.8 AA floor of 24 px. Root cause is exact arithmetic: `text-xs` is a
  16 px line box, `py-0.5` adds 4 px, a 1 px border adds 2 px = 22 px. Fixed with `py-0.5` → `py-1`
  = 26 px. Re-measured on the rebuilt server: sub-24 px count **0**, from 4. Colours, chip shape,
  gap, card and every theme and background token untouched.
* `REPRODUCED_DEFECT` → fixed. `/app/profile` issued `GET /api/profile/photo/{id}?v=0` **twice**,
  both 404, both written to the browser console, for every learner who had never uploaded a photo —
  because the component seeded `present` with `useState(true)` and discovered absence through
  `onError`. The endpoint's 404-for-absence is correct for an image route and was not changed; the
  page is a server component and can settle the question before the browser asks. Measured both
  directions: without a photo, 0 requests, 0 console errors, placeholder renders; with a photo,
  exactly 1 request, image complete, 0 console errors. The positive control matters, because the
  failure mode of this kind of fix is avatars silently never rendering again, which a console-error
  count alone would report as an improvement.

The remaining 6 rows: three pages activate a control, change state, and still own no live region
(`/app/writing`, `/app/speaking/practice`, `/app/vocabulary`); two report duplicated product GETs;
one is the profile row above, now fixed but recorded from the pre-fix run.

Twenty false defects were removed by correcting the harness rather than the product, and this is
recorded because it is the difference between a useful report and noise: focus was being required to
land ON a heading, but headings are not focusable without an explicit `tabindex`, so that check
failed every page while describing correct behaviour; every sub-44 px control was being called a
defect although 24 px is the AA floor; `/_next/static/` assets were being counted as duplicates
although browsers fetch them twice by design through preload hints; and live regions were being
demanded from pages that never fetch. Status regions in this product are conditionally rendered —
`/app/profile`'s photo panel owns `<p role="status">` only once a save produces a message — so an
at-rest count of 0 describes correct implementations. The phase now triggers a real state change
and measures again.

**Package G — measured performance.** `IMPLEMENTED_AND_VERIFIED` for the two reads measured; the
wider inventory is `NOT_YET_EXECUTED`. `docs/SCALE-MEASUREMENT.md`, 19 measurements, 0 defects
after the fixes. PostgreSQL 18 was restarted with `pg_stat_statements` preloaded so query counts
and query times are the database's own accounting, not estimates.

`REPRODUCED_DEFECT` → fixed. `GET /api/speaking/attempts` ran `findMany({ where, orderBy })` with
**no limit at all**, and for a staff caller `where: undefined` read every attempt belonging to every
user in the system:

```
attempts   returned     payload      median     rows read by PostgreSQL
     100        100      46 324 B      9.3 ms                 505
   1 000      1 000     463 024 B     17.0 ms               5 005
  10 000     10 000   4 630 024 B    116.4 ms              50 005
```

The contrast that makes this a defect rather than a preference is that the page learners actually
use was already correct: `GET /app/speaking/history` goes through `listAttempts()` and never moved
across the same series — 373 721 bytes and 505 rows read at 100, at 1 000 and at 10 000. One read
of one table was O(1) and the other was O(n), because the route re-implemented the read instead of
using the function that already owned it. Fixed by deleting the local query and delegating, with
the hardcoded 100 extracted to an exported `ATTEMPT_HISTORY_LIMIT` so the route reports the same
bound the read enforces. Re-measured: **100 rows / 47 751 bytes / 505 rows read at all three
sizes**, growth factor 1.000 on both payload and rows read. Identity is preserved at 10 000
(10 000 unique ids, strictly descending by `started_at`), learner isolation holds at every size,
and a deleted prompt does not break or hide the attempt.

`REPRODUCED_DEFECT` → fixed. `typingStats()` had two bounded reads (10 runs, 50 events) and one
unbounded join that read a learner's entire `typing_run_texts` history to build a Map from which at
most 10 keys are ever read. Measured with `EXPLAIN (ANALYZE, BUFFERS)` on both shapes against the
same 2 000-run corpus: rows returned **2000 → 10**, 1 990 fetched and discarded, buffer hits
**8224 → 197** (97.6% fewer), execution **2.183 → 0.619 ms**. The 10 rows the Map needs are
byte-identical in both, so behaviour is preserved and not merely cheaper.

Live-partner pagination is confirmed set-based rather than assumed: a full cursor walk of a
**10 000-prompt** bank collected all 10 000 in 20 pages, 841 ms, **3 query calls per page**, and
per-page query cost from 1 000 to 10 000 prompts has a growth factor of **1.000** — no N+1. The
slowest statement reads 501 rows per call (the 500-row page plus one to detect `hasMore`), which is
a keyset seek and not a scan-and-discard offset.

Unbounded reads that remain and were **not** fixed this round, recorded rather than left implicit:
`listAllPrompts()` (admin writing-prompt list, no limit), `listActivePrompts()` (learner-facing
live writing prompts, no limit) and `listAllForTeacher()` (all live classes, no `where` clause at
all). Each grows with its corpus. `NOT_YET_EXECUTED` — measuring them needs corpora at a size that
is realistic for those tables, and bounding them is a design decision about pagination on surfaces
that currently show everything.

**§11 — routing 404 status.** `OWNER_DECISION_REQUIRED`, now on measured evidence rather than
assumption. `docs/KNOWN-ISSUES-NOT-FOUND-STATUS.md`.

```
/app/reading/attempts/not-a-uuid                 -> 404, 0 bytes        (12/12 identical)
/app/reading/attempts/<valid uuid, no row>       -> 200, 210 499 bytes  (12/12 identical)
/app/writing/submissions/<valid uuid, no row>    -> 200, 208 986 bytes
/app/courses/ielts/lessons/<valid uuid, no row>  -> 200, 209 464 bytes
```

The split is stable across twelve consecutive repeats in each direction, so it is structural and not
a race between `notFound()` and the shell flushing. The lessons page behaves identically and takes
no `searchParams` at all — a third independent disproof of that hypothesis, and evidence this is a
property of the `(shell)` group boundary rather than of any one page.

The narrow solution does not exist under §11's own constraints. Deleting `(shell)/loading.tsx` does
yield a correct 404 but is forbidden and would strip route-entry loading from all 97 shell pages.
The shape check already lives in `src/middleware.ts`, which is why malformed ids are correct;
extending middleware to existence would put a database round trip in front of every authenticated
navigation, which §11 forbids inventing. And no page-level fix can work: the page throws
`notFound()` correctly and in the documented order, but the group's Suspense boundary commits the
status before the page body runs, and no API lets a child segment opt out of a parent `loading.tsx`.

What is **not** at risk is verified separately: `docs/SECURITY-MATRIX.md` rows R09b, W02 and W07
record these as `STATUS_DEFECT` with `privacy=OK`, deliberately not as IDOR, because the payload was
inspected and the protected content is absent in every case. The owner's decision is a real
trade-off: keep route-entry loading on 97 pages and accept 200-with-not-found-content for a
valid-but-absent id, or surrender the shared loading boundary (or accept a middleware DB lookup) to
obtain the correct status.

**§12 — test quality and the skip inventory.** `IMPLEMENTED_AND_VERIFIED`. The inventory is in
section 4. Every verifier added this round was mutation-tested or given a computed threshold rather
than an asserted one: B3's atomicity test was seen to fail against a deliberately broken build; the
scale probe computes boundedness from the smallest and largest corpus instead of asserting it; the
typing probe compares the content of the bounded query against the unbounded one so a bound that
dropped a needed row could not pass as an optimisation.

**§13 — continuity.** Followed for every production-affecting fix in this round: reproduce, RED,
root cause, smallest safe fix, GREEN, integration, runtime, commit, normal push, remote verify. All
five production changes (listening draft status, vocabulary chip height, profile avatar, speaking
attempts bound, typing stats bound) have a measured RED and a measured GREEN with a named build
identity.

**§14 — H / I / J.** `NOT_YET_EXECUTED`. H cannot be frozen until E, F and G are complete, and G
still has the three unbounded reads above plus the wider N+1/index inventory outstanding. I and J
follow H by definition. The full-suite re-measurement with `QA2_DATABASE_TESTS=1` is part of the H
battery and must be run on the frozen candidate rather than carried forward from this round.

## 6. Remaining security vulnerabilities and limitations

* **Rate limiting is per-instance.** `src/lib/http/rate-limit.ts` uses an in-memory `Map`, so there
  is no cross-instance guarantee on a multi-instance deployment. Documented in
  `docs/RATE-LIMIT-DEPLOYMENT-BOUNDARY.md`. Redis was **refused** — introducing a dependency
  without demonstrated necessity and authorisation was not justified. If the deployment contract
  requires distributed enforcement, this is `OWNER_DECISION_REQUIRED`. B4's fix itself is
  `IMPLEMENTED_AND_VERIFIED` (~392 ms → ~1 ms against an oracle, EN1–EN6, two mutations killed).
* ~~`src/lib/auth/teacher/feedback/route.ts` has no ownership or roster scoping on
  `writingSubmissions`~~ — **CLOSED** in `eca6692`. A second teacher account with no roster link is
  refused, and denial is a 404 carrying a missing-submission body rather than a 403 that would
  confirm the submission exists. `scripts/verify-teacher-feedback-authority.mjs` 10/10.
  `IMPLEMENTED_AND_VERIFIED`.
* **`activity_events` has no indexes and no `run_id`.** `NOT_YET_EXECUTED`.
* **Non-transactional `activityEvents` writers remain** in `grammar/exercises/[id]/{practice,produce}`,
  `live-classes/[id]/join`, `vocabulary/[id]/use`, `data/evaluations.ts`, `stealing.ts` and
  `activation.ts`. B3 made assignment creation atomic; the same defect class is unremediated
  elsewhere. `REPRODUCED_DEFECT` by inspection, not yet measured per-writer.
* **`stealing.ts` continuation past 300 is still missing.** `NOT_YET_EXECUTED`.
* **Valid-UUID-no-row answers 200**, per section 5 §11. `OWNER_DECISION_REQUIRED`.
* ~~The QA2 test suite leaks — 8 files, 1 155 rows~~ — **CLOSED** in `6f2276a` (Package C). The leak
  was measured per file at 1 153 rows across 7 files (`general-reading-qa2` 786 over 19 tables,
  `vocabulary-architecture-qa2` 281 over 19, `academic-reading-qa2` 47, `vocabulary-integrity-db` 12,
  `video-completion-db` 11, `qa2-postgres-n07-n08` 8, `vocabulary-points-db` 8), and `retention-db`
  failed 0/6 under that pollution. `tests/support/qa2-residue.ts` now takes a differential primary-key
  snapshot of every base table and removes only keys absent at capture, children before parents using
  the catalog's foreign keys, wired through gated `before`/`after` hooks into all 26 gated files.
  Two consecutive full runs on the same database with no reseed: 1620 pass / 0 fail each, rows
  128 → 128 → 128. The guard's teeth were proven by defeating its delete, which makes the file fail
  and name the tables. One table, `live_partner_blocks`, has no primary key and is reported as
  uncovered rather than silently skipped. `IMPLEMENTED_AND_VERIFIED`.
* **Live Partner still probes for an absent avatar with a failing request.** The profile page was
  fixed; `LivePartnerClient`'s `Avatar` is a client component whose partner identity arrives in the
  room payload, so seeding it the same way needs a payload field. Left as a documented defect
  rather than folded into an unrelated change. `REPRODUCED_DEFECT`.
* ~~Two untriaged probe failures remain: `verify-brand` and `verify-theme`~~ — both triaged.
  `verify-brand` measures **33 PASS / 0 FAIL**; it was not failing. `verify-theme` measures 28/4 and
  its four failures are analysed in section 9 and `docs/THEME-PALETTE-FINDINGS.md`: one real defect
  found and fixed beside it, two that are the same first-paint design question, and one palette
  question spanning 44 sites that is `OWNER_DECISION_REQUIRED` with no contrast defect in any of them.

## 7. Owner and external blockers

| blocker | what it prevents | classification |
| --- | --- | --- |
| Listening package import (`listening_packages` is empty) | 5 Package D rows (L04–L08) and the whole of journey E2 — the pre-submission answer-key guarantee cannot be walked. The 13 residual packages left by leaking tests all have 0 questions, so they cannot substitute. | `OWNER_ASSET_REQUIRED` |
| Verified dictionary catalogue (`nested.json.gz`) | 1 skipped test; the frozen-catalogue release guarantee | `OWNER_ASSET_REQUIRED` |
| Speaking bank source (`bank.jsonl`) | 2 skipped tests | `OWNER_ASSET_REQUIRED` |
| R2 / S3 credentials | real object-storage upload acceptance | `EXTERNAL_ACCEPTANCE_REQUIRED` |
| Real microphone and WebRTC hardware | recording and live-partner media acceptance; not claimed anywhere in this dossier | `ENVIRONMENT_BLOCKED` |
| §11 trade-off | the 404 status on valid-but-absent ids | `OWNER_DECISION_REQUIRED` |
| Distributed rate limiting, if the deployment contract requires it | cross-instance enforcement | `OWNER_DECISION_REQUIRED` |

RIWI (`arena/01a10bac-learners-area`) is a separate read-only workstream and RIWI-01..13 belong to
it; nothing in this dossier depends on them.

## 8. How to reproduce any number in this dossier

```
bash scripts/qa2-local-postgres.sh                       # 53/53 migrations, 2 light fixtures,
                                                         # pg_stat_statements preloaded + created
node --conditions=react-server --import tsx src/db/seed.ts   # MANDATORY: the 7-actor seed
npm run build
DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
AUTH_SECRET=qa2-closure-acceptance-secret-0123456789 STORAGE_PROVIDER=local \
STORAGE_LOCAL_DIR=/tmp/qa2-uploads BASE_URL=http://127.0.0.1:3000 \
  npx next start -H 0.0.0.0 -p 3000

npm run test:qa2                             # 1626 tests, serialized -> 1620 pass / 0 fail / 6 skipped

node scripts/verify-security-matrix.mjs      # 74 rows   -> docs/SECURITY-MATRIX.md
node scripts/verify-journeys.mjs             # 37 steps  -> docs/JOURNEY-MATRIX.md
node scripts/measure-scale.mjs               # 19 meas.  -> docs/SCALE-MEASUREMENT.md
node scripts/audit-test-residue.mjs --files "$(grep -rl QA2_DATABASE_TESTS tests/*.test.ts | paste -sd,)"
LD_LIBRARY_PATH=/tmp/chromium-libs/lib:/tmp node scripts/verify-browser-matrix.mjs   # 90 rows
LD_LIBRARY_PATH=/tmp/chromium-libs/lib:/tmp node scripts/verify-report-control.mjs   # 19 checks
node scripts/measure-unbounded-reads.mjs     # 6 meas.   -> docs/UNBOUNDED-READS.md
```

`pg_stat_statements` no longer has to be enabled by hand: `qa2-local-postgres.sh` preloads it and
creates the extension after migrating, and prints `pg_stat_statements 1.12 ready`. Without it both
measurement probes abort rather than report a query count they cannot observe.

Every generated document in `docs/` is written through `scripts/lib/doc-output.mjs`. Anything between
its hand-written markers survives regeneration; anything appended **outside** those markers does not,
which is how a 3 600-character correction was once silently deleted. Analysis appended to a generated
document has to be inside the markers.

The seed step is not optional and is the single most common way to produce a false result here:
`qa2-local-postgres.sh` alone leaves two fixture users, and every actor login in the matrix then
fails. `psql` is not installed in this environment; database assertions go through Node `pg`.
**Any source mutation requires a full `npm run build` and a server restart before a runtime test
can see it** — that omission invalidated a mutation test once already this round.

Real-browser runs need Chromium restored to `/tmp/chromium-libs`: `@sparticuz/chromium`'s
`chromium.br` decompresses to a **raw ELF `headless_shell`**, not a tar, and `al2023.tar.br`
supplies the 12 shared libraries. Puppeteer is side-installed to `/tmp/browserdeps` so it can never
disturb the build, and `browser-qa.mjs` resolves both prefixes.

Every probe in this dossier verifies its own teardown and reports the remaining row counts. After
the journeys and the matrices, all 24 checked tables sit exactly at the seeded baseline. Note that
`lesson_progress` and `evaluations` have a seeded baseline of **1**, not 0 — `seed.ts:338` inserts a
completed progress row and `seed.ts:401` calls `evaluateWritingSubmission` so that the demo
evaluation is real evaluator output rather than hand-written numbers. Two rows that looked like
leaked probe residue were the seed's own, and were identified by reading their owner, timestamps
and the seed source rather than deleted.

## 9. Revision of 2026-10-11 — what changed, what it proved, and where H/I/J stand

This revision is `54fc194` → `9fca98e`, six commits. **One production file changed, by five lines.**
Everything else is test infrastructure, probes and documents. No migration was added, altered or
removed: 53 SQL files and 53 journal entries, unchanged.

### 9.1 The one production defect found and fixed

`IMPLEMENTED_AND_VERIFIED` — `e14f128`, `src/components/support/ReportProblem.tsx`.

The report form's `<textarea>` had no accessible name. Its only labelling source was the placeholder,
which assistive technology drops as soon as the learner types, so the field was announced as an
unnamed edit box during exactly the moment it is used (WCAG 1.3.1 / 4.1.2). The label copy already
existed in both locales — `support.message`: "What happened?" / "Nima bo'ldi?" — and was rendered by
nothing anywhere in the product. The fix wires it as an `aria-label`, which adds no visual change to
the protected shell design.

Evidence, not inference: `scripts/verify-report-control.mjs`, 19/19 in real Chromium at 320px,
end to end into PostgreSQL. It proves the launcher is in first paint, that opening it reveals the
control, that the control is inside the viewport and clears the WCAG 2.5.8 touch floor at a measured
52×46px, that it exposes `aria-expanded` and a name, that the form opens with a **named** field, that
submitting calls `POST /api/support/reports`, that the row reaches `problem_reports` with the correct
route and viewport, that there are no console errors, and that the **rendered** Uzbek names differ
from the English ones. `tests/reporter.test.ts` 18/18. Lint and typecheck clean.

### 9.2 Package G: `verify-theme` 28/4, triaged rather than deferred

`docs/THEME-PALETTE-FINDINGS.md` holds the measurements. The four failures are not four defects.

| finding | status |
| --- | --- |
| `data-report-toggle` absent from the first paint of `/app` — **two** failures, one assertion evaluated twice | `OWNER_DECISION_REQUIRED`. The control exists and works; it sits inside the shell's collapsible utilities panel behind one launcher that also opens Focus mode and the Coach link. Whether it belongs in first paint is a visual-design decision about the protected shell. Reachability is not a matter of opinion and is proven at 19/19. |
| Two components contain literal hex colours | `IMPLEMENTED_AND_VERIFIED` as correct. `AuthoredListeningFrame` injects a script string into a **foreign iframe** that has no access to the app's tokens; `StudyRichEditor` passes a colour to `execCommand("hiliteColor")`, which does not resolve CSS variables. Neither adapts to Night Mode and both *could* be made to, which is a rendered-appearance change and therefore also `OWNER_DECISION_REQUIRED`. |
| 44 uses of Tailwind's fixed default palette across 14 files | `OWNER_DECISION_REQUIRED`. **No contrast defect in any of the 44.** Ratios computed from this product's own built stylesheet: the self-consistent pairings run 5.57:1–8.75:1, and the mixed pairings that carry a token text colour over a fixed background reach AAA in **both** themes (11.12:1–15.07:1) because their `dark:` variants flip the background too, with `dark:bg-amber-950/30` composited over the real night surface `rgb(17 20 33)`. |

The third finding was badly reported and that nearly caused a wrong decision. The check printed only
its **first five** matches, which made two writing pages look like the whole problem when the true
scope is 44 occurrences across 14 files (`amber` 25, `sky` 7, `black` 4, `red` 3, `rose` 3, `white` 1,
`emerald` 1). `amber` is the product's de-facto caution colour across listening import warnings,
speaking readiness, live-partner unavailability, exam notices and grade highlights — so migrating
only the two named pages would have left 39 sites behind and made the idiom *less* consistent than it
is today. The message now summarises by family and file count. **The pass/fail criterion was not
touched**; the check still fails until the palette is sanctioned or migrated.

The decision is binary and belongs to the owner: sanction the fixed palette for caution and danger
semantics and teach the verifier the allowlist, or migrate all 44 sites with its own visual review.

Also closed here: the check that *passes* — `/ReportProblem/.test(shellUtilities)` — is a source-text
scan that cannot see render conditions and would still pass if the control were never mounted.
`verify-report-control.mjs` replaces that inference with a measurement.

### 9.3 Two verifier-quality defects, both in my own work from this round

§15 requires that every new verifier resist a false PASS. Two did not, and both are fixed.

**Probe regeneration deleted the analysis attached to its document** — `ff1a684`,
`REPRODUCED_DEFECT` → `IMPLEMENTED_AND_VERIFIED`. Eight probes wrote their Markdown report with a
bare `writeFileSync`, so anything appended by hand was destroyed on the next run. This cost a real
3 600-character correction to `docs/UNBOUNDED-READS.md` — the one explaining that the measured 6.15 MB
speaking payload is a **floor**, because the 10 000-prompt fixture inserts no `study_support` and 28%
of every row was an empty skeleton, together with the reason no populated estimate can be quoted
(synthetic filler compresses roughly 17× through TOAST, so 2 048 B per row stored *smaller* than
512 B). Nothing failed, nothing warned, and the tables that replaced it looked complete.
`scripts/lib/doc-output.mjs` now preserves anything between hand-written markers, prefers the file's
own region over a seed so a run cannot revert an edit, and **throws** on a begin marker with no end
rather than guessing where prose stopped. The correction was recovered from git, not retyped, and
re-running the probe twice — once on a cluster rebuilt from scratch — leaves the region
byte-identical while the measurement tables do move. `tests/doc-output.test.ts`, 6 tests; disabling
preservation fails 4 of them.

**`verify-report-control` left a row behind and reported itself clean** — `53d2f2f`,
`REPRODUCED_DEFECT` → `IMPLEMENTED_AND_VERIFIED`. Filing a report writes *two* rows: the
`problem_reports` row and an `audit_log` entry (`action = support.reported`). The probe deleted the
report and asserted the delete count matched, and that check passed on every run while an `audit_log`
row accumulated, taking the QA database from its 128-row baseline to 129. A cleanup assertion scoped
to the one table the probe knows about cannot see a write to any other table — the same failure mode
Package C was opened for. Cleanup now removes the audit rows first, children before parents, casting
the column rather than the parameter because `target_id` is a uuid and `uuid = text` has no operator;
and the proof of cleanliness is the **whole-database row total** against a pre-run snapshot. 19/19,
128 rows after, confirmed by an independent count rather than the probe's own assertion. Disabling
just the audit delete fails two checks, naming the defect and the residue ("128 → 129 rows across
119 base tables").

Found by counting the whole database after a full QA2 run instead of trusting the probe's report:
every table the seed populates matched exactly, and the single extra row was `support.reported`.

### 9.4 §10 was unrunnable, and is now runnable

`3f7ea34`, `IMPLEMENTED_AND_VERIFIED`. `measure-scale.mjs` and `measure-unbounded-reads.mjs` take
their query counts, rows read and database time from `pg_stat_statements`, and both fail closed
without it — correctly, since neither will invent a number — but that made the entire §10 inventory
unmeasurable on a fresh environment. The embedded-postgres build does ship the contrib module; it is
simply not preloaded. Enabling it by hand in `/tmp` is not a fix, because any environment rebuild
wipes it, which is exactly what happened. The cluster script now enables it after `initdb`, restarts
only when it added the setting (stop then start separately — a chained `pg_ctl restart -w` has hung
here before), and creates the extension after migrating, since the database is recreated every run.
No guard is weakened: `assertIsolatedTarget` still runs before anything touches the database.

Measured on a cluster built from scratch:

| surface | verdict | evidence |
| --- | --- | --- |
| Speaking Practice, `/app/speaking/practice` | `REPRODUCED_DEFECT`, unbounded | rows read 107 → 10 007 (×93.5), bytes 278 kB → 6.15 MB (×22.1), median 55 → 683 ms (×12.3), **queries flat at 2** |
| Speaking AI, `/app/speaking/ai` | `REPRODUCED_DEFECT`, unbounded | same shape, queries flat at 3 |
| Speaking prompt bank, `GET /api/speaking/live-partner/questions` | `IMPLEMENTED_AND_VERIFIED`, bounded | a 10 000-prompt bank walked in 20 cursor pages, 10 000 prompts collected, **3 queries per page flat** while the corpus grows 10× |
| `GET /api/speaking/attempts` | `IMPLEMENTED_AND_VERIFIED`, bounded | 100 attempts returned at both 100 and 1 000 in the corpus, 505 rows read, learner isolation confirmed |
| Scale inventory overall | 19 measurements, **0 defects** | |

Flat query counts with growing rows read is the signature of one unbounded `SELECT`, not an N+1. The
bounded path already exists in the product and is measured above, so the fix for the two pages is not
speculative — but it changes what a protected learner surface requests and renders, and the real
payload magnitude needs the owner's canonical speaking bank. `OWNER_DECISION_REQUIRED`, with both
options priced in `docs/UNBOUNDED-READS.md` and the floor correction preserved inside the markers.

### 9.5 The battery, re-run on the frozen candidate

Every figure below was measured on `9fca98e` / build `D-0uxyL3rXTNPEboduCe9`, real Chromium 153.0.8010.0,
real PostgreSQL 18.4, 53/53 migrations, 7-actor seed, `LD_LIBRARY_PATH` restored after the wipe.

* Browser matrix **90 PASS / 0 NOT-PASS** — Reading 12/12, Listening 12/12, Writing 7/7,
  Speaking 20/20, Vocabulary 11/11, Lessons 6/6, Assignments 3/3, Progress 3/3, Notifications 3/3,
  Profile 4/4, Staff admin 9/9. 0 a11y, 0 i18n, 0 perf defects, 0 not-measurable.
* Security matrix **66 PASS / 0 FAIL** of 74 rows; 3 `STATUS_DEFECT` (privacy held, status code at
  issue) and 5 `OWNER_ASSET_REQUIRED`. Concurrency rows are real concurrency: three simultaneous
  assignment POSTs produce a 1:1:1 assignment/target/event triple; a double submit answers 200/409
  with 6 reading answers, not 12; eight concurrent vocabulary uses store exactly 8 rows; a double
  finalize mints one usable object.
* Journeys **36/37**, E2 blocked on `listening_packages = 0`.
* Assignment journey **44/44**; assignment B3 **55/55** across 7 actors and both creation paths.
* Full unit suite **1608 / 1509 pass / 0 fail / 99 skipped**; serialized with the gate set
  **1626 / 1620 / 0 / 6**.
* `verify-brand` **33/0**. Listening verdicts **40/40**. Teacher feedback authority **10/10**.
* Whole-database row total **128** after the suite, after the matrix, and after every probe — the
  post-seed baseline, counted across all 119 base tables. 0 leftover `qa_fault` triggers.

### 9.6 H, I and J

**H is NOT frozen.** §13 permits freezing H only once everything the repository can solve is solved.
Three things are open and none is a repository-solvable defect I have declined to fix:

1. the two unbounded speaking reads — the fix changes a protected learner surface and the real
   magnitude needs the owner's canonical bank: `OWNER_DECISION_REQUIRED`;
2. the 44-site fixed-palette question — sanction or migrate, a product-wide visual change:
   `OWNER_DECISION_REQUIRED`;
3. the report control's first-paint placement — a protected-shell visual decision:
   `OWNER_DECISION_REQUIRED`.

Because this revision changed code, any previously frozen H candidate is historical and a new
candidate must be re-measured after the three decisions land. The battery in 9.5 is the current
measurement of the current tree, and it is offered as evidence for a future freeze, not as a freeze.

**I is `NOT_YET_EXECUTED`** and cannot be executed here. §13 requires a *genuinely independent*
audit. Everything in this dossier was produced by the same agent that wrote the code it verifies, so
self-certifying I would be worthless by construction. I needs a reviewer who did not write this work.

**J is `NOT_YET_EXECUTED`.** It requires complete evidence *and* explicit owner authorisation. Vercel
`success` on the SHAs listed in section 2 — including HEAD `9fca98e` — is not that authorisation and
is not offered as `PRODUCTION_GO`. No `PRODUCTION_GO` claim is made anywhere in this dossier.

### 9.7 Remaining P0 and P1

No P0 is open. The P1s:

| item | status |
| --- | --- |
| Two unbounded speaking reads (6.15 MB and growing with the bank) | `REPRODUCED_DEFECT`, priced, `OWNER_DECISION_REQUIRED` |
| 44 fixed-palette sites / 14 files | `OWNER_DECISION_REQUIRED`, no contrast defect |
| Report control not in first paint | `OWNER_DECISION_REQUIRED`, capability proven working |
| Rate limiting is per-instance (in-memory `Map`) | `OWNER_DECISION_REQUIRED` if the deployment contract requires distributed enforcement; Redis refused as unjustified |
| Valid-UUID-no-row answers 200 | `OWNER_DECISION_REQUIRED`; deleting `src/app/app/(shell)/loading.tsx` is forbidden, and inventing a global middleware DB dependency to obtain a status code is not warranted |
| `bg-ink-50` generates no CSS — 38 sites / 21 files, every loading skeleton including the shared `SectionEntryFrame` and 2 `role="progressbar"` tracks | `REPRODUCED_DEFECT`, documented in `docs/DEFECT-bg-ink-50-invisible-skeletons.md`; the fix changes rendered appearance of protected surfaces |
| Non-transactional `activityEvents` writers outside assignments | `REPRODUCED_DEFECT` by inspection, not measured per writer |
| Off-roster `/app/teacher/students/[id]` answers 200 with not-found content | not IDOR — no name, email or form is leaked; the status code alone is tracked as `STATUS_DEFECT` |

Owner-asset blockers are unchanged and listed in section 7. No educational content, listening package,
reading set, dictionary catalogue or speaking bank was fabricated at any point, and no AI or external
provider response was invented.
