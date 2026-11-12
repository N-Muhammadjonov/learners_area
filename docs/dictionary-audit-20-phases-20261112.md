# Dictionary sense audit — 2026-11-12

## Frozen production baseline

- Project: `tuoeabrrnsiuxpjmslxp`
- Channel: `stable`
- Release: `rel-v1-1fa06d8d41d8ff701632573e`
- Entries: **65,277**; distinct lexeme IDs: **65,277**
- Sense IDs: **110,409**; no null sense arrays observed.
- Storage: **Cloudflare R2**; all active entry `payload` values are null.
- Immutable source is never edited in place. Changes require a new validated release with checksum-based R2 shards, explicit publication and rollback to previous release.

## Deterministic batch partition

Take all `(lexeme_id, sense_id)` pairs from the frozen release, order by `lexeme_id, sense_id`, assign 1-based row numbers, and compute `floor((row_number - 1) * 20 / 110409) + 1`. When resuming, assert the release and total are unchanged; never silently recalculate against a different release. Keep a checkpoint keyed by `release_id`, `lexeme_id`, `sense_id`. Some entries span phase boundaries by design.

| Phase | Sense rank (inclusive) | Sense count | Status |
| --- | ---: | ---: | --- |
| 01 | 1–5,521 | 5,521 | Structural audited; semantic pending |
| 02 | 5,522–11,041 | 5,520 | Structural and presentation coverage audited; semantic review pending |
| 03 | 11,042–16,562 | 5,521 | Structural and presentation coverage audited; semantic review pending |
| 04 | 16,563–22,082 | 5,520 | Not started |
| 05 | 22,083–27,603 | 5,521 | Not started |
| 06 | 27,604–33,123 | 5,520 | Not started |
| 07 | 33,124–38,644 | 5,521 | Not started |
| 08 | 38,645–44,164 | 5,520 | Not started |
| 09 | 44,165–49,685 | 5,521 | Not started |
| 10 | 49,686–55,205 | 5,520 | Not started |
| 11 | 55,206–60,725 | 5,520 | Not started |
| 12 | 60,726–66,246 | 5,521 | Not started |
| 13 | 66,247–71,766 | 5,520 | Not started |
| 14 | 71,767–77,287 | 5,521 | Not started |
| 15 | 77,288–82,807 | 5,520 | Not started |
| 16 | 82,808–88,328 | 5,521 | Not started |
| 17 | 88,329–93,848 | 5,520 | Not started |
| 18 | 93,849–99,369 | 5,521 | Not started |
| 19 | 99,370–104,889 | 5,520 | Not started |
| 20 | 104,890–110,409 | 5,520 | Not started |

## Validation gates — every sense

1. Check English lemma, part of speech, distinct homographs and the exact sense definition.
2. Cross-check English–Uzbek translation and usage examples against that sense. Flag suspect machine translations; do not guess.
3. CEFR must be evidence-backed at *usage/sense* granularity, not assigned from obscure synonym ranking or lexeme frequency alone.
4. Check synonym and antonym relations for target validity, POS matching and correct sense scope. Absence of legitimate antonyms is not a defect.
5. Validate collocations: natural attestation, meaning match and link resolution. Absence is not automatically a defect.
6. Verify entry schema, referential integrity, no duplicate ID, source/license attribution, UI read path and readback.
7. Record evidence URL, reviewed_by, confidence, original value, proposed value, release ID and resolution state for each intervention.
8. Require original-shard snapshot and new-release checksum verification before any publish; run regression tests and compare counts/hashes; rollback by channel switch only if required.

## Priority regression outside Phase 01 — confirmed case: hello

- Entry: `661696f8-4ed4-5321-8e0c-e4e513d768a5`, POS `n`.
- Sense: `eadfd862-8108-42cf-b009-995653d25c2c`.
- Exact definition: `an expression of greeting`; translation: `salom`.
- Current R2 CEFR: **C2**; editorial reference for greeting **A1**: https://dictionary.cambridge.org/dictionary/english/hello (entry includes exclamation and noun).
- Four existing canonical synonym edges: `hi`, `how-do-you-do`, `howdy`, `hullo`. The reader's presentation fallback had previously discarded unscoped edges when a curated sense row existed. Branch fix retains these for single-sense entries; no relation is fabricated.
- No canonical antonyms or collocations recorded. Review whether authentic combinations such as `say hello` belong to this noun sense before adding; do not invent entries.
- **Status:** canonical CEFR correction proposed, NOT published. Because the active release is immutable and checksum-bound, do not patch Postgres metadata, cached previews, or R2 objects in place. Build a new release with `A1` and rerun index, reader-metadata and presentation checks.
- **Phase-01 senses:** All 5,521 require full sense-specific linguistic verification; `hello` is outside the frozen phase-01 range. No claims of complete QA.

