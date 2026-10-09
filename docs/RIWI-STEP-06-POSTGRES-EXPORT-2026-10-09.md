# RIWI step 06 — snapshot export and dependency-ordered import

Baseline: `27378cf10b462a9b75a19cf2dc7a8ce8b6d123e2`, branch `arena/01a10bac-learners-area`. The step-03 complete assessment-contract manifest check and step-05 hash migration runner are preserved.

## Implemented behavior

- Full-system PostgreSQL export uses a dedicated read-only, repeatable-read transaction and server-side cursors. Client batches are constrained to 1–5,000 rows without an overall row-count cap. SQL columns are mapped back to canonical TypeScript field names.
- A source-provided snapshot timestamp binds the archive's retention checks and manifest timestamp. Explicit timestamp mismatch and unsupported source scope fail before opening an output file. Invalid batch size also fails before output begins.
- Active RIWI conversation parents require no deletion marker, future expiry and owner online activity within seven elapsed days. Message reads additionally require age within 30 days. Exactly-seven-day offline and exactly-30-day message boundaries are retained. Parent proof is checked again for every bounded message batch.
- Connections and cursors close on success or failure. Escaped source operations reject after the snapshot is closed and never query a released connection. An import rollback connection error cannot replace the original failure; the connection is still released.
- The PostgreSQL destination sorts populated tables by declared foreign-key dependencies. Empty files still undergo checksum verification. The archive rejects ordering adapters that omit, duplicate or replace original table metadata before starting a transaction.
- Nonempty identity reconciliation maps are explicitly unsupported in this checkpoint and rejected before row queries. They are not silently ignored.

## Current QA

28 focused tests passed, 0 failed, 0 skipped. The database export fixture contains 1,250 recent messages plus two retained boundary messages. All 1,252 export and import successfully in ten-row cursor batches. Old-message, offline-chat and expired-chat canaries never appear in the archive. Tests also cover scope/time mismatch, parent retention proof, source failure cleanup, escaped cursors, import ordering integrity, unsupported identity mapping, and preservation of the original error when rollback fails.

Invalid-batch and rollback-error regressions failed before their fixes and passed afterward. Typecheck, lint, production build and diff checks passed.

## Remaining acceptance

The database tests use PGlite, not a native PostgreSQL server. Native snapshot/concurrency and live full-data acceptance remain open. This source adapter is deliberately full-system only: Mode B needs approved global-data/privacy projection and anonymous-operator reconciliation; Mode C needs site-only projection and identity reconciliation. Populated foreign-key cycles currently fail closed and require a separate deferred-link import implementation. O2 object-copy rollback/lifecycle, encrypted archive delivery and owner-authorized deployment targets remain separate work. No shared database, object store or deployment was changed. This checkpoint is not overall portability completion or Production GO.

The user-supplied step-05 native Terminal result recorded 1,231 tests: 1,140 passed, 0 failed, 91 skipped; typecheck, lint and build passed. Remote step-05 commit and all nine changed blobs were independently verified before this step began. Those results are baseline evidence, not this patch's full-suite results.
