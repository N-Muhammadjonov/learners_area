# Prompt Book registry checkpoint — 2026-10-09

Publication base: `9d2acf3c60f65e88d556779979490d4a467d160e` on `arena/01a10bac-learners-area`.

## Behavior

Preserves all 68 historical contract definitions, keys, versions and overlay fields. Adds 37 missing task definitions to the existing registry, giving 105 runtime entries covering the original book's 68 source tasks. The extra count represents preserved historical compatibility, not additional source requirements.

All 68 source task keys, titles, focus, teaching methods and hard guards were compared with the original source file. Its SHA-256 is `7b78fbae566e1b055a6a5406b193c14a11c6f49f28a43fdde02a96443ab5c2fc`.

Canonical metadata can distinguish objective question subtypes and single/multiple MCQ. Unknown types fail closed. Objective/instruction entries cannot become provider grading or owner assessment-overlay paths. Positive/negative Writing Task 2 is distinct from the preserved cause/effect contract.

Mode A/B archives carry exact contract version/hash metadata. Mode C excludes it. Import rejects absent, incompatible, duplicate or incomplete metadata before destination mutation. A newly added regression reproduces acceptance of a manifest with one omitted contract, then passes after complete-set validation was added.

## Verification

- Registry, coverage, owner governance, portability and ledger focused tests: 28 pass, 0 fail, 0 skip.
- Owner policy, assessment migration, provider transport and privacy tests: 40 pass, 0 fail, 0 skip.
- UI: 232 pass, 0 fail, 0 skip.
- Typecheck, lint and production build: exit 0.
- Historical contract snapshot equality and original source-data comparison passed.

The first integration run failed two Git privacy checks because the isolated QA source snapshot lacked `.git`. Repeating the same checks with the actual cloned Git metadata passed all 40 checks. No product change was made to suppress those failures.

## Limits

Registry coverage is not full runtime acceptance. Post-submission Reading/Listening explanations, additional instruction/catalog runtime routing, deployed browser/provider/native PostgreSQL/object-store checks and website-branch integration remain separate requirements.

Older Mode A/B archives without a complete compatible contract manifest fail explicitly. They require a reviewed migration/re-export path; no rubric is silently substituted. Historical evaluation records are unchanged.

No shared database, main, website branch or deployment was changed by this checkpoint. Publication is complete only after the resulting remote commit and all changed blobs are verified.
