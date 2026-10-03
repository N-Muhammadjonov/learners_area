# Migration 0035 — teacher_student_links (approval package, SEPARATE from 0029–0034)

Status: **NOT APPLIED to Preview or Production. OWNER ACTION REQUIRED.**
Tested locally: PGlite (`tests/reporter.test.ts` RP14–RP17) and the real-PostgreSQL QA gate.

## Why it exists
RIWI Reporter teachers previously reached **every** student. The schema had no
authoritative teacher→student relation:

| Candidate | Why it is NOT ownership |
|---|---|
| `assignments.created_by_user_id → target_user_id` | One task, one time. Any staff member can create one; it does not mean "my student". (RP14 proves it grants no reach.) |
| `live_classes.teacher_user_id` + `live_class_attendance` | Marked schema-only/not wired; attendance is per-session history. |
| `writing_feedback.teacher_id` | Who wrote one feedback, not a roster. |

So 0035 adds an explicit roster that owner/admin manage at **/admin/roster**.

## What it does
- `CREATE TABLE IF NOT EXISTS teacher_student_links` (teacher, student, assigned_by, created_at), unique pair, student index, `teacher <> student` check.
- Only `CREATE … IF NOT EXISTS` statements (pinned by RP17). No existing row is read, changed or back-filled.

## Impact once applied
- Teachers see **zero** learners in Reporter until owner/admin assign students (fail closed). This is intended.
- Owner and admin reporting is unchanged (admin reach is stated in `ADMIN_REPORT_POLICY`).

## Impact if Preview code runs BEFORE 0035 is applied
- Owner/admin/student reports: unaffected.
- Teacher reports: the roster query fails → roster check returns 404 / report returns `generation_failed` (503). Teachers get **no** data, so nothing leaks.
- `/admin/roster` is expected to show the error page until the table exists (not verified on Preview).

## Rollback / recovery
`DROP TABLE teacher_student_links;` removes only roster links. No learner data
depends on the table; teachers revert to seeing no learners (fail closed). Do not
roll back by editing the journal.

## Owner steps (read-only first)
1. `node scripts/preview-qa-migrate.mjs --fingerprint`
2. `node scripts/preview-qa-migrate.mjs --plan` → 0035 will be listed as pending, **outside** `ALLOWED_PENDING` (0025–0028); the guard refuses to apply it.
3. Approving 0035 is a separate decision from 0029–0034. Applying it requires an explicit owner approval and a reviewed change to the guard. Never use `--apply` without it.
