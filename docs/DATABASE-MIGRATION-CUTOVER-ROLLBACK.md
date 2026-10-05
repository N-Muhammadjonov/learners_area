# Database cutover and rollback

Take a provider-confirmed backup/PITR safety point and record its identifier/time (never credentials). Announce maintenance; stop writers; drain jobs; create final consistent export; verify no writer remains. Import/validate destination while source stays read-only. Change one authoritative `DATABASE_URL`; do not dual-write. Acceptance includes health, auth, role boundaries, representative mutations, relationship/hash checks and monitoring.

Rollback trigger: any critical integrity, security, auth or object mismatch inside the owner-declared window. Stop destination writers, restore the old URL, verify source health, then reopen source writes. Do not replay destination writes automatically. RPO/RTO are OWNER ACTION REQUIRED until source/destination providers and the owner declare tested values.
