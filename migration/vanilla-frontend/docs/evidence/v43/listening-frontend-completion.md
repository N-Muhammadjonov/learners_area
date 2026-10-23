# Learner Listening frontend: completion check (V43)

Scope: learner-facing Lessons, Tests (hub, activities, study, Academic/General, attempts, revision) and MCQ Mastery
(programme catalogue, daily questions, drill). Synthetic fixtures; no live backend, no hardware, no Staff pages.
Reference: original Next.js source under `src/app/app/(shell|focus)/listening/**` and `src/components/listening/**`.

## Result

| Section | Status | Basis |
| --- | --- | --- |
| Lessons | COMPLETE | Catalogue→detail, tabs (`?tab=`, reload-safe), back link, not-found, body blocks (text/audio/video/image/file/link/quiz/reference), quiz verdicts, lesson media (direct audio, provider link), description focus and minutes, private notes (`browser-v10`, `browser-listening-v42`, `browser-listening-v43`) |
| Tests | COMPLETE for the frontend | Hub, Activities 1–5, practice, study, Academic/General, attempts/history, revision, lexical and media behaviour are covered by `browser-v8/v9/v10/v11`, `browser-listening-v38/v39/v40`, `browser-listening-revision-v37`. One real defect was found and fixed here (see below). |
| MCQ Mastery | COMPLETE for the frontend | Programme catalogue states, locked/draft/empty, day page progress and `?q=` steps, six-stage drill with multi-choice, reasoned refresh (`browser-listening-v41`, `browser-listening-v38`, `browser-v8`, `browser-listening-v42`) |

Not part of frontend completion (kept separate, unchanged): live `/api/*` integration, authorized live eligibility,
hardware and Safari acceptance, strict pixel-visual acceptance (the Hub 768×1024 UZ Day case remains a documented
historical FAIL), Review "Phase 2" stability gate (owner-blocked), Script tests 10 and 25 (external timing, blocked),
and Staff pages (Admin Listening import placeholder kept by owner decision).

## Real defect found and fixed

**Activity 3 Script Completion ignored typed gap answers on real script packages.**
`activityIds()` (`js/adapters/listening-activity-v8.js`) took Activity 3 keys only from `keyword1`. The server sends
script parts *instead of* keyword1 (`src/lib/listening/activities.ts`: `keyword1 && !script`), with `keyword1: []`.
So every script gap key was outside the allowed set: `answer()` dropped the typed text, Check all stayed disabled,
and draft restore discarded the answers. The fixture used by V39 kept keyword1 alongside script parts, which the
server never sends, so it passed by accident.

Fix: Activity 3 allowed keys are the keyword1 numbers plus every script gap number. No write format change.

Evidence: `browser-listening-v43.mjs`, 3 cases (part switching keeps typed answers; Check all gating; reveal and one
write with answers). Against the pre-fix adapter all 3 FAIL; against the fix all 3 PASS.

## Checked against the original, no defect

- MCQ drill payload gating: options from `revealed`, outcome and key from `chosen` (server `optionsVisible` /
  `outcomeVisible` match the native validator).
- Lesson block kinds and content-reference problems render as in `ListeningLessonBody.tsx`.
- ListeningMap is a static SVG in the original (no drag); native renders the same SVG.
- Study and Exam answer keys (question numbers) match their original renders.
- Activity 4 keyword2 and recall are exclusive on the server, so the native single-branch key set is correct.

## Test results (final build)

| Suite | Result |
| --- | --- |
| browser-v8 | 79 PASS / 0 FAIL |
| browser-v9 | 29 PASS / 0 FAIL |
| browser-v10 | 53 PASS / 0 FAIL |
| browser-v11 | 18 PASS / 0 FAIL |
| browser-v7 | 26 PASS / 0 FAIL |
| browser-listening-v38 | 5 PASS / 0 FAIL |
| browser-listening-v39 | 78 PASS / 0 FAIL |
| browser-listening-v40 | 47 PASS / 0 FAIL |
| browser-listening-v41 | 17 PASS / 0 FAIL |
| browser-listening-revision-v37 | 1 PASS / 0 FAIL |
| browser-listening-v42 | 8 PASS / 0 FAIL |
| browser-listening-v43 | 5 PASS / 0 FAIL |
| npm test (unit) | 605 PASS / 0 FAIL |
| npm run check:assets | PASS |

Mutant checks: V43 fails on the pre-fix adapter (3/3). V42 landing check recognises a push-based regression only
where the redirect module runs; the landing is done by `canonicalPath()` with `replaceState`, which the check verifies.
