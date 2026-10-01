These receipts come from a **local simulation** on the isolated learners_qa2 database (embedded PostgreSQL 18.4, localhost).
That database was migrated to 0024 first, then `scripts/preview-qa-migrate.mjs` ran in four modes in order:
`--plan`, `--apply` (applied 0025–0027), `--apply` again (nothing pending, so nothing ran), and a fourth run.
The refusal cases (wrong fingerprint, missing backup reference) stop before a receipt is written.
These are NOT Preview receipts. No Preview database credential was available in this sandbox.
