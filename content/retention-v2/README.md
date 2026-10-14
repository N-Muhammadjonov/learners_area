# Retention FINAL V2 — 75 author-provided items

This content bank comes from the owner's file `Learners_Area_Retention_75_Texts_FINAL_V2(1).txt`, provided 2026-10-14, and replaces **neither** the historical unapproved N14 draft files nor any existing production Retention records.

- `A2.jsonl`: 15 items, 100–125 words each
- `B1.jsonl`: 15 items, 160–195 words each
- `B2.jsonl`: 15 items, 240–285 words each
- `C1.jsonl`: 15 items, 280–330 words each
- `C2.jsonl`: 15 items, 390–450 words each

Each JSONL row has `sourceId` (such as `A2-001`), `level`, `bodyText`, and the **original authored** `scoringStructure`. All 75 original JSON structures and retention texts are preserved. Every rubric is private server-side data; it must **never** be placed into Retention learner API payloads or client bundles.

## Production evaluator discrepancy — BLOCKS PUBLICATION

The source file's own QA says exact and paraphrased recall score 100 on all 75. On the **current website evaluator**, the real CI proved otherwise: **49 failed score checks across 29 item IDs** (23 canonical-label checks, 26 source-text checks); some C2 material scores as low as 46. See `calibration-gaps.json` for the exact ID/check/observed score. **Those claims are not falsely certified**. The test pins the actual known results and fails if they drift without a reviewed update; the source stays in `QA_HOLD_DO_NOT_PUBLISH` state and must not be seeded/published until each discrepancy is resolved and all 75 show the expected behavior. Do not round these scores to 100 or change the original author content silently.

Every authored scoring structure uses schemaVersion 1, maxScore 100, exactly five 20-point sentence-scoped claims, groups summing to each claim's points, accepted paraphrases, contradiction reject phrases, and strict date/number anchors. The longest actual `anyOf` phrase is 171 characters and one C2-009 contradiction is 203 characters. The shared strict validator now accepts bounded 180-character alternatives and 220-character accepted/rejected phrases, rather than truncating authored content. The strict schema still rejects executable shapes, regex, callbacks, oversized arrays and unknown keys.

## Quality gate

```bash
node --import tsx --test tests/retention-v2-content.test.ts
```

The regression validates all 75 exact level and source IDs, no duplicate body, every canonical word range, real production scoring-schema validation, all 375 claim totals and deterministic recall. The 49 known score mismatches are *pinned as release blockers*, not waived or reported as PASS. Author-declared CEFR levels have not been certified by an external examiner.

## Availability / production import

**Merging JSONL into `main` does NOT make these 75 records live in the Retention UI.** The website reads the versioned PostgreSQL `retention_texts` / `retention_text_versions` tables; it does not seed itself on deploy. This PR intentionally performs **zero production DB writes**.

To publish, first inspect existing rows per CEFR level, verify backups and import to an isolated QA database, verify the actual 100-point evaluation and rotation, then use the current admin content workflow or a separately approved idempotent production import. Do not overwrite or delete existing Retention attempts and versions.

Do not replace the old drafts retroactively; learner attempts must retain the exact version and result they were graded against.
