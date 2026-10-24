# V38 Listening Component Closure Matrix

Scope: the 24 original `src/components/listening/*` source files, as recorded in `docs/component-ledger-v37.json`. Statuses are the V37 ledger values; V38 did **not** promote any component. The counts below are re-derived from the ledger, not restated.

Counts (24): CODE COMPLETE 9 / IN PROGRESS 10 / NOT STARTED 5 (baseline 9/10/5 is unchanged).

Rules applied: a component is CODE COMPLETE only when every original required behavior it owns is implemented and supported tests pass. V38 found no component whose completion is proven; two components received source repairs (`ListeningExam.tsx` legacy submit error mapping; `McqMastery.tsx` MCQ Day reasoned transition), and both remain IN PROGRESS because their strict visual/original-source coverage is not closed. `StartTestButton.tsx` has no active learner caller (Staff `FullListeningLibrary` only); it is not invented into a learner route. The five NOT STARTED components are Staff/import dependencies and are excluded from the learner scope.

Ten PARTIAL components named in the V38 directive: AuthoredListeningFrame, FullExamStart, ListeningExam, ListeningMap, ListeningPractice, ListeningSectionHeading, ListeningSequenceLocked, McqMastery, NativeListeningExam, StartTestButton. All ten are IN PROGRESS in the table below.

| Original component | V37/V38 status | Native owner (V37 ledger) | Scope | V38 change |
|---|---|---|---|---|
| `AuthoredListeningFrame.tsx` | IN PROGRESS | authored.js + existing review/checkpoint/source/media owners | Learner component | V38: no change |
| `FullExamStart.tsx` | IN PROGRESS | exam-start.js | Learner component | V38: no change |
| `FullListeningActivity.tsx` | CODE COMPLETE | full-activity.js | Learner component | V38: no change |
| `FullListeningLibrary.tsx` | NOT STARTED | No implementation; Staff/import dependency | Staff/import exclusion (reserved) | V38: no change |
| `FullListeningStudy.tsx` | CODE COMPLETE | study.js | Learner component | V38: no change |
| `LessonQuizBlock.tsx` | CODE COMPLETE | lesson-quiz.js | Learner component | V38: no change |
| `ListeningAnalysis.tsx` | CODE COMPLETE | generated/listening-analysis.js | Learner component | V38: no change |
| `ListeningExam.tsx` | IN PROGRESS | legacy.js + media/material-player.js | Learner component | V38: Submit catch maps errors through request-errors failure(e,dict): 429 -> errorRateLimited, network -> errorNetwork, other -> errorServer. 409 still refreshes. Status unchanged (IN PROGRESS). |
| `ListeningImport.tsx` | NOT STARTED | No implementation; Staff/import dependency | Staff/import exclusion (reserved) | V38: no change |
| `ListeningLegacyImport.tsx` | NOT STARTED | No implementation; Staff/import dependency | Staff/import exclusion (reserved) | V38: no change |
| `ListeningLessonBody.tsx` | CODE COMPLETE | lessons.js + typed body renderer | Learner component | V38: no change |
| `ListeningMap.tsx` | IN PROGRESS | generated/listening-map.js | Learner component | V38: no change |
| `ListeningPractice.tsx` | IN PROGRESS | practice.js | Learner component | V38: no change |
| `ListeningSectionHeading.tsx` | IN PROGRESS | generated/listening-section-heading.js + existing shell layout | Learner component | V38: no change |
| `ListeningSequenceLocked.tsx` | IN PROGRESS | generated/listening-locked.js | Learner component | V38: no change |
| `ListeningSpeedPractice.tsx` | CODE COMPLETE | speed-practice.js | Learner component | V38: no change |
| `ListeningTestActions.tsx` | NOT STARTED | No implementation; Staff/import dependency | Staff/import exclusion (reserved) | V38: no change |
| `McqMastery.tsx` | IN PROGRESS | mcq.js | Learner component | V38: Reasoned completion in MCQ Day uses replaceState (same-path guarded) + refresh, matching original router.replace + router.refresh. Status unchanged (IN PROGRESS). |
| `NativeListeningExam.tsx` | IN PROGRESS | exam.js | Learner component | V38: no change |
| `SectionListeningActivity.tsx` | CODE COMPLETE | section.js / section-activity.js / existing exam owner | Learner component | V38: no change |
| `SectionRetakeButton.tsx` | CODE COMPLETE | start-attempt.js | Learner component | V38: no change |
| `SpeedTrainer.tsx` | CODE COMPLETE | revision.js | Learner component | V38: no change |
| `StartTestButton.tsx` | IN PROGRESS | start-attempt.js (no active learner library caller) | Learner component | V38: no change |
| `audio-probe.ts` | NOT STARTED | No implementation; Staff/import dependency | Staff/import exclusion (reserved) | V38: no change |
