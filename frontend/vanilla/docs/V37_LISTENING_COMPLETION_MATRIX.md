# V37 Listening completion matrix — incomplete overall

Baseline **62076acc0178602c0bd87025f5c542510242bc1e**, same Arena branch. Listening supersedes course video/Grammar priority. **This is not whole-Listening completion or release approval.** No main merge, deployment, new backend, Staff implementation, educational reconstruction or ZIP. Human project owner authorizes implementation; separate unsigned Phase2 A–J release decision remains BLOCKED and does not block frontend work.

Historical counts are preserved, not silently relabeled: 16 canonical Listening routes = **9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED**. Target = 15 learner routes; historical frontend-code-complete count remains **9/15**, not 15/15 or 16/16. Full accepted/parity status is not established; do not confuse this historical code count with strict original/live acceptance. 24 components = **9 CODE COMPLETE / 10 IN PROGRESS / 5 NOT STARTED**. Global108 routes22/18/68;206components62/19/125;35 Staff routes reserved. CODE COMPLETE is historical frontend/fixture scope, not accepted production or comprehensive original parity.

## All16 canonical routes
| Route | Before → after | Native owner / evidence |
|---|---|---|
| `/app/listening/attempts/:id` | IN PROGRESS → unchanged | route-v7.js → section.js / exam.js / legacy.js |
| `/app/listening/attempts/:id/revision` | IN PROGRESS → unchanged | route-v7.js → revision.js |
| `/app/listening/tests/:id/:activity` | IN PROGRESS → unchanged | route-v7.js → exam-start.js / full-activity.js / practice.js |
| `/app/listening/tests/:id/mcq` | CODE COMPLETE → unchanged | route-v7.js → test-mcq.js → mcq.js |
| `/app/listening/tests/:id` | IN PROGRESS → unchanged | hub.js → authored.js or generated/listening-hub.js |
| `/app/listening/tests/:id/study` | CODE COMPLETE → unchanged | route-v7.js → study.js |
| `/app/listening/academic/:testId` | CODE COMPLETE → unchanged | catalogue-v9.js → generated/AcademicListeningTestPage-v9.js |
| `/app/listening/academic` | CODE COMPLETE → unchanged | catalogue-v10.js → generated/views/listening-academic.js |
| `/app/listening/general/:sectionId` | CODE COMPLETE → unchanged | catalogue-v9.js → section.js / section-activity.js |
| `/app/listening/general` | CODE COMPLETE → unchanged | catalogue-v9.js → generated/views/listening-general.js |
| `/app/listening/history` | CODE COMPLETE → unchanged | catalogue-v10.js → generated/views/listening-history.js |
| `/app/listening/lessons/:lessonId` | CODE COMPLETE → unchanged | lessons.js → lesson-quiz.js / original typed body renderer |
| `/app/listening/lessons/author` | NOT STARTED → unchanged | Staff author route: NOT IMPLEMENTED / RESERVED |
| `/app/listening/lessons` | CODE COMPLETE → unchanged | lessons.js → original list renderer |
| `/app/listening/mcq/day/:day` | IN PROGRESS → unchanged | mcq-day.js → mcq.js |
| `/app/listening/mcq` | IN PROGRESS → unchanged | shell data-view → generated/views/listening-mcq.js |
## All24 components
| Source component | Before → after | Scope |
|---|---|---|
| `AuthoredListeningFrame.tsx` | IN PROGRESS → unchanged | authored.js + existing review/checkpoint/source/media owners; Existing learner implementation; no whole-component acceptance promotion |
| `FullExamStart.tsx` | IN PROGRESS → unchanged | exam-start.js; Existing learner implementation; no whole-component acceptance promotion |
| `FullListeningActivity.tsx` | CODE COMPLETE → unchanged | full-activity.js; Existing learner implementation; no whole-component acceptance promotion |
| `FullListeningLibrary.tsx` | NOT STARTED → unchanged | No implementation; Staff/import dependency; Staff/Admin only; no migration implementation |
| `FullListeningStudy.tsx` | CODE COMPLETE → unchanged | study.js; Existing learner implementation; no whole-component acceptance promotion |
| `LessonQuizBlock.tsx` | CODE COMPLETE → unchanged | lesson-quiz.js; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningAnalysis.tsx` | CODE COMPLETE → unchanged | generated/listening-analysis.js; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningExam.tsx` | IN PROGRESS → unchanged | legacy.js + media/material-player.js; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningImport.tsx` | NOT STARTED → unchanged | No implementation; Staff/import dependency; Staff/Admin only; no migration implementation |
| `ListeningLegacyImport.tsx` | NOT STARTED → unchanged | No implementation; Staff/import dependency; Staff/Admin only; no migration implementation |
| `ListeningLessonBody.tsx` | CODE COMPLETE → unchanged | lessons.js + typed body renderer; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningMap.tsx` | IN PROGRESS → unchanged | generated/listening-map.js; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningPractice.tsx` | IN PROGRESS → unchanged | practice.js; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningSectionHeading.tsx` | IN PROGRESS → unchanged | generated/listening-section-heading.js + existing shell layout; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningSequenceLocked.tsx` | IN PROGRESS → unchanged | generated/listening-locked.js; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningSpeedPractice.tsx` | CODE COMPLETE → unchanged | speed-practice.js; Existing learner implementation; no whole-component acceptance promotion |
| `ListeningTestActions.tsx` | NOT STARTED → unchanged | No implementation; Staff/import dependency; Staff/Admin only; no migration implementation |
| `McqMastery.tsx` | IN PROGRESS → unchanged | mcq.js; Existing learner implementation; no whole-component acceptance promotion |
| `NativeListeningExam.tsx` | IN PROGRESS → unchanged | exam.js; Existing learner implementation; no whole-component acceptance promotion |
| `SectionListeningActivity.tsx` | CODE COMPLETE → unchanged | section.js / section-activity.js / existing exam owner; Existing learner implementation; no whole-component acceptance promotion |
| `SectionRetakeButton.tsx` | CODE COMPLETE → unchanged | start-attempt.js; Existing learner implementation; no whole-component acceptance promotion |
| `SpeedTrainer.tsx` | CODE COMPLETE → unchanged | revision.js; Existing learner implementation; no whole-component acceptance promotion |
| `StartTestButton.tsx` | IN PROGRESS → unchanged | start-attempt.js (no active learner library caller); Only caller FullListeningLibrary; management=true in sole active Admin page bypasses legacy learner button. No active learner caller in this checkout; historical partial retained, not falsely promoted. |
| `audio-probe.ts` | NOT STARTED → unchanged | No implementation; Staff/import dependency; File metadata probe for ListeningLegacyImport (and re-export from ListeningImport), not learner playback or diagnostics. Reserved Staff import dependency. |
## Actual nine workflows
| Actual workflow | Before | V37 implementation/evidence | Remaining acceptance |
|---|---|---|---|
| Full IELTS Test | FRONTEND CODE COMPLETE | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |
| Review & Revision | PARTIAL | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; Phase2 release decision separate |
| Script Completion | PARTIAL | Existing Script owner decorated: accessible tabs/gaps/status; part URLs, keyboard, Back/Forward/reload; 12-condition original-source fixture matrix | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |
| MCQ Mastery | PARTIAL | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |
| Map Mastery | PARTIAL | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |
| Choose TWO Mastery | PARTIAL | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |
| Completion Mastery | PARTIAL | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |
| Vocabulary Builder | PARTIAL | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |
| Retry Weak Areas | FRONTEND CODE COMPLETE | Existing original/native owner retained; mandatory regressions | Comprehensive source/workflow set, authorized live eligibility and original-state visuals not closed; no completion credit inferred |

The nine names are recovered from V33_CATALOGUE_ACCEPTANCE_HANDOFF.md and original Test1 ACTIVITIES, not invented by tallying numeric legacy routes. Source-specific Matching and legacy keyword/recall controls remain distinct where supported; do not assume every one of32sources has Test1’s exact nine capabilities.
