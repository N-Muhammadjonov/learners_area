# Batch 19: atomic Vocabulary game practice

Continue from the preserved Batch18 candidate, source `906a14389b04e0569119de3d35f7d0d0f3aced6c0772b28f719a7c1c3e83afe9`, on published base `0524512a40f24a1d38e26f1728e247248916107b`. No restart, reset, rebuild, commit or push was performed. Hosting work remains deferred by the owner.

## Baseline evidence

Seven isolated regressions were run against the prior game writer with only an explicit database-injection seam. The production default remained the application database. A test guard prevented legacy global bookkeeping from reaching any unknown database. Baseline source `decc4ba37ff1b2e7568c97629121a9ba6c9e03bea67942b171573302e34b1d29` is therefore a reproduction source, not the byte-identical published source.

The baseline had four passes and three failures:

1. Point insertion failure left the already-inserted practice event committed.
2. A suspended actor could still save through the storage service. The endpoint's earlier active-user check alone did not recheck identity at the write boundary.
3. The storage service accepted forged extra score/verdict fields instead of validating its own input.

Existing event failure, set/pair ownership, cross-game award deduplication and Tashkent-day boundaries already passed. They were retained as regression boundaries, not presented as newly reproduced defects.

## Change

The game service now validates input, starts a transaction, locks the active actor before the owned word, and rechecks selected-set membership. Pair and folder references remain owner-scoped. The canonical lexeme is read under a shared lock before the existing authored-answer grader runs.

Actor activity time, practice event and the existing optional one-point award commit together. A failure in any write rolls all of them back. The activity clock remains monotonic. The actor lock is exclusive from the beginning to avoid a later shared-lock upgrade. Games do not update the Vocabulary row or its SRS fields.

HTTP and storage use a shared strict submission schema. The HTTP body cannot choose user identity, server time, verdict or points. Empty typed answers remain valid practice and are graded wrong. Flashcard self-assessment and incompatible game/submission combinations keep zero credit. Unknown game IDs, unknown submission kinds, invalid identifiers/dates and extra verdict fields are refused by storage before any write.

The existing one-award-per-learner/word/Tashkent-day rule still spans all game modes. Incorrect and self-assessed practice counts as activity without earning a point or advancing SRS. The route returns 400 for invalid service input, 401 when the actor became inactive and the existing 404 for missing/out-of-set references.

## Verification

Nine added tests cover shared HTTP input, point/event/activity-clock failure rollback, retries, suspension/foreign ownership, forged service input, selected-set/pair/folder scope, competing correct game modes, every SRS field, exact Tashkent midnight and persisted flashcard read-back. Broader focused run before the final pair assertion refinement: 62 total, 57 pass, 5 native skips, 0 fail. The current pair/flashcard/UI-contract run has 23 passes without failures or skips. PGlite concurrency does not prove independent native PostgreSQL connections.

The existing native point test now starts eight competing correct game answers through the real application pool and requires one award before continuing its original replay, wrong-answer, self-assessment and leaderboard assertions. No new native test was skipped and no existing assertion was removed.

Three intermediate issues were detected before the final gates. Typecheck found that the local function replacement had removed the adjacent flashcard read-back export. Its complete implementation was restored byte-for-byte from the published source and all engine exports were reconciled against the preserved Batch18 ZIP. A structural self-assessment assertion still referred to the old unvalidated input variable. It was updated to the explicitly validated self branch while retaining all no-credit and verification assertions. A runtime assertion now also reads back the self-assessment written by the repaired service. The first full backend gate subsequently had 1265 passes, one failure and 92 skips: the Matching Pairs structural selector still expected the old unvalidated variable. That selector now checks schema validation and the actual validated pair ID within the game writer. The runtime fixture additionally checks correct self-pairs and incorrect pairs between two owned words. A separate 23-case focused run passed without failures or skips. Production implementation did not change after that full-gate failure. The superseded source manifest and all intermediate logs are retained and do not count as passing final gates.

Final source `9ab8ab6fb9a8a396f6a3445bb6feb44e0ebdf32cc0bcd445a155eefaf42ca905` has 1215 source files. Final two-round non-build results, exact log hashes and declared skips are recorded in `RIWI-BATCH-19-QA-RESULTS.json` after completion. Source bytes and inventory are checked before and after every final gate.

## Acceptance boundary

Batch18 artifacts remain unchanged. This candidate contains both the preserved scheduled-review repair and the game repair. It is not a six-new-group acceptance packet. Original prompt closure remains 17/34 = 50%, with zero new full groups accepted. RIWI-wide and project-wide percentages remain unknown.

Native PostgreSQL, canonical source-bank, live-provider, authenticated browser, isolated full restore and operational acceptance remain open. The optional native runner uses trusted installed PostgreSQL binaries and a newly-created private localhost cluster. It downloads nothing, resets no existing database, and stops only its own cluster. A pinned npm distribution (`16.14.0-beta.17`) was downloaded with install scripts disabled and SHA512 verified against registry metadata. The included server reports PostgreSQL 16.14. Native initdb was attempted in a newly-created private directory, but the execution environment denied `shmget` with Operation not permitted. No server or database started, so native tests remain unverified. The binary and failure evidence are recorded in `RIWI-BATCH-19-NATIVE-READINESS.json`. The Terminal runner verifies the exact new cluster data directory before creating its isolated QA database. It verifies the point/game/review cases only, not all remaining native requirements. No production database, object storage or hosting state was modified.

## Owner Terminal native verification

The owner ran the pinned native helper successfully on 2026-10-10. The separately supplied evidence ZIP was compared byte-for-byte with all eight local files. Receipt exit codes, log SHA256 values and both native summaries were independently verified. Each round passed six cases with zero failures or skips. Five of these cases were previously skipped in the full backend gate. The HTTP contract case already passed there and is not counted again as newly verified.

All 1215 source file hashes and the complete inventory still match `9ab8ab6fb9a8a396f6a3445bb6feb44e0ebdf32cc0bcd445a155eefaf42ca905`. PostgreSQL 16.14 initialized a new private cluster and the canonical empty-database migration chain applied all 51 migrations through 0050. The stop log confirms shutdown, and the private data directory has no postmaster PID or password file. The receipt was written before shutdown, so shutdown evidence was checked separately rather than inferred from that receipt. The earlier environment IPC failure remains preserved as history.

The native receipt and log copies are retained under `docs/evidence/riwi-batch19-native`. Exact hashes and limits are in `RIWI-BATCH-19-NATIVE-VERIFICATION.json`. No implementation files, native checkout, existing database, build, commit or push changed during this verification. Other native cases and original-source/provider/browser/restore acceptance remain open. Original prompt progress remains 17/34 = 50%.
