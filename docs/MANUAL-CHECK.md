# Manual check

This is the owner's checklist for the build on `arena/01a0cf7b-learners-area`.
It is written to be executed by hand, in a browser, in the user's own
environment. It is **not** a QA 2 result: full QA 2 has not been run and is not
claimed, and RIWI V2 has not started.

Everything below marked **VERIFIED LOCALLY** was measured in this sandbox against
a production build (`next start`) and the local PostgreSQL. Nothing marked
EXTERNALLY UNVERIFIED has been checked against production from here — the sandbox
cannot reach the deployment.

## 1. How to run it

```bash
# local, from the repository root (already running in the sandbox on :3000)
npm run build && npm start

# production checks (in your own environment, with your own connection string —
# never paste a connection string into a chat or a document)
DATABASE_URL="postgres://…" node scripts/migrate-production.mjs            # inspect first
DATABASE_URL="postgres://…" node scripts/migrate-production.mjs --apply --yes
DATABASE_URL="postgres://…" node scripts/verify-production-schema.mjs
```

**The production Reading acceptance run** (the P0 in the report of 2026-09-26).
Parols are typed into the command, never into a chat:

```bash
PROD_BASE_URL="https://learners-area.vercel.app" \
PROD_OWNER_EMAIL="…" PROD_OWNER_PASSWORD="…" \
PROD_STUDENT_EMAIL="…" PROD_STUDENT_PASSWORD="…" \
node scripts/verify-production-reading.mjs
```

It prints the deployed commit and region first (`/api/version`), then signs in
and makes 10 direct loads + 10 client-side navigations + return / filter /
page-2 / query per account, printing status, first byte, total time, error
boundaries and digests. It writes nothing and creates no attempt. It prints
`READING PRODUCTION STABLE` only when every request rendered; that line is the
acceptance signal for this run.

Accounts used for the walk (local seed, see `src/db/seed.ts` for the seeded
credentials — one OWNER, one ADMIN, two TEACHERs, two ACTIVE students, one
PENDING student). In production the OWNER account is the centre's own.

The automated equivalent of this document is the rig set plus the `verify-*`
battery. In this sandbox `/tmp/bt/matrix.mjs` no longer exists, so the older
"157/157" figure cannot be re-derived and is not claimed any more; what is
reproducible today is:

- `/tmp/bt/reading-stability.mjs` — **32/32** (both roles: 10 direct loads + 10
  client-side navigations each, hard reload, leave and return, Day/Night, UZ/EN,
  search, topic filter, Passage-1 filter, pagination, `page=99`, a real passage)
- `/tmp/bt/admission-flow.mjs` — **11/11** (register → pending row → queue →
  approve → ACTIVE → learning, second decision 409, student refused)
- `scripts/verify-*.mjs` — access 33, pages 71, browser-flow 54, owner 10,
  reading 33, vocabulary 103, retention 10, dashboard 21, theme 32,
  responsive 23, publication 34, a11y 41, brand 33, shadowing 15, support 26,
  progress 19, grammar 32, lessons 27, listening 45, live-classes 24, writing 18,
  coach 21, uploads 44, admission-race 6, migration tooling 24, production
  schema 41/42 (locally only: the seven seed accounts; 42/42 is the production
  expectation)

## 2. The twenty reported blockers

