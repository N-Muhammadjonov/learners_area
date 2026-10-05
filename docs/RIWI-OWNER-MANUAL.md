# RIWI owner manual

## Daily controls

Use **Owner → RIWI** for AI/provider readiness, provider fixture lab, rollout governance, assessment policy, and security-learning counts. Security signals contain sanitized classifications only. Review a signal only after a registered regression fixture passes; approving without fixture ID, evidence SHA-256, reviewer and timestamp is rejected.

## Assessment policy

Policy changes are versioned, audited and owner-only. Preview the proposed version and regression evidence before activation. Do not edit database rows directly or weaken assessment contracts to accommodate a provider.

## Knowledge

Submit only material with provenance and rights. Conflicts are review signals, not truth decisions. Resolve every conflict and run required regressions before promotion. Unknown rights and partial over-capacity analysis fail closed.

## Portability and provider changes

Choose an explicit scope—Mode A full system, Mode B RIWI only, or Mode C Learners Area only—and choose O1 keep current R2 or O2 move objects. Follow the matching runbook. Always run dry-run, inspect counts/privacy canaries, use encrypted temporary storage, restore into an isolated destination, verify checksums/references, and record a rollback point before cutover. Never reuse application secrets in an archive.

## Speaking privacy and retention

Speaking audio and transcripts are private Learners Area data and never enter Mode B. Apply the owner-approved retention durations documented in `SPEAKING-DATA-RETENTION.md`; until those decisions are approved, do not claim automated deletion is active. Live partner signaling stores metadata, not call media.

## Security incidents

Keep the request denied even if security-signal persistence is unavailable. Investigate sanitized fingerprints/counts; use protected provider logs for infrastructure diagnosis. Promote a finding only to a test-backed regression. Code changes remain a developer-reviewed deployment; the application cannot modify itself.

## Backup and disaster recovery

Follow `RIWI-BACKUP-RESTORE.md` and `RIWI-DISASTER-RECOVERY.md`. Provider backup/PITR configuration and restore receipts are external evidence. Perform quarterly isolated restore drills and do not call a backup usable until restore plus application integrity checks pass.

## Boundaries requiring approval

Production deployment, shared Preview migration, DNS/cutover, provider credentials, R2/S3 movement, destructive cleanup, and final retention policy require explicit owner/operator action. The application and this repository do not perform them automatically.
