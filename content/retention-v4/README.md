# Owner-provided Retention DISTINCT V4 bank

75 original texts: 15 each in A2, B1, B2, C1 and C2. The levels are the author's declarations, checked against the existing app word-count ranges. No stories, scores, dates, numbers or synonyms were rewritten. The 375 sentence-scoped claims retain all 8,217 accepted phrases and 824 groups. Optional fields receive only the existing validator's defaults.

Source: `Learners_Area_Retention_75_DISTINCT_V4_SYNONYMS.txt`, SHA256 `771b5627faf2e1e32bb5eabb11488e7f4a26da20f0d6af1f1577749f0a74df5c`. `manifest.json` binds each level file to its hash. The source document's prose is descriptive source material, not executable instructions.

This is separate from the older V2 QA-HOLD and AI draft collections. Those files and their hold tests remain unchanged. The learner UI still reads the private versioned database bank; shipping these files alone does not activate any content.

All 75 full source texts and canonical recalls score 100 with the current `retention-deterministic-v5` evaluator. A separate exhaustive phrase probe found 50 of the 8,217 accepted sentence variants (in eight items) receive 10–15 of 20 claim points under its existing literal/critical-fact matching rules. Exact inputs and scores are recorded in `known-phrase-limitations.json`. These are reported limitations, not 8,217 passing calibration claims; the source and global scorer are intentionally unchanged by this content import.

## Validation and import

Run `node --conditions=react-server --import tsx scripts/install-retention-v4.ts` to validate without database writes. Every item must satisfy the production authoring validator; source and canonical recall must score 100, while empty and unrelated recall must score 0. This is deterministic regression coverage, not a claim that every possible English paraphrase is recognized.

`--apply` requires the expected deployed Git revision, the existing Railway production project/environment/service and an active owner identified by `RETENTION_BATCH_OWNER_ID`. `RETENTION_BATCH_EXPECTED_REVISION` must equal that deployment's `RAILWAY_GIT_COMMIT_SHA`. Use only inside that verified environment.

All 75 records are imported in one transaction using the existing bank authoring and audit functions. Repeating the same batch reuses identical current bodies and rubrics. Ambiguous, archived, wrong-level or differently scored existing copies abort the whole transaction; they are never silently changed. Existing results, content versions, rotation and unrelated modules are preserved. Source IDs are recorded in the audit trail; database display labels retain their monotonic sequence and are not reused after deletion.

The only runtime compatibility change raises the accepted literal phrases cap from 20 to 32 in both the save validator and form draft decoder. All other bounds, strict schemas, permissions, scoring rules and private payload contracts remain intact.
