# V6 source-state/dependency gate

Baseline V5 `68778f85eb862206b22750656ccaea28fc8ac324`; source files unchanged. SHA256 provenance: `evidence/v6/phase2-source-audit.json`. Inventory counts remain115source pages (108canonical candidates),206components,214API routes. Protected redirects6 and retired Shadowing1 remain separate. CODE COMPLETE here means frontend code/source-state closure, NOT original rendered, live, backend or production acceptance. Linked future modules are not silently promoted.

## Phase2 reviewed sources and native closure

| Source | Native implementation / closure |
|---|---|
| shell/page.tsx, data/dashboard.ts, data/attempt-timeline.ts | generated/dashboard + modules/dashboard + adapters/dashboard; own summary, source URL metadata, attribution, unavailable/null behavior |
| progress/MockProgressOverview.tsx, MockBandPanel.tsx, progress/mock-summary.ts | generated/mock-band + mock-summary + native overview; source compact/full, chart last12, earned completed full bands, table disclosure, empty/unavailable/retry |
| shell/mocks/page.tsx, data/mocks.ts | generated/mocks; original catalogue/non-runner, own finished+unfinished, finishedCount, null scores/title fallbacks and independent notices |
| shell/reports/page.tsx | generated/reports + modules/reports; original role scopes/roster/query/caps/form/options/defaults/content/styles |
| reporter/access.ts, roster.ts, validation/like.ts | read-only server authority contract; client duplicates safe scope/subject validation, never substitutes authorization |
| reporter/period.ts, time.ts | reviewed build-time pure period conversion; same inclusive calendar/range/centre timezone validation |
| reporter/exports.ts, service.ts, api/reports/route.ts | existing binary API consumed; original server remains unchanged. File encoders and report generation NOT moved into browser |
| ui/Card,Button,Badge; lesson StateBadge; shell/session/dictionaries/time/native DOM | V5 dependencies reused unchanged, same CSS/assets/tokens. New reporters renderer is native DOM output, no framework runtime |

## Dashboard complete source states

- Greeting/source first name, target band/profile missing/unavailable, streak/writing/vocabulary/nullable counts, retention CTA, ContinueLearning/last activity (safe real deep URL), assignments/overdue/due dates, next live class, latest feedback/public attribution/weaknesses/estimate, four skill counts; original absent vs unavailable vs zero distinctions.
- Three concurrent independent reads: mock, dashboard summary, openLessons. Each pending/loading does not suppress siblings; source-success and legitimate empty states; HTTP/network/malformed/rejected region errors; retry only owned region; payload-level partial failures; signal cancellation/latest-version stale guard and session401 authority reconciliation.
- Lessons show even while summary waits/fails. Summary resolution reparents SAME lesson boundary into source card position; retry preserves exact lesson DOM identity. Source roadmap slice4/open-state rules remain server decisions. No locked lessons manufactured.
- Own completed earned full mocks only for chart; removed-test historical rows retained; unique current catalogue completed count not inflated. Chart compact/full last12points, progress values, native keyboard details table. No local grading/new attempts/runner.

## Mocks complete source states

Catalogue success/empty/unavailable; own attempts success/empty/unavailable; title lookup unavailable independent. FinishedCount and original total-count label; finished/unfinished status, finished date only when present, original band/raw-score formatting, null-score em dash, skill/title fallback. No action links or invented exam screens. All-source empty/notices and compact/full chart variants additionally unit-rendered. Malformed duplicate IDs/unknown flags/unsafe snapshot/questions/answers payloads rejected.

## Reports complete source states

- Owner ordered owner/teacher/student scopes; admin teacher/student; teacher teacher/student with explicit roster cap500; student self-only student scope, no selector. Source owner/admin query trim60/escaped server search/stable ordering/cap1000 and capped notice; empty student list and distinct teacher noRoster notice. UI never widens teacher roster or trusts caller role.
- Exact source default scope/monthly/pdf/current locale; all source periods/formats json,csv,xlsx,docx,pdf,zip; report language; custom dates and inclusive≤366day/calendar/reversed/future validation in centre timezone. Invalid scope/subject/language/period/format rejected before fetch; backend repeats authorization and all validation.
- Projection pending/error/malformed/network/retry/empty; old query/error/deep URL handled safely; search native Enter, query History/back; required/labeled native controls and focus retained on same-route locale refresh; selected form/search draft in private ephemeral route state only. Changing actor/route resets draft; downloaded blobs never persisted/replayed.
- Actual existing binary fetch, disabled/loading, cancellation and retry; MIME/attachment/empty checks; safe filename; objectURL cleanup on timer/new download/abort; structured localized errors;401 expiry reconciles authority without delivering a file. Cancel does not assert server generation/audit was undone.
- All six download event paths tested with synthetic bytes, NOT real PDF/Office/ZIP generation/live authorization acceptance. Existing source backend encoders/services were reviewed, not executed against private data.

## Gate evidence and limitations

Final normal `npm test`:236PASS/0FAIL/0SKIP (211preserved +25V6). Browser:214preserved +77V6 =291PASS/0FAIL/0SKIP. V6 matrix72cases:12viewport/locale/theme conditions ×(Dashboard +Mocks +4report roles), plus5adversarial/preference/expiry/navigation/performance journeys. Historical evidence preserved byte-for-byte by regression-v6 runner; fresh copies under evidence/v6/*-regression.

Additional V6 unit coverage: calendar/leap/invalid/reversed/future/range limits, noncustom stale-date omission, authorized membership, source scopes, empty/notices/null scores, earned summary/removed catalogue, full+compact chart, attachment/MIME/spoof/empty/401/abort, real lesson DOM identity. Historical V3/V4 tests retain network/delayed/retry/stale/private cache/rapid-back-forward/abort checks. One historical30msJSDOM history unit timed out while concurrently running full Chromium+unit workers; unchanged test passed in final236normal run after browser completion. No runtime router/test weakening.

Assets25PASS; original source CSS exact SHA b91507c391d30d49d1f9c2882fa10ae5835409f43866d9bedc578d6a26156ce2; deterministic compiled CSS SHA81c54121be20442dc586113abc6f29a27e18190a8790956b4c21f74614597250 (same as V5). Screenshot originals comparison0; live0; Safari0; hardware0; production0. Screenshots/fixtures alone are not parity acceptance.

## Remaining ordinary frontend work

Phase2 dependency gate closes3routes and2new source components; Phase1 unchanged10routes/51components. Cumulative13canonical complete,16partial,79notstarted;53components complete,8partial,145notstarted. Component percentages are inventory counts, not weighted whole-product implementation.35staff routes reserved to offline AI, no completion credited here. Other learner modules including Listening still require ordinary native frontend implementation; not all externally blocked. Server adapters/live/visual acceptance are separate integration work, not excuses to skip frontend.

Phase3 continuation: source audit in LISTENING_PHASE3_AUDIT_V6.md. No Listening runtime completion claim or new incomplete route rollout in this checkpoint.
