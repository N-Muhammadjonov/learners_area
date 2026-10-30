# V37 Listening component ledger

Baseline **62076acc0178602c0bd87025f5c542510242bc1e**, same Arena branch. Listening supersedes course video/Grammar priority. **This is not whole-Listening completion or release approval.** No main merge, deployment, new backend, Staff implementation, educational reconstruction or ZIP. Human project owner authorizes implementation; separate unsigned Phase2 A–J release decision remains BLOCKED and does not block frontend work.

Historical counts are preserved, not silently relabeled: 16 canonical Listening routes = **9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED**. Target = 15 learner routes; historical frontend-code-complete count remains **9/15**, not 15/15 or 16/16. Full accepted/parity status is not established; do not confuse this historical code count with strict original/live acceptance. 24 components = **9 CODE COMPLETE / 10 IN PROGRESS / 5 NOT STARTED**. Global108 routes22/18/68;206components62/19/125;35 Staff routes reserved. CODE COMPLETE is historical frontend/fixture scope, not accepted production or comprehensive original parity.

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

Import classification is based on actual callers, not names. FullListeningLibrary and ListeningTestActions only appear in Admin pages; ListeningImport only in Admin import page; ListeningLegacyImport only inside that import UI; audio-probe is uploaded-file metadata, not learner media. Legacy learner import URL redirects, never mounts import UI. Source receipts list direct import callers and hashes.
