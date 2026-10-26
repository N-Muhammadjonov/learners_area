# Dictionary optimization review tools

Current production continuation: [PRODUCTION_VERIFICATION_20261026.md](PRODUCTION_VERIFICATION_20261026.md). The Retention context-selection fix and legacy fallback guard are deployed on main as 4c3a3f6. All protected R2 object bytes and database identities were verified, authenticated API baselines were measured, and a private full database archive was captured. Full restore/rehearsal, complete multi-user/module QA, paired performance and production Cloudflare administration evidence remain open. Cleanup is still BLOCKED; see evidence/production-gates.json. Historical evidence below is retained.

The owner authorized merging this prepared code into main on 26 October 2026. Production database cleanup remains BLOCKED by the open backup, live parity, performance and approval gates.

The original learner and owner read guards remain. The production follow-up extends the same protection to Retention and fixes the missing word argument in contextual sense selection. SQL fallback requires an explicitly validated legacy release. Healthy Worker reads add no registry query. Backend tests cover delivery guards, context selection and operator integrity.

Run operator commands from this directory in a full repository checkout using the existing backend dependency environment. The script locates the repository's native ICU canonicalizer automatically; LA_REPO can override the checkout path. No command in the script executes cleanup SQL or changes an R2 object.

- FINAL_ENGINEERING_REPORT.md records the audit, evidence, current limits and proposed operation.
- RUNBOOK.md describes the required backup/restore, paired QA measurements, production approval, rollback and monitoring.
- operations/audit.READ_ONLY.sql performs read-only SQL inspection.
- operations/cleanup.PROPOSED.sql is a review draft with an unconditional stop. It is outside every migration directory and must remain blocked until the required evidence and explicit destructive-operation approval exist.
- evidence contains selected audit results and regression logs. The full manifest inventory and captured source snapshots remain in the previously delivered review ZIP, SHA-256 d33335c1b6507955244fa19b172303e40f99ca1d2fb723214f1cbd368408707c.
- fixtures/queries.json supplies a 24-query search cohort; it does not claim completed live EN/UZ coverage.

Keep credentials and full database backups outside this repository. Evidence receipts contain status, timestamps, counts and hashes only.
