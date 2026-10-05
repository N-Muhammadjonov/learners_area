# RIWI backup and restore

Provider backup/PITR is the authoritative same-site PostgreSQL recovery mechanism; portable export is an additional migration/RIWI-core artifact, not a substitute. R2 needs its own versioning/backup policy. GitHub stores code/migrations, never database dumps, learner exports or credentials.

Restore drill: obtain owner-approved isolated target, restore provider backup, configure private object access, apply only genuinely pending canonical migrations, run integrity/role/security/golden checks, and record RPO/RTO observations. Production and shared Preview remain untouched without approval. Backup/PITR existence and restore evidence are externally unverified until the owner/provider supplies receipts.
