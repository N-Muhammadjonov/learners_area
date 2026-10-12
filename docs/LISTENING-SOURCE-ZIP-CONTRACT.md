# Canonical Listening source ZIP — status and contract (2026-10-03)

**Status: OWNER ACTION REQUIRED.** The file is not in the repository, not on
`arena/reference-materials` (that branch holds only `booster.zip`, a scraped web bundle
that is NOT a Listening package), and not anywhere on the QA machine. No substitute or
generated ZIP is used. These 2 tests remain **SKIPPED (not PASS)**:

| Test | File | Missing input |
|---|---|---|
| "Uploaded owner source: counts, no fabricated transcript and valid source parsing" | `tests/full-listening-package.test.ts` | `LISTENING_SOURCE_ZIP` = path to the owner's original package |
| "Actual uploaded source grades all 40 answers including swapped choose-TWO; repeat submit remains immutable" | `tests/full-listening-write-db.test.ts` | same file |

## The exact file the tests pin
They assert facts about ONE specific owner package, so only that original file can turn them green:
- `testId` = `full-listening-10`, 40 questions
- Q18 is a map-labelling item whose options include "A Music room"
- Q25 is "Choose TWO" with an option containing "Modern Forensic Techniques"
- keyword match 1 and 2: 20 items each; vocabulary session: 15 items
- `publicationIssues` = 4 (the importer must find exactly these review flags)
- audio entry size = **16,451,023 bytes**; duration used by the test 1645.061224 s

## Package layout the importer accepts (`src/lib/listening/source-parser.ts`, `zip.ts`)
```
<root>/01_full_exam.html          required — the 40 controls, sections, explanations
<root>/03_keyword_match_1.html    activity (optional but expected here)
<root>/04_keyword_match_2.html    activity
<root>/05_vocabulary_session.html activity
<root>/metadata.json | manifest.json   optional (fallback when absent)
<root>/data/transcript.json       optional canonical transcript (never fabricated)
<root>/<audio>.mp3|.m4a|...       the exam audio
```
Limits: ≤ 200 MB compressed and expanded, no `..`/absolute paths, no duplicate names.

## Owner steps
1. Put the original ZIP somewhere on the QA machine (do NOT commit it).
2. `LISTENING_SOURCE_ZIP=/path/to/package.zip npm run qa:gate`
3. Both tests must report PASS. Any failure is a real defect, not a skip.