## QA

Run relevant backend tests: `python -m pytest services/backend/tests/test_dictionary_reader_metadata.py -q` from an environment with the backend dependencies importable. Both single-sense preservation and multi-sense isolation are covered in the dedicated regression tests added on this branch.

No production release, channel, data or main branch was mutated by this audit.

## Phase 01 — November 12 comprehensive structural pass

- Frozen rank range: **1–5,521** (lexeme/sense IDs sorted). The first 13 R2 shards `00` through `0c` were downloaded and their entire content parsed. Shard `0c` contains additional senses beyond this phase; only rank <=5,521 was included in phase totals.
- Parsed: **3,408 entries**, of which **5,521 sense IDs** belong to Phase 01. Every shard's **SHA-256 and entry count match** production Supabase `dictionary_r2_shards` descriptors, checked independently.
- **0** missing EN/UZ definitions, **0** empty translations, **0** invalid nonempty CEFR enumerations, **0** missing attribution objects, **0** empty Uzbek example text in authored sense records.
- CEFR: A1=62; A2=166; B1=756; B2=954; C1=770; C2=2,377; unassigned=436. Counts sum to **5,521**.
- Canonical sense records lacking authored examples: **3,140**. Canonical relations not directly linked to a sense: synonyms **4,345**, antonyms **5,478**, collocations **5,482**. These **are not evidence that supplementary presentation is empty** and not proof of a factual defect.
- **436** unassigned CEFR senses and **2,377** C2 senses were preserved in the exact-ID review queue: `content/dictionary/audit-20261112-phase01-flagged-records.json`. Each of the 13 immutable shard hashes is included so the source can be reverified.
- Independently source-checked: **you**, pronoun referring to the addressed person(s), has absent CEFR, Cambridge rates this exact usage **A1**: https://dictionary.cambridge.org/dictionary/english/you. Proposed immutable correction.
- Independently source-checked: **come**, noun meaning semen, is marked **slang** in Cambridge rather than the common movement verb. Current **A1** is semantically suspect; leave proposed value unset pending evidence instead of automatically replacing with C2: https://dictionary.cambridge.org/dictionary/english/come.
- **hello** is a priority out-of-band regression, **not within the phase-01 lexeme-ID partition**, and is still a source-checked C2→A1 correction proposal. Synonym presentation code fix lives on the same branch.

### Signoff

**Structural inventory and flag generation: COMPLETE.** **Semantic verification of all 5,521 translations, CEFR labels, synonyms, antonyms and collocations: NOT COMPLETE.** A populated field cannot be treated as a correct translation; an absent relation is not necessarily a mistake. All 5,521 entries require provenance-backed semantic review before this phase can truthfully be certified as fully corrected. The branch includes no newly published R2 release and no production data mutation. The four added preservation/isolation regression tests were executed with the broader focused backend suite on GitHub Actions. **82 passed, 1 warning**; see https://github.com/N-Muhammadjonov/learners_area/actions/runs/43231278384 . This proves focused code behavior, not linguistic correctness of all 5,521 senses. The project must not equate structural coverage with linguistic signoff.


## Continuation: execution evidence (2026-11-12)

- Fixed an additional display defect in `services/backend/app/dictionary_presentation.py`: when exact-sense curated metadata was present (even an empty curated collocation array), the reader previously discarded valid canonical collocations. The display now deduplicates the canonical and curated phrases by normalized text and target identifiers, without assigning unscoped phrases to arbitrary senses.
- Added single- and multi-sense collocation regression tests. These extend the earlier two synonym tests.
- Added `.github/workflows/dictionary-audit-phase1-ci.yml`. GitHub Actions run `43231278384` completed successfully: **82 passed, 1 warning** in the focused backend suite; `compileall` also succeeded. CI only verifies code, not independent translation/CEFR source correctness.
- Current `main` has advanced independently. This audit branch is not automatically rebased or merged. Production data and immutable R2 objects have not been altered.
- **Final classification:** structural data integrity QA and code regression complete; phase-01 human/independent linguistic certification, immutable release generation, and production readback still incomplete. The phase cannot be marked fully verified until those deliverables exist. The 436 null CEFR and 2,377 C2 records are review candidates, not blanket errors.

