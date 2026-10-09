# RIWI Step 10: speaking retries and grounded evidence

Base: `985ade6983e7efbdb900f852ab9216996bcd0d2f`. Target: `arena/01a10bac-learners-area`.

Four requirement groups are addressed: C05, C06, C07 and B05. No new group receives closure credit before required native QA, exact remote publication and applicable acceptance receipts.

## Resulting behavior

- Explicit Send acquires a committed, bounded evaluation claim before external work. The database pool is released during provider calls. Persisting a result checks the same claim and database-clock expiry atomically. Expired/stale workers cannot publish or clear a newer claim. Completed results are reused, and provider failures preserve the submitted reviewed transcript for retry.
- Attempt/session/item/current question/latest answer generation remain server-bound. Attachment and discard reject an in-flight evaluation. Detached UI callbacks cannot advance a session, and a delayed old discard cannot clear a new recording.
- The server hashes bounded owned private audio bytes and validates exact size. Raw and reviewed transcripts remain separate; actual text comparison determines edits. Manual/browser text is learner input. Internal STT/worker provenance stays out of the learner DTO; evaluation provider/model/fallback provenance remains persisted internally.
- Practice on Your Own can retain audio without inventing a transcript or evaluation; a later explicit transcript retry remains available. AI feedback absence stays in review rather than advancing.
- Speaking assessment always treats the current request as transcript-only: registering an audio-capable provider cannot establish acoustic evidence. Unique supported textual criteria, grounded quotes and server-calculated overall apply to all five parts.
- Part 2 preparation keeps the microphone off. Early start begins recording; the recording limit opens review without sending. Session summaries accept only owned, linked, grounded evaluation evidence. Recurrence counts distinct answers. Missing/skipped/limited evidence prevents an overall estimate; pronunciation remains Not assessed.
- Migration 0050 adds nullable audio SHA and paired claim fields with checks. Historical SQL and journal entries are preserved. The known 0046–0048 recovery accepts only the exact known omission and an otherwise hash-verified contiguous suffix, including 0050; other gaps/divergence fail closed.

## QA receipts

| Gate | Observed result |
| --- | --- |
| Full backend | 1257 tests: 1163 passed, 3 failed with socket `listen EPERM`, 91 skipped; native gate required |
| Full React UI | 250 passed, 0 failed, 0 skipped |
| Typecheck | Passed |
| Lint | Passed with zero-warning gate |
| Production build | Passed |

The JSON report records source hashes and final log hashes. Earlier failed exploratory runs are not acceptance receipts. Native publication script retains detailed logs, leaves socket tests enabled, and stops before commit/push on any failure. Skipped tests are not passing evidence.

## Remaining operational acceptance

Offline SDK signing proves an owned-key signed GET configured for 300 seconds, not an actual expired R2 response. Real R2 expiry, authenticated role/browser/microphone/STT journeys, native PostgreSQL concurrency and live provider calls remain unverified. Recurring learning-signal consent/privacy needs its applicable runtime acceptance. Original-source/environment skips remain open. Full-group percentage must not increase merely because these code changes are published.

Migration 0050 has NOT been applied to a live database. The push script does not run migrations or deploy. Before using this application version, identify the authorized target, reconcile its exact migration history, apply the canonical reviewed migration chain, and verify runtime behavior. Never run blind `db:push`, renumber old SQL, or migrate an unidentified production database.

## Publication

Run the supplied verification script from the Mac Terminal. It checks the clean native clone, exact base/branch/remote head and patch digest, applies this patch with index, runs backend/UI/typecheck/lint/build, rechecks remote base and then commits/pushes without force. It prints the SHA and native QA log directory. Send the resulting output for independent GitHub ref/tree/blob verification before starting the next batch.

Current verified prompt closure: 7/34 = 20.59%. This batch targets four groups (11.76 percentage points); 11/34 = 32.35% is only a maximum conditional target after all applicable acceptance is satisfied. Overall RIWI and whole-project percentages remain unknown because their complete requirement denominators are not reconciled.
