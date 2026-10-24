# V37 Listening route ledger

Baseline **62076acc0178602c0bd87025f5c542510242bc1e**, same Arena branch. Listening supersedes course video/Grammar priority. **This is not whole-Listening completion or release approval.** No main merge, deployment, new backend, Staff implementation, educational reconstruction or ZIP. Human project owner authorizes implementation; separate unsigned Phase2 A–J release decision remains BLOCKED and does not block frontend work.

Historical counts are preserved, not silently relabeled: 16 canonical Listening routes = **9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED**. Target = 15 learner routes; historical frontend-code-complete count remains **9/15**, not 15/15 or 16/16. Full accepted/parity status is not established; do not confuse this historical code count with strict original/live acceptance. 24 components = **9 CODE COMPLETE / 10 IN PROGRESS / 5 NOT STARTED**. Global108 routes22/18/68;206components62/19/125;35 Staff routes reserved. CODE COMPLETE is historical frontend/fixture scope, not accepted production or comprehensive original parity.

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

Legacy `/app/listening` and `/app/listening/import` remain protected redirects, not two extra canonical learner pages. Staff lesson author route remains reserved. Machine source: route-ledger-v37.json.