## Presentation cross-check — all 5,521 phase-01 senses

The frozen canonical R2 entries were independently matched by `lexeme_id` and `sense_id` against all 13 locally bundled presentation shards `00`–`0c`. The final shard `0c` was restricted to the first 309 senses ordered by lexeme/sense ID; its other 192 senses belong to phase 02.

| Count across exact phase-01 scope | Count |
| --- | ---: |
| Source senses checked | 5,521 |
| Matching presentation sense IDs observed | 5,473 |
| No presentation sense row | 48 |
| Senses with presentation synonyms | 3,059 |
| Senses with canonical synonyms scoped to the exact sense or safe single-sense fallback | 1,176 |
| Senses with synonyms in either counted layer | 3,064 |
| Senses with presentation collocations | 114 |
| Senses with canonical collocations scoped to the exact sense or safe single-sense fallback | 39 |
| Senses with collocations in either counted layer | 153 |
| Senses with no synonym in either counted layer | 2,457 |
| Senses with no collocation in either counted layer | 5,368 |

These are **presence counts**, not semantic validation. Missing presentation rows may be custom additions, stale supplementary metadata or expected base fallback; all 48 must be inspected against exact source hashes and provenance before assigning a defect. The presence audit matched sense IDs but did **not independently validate every presentation `meaningSha`**, so effective rendered counts may be lower. Unscoped relations on polysemous entries require sense disambiguation; the UI must not distribute them across unrelated senses. All missing relation numbers are review candidates rather than invented antonyms/collocations.

Code fix: retaining both canonical and curated collocations without losing either when curated metadata is present. GitHub CI on branch runs the preservation and sense-isolation regression tests.

### Completion criteria still outstanding

- Independently verify **every one of 5,521 EN→UZ sense translations**, not merely its nonempty JSON string.
- Check CEFR at the exact sense and register, resolve 436 null labels appropriately, and investigate 2,377 C2 labels without mass downgrading.
- Validate that each proposed synonym, antonym and collocation is genuine, appropriately scoped and sourced. `no antonym` can be legitimate.
- Produce reproducible immutable candidate R2 release, full source/presentation/hash QA, rollback pointer and deployment readback before changing the stable channel.
- Rebase or reconcile independently advanced `main` only after test gates; do not silently merge.


## Verified regression gate — final focused run

- GitHub Actions: https://github.com/N-Muhammadjonov/learners_area/actions/runs/43232070037
- Run completed successfully: **85 passed, 1 warning**, plus `compileall` PASS.
- Includes three frozen-receipt assertions and four new sense-isolation/preservation tests (two synonym and two collocation cases).
- External language correctness still requires source-by-source review; passing test code cannot certify unreviewed translations.


## Phase 02 — 12 November 2026 audit

Source release `rel-v1-1fa06d8d41d8ff701632573e` was frozen before starting. The phase includes exactly 5,520 sense IDs at sorted ranks 5,522–11,041, with 3,222 unique lexemes. Thirteen R2 shards (`0c`–`18`) were fetched; SHA-256, compressed byte sizes and entry counts matched production Supabase shard descriptors. Boundary shards were filtered by exact lexeme/sense ID. Audit source receipt: `content/dictionary/audit-20261112-phase02-flagged-records.json`. Additional exact sense ID presentation receipt: `content/dictionary/audit-20261112-phase02-presentation-coverage.json`.

| Validation | Phase 02 observed |
| --- | ---: |
| Sense IDs checked structurally | 5,520 |
| Empty translation / EN definition / UZ definition | 0 / 0 / 0 |
| Missing CEFR | 461 |
| Nonempty CEFR outside A1–C2 | 0 |
| CEFR distribution A1/A2/B1/B2/C1/C2 | 64 / 185 / 733 / 975 / 768 / 2,334 |
| Sense records without source examples | 3,111 |
| Sense records with AI draft editorial provenance | 47 |
| Duplicate translation rows / repeated sense IDs | 0 / 0 |
| Invalid local source sense references in relations / collocations | 0 / 0 |
| Canonical-only missing synonym/antonym/collocation | 4,363 / 5,492 / 5,480 |
| Missing presentation sense row | 44 |
| Senses with synonyms in canonical or presentation layer | 3,054 |
| Senses with collocations in canonical or presentation layer | 129 |
| No synonym in either counted layer | 2,466 |
| No collocation in either counted layer | 5,391 |

