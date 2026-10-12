# Preview QA migrator — LOCAL SIMULATION receipts (not Preview)

These receipts come from an **isolated local PostgreSQL** (embedded PostgreSQL, localhost, database
`learners_preview_sim`). It was first migrated to `0024_video_lessons_standalone` to match the
Preview state, then `scripts/preview-qa-migrate.mjs` ran in the order below. **No Preview database was touched.**
This sandbox has no Preview credential.

| step | command | outcome |
|---|---|---|
| 1 | `--fingerprint` | exit 0 |
| 2 | `--plan (wrong URL fingerprint)` | exit 1 (refused, no connection) |
| 3 | `--plan (wrong server identity)` | exit 1 (refused after connect, before plan) |
| 4 | `--plan` | exit 0 (pending 0025–0027; verification skipped with reason) |
| 5 | `--apply (no PREVIEW_QA_BACKUP_REF)` | exit 1 (refused) |
| 6 | `--apply` | exit 0 (applied 0025–0027; 5/5 verifications pass) |
| 7 | `--apply again` | exit 0 (nothing pending; nothing applied) |
| 8 | `--plan with live_partner_blocks hidden (simulated broken schema)` | exit 1 (verification failure is non-zero) |
| 9 | `--plan after restoring` | exit 0 |

Step 2 refuses before connecting, so it writes no receipt. Step 8 temporarily renamed one table
on the simulation database only, to prove that a failed verification exits non-zero. The rename
was then reverted.

# Owner procedure for the real Preview QA database (`0025`–`0027` only)

Run this from a machine that holds the Preview QA credential. **Never paste the URL or password into chat.**

1. `DATABASE_URL=<preview QA url> node scripts/preview-qa-migrate.mjs --fingerprint`
   * This connects read-only and prints:
     * `dbFingerprint`: a hash of host, port, database, role and project ref; never the password.
     * `serverIdentity`: a hash of the server's `system_identifier`, `current_database`,
       `session_user` and port, as reported **by the server**.
     * `target`: host, port, db, role, project ref, and whether the host is a shared pooler.
   * Check `target.projectRef` against the QA project in the Supabase/Neon dashboard. On a
     shared pooler, host and database alone are the same for every project; the project ref
     in the username is what identifies the QA project.
2. Approve those values by exporting them:
   * `PREVIEW_QA_DB_FINGERPRINT=…`
   * `PREVIEW_QA_SERVER_IDENTITY=…`
   * `PREVIEW_QA_PROJECT_REF=<qa project ref>`. This is required for pooler hosts.
3. `node scripts/preview-qa-migrate.mjs --plan`. It must list exactly `0025`, `0026` and `0027`
   as pending and exit 0.
4. Take a backup or recovery point (a snapshot, branch or PITR timestamp), then run
   `PREVIEW_QA_BACKUP_REF=<that id> node scripts/preview-qa-migrate.mjs --apply`.
   * It must exit 0, with `after.pending = []` and 5/5 verifications passing.
   * The receipt is written to `docs/receipts/`.
5. Commit the receipt. It contains no URL and no password.

**When to re-approve:**
* `dbFingerprint` changes when the host, port, database, role or project ref changes.
* `serverIdentity` changes when the cluster changes (restore to a new instance, failover to a
  different system identifier, or a different session user).
* Either mismatch refuses the run. Re-run step 1, re-verify the target in the dashboard, and
  re-export the values.
* A password rotation does **not** change either value.
* If the role is not allowed to read `pg_control_system()`, `systemIdentifier` shows as
  `"unavailable"`. The identity then rests on database, user and port; record that in the receipt review.
