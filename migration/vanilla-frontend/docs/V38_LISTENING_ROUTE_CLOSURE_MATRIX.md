# V38 Listening Route Closure Matrix

Baseline: V37 `79a289298f25a26e4804168df9d228129294a024`. V38 work is uncommitted at the time this file was written; see the implementation report for the final commit.

Status rule: a route is CODE COMPLETE only when every original required frontend behavior is implemented and supported tests pass, and its visual/original-source coverage is not left as a known failure. **No target route is promoted in V38.** Route counts stay at 9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED (16 canonical). The 15/15 learner-route figure is a target, not a claim.

V38 method: read-only branch comparison of each original route file against the native dispatcher and owner module, followed by focused browser checks. Only two real behavior divergences were found and repaired (see "V38 change"). Everything else listed as "remaining" below was NOT implemented in V38.

## Summary

| # | Route (native) | Original source | V37 | V38 status | V38 change | Remaining original work (not done in V38) |
|---|---|---|---|---|---|---|
| 1 | `/app/listening/tests/:id` (Hub) | `src/app/app/(focus)/listening/tests/[id]/page.tsx` | IN PROGRESS | IN PROGRESS | none | Hub-768-UZ-day strict visual FAIL (max channel delta 1, unresolved); live `/api/frontend/view` integration UNVERIFIED; no V38 keyboard/touch/back-forward/disposal pass was executed for the hub. |
| 2 | `/app/listening/tests/:id/:activity` | `…/tests/[id]/[activity]/page.tsx` | IN PROGRESS | IN PROGRESS | none | Per-source journeys for Map, Choose TWO, Completion, Vocabulary are not closed across the 32 original sources; Script source-specific coverage is V37's 30 PASS / 2 BLOCKED (Tests 10, 25). |
| 3 | `/app/listening/attempts/:id` | `…/attempts/[id]/page.tsx` | IN PROGRESS | IN PROGRESS | legacy submit error mapping | Legacy in-progress exam has no strict visual evidence; source-specific attempt states across sources not closed; other-user refusal is server-side and not re-verified in V38. |
| 4 | `/app/listening/attempts/:id/revision` | `…/attempts/[id]/revision/page.tsx` | IN PROGRESS | IN PROGRESS | none (V37 SpeedTrainer attempt-ID fix preserved) | Five strict visual FAILs (1440 EN/UZ day/night; 768 EN night) not investigated in V38; Review Phase2 A–J remains a BLOCKED owner decision. |
| 5 | `/app/listening/mcq` (library) | `src/app/app/(shell)/listening/mcq/page.tsx` | IN PROGRESS | IN PROGRESS | none | Live catalogue/mastery data UNVERIFIED; no V38 loading/error/retry pass; responsive/EN-UZ/theme strict visual evidence limited to V37 fixtures. |
| 6 | `/app/listening/mcq/day/:day` | `src/app/app/(shell)/listening/mcq/day/[day]/page.tsx` | IN PROGRESS | IN PROGRESS | reasoned transition: replaceState + refresh | Live authorized session/expiry UNVERIFIED; original-state visual not closed; no V38 grading-state pass beyond the synthetic six-stage fixture. |

Counts after V38: unchanged (9/6/1 canonical; 9/10/5 components).

## Per-route detail

### 1. `/app/listening/tests/:id` (Hub)

- Original branches (`tests/[id]/page.tsx`): not-found, locked, authored (runtime) and hub. Native dispatcher `hub.js` routes `not_found`, `locked`, `authored` and `hub` adapter kinds; an unrecognized kind throws `Unknown Listening hub adapter kind` (not reached for valid adapter output).
- V38 comparison: no missing branch found. No file changed.
- Not closed: visual (hub 768 UZ day FAIL), live data, and the keyboard/touch/history/disposal items in the V38 directive were not exercised by a V38 browser pass.

### 2. `/app/listening/tests/:id/:activity`