The counts for relationships represent *presence*, not confirmation of exact semantic correctness. The presentation comparison matched lexeme and sense IDs, but it did not independently validate every `meaningSha`, so the effective UI count can be lower when metadata is stale. The 44 absent presentation rows are follow-up candidates, not automatically errors because fallback data may be valid.

**Automated structural audit: COMPLETE.** **Independent semantic translation, sense-level CEFR and relationship certification: NOT COMPLETE.** Exactly 2,795 meaning IDs are queued for missing CEFR (461) or C2 review (2,334), but C2 itself is not an invalid value. None of the 5,520 meanings has been certified as fully linguistically correct merely because all required fields are filled. No fictional synonyms, antonyms, or collocations were created. No live release, channel pointer or production content was modified.

### Release and merge policy

Do not merge `fix/dictionary-audit-phase-01-20261112` to `main` until all 20 planned phases are finished and separately tested. The production `stable` channel must not change before fully validated immutable release generation, backup, rollback and regression gates.

## Phase 03 — 12 November 2026 audit

Frozen release: `rel-v1-1fa06d8d41d8ff701632573e`. Exact rank range: 11,042–16,562 (5,521 senses, 3,343 lexemes). Cloudflare R2 shards `18`–`25` (14 shards) were read, and SHA-256, byte lengths and entry counts matched Supabase descriptors. The two boundary shards were restricted to the exact `lexeme_id/sense_id` range.

Source audit receipt: `content/dictionary/audit-20261112-phase03-flagged-records.json`. Presentation receipt: `content/dictionary/audit-20261112-phase03-presentation-coverage.json`.

| Validation | Phase 03 result |
| --- | ---: |
| Senses inventoried | 5,521 |
| Missing translation / English definition / Uzbek definition | 0 / 0 / 0 |
| Missing CEFR | 444 |
| Invalid nonempty CEFR labels | 0 |
| CEFR A1 / A2 / B1 / B2 / C1 / C2 | 57 / 164 / 696 / 944 / 766 / 2,450 |
| Canonical source senses without examples | 3,207 |
| AI-draft editorial senses | 48 |
| Duplicate source sense IDs / translations | 0 / 0 |
| Invalid local relation / collocation source sense IDs | 0 / 0 |
| Senses without canonical synonym / antonym / collocation | 4,263 / 5,477 / 5,495 |
| Missing supplementary presentation sense row | 33 |
| Senses with synonyms in canonical or presentation layer | 3,059 |
| Senses with collocations in canonical or presentation layer | 118 |
| Senses without synonyms in counted layers | 2,462 |
| Senses without collocations in counted layers | 5,403 |

The 2,894 sense IDs with missing CEFR (444) or a C2 label (2,450) are recorded in the frozen review queue. A high C2 count is **not itself proof of wrong labels**. A missing relation or supplementary presentation row is **not automatically an error**. Supplementary comparison was performed by exact IDs, but does not prove every `meaningSha` is current or every relationship is semantically correct.

A spot check illustrates why word-level inference is unsafe: `school` in this phase is a verb and includes both educating and fish schooling senses, while `OR` is a hospital operating room noun, not the conjunction. Do not apply CEFR or translations across homographs, parts of speech or senses.

**Structural and presentation presence audit: COMPLETE.** **Independent source-by-source semantic correctness review, candidate immutable release generation and production readback: NOT COMPLETE**. No fabricated synonyms, antonyms or collocations, no blanket CEFR reassignment, no R2 or production writes and no merge to `main`.

### Phase 03 follow-up gates

1. Verify individual English–Uzbek translations and each CEFR against source-backed sense and register references.
2. Review AI-draft meanings and investigate suspicious C2, while respecting legitimate specialist language and true synonym absence.
3. Validate `meaningSha`, relation target lexeme/sense identities, sense matching, and provenance before finalizing a linguistic signoff.
4. Rebuild and validate an immutable new candidate release only after accepted edits, with a backed-up rollback channel and regression tests.
5. Keep all 20 phases on this branch until the user's no-merge rule is satisfied.
