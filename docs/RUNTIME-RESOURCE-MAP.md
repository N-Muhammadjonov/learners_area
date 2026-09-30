# Runtime Resource Map

Baseline: `0f4a6eaed94da4254789c3c89f8c2871ab96959e` (integrated Part 1, ARENA-VERIFIED, not yet OWNER-VERIFIED).
Measurements: local `next start` production build + PGlite socket DB, seeded demo data, `curl` against `127.0.0.1:3000`
as `demo.student`. They are sandbox numbers only — not Preview/Production latency.

Legend — Type: STATIC_COMMON, USER_READ, USER_MUTABLE, SECURITY_AUTHORITY, DERIVED_AGGREGATE, LARGE_BINARY,
EPHEMERAL_UI, RETENTION_AUTHORITY, RETENTION_PROTECTED. "Client cache" means the new memory-only, user-scoped
`privateResources` cache (`src/lib/client/private-resource.ts`).

## Shell / security (all sections)

| Resource | Type | Producer → consumer | Fetch path / queries | User-scoped | Cacheable | Stale OK | Invalidation | Failure scope | Prefetch | Security |
|---|---|---|---|---|---|---|---|---|---|---|
| Current user + role + accountStatus | SECURITY_AUTHORITY | `getCurrentUser()` → `(app)/layout.tsx`, every page/API | DB read per request (React `cache` per request) | yes | **never** on client | no | every request | LEVEL 1 (redirect /login, /pending) | shell only | DB-authoritative |
| Locale / theme | EPHEMERAL_UI | cookies → layout | cookie | yes | cookie | yes | LocaleSwitcher → `router.refresh()` (retained: whole tree is localized) | local | yes | none |
| Section entry frames | STATIC_COMMON | `sectionEntryFrames(dict)` → InstantInteractionProvider | in-memory | no | yes (props) | yes | deploy | none | yes | none |

## Vocabulary

| Resource | Type | Fetch path | Size (seed) | Queries | User | Client cache | Freshness | Invalidation trigger | Failure scope | Pagination | Prefetch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Frame + packs | STATIC_COMMON | RSC `/vocabulary` (auth + locale only) | 113 KB HTML | auth only | frame only | RSC | per deploy | — | LEVEL 1 | — | route code (loading boundary) |
| Library first page | USER_MUTABLE | `GET /api/vocabulary?limit=50&offset=0` | 2.6 KB | 1–2 | yes | yes `vocabulary:library:first:50` | 30 s fresh, then stale-while-revalidate | save/delete/move word, games answer, Use It, SRS review | LEVEL 2 (library region) | offset, 50/page | no |
| Summary (counts, due) | DERIVED_AGGREGATE | `GET /api/vocabulary/summary` | 175 B | 1 | yes | yes `vocabulary:summary` | 30 s / SWR | same as library | LEVEL 3 (summary region) | — | no |
| Folders | USER_MUTABLE | `GET /api/vocabulary/folders` | 24 B | 1 | yes | yes `vocabulary:folders` | 30 s / SWR | folder create/rename/delete, word save | LEVEL 3 | bounded by owner | no |
| Revision (due queue) | USER_MUTABLE | `GET /api/vocabulary/due?limit=40` | 2.5 KB | 1 | yes | **no** (always fresh SRS queue) | fresh | review | LEVEL 2 (revision region) | limit 40 | no |
| Standing / leaderboard / awards | DERIVED_AGGREGATE | `GET /api/vocabulary/leaderboard[?view=]` | small | 1–3 | mixed | no (ledger must be current) | fresh; `vocab:ledger-changed` event | awards | LEVEL 3 (board region) | top N | no |
| Use It history / picker | USER_READ | `GET /api/vocabulary/sentences?view=history|words&limit=100` | small | 1 | yes | no | fresh | sentence submit | LEVEL 3 (each list) | limit 100 | no |
| Games sets | USER_READ | `/vocabulary/games` RSC + `/api/vocabulary/games` | 115 KB HTML | per game | yes | no | fresh | answer | LEVEL 2 (games route) | per set | links `prefetch={false}` (pre-existing) |
| Search | USER_READ | `GET /api/vocabulary/search` (debounced) | small | 1 | yes | no | per keystroke | — | local dropdown | limit | no |

## Reading / Listening / Writing / Grammar / Dashboard / Notes / TED-PODCAST

| Resource | Type | Fetch path | User | Client cache | Failure scope | Notes |
|---|---|---|---|---|---|---|
| Reading catalog + counts | STATIC_COMMON + USER overlay | RSC `/reading` → `reading-library.ts` (bounded, paginated server-side) | overlay yes | no (RSC) | LEVEL 2 with region notices (Part 1) | unchanged; 0.06–0.10 s local |
| Reading passage / attempt / draft | USER_MUTABLE | RSC `/reading/attempts/[id]` + attempt APIs (`requestJson`, 25 s deadline) | yes | no | LEVEL 2 | ownership checked server-side |
| Saved vocabulary from Reading (ClickableText) | USER_MUTABLE | `POST /api/vocabulary` | yes | invalidates `vocabulary:` | local popover | narrow invalidation added |
| Listening catalog / attempts | STATIC_COMMON + USER_MUTABLE | RSC + `/api/listening/*` | overlay | no | LEVEL 2 | unchanged |
| Writing prompts / drafts / feedback | USER_MUTABLE | RSC + `/api/writing/*` | yes | no | LEVEL 2 | AddVocabQuick now invalidates `vocabulary:` |
| Grammar topics / exercises | STATIC_COMMON | RSC `/grammar` (`lib/data/grammar.ts`) | no | no | LEVEL 2 | unchanged |
| Grammar mastery / attempts | USER_MUTABLE | RSC + `/api/grammar/*` | yes | no | LEVEL 3 region | unchanged |
| Dashboard aggregates | DERIVED_AGGREGATE | RSC `/dashboard` (`lib/data/dashboard.ts`, per-region catch) | yes | no | LEVEL 3 regions | unchanged |
| Notes (video lessons) | USER_MUTABLE | `/api/video-lessons/*/notes` | yes | no | local | unchanged |
| TED/PODCAST media | LARGE_BINARY | R2 signed URLs via storage service | authorized | browser HTTP cache only | local player | unchanged |

## Retention (exception class — see RUNTIME-STABILITY-ARCHITECTURE.md §19)

| Resource | Type | Fetch path | Client cache | Prefetch | Notes |
|---|---|---|---|---|---|
| Hub frame, summary, history page 1 | USER_READ | RSC `/reading/retention` (3 independent owner-scoped reads, now concurrent) | **never** | links `prefetch={false}` | each read has its own `.catch` region |
| Live attempt payload (phase, deadline, source during Reading only) | RETENTION_AUTHORITY / RETENTION_PROTECTED | `buildAttemptPayload(live, new Date(), db)` in RSC; `GET /api/retention/attempts/[id]` | **never**; `fetchPrivateJson` refuses `/api/retention` | never | server time; source stripped server-side after Reading |
| Start / allocation | RETENTION_AUTHORITY (CLASS E) | `POST /api/retention/attempts` (transactional) | never | never (POST, button only) | verified: 3× prefetch-header GET + 3× GET of the hub left `retention_attempts` count at 0 |
| Draft | RETENTION_AUTHORITY | `PATCH …/draft` | never | never | Saved only after server ack (unchanged) |
| Submit / timeout / score | RETENTION_AUTHORITY | `POST …/submit` | never | never | idempotent server finalization (unchanged) |
| Bank / Measurement Structure | RETENTION_PROTECTED | Management only | never | never | never in learner payloads |