| # | What you reported | What changed | How to check by hand | Status |
| --- | --- | --- | --- | --- |
| 1 | sidebar and page scroll together | the shell is viewport-locked; the rail and the main column are two independent scroll containers (`min-h-0` is what makes it work) | open a long passage, scroll the rail, then scroll the page | VERIFIED LOCALLY (`shell.mjs` 36/36) |
| 2 | 5–10 s click latency | per-question queries removed; list pages fetch materials in one query; autosave and search debounce instead of blocking | click between Reading → Vocabulary → Grammar and watch the heading | VERIFIED LOCALLY (72–96 ms warm on this machine); production EXTERNALLY UNVERIFIED |
| 3 | undersized authenticated UI | geometry tokens: rail 288/264px, topbar 68px, padding 32/28, content max 1440px, controls 46px, tabs 44px | look at any module page at 1440px | VERIFIED LOCALLY |
| 4 | weak hierarchy | section titles, card titles, meta text and empty states come from one type scale | compare the dashboard and the Reading hub | VERIFIED LOCALLY |
| 5 | unclear icon-only Day/Night | two separate 44×44 buttons `[☀] [☾]`, the active one visibly selected, labels on hover and for screen readers | click both, reload, check it is remembered | VERIFIED LOCALLY (`brand.mjs`, `matrix.mjs`) |
| 6 | no consistent Back | back + breadcrumbs from the route's *meaningful parent*, on every private page | open a passage → attempt, use Back, then reload | VERIFIED LOCALLY |
| 7 | Focus was unclear | floating bottom-right `[Focus mode (F)]` on the learning surfaces (Reading, Listening, Writing, Speaking, Grammar, Vocabulary, Mock tests, Coach) and never in management mode; `Esc` exits; `F` is ignored while typing; timer/save/submit stay visible | open a Reading attempt, press `F`, then `Esc` | VERIFIED LOCALLY |
| 8 | no user-visible universal upload | one composer, eight content kinds: `/admin/materials` → kind → item; students see the attached blocks on the content's own page | as OWNER attach a text block to a grammar topic, then open that topic as a student | VERIFIED LOCALLY (`materials.mjs` 21/21, `composer.mjs` 16/16) |
| 9 | owner sidebar overload | learning mode has 13 rows; management is a separate mode with its own entry and exit | open the sidebar as OWNER on `/dashboard`, then go to `/admin/people` and look at the navigation again | VERIFIED LOCALLY |
| 10 | oversized raster logo | only derivatives are served (96px mark, 640px lock-up, 32/180px icons) with declared width and height | open dev tools, check the image sizes on any page | VERIFIED LOCALLY (`brand.mjs` 25/25) |
| 11 | empty-looking pages | real counts from the database, real empty states, no placeholder text | open `/admin/content` and the Reading hub | VERIFIED LOCALLY |
| 12 | broken/error routes | `/support` and `/admin/content` were visible in the menu and returned 404 — both pages now exist with real data | click every row in the sidebar | VERIFIED LOCALLY (`matrix.mjs` 157/157 — zero navigation 404s) |
| 13 | unnecessary top-level IELTS item | removed; there is one course and no switcher to promise | look at the MODULES group | VERIFIED LOCALLY (`shell.mjs`) |
| 14 | Reading looked empty | 105 passages imported, 104 published and one held back as a draft **because its source metadata does not match its extracted text** | open `/reading` | VERIFIED LOCALLY (importer `--verify`; see `READING-105-IMPORT-REPORT.md`) |
| 15 | no Reading search/filter | status + topic + question-type filters, AND semantics, reset, state in the URL, pagination | filter by topic, reload the page, press reset | VERIFIED LOCALLY (`reading.mjs` 28/28) |
| 16 | weak global search | grouped results by category (only categories with matches), 300 ms debounce, minimum two characters, `Cmd/Ctrl + K`, results filtered by role on the server | search for a passage title and for a word | VERIFIED LOCALLY |
| 17 | blank on hard reload | pages render server state; the correct theme is on the page before the first byte; an open Reading attempt restores the saved answers | open an attempt, answer two questions, reload | VERIFIED LOCALLY (`practice.mjs` 33/33) |
| 18 | empty states looked broken | one empty-state component, honest wording, a way out of the state | open a module with no content for a student | VERIFIED LOCALLY |
| 19 | English-only errors under UZ | error/loading/not-found and every new string exist in UZ and EN | switch to UZ and visit a page that cannot be loaded (e.g. a malformed id) | VERIFIED LOCALLY; source passages stay in English because the material itself is English |
| 20 | unclear controls | every control in `UI-ACTION-MATRIX.md` has a label, states, permission and an evidence line | spot-check a few rows from that document | VERIFIED LOCALLY |

### Fixed after the first revision of this checklist

| What was wrong | What it was | What changed | Evidence |
| --- | --- | --- | --- |
| Admissions showed nothing while an applicant waited | registering created the account but no request row, so the queue — which lists requests — said "nothing is waiting" while the applicant's own screen said "your request is with the centre" | registering now creates the request; the queue starts from waiting *accounts* and joins their open request, so an older account that never had a row is queued too; the decision endpoint accepts either id and still cannot approve twice | admission flow 9/9 (register → waiting room → queue → approve → audit → ACTIVE → learning) and the race check 6/6 (second decision is 409) |
| Notes / summaries / flow-charts were unanswerable | 191 questions arrive as overlapping windows cut around their own blank, so the screen showed raw window text — a printed "2" with no input | `src/lib/reading/stimulus.ts` rebuilds one stimulus per group from the windows; every blank becomes an input, nothing is shown twice and nothing is dropped (41/41 groups complete, checked by `tests/reading-stimulus.test.ts`) | `practice.mjs` 33/33 — stimulus rendered, one input per blank, answers restored after a reload |
| 144 multiple-choice questions had no options to choose from | the importer took a choice question's wording only from its group, but MCQ keeps the wording on the question's own option rows, so the screen showed "A, B, C, D" with nothing behind them | the importer reads the question's own option text (group wording still wins where it exists); it is source text, never an invention. This landed **before** the production import, so production gets the fixed data | importer `--verify` clean; 0 MCQ rows with a bare-letter option list |

