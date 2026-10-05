# RIWI disaster recovery

- Code failure: redeploy/roll back a known Git SHA; do not roll back data blindly.
- PostgreSQL corruption/loss: provider backup/PITR restore, then integrity and app gates.
- R2 loss: object-store version/backup restore and manifest checksum reconciliation.
- Move RIWI/site: choose Mode A/B/C and O1/O2 runbook.
- Credential leak: rotate in deployment/provider, invalidate sessions where applicable; portable knowledge remains unchanged.

Incident commander records scope, safety point, decision, timestamps and checks. Never paste secrets. RPO/RTO and real provider restore results require owner/provider confirmation. Tabletop rehearsal can be local; Production changes require approval.
