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
The owner-supplied 99-item HTML and live index confirm these same 33 source groups.
Tests 8, 12, 30 and 31 each contain 41 questions. All remain in General learning;
Academic omits one independent question in each: European Heat Wave Q14, How Printed
Books Began Q14, The Terracotta Army Q16, and This is very much the story of a story
Q14. These omissions do not split a Choose TWO pair or shared-stimulus gap. They are
practice selections, not a claim that the source groups were historically co-tested.

`t29-p2-the-importance-of-law` was held as a draft because the extracted archive
has only 546 words. The owner supplied its complete original HTML, whose SHA-256
`3a777bce07f6590bdab0cc2129d5f37651622122c7188a86417a46bbf6653722`
exactly matches the existing original HTML checksum. The new reviewed JSON extracts
all six paragraphs, including continuations omitted during the original extraction.
Its 864 whitespace-delimited words are within the existing 5% tolerance of the
source's 892-word metadata. No prose is generated or taken from an unrelated test.

The same transaction restores this never-attempted draft in place, retaining its
UUID, six paragraph UUIDs, 13 question UUIDs, prompts, answer keys and accepted
variants. All 13 original HTML evidence markers are restored. Its 20 lexical
occurrence UUIDs and meanings are retained; their offsets are repaired using
unambiguous original sentence anchors. A used draft, conflicting text or ambiguous
anchor aborts the transaction. Repeating the restoration performs no writes.

Current expected repair: 39 source containers, 105 relationships to existing
passage UUIDs, 33 eligible 40-question Academic sets. The 105 original passage and
1,406 question identities, all prompts/answer keys, learner rows and lexicon meanings
remain intact. The sole text correction is the verified law restoration above.
Migration 0062 adds a private RLS-protected `reading_assessment_questions` table.
Start captures exactly 40 question UUIDs in order; reload, autosave and submission
use that immutable scope, including after later source edits. Legacy attempts keep
their original scope. Catalogue eligibility for the four selected groups stays
closed until the table exists. Other arbitrary 41-question sets remain ineligible.
Group ranges and box references are renumbered from the actual displayed questions;
a wholly omitted group disappears from the Academic exam only.

## Applying the repair

Run `node --import tsx scripts/repair-reading-105-catalogue.ts --plan` to inspect
the source without opening a database connection. `--dry-run` verifies the live
database and rolls back all new relationships. `--apply` commits one atomic repair.
Both database modes require the exact production website project/environment/
service IDs, `EXPECTED_REVISION` matching its deployed Git commit and `OWNER_ID`
belonging to an active owner. Strict Supabase certificate verification is retained.

Before applying, deploy this code, capture a backup and the original content/learner
row fingerprints, verify the exact 62 existing migration hashes, apply additive
migration 0062 and verify its journal entry, constraints and RLS. Then review the
rolled-back catalogue repair against the deployed target.
Afterwards compare those fingerprints, verify the catalogues and repeat the repair:
the second run must create zero sets and zero relationships. Any identity,
publication or membership conflict aborts the transaction. Original content is not reimported; only the verified law correction is updated. An audit entry records only counts, identities and source SHA.

## Regression coverage

The real PostgreSQL (PGlite) test seeds all 105 reviewed bodies and source metadata,
with explicitly synthetic question rows for relation tests. It verifies owner checks,
rollback, idempotency, original-row fingerprints, all 104 eligible library entries,
source ordering across five pages, 32 Academic sets across two pages before law restoration (33 afterwards), and rejection
of partial/41-question exams. Separate real SQL tests seal General Check for all
three passage positions, legacy standalone attempts and other-user isolation, then
reopen Check after submission. The General detail redirect precedes progress/key
restoration, so an earlier checked result cannot reveal answers during an exam.

The selection regression covers all four original 41-question groups, exact 40-question
capture, repeated Start, contiguous display numbering, cross-user denial, rejected
extra-question drafts, later source additions, grading exactly 40 and an identical
submitted review. Law restoration tests retain its paragraph/question/occurrence
UUIDs, fail closed on a previously used draft and verify idempotent restoration.
