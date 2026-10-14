# Retention FINAL V2 — actual release/production gate (2026-10-14)

The owner provided 75 source texts (15 per A2, B1, B2, C1, C2). They are already in `main` after PR #13. The production Supabase inventory on 2026-10-14 returned **zero** rows in `public.retention_texts`. Merely merging content is not a database import, so the learner UI is not yet populated.

## Calibration evidence and safeguards

PR #13 preserved 49 raw-source evaluator discrepancies across 29 IDs in `content/retention-v2/calibration-gaps.json`. The source JSONL remains unchanged. This follow-up fixes identifiable normalizer bugs (honorific splitting, comma token matching, lost comparatives, and false "not realistically" denials) and adds explicit corrections to 26 claims, grounded solely in exact author labels or clauses from the source. The calibrated private scorer is `scripts/retention-v2/calibration.ts`.

At CI, **all 75** must score 100 on author/source and canonical factual recall; empty/unrelated responses must score 0, keyword stuffing must score below 100, and incorrect dates, factual denials and opposing comparatives must never receive full credit. All regression tests and production build must PASS.

## Safe repeatable operator flow (NO automatic production changes)

1. Verify a recent **recovery-tested Supabase backup** and confirm that `retention_texts` has zero rows. If nonempty, stop and reconcile. Ensure the 75 originals are not already present under other labels; preserve all attempts.
2. First on an isolated QA database with the canonical schema:
   ```bash
   env -u DATABASE_URL node --import tsx scripts/import-retention-v2.ts
   DATABASE_URL='<QA_POSTGRES_URL>' RETENTION_BANK_BACKUP_VERIFIED=yes \
     node --import tsx scripts/import-retention-v2.ts --apply --confirm-empty-bank
   DATABASE_URL='<QA_POSTGRES_URL>' node --import tsx scripts/import-retention-v2.ts --verify
   ```
3. Test login, level selection, 15 texts in each CEFR group, start/submit/review, full and partial scoring, date/negation rejection, refresh resilience, and preserved role boundaries.
4. After owner approves QA and recovery is independently verified, perform the same `--apply --confirm-empty-bank` on a controlled production admin environment **once**, using the actual production `DATABASE_URL` already configured there. Never print credentials. The 75-row import is one PostgreSQL transaction and refuses nonempty unknown banks. It adds text/version/audit records, no deletes and no changes to student attempts.
5. Run production `--verify`, then read-only SQL:
   ```sql
   SELECT level, count(*) FILTER (WHERE active AND current_version_id IS NOT NULL) AS active,
          count(*) FILTER (WHERE NOT active) AS archived
   FROM public.retention_texts GROUP BY level ORDER BY level;
   ```
   Expected after applied and verified: exactly five rows A2/B1/B2/C1/C2, each with active=15 and archived=0.

**The merge/CI alone cannot certify live Retention.** Leave production untouched if any gate fails.

## Academic Reading Test 29 / Passage 2 — source material blocker

Owner's SQL result showed 105 Reading passages in production, 104 published, and `The importance of law` (Test 29 Passage 2) in draft. Original supplied Reading ZIP contains ~546 words for this passage but asserts 892 words. **Do not change the declared count merely to get a PASS, synthesize missing text, copy a third-party copyrighted article into the app without permission, or mark the draft published.** Obtain the owner's complete licensed original source, compare all paragraphs and 13 questions/evidence, then add a versioned, idempotent correction with staging QA and controlled production update. Student exam/history records must not be deleted or rewritten. Until that source is provided, the truthful acceptance status is **104 published + 1 SOURCE_HOLD draft**, not 105 published.
