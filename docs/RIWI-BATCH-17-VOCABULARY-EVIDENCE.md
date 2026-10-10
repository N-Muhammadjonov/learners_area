# Batch 17 continuation: Vocabulary and Writing evidence integrity

Date: 2026-10-10. Published baseline: `6f125f7dd21fafcce4f7ab089b0e26569600b3b5` on `arena/01a10bac-learners-area`.

This is unpublished continuation work. It does not close all of B04 or earn a full original prompt group. Accepted progress stays 17/34 = 50%. Six newly accepted complete groups are still required for the requested 17.65 percentage-point batch. No reset, rebuild, branch switch, migration, deployment or push was performed.

## Reproduced failures and resulting behavior

Four migration-backed PGlite regressions failed before the Vocabulary repair: confirmation activity failure left committed credit, concurrent accepted answers lost a count, inactive/cross-owner confirmation was accepted, and invalid sentences were saved. The raw baseline is `riwi-batch17-vocabulary-before.log`: 4 tests, 0 pass, 4 fail. It is failure evidence, not acceptance.

The shared engine now validates input, rereads active identity and both ownership relationships, locks the usage and saved word, and commits confirmation, the deduplicated point award, active-use count, mastery and activity evidence together. An activity failure rolls everything back. Competing workers cannot replace a committed verdict. Repeating normalized text earns no extra points or count. Rejected work preserves the existing recognition schedule and mastery.

The sentence HTTP boundary accepts only bounded sentence text. Caller verdicts, points and evaluation IDs are rejected. Both HTTP and RIWI handoffs verify evaluator user, domain and exact saved-usage identity. A failed confirmation cannot be returned as successful accepted credit.

A separate adversarial test showed that a syntactically valid resolver UUID could still earn Writing Activation credit without an evaluation row. The pre-repair test on source `87c1ff6c02da714ff5a78d020015e4d21e64fa603197e935dcc78254efe276f2` failed with `true !== false`. The resolver generates a result identity; that alone is not persisted evidence.

Activation now stores the answer event before invoking the evaluator. The existing Writing resolver saves the external, non-fallback evaluation against that server-created event and returns the actual database evaluation ID. Activation rereads that record and checks owner, source event, domain, mode contract, provider origin and score semantics. It uses the persisted feedback. Unpersisted, foreign, mismatched and fallback results produce no credit or exposed feedback. The answer stays available with an unavailable status. Account status is checked again before completion. Completion, canonical Vocabulary usage and credit share a transaction. A failed completion leaves the answer pending and preserves the evaluation, with no partial credit.

## Task audit: source book rows 47–68

Registry inspection still returns 106 contracts. Registration is not full executable task acceptance. No registry or historical contract was changed by this batch.

| Source task | Current execution evidence | Remaining acceptance |
| --- | --- | --- |
| grammar.error_correction | Canonical Correct It service/tool exists; earlier published batch covers its guarded write path. | Full task fixtures and applicable runtime acceptance. |
| grammar.transformation | Assessment contract exists. | Explicit canonical transformation workflow and all task fixtures. |
| grammar.fill_gap | Instruction catalog plus existing objective exercise grading. | Book-specific teaching flow and runtime fixtures. |
| grammar.controlled_production | Canonical Activate It service/tool exists. | Full target-structure semantics and runtime acceptance. |
| grammar.free_production | Assessment contract exists. | Dedicated task selection, canonical context and executable fixtures. |
| grammar.explanation | Authorized authored Grammar topic lookup exists. | Complete book teaching structure, checking question and runtime proof. |
| grammar.retention | Instruction catalog and existing practice/history. | Evidence-based recall task and recurring-error semantics. |
| vocabulary.meaning | Canonical Dictionary lookup. | Complete meaning-teaching task fixtures. |
| vocabulary.contextual_meaning | Authorized occurrence lookup with exam locks. | Complete context/sibling-sense explanation fixtures. |
| vocabulary.translation | Canonical sense translation. | Complete contextual translation task fixtures. |
| vocabulary.collocation | Resolver selects a collocation contract when server task metadata requests it. | Canonical-evidence workflow and direct runtime fixtures. |
| vocabulary.word_form | Resolver selects a word-form contract when server task metadata requests it. | Required form/role workflow and direct runtime fixtures. |
| vocabulary.synonym_choice | Assessment contract exists. | Explicit compare-in-context workflow and fixtures. |
| vocabulary.paraphrase | Assessment contract exists. | Meaning/nuance equivalence workflow and fixtures. |
| vocabulary.activation | Existing evaluator task selection and Writing Activation integration. | All prompt-book semantics and applicable live acceptance; Writing Activation is a separate Writing contract. |
| vocabulary.productive_use | Existing HTTP and RIWI evaluation paths now enforce bounded input, source binding and atomic credit. | Full productive-use semantics and applicable provider/browser acceptance. |
| retention.reading_recall | Instruction catalog and existing Retention data engine. | Authorized source recall task and semantic fixtures. |
| retention.vocabulary_recall | Instruction catalog and shared Vocabulary schedule/progress engine. | Recognition/recall/production distinction across the complete task. |
| retention.error_pattern | Instruction catalog and authorized weakness/history reads. | Multi-attempt recurrence/change/drill workflow, avoiding single-error inference. |
| tutoring.simple_explanation | Instruction catalog exists. | Full evidence-bound explanation workflow and fixtures. |
| tutoring.compare_concepts | Instruction catalog exists. | Full comparison workflow and fixtures. |
| reporting.progress_explanation | Role-scoped canonical Reporter tools keep deterministic metrics. | Complete explanation task fixtures and applicable runtime proof. |

Primary code inspected: `src/lib/services/coach/contracts/prompt-book.ts`, `registry.ts`, `src/lib/services/riwi/core-tools.ts`, `evaluation-tools.ts`, `src/lib/services/vocabulary/engine.ts`, `src/lib/services/writing/check.ts` and `activation.ts`.

## Acceptance boundaries

Final exact-source QA counts and raw log hashes are recorded separately in `RIWI-BATCH-17-VOCABULARY-QA-RESULTS.json` after the final gate. Interrupted and superseded runs do not count as that gate. PGlite database tests and fixture evaluator results do not establish native PostgreSQL concurrency or live provider semantics. The new native PostgreSQL concurrency regression remains explicitly skipped without an isolated authorized QA target. Original source-bank, live provider, authenticated browser, deployed scheduler and restore evidence remain open.

Next retention verification must also cover `applyScheduledReview`: its existing read/update/activity/point sequence is separate from the newly transactional sentence confirmation. Reproduce simultaneous scheduled review and active-use confirmation, scheduled-review event failure, repeated due submissions and identity revocation before claiming the shared engine's entire scheduling/credit workflow is atomic. This batch does not claim that untested path is repaired.

The working patch must be based on the clean published `6f125f7` tree. The candidate checkout's historical `c133f97` Git HEAD is not a valid delta base. Existing Batch 16 artifacts and earlier Batch 17 requirement-evidence receipts are preserved.
