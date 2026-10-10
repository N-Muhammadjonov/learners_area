# Batch 24: bounded tutoring and canonical report explanation

Baseline: `b9007d68c82b27d02d615ae7c1d0f1546aa83393`.
Current source: `aa73ffbf7b8d698322e3961ea13298446f99a794a1f82d3929296452a58c7407`, 1,227 source files.

The authenticated RIWI gateway now selects and executes the two source-book tutoring tasks through the existing shared provider adapter. Simple explanation requires an answer, explanation, example, mini illustration and check question. Concept comparison requires two distinct named concepts, an explanation and example for each, the key difference and common confusion. The server constructs the displayed answer from validated fields. A generic free-text answer cannot substitute for these steps.

Task selection is server-owned. Learner-supplied task keys, policy prompts and grading contracts are rejected. The router requires an explicit instruction-teaching capability, independently validates the returned steps and applies the existing citation, privacy, timeout and audit boundaries. Declaring a capability alone is insufficient. Provider usage fields are validated separately and cannot bypass task validation. No new external client or assessment engine was introduced.

The task key, contract version, rubric version and exact instruction-fragment SHA are recorded with authorized assistant conversation metadata. This SHA describes the immutable task instructions, rather than the entire provider request. Saving validates the current trace. Historical display preserves the stored version without regrading it. Existing course, dictionary, roster, exam and transcript authorization boundaries still apply. Legacy responses without a teaching trace are not evidence that either new task executed.

Reporter explanation uses canonical server metrics after the gateway verifies every metric against its authorized Reporter specification. Values retain the canonical display. Missing values are explicitly unavailable. Count, ratio, band and score meanings distinguish window activity from a snapshot at the window end. No earlier-period comparison exists in this snapshot, so improvement or decline is not asserted. The suggested next action is to review authorized completed work and practise a correction supported by it. No generated metrics, new priorities, arbitrary URLs or additional report queries are introduced.

## Original-source mapping and limits

| Source task | Executable route | Required behavior |
| --- | --- | --- |
| `tutoring.simple_explanation` | Authenticated gateway → shared adapter → router validation → conversation persistence | ANSWER → EXPLAIN → EXAMPLE → ILLUSTRATE → CHECK |
| `tutoring.compare_concepts` | Same path with a distinct strict comparison schema | Two concepts, differences, examples and common confusion |
| `reporting.progress_explanation` | Authorized Reporter tool → canonical metric validation → deterministic explanation | Metric, meaning, supported change boundary and next action |

These are three source-task implementations within B04. They do not close the entire B04 group, B01's 68-task semantic audit or live-provider acceptance. The implementation does not convert unsupported Grammar, Vocabulary or retention tasks into generic chat grading.

## Validation

The assistant runs two exact-source affected rounds. Each includes 159 backend cases, all 260 UI cases, typecheck and lint. The associated receipt and unmodified raw logs are in `docs/evidence/riwi-batch24-assistant/`. The affected suites include provider contracts, routing, privacy/security, conversation retention, source-task coverage and Reporter authorization. New real-SQL PGlite journeys cover both tutoring tasks for student, teacher, admin and owner, persistence/history, anonymous denial and the student active-exam boundary. Transport fixtures are synthetic and are not live-provider or authenticated-browser evidence.

A first harness attempt incorrectly disabled the external fixture path; eight existing provider cases failed as a result. The harness was corrected. Intermediate typecheck failures in new code/tests were fixed before freezing this source. Those earlier runs are not reported as passing QA. Native PostgreSQL initialization was attempted in a newly created private directory but denied by the environment's shared-memory restriction. No current-source native receipt is claimed. Unchanged D03 core acceptance uses the independently verified previous native evidence described in `RIWI-D03-ACCEPTANCE-b9007d6.json`.

Build, reset and production deployment were not performed. Current-source native application boot, real provider, browser, private R2, backup/PITR and unselected destructive Speaking retention requirements remain open. The owner performs publication after the reviewed checkpoint is prepared.

## Accepted progress

D03's original acceptance blocks are independently satisfied at the already published `b9007d6` state. This moves the equal-weight original prompt metric from 18/34 to 19/34, or 55.88%. The new three-task implementation receives no additional full-group credit. Overall RIWI and whole-project percentages remain undetermined because their reviewed denominators are unavailable. This checkpoint is not a four-group batch or operational GO.
