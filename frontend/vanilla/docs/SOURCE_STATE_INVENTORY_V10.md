# V10 source/state inventory — continue, do not restart

Exact V9 baseline b9d9c8517c1301ea3e75ed632b23c5b40c2d452b. Native DOM/Fetch/History/ES modules only, reviewed build-time source presentation extraction. Preserved Phase1/2/V7/V8/V9 General controllers and historical archives. No staff/source/backend/cloud changes.

| Source surface | Native owner | Gate |
|---|---|---|
| Academic catalogue and own history | modules/listening/catalogue-v10.js + original generated source views; adapters/listening-v10.js | FRONTEND CODE COMPLETE / FIXTURE VERIFIED |
| Academic detail | catalogue-v9.js + strengthened academicDetailDTO; exact original registry redirect/order/results | FRONTEND CODE COMPLETE / FIXTURE VERIFIED |
| Hub summary/lock/not-found | hub.js + hubDTO | Implemented, whole authored hub remains PARTIAL |
| Learner lesson list/detail/tabs | lessons.js + source-native ListeningLessonPage-v10 / existing catalogue | FRONTEND CODE COMPLETE / FIXTURE VERIFIED |
| Eight lesson body block types | ListeningLessonBody-v10.js | Leaf FRONTEND/FIXTURE complete |
| Lesson quiz | lesson-quiz.js + LessonQuizBlock-v10.js; existing server answer API | Leaf FRONTEND/FIXTURE complete |
| Listening private notes | modules/notes/lesson-notes.js; source LessonNotesPanel-v10 presentation | Listening consumer complete; shared course/Reading/Grammar integration remains PARTIAL |
| Original/shared uploaded media | authored.js + authored-progressive.js + preserved source-derived media bridge/controller | Paint-before-audio implemented, full universal behavior PARTIAL |
| Generic uploaded native media | post-paint parent authorized blob read, opaque child-owned objectURL | After-paint full blob, NOT universal progressive range |
| FullListeningLibrary/ListeningTestActions | only original Admin caller | Reserved; no staff or invented learner implementation |
| Lesson author desk | source requiresStaff/mayAuthorContent | Reserved; no learner create/edit/save/delete/publication permission exists |

Source references: src/app/app/(shell)/listening/{academic,history,lessons}/; src/components/listening/{ListeningLessonBody,LessonQuizBlock}.tsx; src/components/notes/LessonNotesPanel.tsx; src/lib/content/{lesson-library,lessons}.ts; src/app/api/lessons/[id]/notes/route.ts and /api/lessons/blocks/[blockId]/answer. Existing API loaders, not client roles, decide ownership/publication/grades. New frontend view projections remain proposed, not deployed APIs.

No source pagination on Academic/history/lesson catalogue: preserve all rows and query/hash, never invent page links/limits. General pagination unchanged. Owner authentication/publication/sequence checks remain server-authoritative. No private curriculum/answer/media shipped.

## Actual-original evidence is deliberately narrow

Optional tests/browser-original-source-v10.mjs reads original source.html and adaptation TS from ORIGINAL_SOURCE_ROOT in memory. It stores only identity/navigation assertions, no content/screenshots. Actual9 named source buttons open/return in one opaque hydrated generation. Comprehensive closures remain0/9; source availability is NOT an excuse to mark ordinary full workflow work externally blocked. Protected audio/live server and full timer/note/flag/checkpoint/grading/provider gates remain unverified.

## Remaining, in order

1. Genuine nine original Test1 full behavior, not enum/identity tests; real source Map and A–E ChooseTWO, exact transcripts/controls/timers/notes/flags/autosave/resume/submit/review; server-authoritative grading/release must remain, no new client grading.
2. Universal private/public/YouTube media across all callers: range, authorized seeking/expiry/revocation/retry/position, no orphaned audio/listeners/URLs/nodes over rapid and repeated navigation. Generic post-paint blobs are not a universal range solution. Strict standalone external-media CSP not loosened; owner-approved origin normalization/integration needed.
3. Remaining legacy exam/revision/standalone MCQ and shared all-caller gates. Preserve all accepted General/exam/activity/study/MCQ/retake/highlight/vocabulary controllers; do not duplicate.
4. Staff authoring/library remains parallel35 routes (23 Admin/6 Owner/6 Teacher). Only reconcile latest shared V10 manually; never merge stale V4 wholesale. No learner authoring product invented.
5. Backend view DTO implementation and live original-rendered/authorization/provider/ownership testing with owner approval, not fake integration. Reading only after actual Listening completion.

Counts:22/15/71 of108 canonical;62/17/127 of206 components. Listening9/6/1 of16 routes;9/10/5 of24 source components. Two redirects separate. All acceptance=false at product/live level.323 units; Chromium 478 PASS/0 FAIL/0 SKIP. Source/fixture identity ≠ pixel parity; Chromium ≠ Safari; fake media ≠ hardware. Production NONE.
