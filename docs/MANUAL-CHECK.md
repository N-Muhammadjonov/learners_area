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

Accounts used for the walk (local seed, see `src/db/seed.ts` for the seeded
credentials — one OWNER, one ADMIN, two TEACHERs, two ACTIVE students, one
PENDING student). In production the OWNER account is the centre's own.

The automated equivalent of this document is `/tmp/bt/matrix.mjs` (5 accounts ×
every visible destination × 1512 / 820 / 390 / 320px × Day/Night × UZ/EN × hard
reload × client navigation). Current result: **157/157**.

## 2. The twenty reported blockers

| # | What you reported | What changed | How to check by hand | Status |
| --- | --- | --- | --- | --- |
| 1 | sidebar and page scroll together | the shell is viewport-locked; the rail and the main column are two independent scroll containers (`min-h-0` is what makes it work) | open a long passage, scroll the rail, then scroll the page | VERIFIED LOCALLY (`shell.mjs` 36/36) |
| 2 | 5–10 s click latency | per-question queries removed; list pages fetch materials in one query; autosave and search debounce instead of blocking | click between Reading → Vocabulary → Grammar and watch the heading | VERIFIED LOCALLY (72–96 ms warm on this machine); production EXTERNALLY UNVERIFIED |
| 3 | undersized authenticated UI | geometry tokens: rail 288/264px, topbar 68px, padding 32/28, content max 1440px, controls 46px, tabs 44px | look at any module page at 1440px | VERIFIED LOCALLY |
| 4 | weak hierarchy | section titles, card titles, meta text and empty states come from one type scale | compare the dashboard and the Reading hub | VERIFIED LOCALLY |
| 5 | unclear icon-only Day/Night | two separate 44×44 buttons `[☀] [☾]`, the active one visibly selected, labels on hover and for screen readers | click both, reload, check it is remembered | VERIFIED LOCALLY (`brand.mjs`, `matrix.mjs`) |
| 6 | no consistent Back | back + breadcrumbs from the route's *meaningful parent*, on every private page | open a passage → attempt, use Back, then reload | VERIFIED LOCALLY |
| 7 | Focus was unclear | floating bottom-right `[Focus mode (F)]` on practice pages; `Esc` exits; `F` is ignored while typing; timer/save/submit stay visible | open a Reading attempt, press `F`, then `Esc` | VERIFIED LOCALLY |
| 8 | no user-visible universal upload | one composer, eight content kinds: `/admin/materials` → kind → item; students see the attached blocks on the content's own page | as OWNER attach a text block to a grammar topic, then open that topic as a student | VERIFIED LOCALLY (`materials.mjs` 21/21, `composer.mjs` 16/16) |
| 9 | owner sidebar overload | learning mode has 13 rows; management is a separate mode with its own entry and exit | open the sidebar as OWNER on `/dashboard`, then go to `/admin/people` and look at the navigation again | VERIFIED LOCALLY |
| 10 | oversized raster logo | only derivatives are served (96px mark, 640px lock-up, 32/180px icons) with declared width and height | open dev tools, check the image sizes on any page | VERIFIED LOCALLY (`brand.mjs` 25/25) |
| 11 | empty-looking pages | real counts from the database, real empty states, no placeholder text | open `/admin/content` and the Reading hub | VERIFIED LOCALLY |
| 12 | broken/error routes | `/support` and `/admin/content` were visible in the menu and returned 404 — both pages now exist with real data | click every row in the sidebar | VERIFIED LOCALLY (`matrix.mjs` 157/157 — zero navigation 404s) |
| 13 | unnecessary top-level IELTS item | removed; there is one course and no switcher to promise | look at the MODULES group | VERIFIED LOCALLY (`shell.mjs`) |
| 14 | Reading looked empty | 105 passages imported, 104 published and one held back as a draft **because its source metadata does not match its extracted text** | open `/reading` | VERIFIED LOCALLY (importer `--verify`; see `READING-105-IMPORT-REPORT.md`) |
| 15 | no Reading search/filter | status + topic + question-type filters, AND semantics, reset, state in the URL, pagination | filter by topic, reload the page, press reset | VERIFIED LOCALLY (`reading.mjs` 28/28) |
| 16 | weak global search | grouped results by category (only categories with matches), 300 ms debounce, minimum two characters, `Cmd/Ctrl + K`, results filtered by role on the server | search for a passage title and for a word | VERIFIED LOCALLY |
| 17 | blank on hard reload | pages render server state; the correct theme is on the page before the first byte; an open Reading attempt restores the saved answers | open an attempt, answer two questions, reload | VERIFIED LOCALLY (`practice.mjs` 27/27) |
| 18 | empty states looked broken | one empty-state component, honest wording, a way out of the state | open a module with no content for a student | VERIFIED LOCALLY |
| 19 | English-only errors under UZ | error/loading/not-found and every new string exist in UZ and EN | switch to UZ and visit a page that cannot be loaded (e.g. a malformed id) | VERIFIED LOCALLY; source passages stay in English because the material itself is English |
| 20 | unclear controls | every control in `UI-ACTION-MATRIX.md` has a label, states, permission and an evidence line | spot-check a few rows from that document | VERIFIED LOCALLY |

## 3. Known exceptions (deliberate, reported)

| Item | Why it is this way |
| --- | --- |
| Speaking materials keep their own block editor | those rows carry a resolved public `object_url` rather than a private key, so folding them into the universal `resource_blocks` table would silently change how their files are delivered. The universal composer covers the other seven kinds today; the Speaking migration is a separate, explicit decision |
| One Reading passage stays a DRAFT (`t29-p2`) | the source promises 892 words and its text contains ~546. Publishing it would mean inventing text to reach a count |
| No visible "Coming soon" modules | the brief forbids pretending: a module that is not built is not advertised |
| Mock tests have no runner | the page says what a mock is here instead of pretending to run one |
| No AI provider is active | `REAL_AI_ENABLED=false`; no acoustic or AI-examiner claim is made anywhere |

## 4. What the sandbox could not check (please check these yourself)

| Item | Where |
| --- | --- |
| Production routing, real TTFB, p95 latency | Vercel deployment |
| R2 signed delivery in production | upload a file through the composer and open it |
| Telegram sign-in | the sign-in page — it must state plainly that Telegram is not configured if it is not |
| A real phone (touch feel, keyboard behaviour) | iOS Safari / Android Chrome |
| Migration 0017 + 0018 applied to production | `migrate-production.mjs --apply`, then `verify-production-schema.mjs` (expect 19/19 migrations, 62 tables, 42/42 checks; locally 41/42 because the demo accounts exist there by design) |

## 5. After your manual result

- If you find a defect, report it and it will be fixed **before** anything else.
- Only after you confirm this checklist does full QA 2 start (`docs/QA-2-FINAL-REPORT.md`).
- RIWI V2 starts after QA 2 **and only from an authoritative V2 specification**;
  the scoring dimensions will not be invented.

Test residue to expect in the database: the verification scripts create and
archive a small "Publication QA" passage, and the browser rigs create attempts
for the demo student. None of it is visible to students, and none of it exists in
production.
