# Reading 105 catalogue repair

The original importer created `reading_passages` and their questions, but no
`general_reading_sets` / `general_reading_passages` relationships. Question Types
reads published passages directly; General learning requires membership, and
Academic requires a complete three-passage, 40-question set. Empty memberships
therefore produced two empty catalogues while Question Types worked.

## Source and scope

The checked-in `data/import-sources/learnersarea_reading_105.zip` has SHA-256
`d736cd4bada0f55309a498116e0e408dd64306ad22779d3ba306a20d01529dd6`.
It defines 33 three-passage tests plus six standalone passages, not 35 tests.
Tests 8, 12, 30 and 31 each contain 41 questions. Keep all their authored questions
in General learning; do not present them as standard 40-question Academic exams.

`t29-p2-the-importance-of-law` remains a draft: the metadata says 892 words but
the source contains only 546. Both the original archive and the desktop READY
archive have the same shortened text. A complete verified original is required
before publishing it. Its two published siblings can still be studied in General;
the incomplete test must not start as an Academic exam.

Current expected repair: 39 source containers, 104 relationships to existing
published passage UUIDs, 28 eligible Academic sets. The 105 original passage rows,
1,406 question rows and all answers, progress, versions and lexicon remain intact.

## Applying the repair

Run `node --import tsx scripts/repair-reading-105-catalogue.ts --plan` to inspect
the source without opening a database connection. `--dry-run` verifies the live
database and rolls back all new relationships. `--apply` commits one atomic repair.
Both database modes require the exact production website project/environment/
service IDs, `EXPECTED_REVISION` matching its deployed Git commit and `OWNER_ID`
belonging to an active owner. Strict Supabase certificate verification is retained.

Before applying, deploy the General Check exam seal from this change, capture a
backup and the original content/learner row fingerprints, and review the dry run.
Afterwards compare those fingerprints, verify the catalogues and repeat the repair:
the second run must create zero sets and zero relationships. Any identity,
publication or membership conflict aborts the transaction. No original content is
updated or reimported. An audit entry records only counts, identities and source SHA.

## Regression coverage

The real PostgreSQL (PGlite) test seeds all 105 reviewed bodies and source metadata,
with explicitly synthetic question rows for relation tests. It verifies owner checks,
rollback, idempotency, original-row fingerprints, all 104 eligible library entries,
source ordering across five pages, 28 Academic sets across two pages, and rejection
of partial/41-question exams. Separate real SQL tests seal General Check for all
three passage positions, legacy standalone attempts and other-user isolation, then
reopen Check after submission. The General detail redirect precedes progress/key
restoration, so an earlier checked result cannot reveal answers during an exam.