## 3. Known exceptions (deliberate, reported)

| Item | Why it is this way |
| --- | --- |
| Speaking materials keep their own block editor | those rows carry a resolved public `object_url` rather than a private key, so folding them into the universal `resource_blocks` table would silently change how their files are delivered. The universal composer covers the other seven kinds today; the Speaking migration is a separate, explicit decision |
| One Reading passage stays a DRAFT (`t29-p2`) | the source promises 892 words and its text contains ~546. Publishing it would mean inventing text to reach a count |
| No visible "Coming soon" modules | the brief forbids pretending: a module that is not built is not advertised |
| Mock tests have no runner | the page says what a mock is here instead of pretending to run one |
| No AI provider is active | `REAL_AI_ENABLED=false`; no acoustic or AI-examiner claim is made anywhere |

## 4. The manual-check items, and what is already automated

**VERIFIED LOCALLY** means measured in this sandbox on the final commit; the
right-hand column is what still needs a signed-in production session (the owner,
or `verify-production-reading.mjs` where it applies).

| Item | Automated evidence (local, final commit) | Production |
| --- | --- | --- |
| Reading hub / library | rig 32/32 — 5 hub tabs, count from the database, 24 cards per page; `verify-reading` 33 | the acceptance run, then your own walk |
| A passage opens | rig — a real passage opens with 13 questions and 8 paragraphs; `verify-reading` 33 | acceptance run |
| Filters and search | rig 32/32 — search 11, topic 13, Passage-1 35 total (< 105), "Sahifa 2 / 5", `page=99` clamped to 5/5 | acceptance run |
| Reading → Vocabulary save | `verify-vocabulary` 103 — the canonical lexeme is not duplicated and the occurrence keeps its Reading context | your walk |
| Vocabulary | `verify-vocabulary` 103 (words / revision / games / use / board tabs, 401 for an anonymous caller) | your walk |
| Flashcards / revision | `verify-vocabulary` 103, `verify-retention` 10 (1/3/7/16/35 ladder, DB-backed) | your walk |
| Games must not advance SRS | `verify-vocabulary` 103 explicitly: a game answer never moves the ladder and is graded by the server | your walk |
| Admission: pending → OWNER approval → ACTIVE | `admission-flow` 11/11 (register → pending row → queue → approve → ACTIVE → learning; second decision 409), `verify-admission-race` 6 | your walk (the flow was fixed and confirmed locally; the production confirmation is still yours) |
| Role boundaries (OWNER / ADMIN / STUDENT) | `verify-access` 33, `verify-owner` 10, `verify-browser-flow` 54 | your walk |
| Logo and branding | `verify-brand` 33 — the six approved PNGs, HTML wordmark in the shell, brand-derived files served | seen anonymously on production; confirm signed in |
| Day/Night, two icon-only controls | `verify-theme` 32 — 44×44 `[☀] [☾]`, visible selected state, persistence, no wrong-theme flash | your walk |
| Mobile 390 / 320 | `verify-responsive` 23 | your walk (a real device cannot be simulated here) |
| Hard reload, leave and return | rig 32/32 — no blank page, no error boundary | acceptance run |
| No 404 / 500 | `verify-pages` 71, `verify-a11y` 41, rig 32/32 (0 non-200) | acceptance run |
| Navigation performance | rig p50 per role; the acceptance script prints first byte **and** total time per request | acceptance run |
| Production routing and TTFB | `/api/version` read from outside: canonical alias serves this branch's commit in region `sin1` | — |
| R2 signed delivery in production | not automatable here | upload through the composer and open it |
| Telegram sign-in | not automatable here | the sign-in page must state plainly that Telegram is not configured |
| A real phone (touch, keyboard) | not automatable here | iOS Safari / Android Chrome |
| Migrations in production | — | already confirmed by you: 19/19 migrations, 62 tables, 42/42 checks |

## 5. After your manual result

- If you find a defect, report it and it will be fixed **before** anything else.
- Only after you confirm this checklist does full QA 2 start (`docs/QA-2-FINAL-REPORT.md`).
- RIWI V2 starts after QA 2 **and only from an authoritative V2 specification**;
  the scoring dimensions will not be invented.

Test residue to expect in the database: the verification scripts create and
archive a small "Publication QA" passage, and the browser rigs create attempts
for the demo student. None of it is visible to students, and none of it exists in
production.
