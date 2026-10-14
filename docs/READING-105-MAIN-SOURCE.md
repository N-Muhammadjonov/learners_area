# Reading 105 — immutable source on the current main lineage

This adds only the original owner-provided source archive to the Learners Area Git tree; **no Reading passage has been inserted into any database by this change**.

- Source ZIP: `data/import-sources/learnersarea_reading_105.zip`
- Git blob SHA-1: `f8679d9ea81713fdbc8e7cc6b3b3505dbd4d292a`
- Original source ref: `assets/learners-area-brand:learnersarea_reading_105.zip`
- Source bytes: `2,897,149`
- Recorded SHA-256: `d736cd4bada0f55309a498116e0e408dd64306ad22779d3ba306a20d01529dd6`
- Existing importer: `scripts/import-reading-105.mjs` (already present on `main`)
- Existing schema: `drizzle/0017_reading_105_library.sql` (already on `main` and part of the canonical migration chain)

## Verification gates

CI uses the real archive in a `DATABASE_URL`-free dry run:

```bash
env -u DATABASE_URL node --import tsx scripts/import-reading-105.mjs \
  --source data/import-sources/learnersarea_reading_105.zip \
  --report /tmp/reading-105-import-ci.md
```

Expected: 105 passages, 1,406 questions, 104 publishable and 1 held draft. The report `docs/READING-105-IMPORT-REPORT.md` is **historic dry-run evidence**, not a production database import receipt. Passage 29/2 (`The importance of law`) has source word-count mismatch and must remain draft until its text is verified. Missing authored evidence must never be invented.

## Database release gate — separate owner-approved operation

1. Read-only production inventory: scope by the `external_id` keys in the ZIP and count already-imported rows, existing questions, published/draft status. Do not assume that an existing row with another source ID belongs to this library.
2. Verify a recent recovery-tested backup and current canonical schema; preserve existing learner attempts and records.
3. Clone an isolated QA database from that backup; execute the idempotent `--apply` in QA and run `--verify` (105 passages / source identity / 1,406 answers / 104 published + 1 held draft), plus exam/review/security checks.
4. Only after QA PASS and explicit owner approval, run the same controlled import against production. Never run raw SQL copied from another branch, truncate content, or republish the held draft.
5. Re-verify publication state and learner surfaces; generate a fresh production receipt. If QA or production differ, stop.

This source-copy PR does not authorize a production database import.
