# Full-system migration runbook (Mode A)

1. Verify owner approval, private encrypted workspace, source fingerprint and backup/PITR receipt.
2. Provision fresh PostgreSQL; apply all canonical migrations.
3. Select `scope=full-system` and O1 or O2 explicitly; export; verify manifest/checksums and secret scan.
4. Run dry-run; resolve identity/collision findings. No mutation is permitted during dry-run.
5. Establish write freeze/maintenance mode and a final consistent export. Do not dual-write.
6. Transactionally import; roll back on any error.
7. Reconcile rows/entities, FKs, unique/check constraints, roles/rosters, content/progress/submissions, RIWI state, Speaking links, sequences and object hashes/classes.
8. Run real PostgreSQL QA, unit/security/red-team and isolated browser smoke.
9. Switch `DATABASE_URL` only after acceptance. Monitor. Keep old system read-only for the declared rollback window.
10. On failure, switch back, unfreeze the old source, quarantine destination, and investigate; never merge diverged writes.
