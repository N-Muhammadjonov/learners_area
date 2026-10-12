# Skipped-test inventory (§12)

Source: `/tmp/full-unit-suite.tap` — 96 skipped tests.

**SKIP IS NOT PASS.** Every skip below is classified by its ACTUAL gate, recovered from source
when the TAP carried no reason string (73 of them did not).

## Summary by classification

| classification | count |
| --- | --- |
| AVOIDABLE — set QA2_DATABASE_TESTS=1 (isolated QA database) | 93 |
| OWNER_ASSET_REQUIRED — Listening source package | 2 |
| OWNER_ASSET_REQUIRED — checksum-pinned dictionary catalog | 1 |

**Total: 96**

## AVOIDABLE — set QA2_DATABASE_TESTS=1 (isolated QA database) (93)

| test | file | gate |
| --- | --- | --- |
| 1 mode is persisted data: General membership row with reading_mode general_practice; Academic passages have none | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 2 General passage resolves immediately with no attempt (sourceId = passage id) | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 3 one-meaning trap: the river 'bank' outside the authored example stays unresolved (Meaning not checked yet) | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 4 MWE: longest occurrence wins — 'took the cost into account' is one phrase occurrence, not 'account' alone | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 5 inflections resolve to the lemma sense: runs/ran (P1), bought (P2) | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 6 save from General: canonical sense id, context with set/passage/occurrence/sentence/mode, no attempt id | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 7 revisit route returns to the set and passage | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 8 dedup by learner+sense across General P1 and P3 (one item, two contexts) | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 9 same sense shared across passages: P1/P2/P3 'bank' point at ONE canonical lexeme (no duplicate senses) | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 10 submitted Academic review is eligible; the General saved item is preserved | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 11 dedup General + Listening: an identically authored Listening sense is the same canonical item | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 12 SRS is not reset when the same sense is saved again from another General passage | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 13 Academic exam lock unchanged: an open Academic attempt is locked while General works for the same learner | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 14 forged General: an Academic passage id or occurrence cannot borrow General permission | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 15 retake stays locked: completed + new in-progress Academic attempt, General unaffected | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 16 Academic surfaces exclude General passages (library count, facets-free list, active list, start) | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 17 draft sets are invisible to learners and locked; staff can preview | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 18 question evidence stays separate: evidence quotes create no sense and do not resolve the river 'bank' | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 19 function words are not vocabulary targets | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 20 per-passage progress persists answers without grading; reload returns them | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 21 learning results: Check grades with correct answer and evidence; foreign question ids are dropped | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 22 Full Reading keeps progress of all 3 passages independently | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 23 progress is per learner and cannot target Academic passages | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 24 import is idempotent on sourceRef and canonical ids are stable on re-run | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 25 existing ids unchanged: adding General content never touches existing Academic rows or learner items | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 26 VD-001 occurrence-less Reading save gate: active exam locked, forged source not found, General allowed and submitted Academic review eligible | `tests/general-reading-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 1 Reading click: each occurrence resolves to ITS sense, server-validated, with a revisit snapshot | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 2/3 Listening click: authored place resolves; the same spelling in another sense is UNRESOLVED (no meaning) | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 2b a draft Listening test is not resolvable by a student; staff may | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 10/11 same sense from Reading and Listening → ONE item with TWO contexts; replays add nothing; SRS untouched | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 12 two senses of one spelling are two separate items for one learner | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 18 concurrent duplicate saves of one occurrence: one item, one context (real row locks) | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 19/20 multi-user isolation: separate items, contexts and SRS per learner | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 21 games do not move SRS; 22 RIWI V1 sentence use is tied to the exact saved sense | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 14 an unresolved Listening occurrence cannot be saved under a sense; 24 missing pronunciation stays null | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| M21 Full Exam reveals nothing: exam components carry no lexical code or transcript; policy and server lock while the exam is open | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| M21b a General section is a LEARNING activity: its own open attempt does not lock its vocabulary, while the Academic full exam stays sealed | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| M22 independent study: never-taken → resolved; exam open → locked; submitted → locked; a NEW open attempt re-locks | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| M23/M24 after submission, financial vs river bank: the money place resolves, the river place stays UNRESOLVED (one-meaning trap) | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| M25/M26 save from review keeps the Listening source context; the same sense from Reading is ONE item with TWO contexts | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| M27 Vocabulary Session: canonical sense wins over a conflicting package definition; order kept for index grading | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| M28 question evidence is independent of vocabulary occurrences: ingestion ignores evidence, evidence never creates a sense | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| R23 ACADEMIC_EXAM: occurrence data exists, but an open attempt reveals nothing — by attempt id AND by the passage-id bypass | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| R27 Academic transition: never taken → locked; open → locked; own submitted review → resolved; a retake re-locks (also the old attempt id) | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| R28/R29 bank polysemy by occurrence identity; one-meaning trap: an unlinked river 'bank' has NO occurrence, so no meaning is served | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| R30/R13 save from General learning: one sense-level item, source occurrence + passage in context; same sense in a 2nd passage → SAME item, 2 contexts; | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| R31/R32 MWE resolves the whole expression; inflections run/runs/running/ran share one sense → ONE item, four distinct occurrences | `tests/vocabulary-architecture-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| guard: only the isolated local QA2 database | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| S7 authored standalone and course questions are both stored | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| S8 authored standalone questions gate completion and an explicit edit replaces them | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| C1/C2 standalone known duration: 79% in progress, 80% completed | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| C4/C5 standalone unknown duration: opinion alone does not complete; a trusted end does, durably | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| unknown duration: an end report with nothing watched cannot complete | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| known duration: an end report does not bypass the 80% threshold | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| R1/R2/S9 course-linked: questions still gate completion (wrong -> not done, all correct -> done) | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| R3 course-linked without questions: threshold, or a written response when duration is unknown (unchanged) | `tests/video-completion-db.test.ts` | `process.env.QA2_DATABASE_TESTS === "1"` |
| active vocabulary and listening learners survive stale activity clocks and old attempt start dates | `tests/retention-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| retention owns a transaction lock; a concurrent runner does no work | `tests/retention-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| a freshly attached recording on an old draft survives cleanup and duplicate attachment has one winner | `tests/retention-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| cleanup during a blocked audio attachment preserves the fresh object and commits one intact relationship | `tests/retention-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| real SRS and wrong game answers count as activity; games cannot advance SRS or preserve stale accounts forever | `tests/retention-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| retention keeps failed object references and 18-month learning history, then retries safely | `tests/retention-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| concurrent saves share one canonical sense and one learner entry with one award | `tests/vocabulary-integrity-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| failed vocabulary batches cannot leave canonical rows, points or partial learner entries | `tests/vocabulary-integrity-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| source deletion removes only its occurrences, preserving shared senses and both learners' saved words | `tests/vocabulary-integrity-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| foreign or deleted folder fails before any lexical write or award; own and unfiled saves stay idempotent | `tests/vocabulary-integrity-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| contextual bank saves preserve the exact sense, ownership and encounter after source deletion | `tests/vocabulary-integrity-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| legacy IDs stay stable while distinct parenthetical meanings and POS get separate new senses | `tests/vocabulary-integrity-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| new saves earn zero; verified game answers award once; wrong/self/forged modes earn zero; leaderboard sums ledger | `tests/vocabulary-points-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| effective leaderboard remaps legacy values and collapses historical game modes per word/day | `tests/vocabulary-points-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| each genuinely scheduled revision earns one point, and the same due occurrence cannot replay | `tests/vocabulary-points-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| RIWI acceptance is authoritative and a repeated accepted sentence under a new usage id pays once | `tests/vocabulary-points-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| PS1 1 205 band estimates in one week: exact count and pooled mean (no truncation) | `tests/qa2-progress-scale.test.ts` | `!enabled && "set QA2_DATABASE_TESTS=1" ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| PS2 streak counts Tashkent days, not a 400-event window: 3 busy days of 500 events each = 3 | `tests/qa2-progress-scale.test.ts` | `!enabled && "set QA2_DATABASE_TESTS=1" ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| PS3 own-library search finds the 2 101st word of a library (no 2 000-row cap; last in heap order) | `tests/qa2-progress-scale.test.ts` | `!enabled && "set QA2_DATABASE_TESTS=1" ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| N07 on real PostgreSQL: 8 concurrent finish requests on separate connections → one transition, one deadline | `tests/qa2-postgres-n07-n08.test.ts` | `!enabled && "set QA2_DATABASE_TESTS=1" ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| N08 on real PostgreSQL: SQL executes, users are isolated, unfinished work excluded, no join multiplication | `tests/qa2-postgres-n07-n08.test.ts` | `!enabled && "set QA2_DATABASE_TESTS=1" ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| QA2 real PostgreSQL: re-import is a no-op and never disturbs an attempt's prompt | `tests/qa2-speaking-bank-import.test.ts` | `(process.env.QA2_DATABASE_TESTS !== "1" \|\| !source) && "set QA2_DATABASE_TESTS=1 and SPEAKING_BANK_SOURCE=<bank.jsonl>` |
| QA2 real PostgreSQL: imported drafts are invisible to Practice and Live Partner until published | `tests/qa2-speaking-bank-import.test.ts` | `(process.env.QA2_DATABASE_TESTS !== "1" \|\| !source) && "set QA2_DATABASE_TESTS=1 and SPEAKING_BANK_SOURCE=<bank.jsonl>` |
| Academic full set captures all three passages, resumes one private timed assessment, and saves every part without enabling vocabulary | `tests/academic-reading-qa2.test.ts` | `process.env.QA2_DATABASE_TESTS !== "1"` |
| dictionary recent searches: last five only, duplicates move to top, private clear preserves other learners and vocabulary | `tests/dictionary-recent-qa2.test.ts` | `enabled ? false : skipReason ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1" && process.env.DICTIONARY_RELEASE_TESTS ` |
| essay-derived Grammar stays private before and after source expiry | `tests/grammar-privacy-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| Grammar learner reads follow publication, and the attempt binds the revision that opened it | `tests/grammar-publication-qa2.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| 0020 upgrades populated 0019 without rewriting rows; full migration chain also works from empty | `tests/lexical-migration-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |
| notification acknowledgements are owned, selective and idempotent | `tests/notifications-db.test.ts` | `process.env.QA2_DATABASE_TESTS !== "1" && "set QA2_DATABASE_TESTS=1 for the isolated database"` |
| QA2 real PostgreSQL: parallel Google callbacks for one new identity create exactly one pending account | `tests/qa2-google-race.test.ts` | `process.env.QA2_DATABASE_TESTS !== "1" && "set QA2_DATABASE_TESTS=1 with an isolated QA database"` |
| QA2 real PostgreSQL: concurrent invites/accepts on separate connections — one call wins, no deadlock | `tests/qa2-live-partner.test.ts` | `process.env.QA2_DATABASE_TESTS !== "1" && "set QA2_DATABASE_TESTS=1"` |
| reading cards count their own questions; live search and clear preserve order | `tests/reading-library-db.test.ts` | `process.env.QA2_DATABASE_TESTS !== "1" && "requires isolated QA database"` |
| RV-HIST-14 real PostgreSQL: concurrent start/autosave/submit against a concurrent publication stays consistent | `tests/reading-v4-history-invariants.test.ts` | `!enabled && "set QA2_DATABASE_TESTS=1 for the isolated learners_qa2 database" ⟸ enabled = process.env.QA2_DATABASE_TESTS` |
| PUB-11 real PostgreSQL: concurrent activation and starts cannot create partial membership or a mixed set | `tests/reading-v4-scheduled-activation.test.ts` | `!enabled && "set QA2_DATABASE_TESTS=1 for the isolated learners_qa2 database" ⟸ enabled = process.env.QA2_DATABASE_TESTS` |
| native Practice and Partner return the same saved question IDs, but Partner never receives study helpers | `tests/speaking-shared-bank.test.ts` | `process.env.QA2_DATABASE_TESTS !== "1"` |
| native topic authoring publishes one bank, edits atomically, removes and restores without deleting rows | `tests/speaking-topic-management.test.ts` | `process.env.QA2_DATABASE_TESTS !== "1"` |
| Writing works with no learner typing attempts and with a prompt resource joined by UUID | `tests/writing-query-db.test.ts` | `!enabled ⟸ enabled = process.env.QA2_DATABASE_TESTS === "1"` |

## OWNER_ASSET_REQUIRED — Listening source package (2)

| test | file | gate |
| --- | --- | --- |
| Uploaded owner source: counts, no fabricated transcript and valid source parsing | `tests/full-listening-package.test.ts` | `!source ⟸ source = process.env.LISTENING_SOURCE_ZIP` |
| Actual uploaded source grades all 40 answers including swapped choose-TWO; repeat submit remains immutable | `tests/full-listening-write-db.test.ts` | `!source ⟸ source = process.env.LISTENING_SOURCE_ZIP` |

## OWNER_ASSET_REQUIRED — checksum-pinned dictionary catalog (1)

| test | file | gate |
| --- | --- | --- |
| full frozen catalog: exact-sense save, draft isolation, bounded publish, immutable release and rollback preserve learner state | `tests/dictionary-release-qa2.test.ts` | `!enabled ⟸ enabled = process.env.DICTIONARY_RELEASE_TESTS==="1"` |

