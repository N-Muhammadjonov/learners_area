# Canonical Listening source ZIP — verified source contract (2026-10-10)

The original `LEARNERS_AREA_LISTENING_TEST_1_FINAL.zip` was recovered from the owner's saved artifacts. Its bytes were not regenerated or modified. The previous 2026-10-03 missing-file description and its counts were stale and did not match the current pinned tests.

Archive SHA256: `5c3cdfffe029b3a7c948f34b2be2d17201c760eae1678f6d83e2853073a90c77`.
Library identity: `libfile_719130566d948191ab89cc8f6f5f90e6`.
The media remains outside the Git repository in `work/source-inputs-batch21`.

## Current exact-source facts

| Contract | Verified value |
|---|---|
| `testId` | `listening-test-1` |
| Questions / sections / activities | 40 / 4 / 5 |
| Q18 | Map labelling, including A Music room |
| Q25 | Choose TWO, including Modern Forensic Techniques |
| Keyword Match I / II | 20 / 20 items |
| Vocabulary | 20 items, no fabricated quiz |
| `publicationIssues` | 0 |
| Audio | `assets/audio/full.mp3`, 16,450,918 bytes |
| Audio SHA256 | `c8d072e719dd00f53df9cc8fa916f35343d21ddffb0336c768e2a3f33aa1b34f` |
| Duration passed to parser test | 1645.061224 seconds |

The metadata rounds the audio duration to 1645.061 seconds. The test-supplied duration is not a new acoustic measurement.

## Executed evidence

`tests/full-listening-package.test.ts`: 8 tests passed, no skips or failures. The owner-source case checks the original package, question options, map data, activity counts and exact audio length. Other cases exercise parser safety and grading contracts.

`tests/full-listening-write-db.test.ts`: 1 test passed, no skips or failures. The original package grades all 40 answers, including a swapped Choose TWO pair. Repeated submission returns 409 and preserves the original 40 answer rows. This case uses PGlite and is not native PostgreSQL evidence.

Raw logs and source hashes are in `docs/evidence/riwi-batch21-source/` and `docs/RIWI-BATCH-21-SOURCE-RECOVERY.json`.

## Package identity and pending acceptance

The source contains `01_full_exam.html`, `02_review_revision.html`, `03_keyword_match_1.html`, `04_keyword_match_2.html`, `05_vocabulary_session.html`, metadata, manifest and shared audio. The importer reads authored data without executing embedded JavaScript. Missing canonical transcript fields stay empty.

Similarly named V4_FIXED, IMPORTER_COMPATIBLE and REFERENCE_MATCH_FINAL packages failed the current legacy-format source test. Their failures remain recorded. No parser or assertion was changed to make them pass. Listening_Test_1_ONLY contains only one HTML file and is not equivalent to this five-activity package.

Batch20's historical full native receipts still show four original-source skips. Batch21's two focused rounds now pass all 13 selected cases without skips or failures, using both pinned original inputs. Both Speaking cases executed on fresh native PostgreSQL16.14. The Listening write case still uses PGlite. All raw ZIP members, log hashes, source/input pins and both shutdowns were independently verified in docs/RIWI-BATCH-21-NATIVE-VERIFICATION.json. This does not imply a rerun of the entire 1,358-case suite without skips.
