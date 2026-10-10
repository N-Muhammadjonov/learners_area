# Batch 22: explicit multi-owner A/C reconciliation

An A/C restore with two pre-provisioned active owners previously failed the fresh-destination check, even when both source-to-target owner identities were explicitly mapped. The import now retains only the initiating owner and reviewed mapping targets. Every target is still checked against persisted active-owner authority. Each mapped source must be an active owner row in the archive. Destination credentials, names, roles and account status remain authoritative.

Only three source paths changed from the preserved Batch19/20/21 source. No migrations, UI or shared environment changed. The native publication checkout remains clean at0524512. The candidate still carries the preserved unpublished Batch18/19 work.

Local recorded portability gate:34tests,31pass,3native skips,0fail. Typecheck and lint each exit0. The two PGlite multi-owner tests cover A/C dry-run, apply, distinct owner references, credential preservation, uppercase/reordered mapping identity, missing/unknown/suspended/many-to-one mappings, learner escalation denial, unused mapping rollback, inactive source-owner denial and repeat-import refusal. The native variants use newly created random databases only inside an identified private QA cluster. Neither supplied database is reset.

Current source:fb827f12a6fee4a3eddf397e20df384957f3a95adea61e6b593cf26fd5c582c6,1217files. New runner requires both canonical original inputs, two fresh private clusters, canonical migrations, full backend1362pass/0skip, UI260pass/0skip and typecheck/lint0 per round. This expectation is not an observed native result yet. Full suites include both native-enabled cases and PGlite tests.

Batch20 and21 native evidence remains valid at predecessor source9ab8ab6f. Batch21 independently verified2x13pass/0skip. It is supplemental source proof, not a full zero-skip backend rerun. The latest source change requires Batch22 gates. No build is requested under the owner's no-rebuild instruction.

Progress remains17/34=50%. D03 remains PARTIAL. Current-source native gates, broader concurrency/uncertain COMMIT, all-task semantics, live provider/browser/microphone, real R2, PITR and operational acceptance remain open. No six-group acceptance, publication,100% or final GO is claimed. Hosting work is deferred by the owner.

Run the saved terminal command from the existing workspace. Keep the printed receipt and evidence ZIP. The runner prints an open -R command to reveal that exact ZIP in Finder. It does not commit, push, switch branches, reset existing data or rebuild the app.

## Current native acceptance successor

The owner supplied Batch22 full evidence. Both rounds are now independently verified: each1362backend and260UI pass, zero skips/failures, typecheck/lint0. All29 archive members match owner-local files, all26 gate hashes and1217source hashes match, exact originals remain bound, both private clusters are stopped. See RIWI-BATCH-22-NATIVE-VERIFICATION.json. Earlier pending statements describe the pre-execution checkpoint. No rebuild occurred. R05 is QA_VERIFIED_PUBLICATION_PENDING. Accepted progress remains17/34=50%, with18/34=52.94% conditional on publication and independent remote acceptance. A current code snapshot may be published separately from the unfulfilled six-group/17.65-point batch policy. No such full batch or operational GO is claimed.