- Original branches (`tests/[id]/[activity]/page.tsx`): activity 1 → FullExamStart; activities 2–5 → FullListeningActivity; practice kinds (matching, completion, retry, map) → ListeningPractice; `mcq` → test-mcq (CODE COMPLETE sub-route); `study` → study (CODE COMPLETE); authored runtime → redirect to the hub; study/mcq with exam in progress → `fullListeningHub.research.examLocked`.
- Native dispatcher `route-v7.js` has a throw fallthrough (`Source mode not yet implemented`) for unhandled kinds. V38 found no unhandled kind for the supported activity set.
- V38 comparison: no missing branch found. No file changed.
- Not closed: per-source journeys for all supported sources (V37 Script sweep is 30 PASS / 2 BLOCKED, Tests 10 and 25 BLOCKED on external timing data; no clamping or guessing is permitted).

### 3. `/app/listening/attempts/:id`

Original branches (`attempts/[id]/page.tsx`) and native owner:

| Original condition | Native owner | V38 verdict |
|---|---|---|
| section in_progress → SectionListeningActivity | `section.js` | branch present |
| no section, package completed → redirect `/tests/:id/2` | `route-v7.js` redirect | branch present |
| no section, package in_progress → NativeListeningExam | `exam.js` | branch present |
| section finished → ListeningAnalysis | `section.js` | branch present |
| legacy in_progress → ListeningExam | `legacy.js` | branch present; **V38 repair** below |
| legacy completed → revision link, ListeningAnalysis, transcript, OwnerMaterialBlocks | `review.js` / `ListeningAttemptPage-v8` | branch present; `data-revision-link` present |

**V38 change (`modules/listening/legacy.js`):** the submit catch set `error=dict.auth.errorServer` for every non-409 failure. It now uses `failure(e,dict)` from `js/request-errors.js`, so 429 maps to `errorRateLimited`, network failures to `errorNetwork`, and other failures to `errorServer`. 409 still refreshes. The first attempt, `failure(e,dict.auth)`, was wrong (the helper signature is `failure(error, dict, known)`) and was corrected before verification.

**Focus entry (verified, no change):** the original in-progress `ListeningExam` calls `useFocusEntry`, but the original `(focus)` layout does not render `ShellUtilities` (only `src/app/app/(shell)/layout.tsx` does), so there is no subscriber. The native legacy route stays `dataset.focus='off'`, matching the original. A `announceFocusEntry` call was added and reverted in V38 because it would add behavior the original does not have.

Not closed: source-specific attempt states across the 32 sources; authorized other-user refusal re-verification; visual evidence for the legacy in-progress state.

### 4. `/app/listening/attempts/:id/revision`

- Branches (`revision.js`): mistake map, weakest areas, keywords, paraphrase table, SpeedTrainer, MCQ mastery, vocabulary, back-to-analysis link. In-progress attempt → not-found (server contract).
- V37 fix preserved: SpeedTrainer receives the attempt ID (asserted by `browser-listening-revision-v37.mjs`, exit 0, 1 PASS / 0 FAIL).
- Strict visual FAILs (V37): revision 1440 EN day, 1440 EN night, 1440 UZ day, 1440 UZ night, 768 EN night. Cause not investigated in V38; see the visual document.
- Not closed: the Review Phase2 A–J release is a BLOCKED owner decision; this does not block the frontend but blocks any Review release claim.

### 5. `/app/listening/mcq` (library)

- Branches (`views/listening-mcq.js`): catalogue, availability, mastery/progress, sections, badges, empty state, card actions. Read-only comparison with the original `(shell)/listening/mcq/page.tsx`: faithful; no change.
- Not closed: live catalogue/mastery binding (UNVERIFIED); loading/error/retry states were not exercised in V38; responsive/EN-UZ/theme coverage is the V37 fixture set only.

### 6. `/app/listening/mcq/day/:day`

- Original `McqMastery.tsx` (`openDrill` POST `/api/listening/mcq`; advance PATCH `/api/listening/mcq/:sessionId`; reasoned → `router.replace(currentHref)` + `router.refresh()`).
- **V38 change (`modules/listening/mcq.js`):** reasoned completion previously called `context.navigate(currentHref,{replace:true})`. `js/router.js` `render()` focuses `h1` or `[data-shell-main]` whenever `navigation.refresh` is false, and `navigate` clears per-route state. The repair uses `history.replaceState` (guarded, same path only) followed by `context.refresh()`, matching the original sequence. The discriminating check records `focusin` targets during the reasoned transition.
- Not closed: live authorized session expiry and grading (UNVERIFIED); original-state visual; the day-validation and correct-answer disclosure rules were not re-audited in V38.
