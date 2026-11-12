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
| 04 | 16,563–22,082 | 5,520 | Structural/presentation audited; linguistic review pending |
| 05 | 22,083–27,603 | 5,521 | Structural/presentation audited; semantic signoff pending |
| 06 | 27,604–33,123 | 5,520 | Structural/presentation audited; semantic signoff pending |
| 07 | 33,124–38,644 | 5,521 | Structural, presentation and meaningSha audited; semantic signoff pending |
| 08 | 38,645–44,164 | 5,520 | Structural, presentation and meaningSha audited; semantic signoff pending |
| 09 | 44,165–49,685 | 5,521 | Structural R2 integrity audited; presentation and semantic review pending |
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

## Phase 04 — 12 November 2026

**Baseline unchanged:** `rel-v1-1fa06d8d41d8ff701632573e`. Frozen exact-sense ranks **16,563–22,082** (5,520 senses, 3,322 distinct lexemes). Cloudflare R2 shards `25`–`32` (14 files) were retrieved and independently verified against production Supabase SHA-256, compressed byte counts and entry counts. Start/end boundary shards were filtered by `lexeme_id/sense_id` identity. Initial script checksum typo was diagnosed against R2/Supabase and corrected before publishing the audit receipt; no source shard changed.

Source receipt: `content/dictionary/audit-20261112-phase04-flagged-records.json`; presentation receipt: `content/dictionary/audit-20261112-phase04-presentation-coverage.json`.

| Check | Phase 04 |
| --- | ---: |
| Senses examined structurally | 5,520 |
| Missing translation / EN definition / UZ definition | 0 / 0 / 0 |
| Missing CEFR | 456 |
| Invalid non-empty CEFR | 0 |
| CEFR A1 / A2 / B1 / B2 / C1 / C2 | 57 / 149 / 699 / 1,009 / 757 / 2,393 |
| Canonical sense records without examples | 3,172 |
| AI draft editorial senses | 55 |
| Invalid local relation/collocation source sense references | 0 |
| Duplicate source sense IDs / duplicate translations | 0 / 0 |
| Without canonical synonym / antonym / collocation | 4,262 / 5,479 / 5,485 |
| Absent supplementary presentation sense row | 42 |
| Synonym presence in canonical OR presentation layer | 3,077 |
| Collocation presence in canonical OR presentation layer | 157 |
| No synonym / collocation across counted layers | 2,443 / 5,363 |

**Review queue:** 2,849 exact sense IDs (456 missing CEFR; 2,393 C2 for *review*, not wholesale invalidation). Presentation presence was matched by exact IDs; not every `meaningSha` or relation target is separately source-certified. Missing antonyms and collocations may be linguistically appropriate. All translations and CEFR labels still require independent sense-level checks. No speculative synonym/antonym/collocation has been created.

**Phase 04 automated structural and presentation presence audit: COMPLETE. Full independent linguistic verification: NOT COMPLETE.** No production release switch, destructive migration or `main` merge. Keep the original 20-phase no-merge policy.

## Phase 05 — 12 November 2026

Production release `rel-v1-1fa06d8d41d8ff701632573e` remains frozen. Exactly **5,521** senses (3,176 distinct lexemes) at sorted ID ranks **22,083–27,603** were structurally audited. All 14 Cloudflare R2 shards (`32`–`3f`) were fetched, parsed and checked against production Supabase SHA-256, byte count and member count. Boundary shards were restricted to exact `lexeme_id/sense_id` identifiers.

Source: `content/dictionary/audit-20261112-phase05-flagged-records.json`; presentation coverage: `content/dictionary/audit-20261112-phase05-presentation-coverage.json`.

| Check | Phase 05 result |
| --- | ---: |
| Senses checked structurally | 5,521 |
| Missing translation / EN definition / UZ definition | 0 / 0 / 0 |
| Unassigned CEFR | 463 |
| Invalid non-empty CEFR | 0 |
| CEFR A1 / A2 / B1 / B2 / C1 / C2 | 63 / 168 / 748 / 991 / 819 / 2,269 |
| Source senses without examples | 3,014 |
| AI draft senses | 57 |
| Duplicate sense IDs / translation strings | 0 / 0 |
| Invalid canonical source-sense relation/collocation references | 0 / 0 |
| Without canonical synonym / antonym / collocation | 4,369 / 5,490 / 5,473 |
| Missing presentation sense record | 57 |
| Senses with synonym in canonical or presentation layer | 3,042 |
| Senses with collocation in canonical or presentation layer | 179 |
| Missing synonym / collocation across counted layers | 2,479 / 5,342 |

Review queue holds **2,732 exact sense IDs** (463 without CEFR and 2,269 with C2 to validate, not automatically wrong). The meaning-level CEFR distribution remains suspect and requires independent lexical evidence. Presentation numbers measure presence only, and a matching sense ID does not independently prove `meaningSha` currency or semantic quality. No absent antonyms/collocations were invented.

**Automated R2 integrity and presentation presence audit: COMPLETE. Independent linguistic review of all 5,521 translations, sense-specific CEFR and relations: NOT COMPLETE.** No new production release, channel pointer or `main` merge. Preserve the 20-phase no-merge requirement.

## Phase 06 — 12 November 2026

Frozen source `rel-v1-1fa06d8d41d8ff701632573e`; **5,520** sense IDs at ranks **27,604–33,123**, **3,204** distinct lexemes. Cloudflare R2 shards `3f`–`4b` (13 files) independently verified against production Supabase SHA-256, compressed byte sizes and entry/member counts; exact ID range filters applied to the boundary shards.

Source receipt: `content/dictionary/audit-20261112-phase06-flagged-records.json`. Presentation receipt: `content/dictionary/audit-20261112-phase06-presentation-coverage.json`.

| Check | Phase 06 |
| --- | ---: |
| Structurally audited senses | 5,520 |
| Missing translation / English definition / Uzbek definition | 0 / 0 / 0 |
| Missing CEFR | 428 |
| Invalid non-empty CEFR labels | 0 |
| CEFR A1 / A2 / B1 / B2 / C1 / C2 | 70 / 150 / 729 / 1,008 / 833 / 2,302 |
| Without canonical examples | 3,181 |
| AI draft editorial senses | 49 |
| Duplicate source sense IDs / translations | 0 / 0 |
| Invalid local source-sense relation/collocation references | 0 / 0 |
| Without canonical synonym / antonym / collocation | 4,311 / 5,493 / 5,474 |
| Missing supplementary presentation sense row | 51 |
| Senses with synonym in canonical OR presentation layer | 3,176 |
| Senses with collocation in canonical OR presentation layer | 168 |
| Without synonyms / collocations across counted layers | 2,344 / 5,352 |

**Frozen exact-ID CEFR review queue:** 2,730 records, consisting of 428 unassigned CEFR senses and 2,302 C2 candidates. A high C2 count is a prompt for independent sense-level review, not automatic proof of error. Additional `unscopedSynonymsPolysemous`=4,875 canonical relation edges need sense disambiguation; they are not automatically attached to arbitrary senses in the presentation reader.

A spot check found `bunny` (young rabbit) labelled C2 while the other stored `bunny` sense describes a nightclub costume: this requires sense-aware independent reference verification rather than word-level reassignment. No invented antonyms or collocations were inserted.

**Structural integrity and presentation presence checks: COMPLETE. Full source-backed semantic translation/CEFR/relationship certification: NOT COMPLETE.** The presentation coverage comparison used exact lexeme and sense IDs but did not independently hash-verify every `meaningSha` or verify every relation target. No production R2 overwrite, stable channel switch or `main` merge. Preserve the strict 20-stage merge gate.

## Phase 07 — 12 November 2026

Frozen source `rel-v1-1fa06d8d41d8ff701632573e`; exactly **5,521** sense IDs at ranks **33,124–38,644**, **3,251** distinct lexemes. All 14 R2 shards (`4b`–`58`) independently checked against production Supabase SHA-256, compressed byte sizes and member counts. The exact ID range was enforced on boundary shards.

Source receipt: `content/dictionary/audit-20261112-phase07-flagged-records.json`. Presentation coverage receipt: `content/dictionary/audit-20261112-phase07-presentation-coverage.json`.

| Check | Phase 07 |
| --- | ---: |
| Structurally audited senses | 5,521 |
| Missing translation / English definition / Uzbek definition | 0 / 0 / 0 |
| Missing CEFR | 460 |
| Invalid non-empty CEFR labels | 0 |
| CEFR A1 / A2 / B1 / B2 / C1 / C2 | 57 / 159 / 689 / 1,088 / 788 / 2,280 |
| Canonical senses without examples | 3,008 |
| AI-draft editorial senses | 71 |
| Duplicate source sense IDs / translation strings | 0 / 0 |
| Invalid local source-sense relation/collocation IDs | 0 / 0 |
| No canonical synonyms / antonyms / collocations | 4,341 / 5,484 / 5,471 |
| Supplementary presentation sense rows absent | 64 |
| Existing presentation records with mismatched `meaningSha` | **0** |
| Senses with synonym from canonical or presentation | 3,078 |
| Senses with collocation from canonical or presentation | 164 |
| Senses without synonym / collocation across counted layers | 2,443 / 5,357 |

**New integrity gate:** all **5,457 existing presentation sense rows** were verified using SHA-256 of the canonical serialized `{definition,lemma,pos}` object against stored `meaningSha`. Zero mismatches were observed. The other **64** senses lack a supplementary presentation row and may still render through the canonical fallback; absence itself is not proof of incorrect linguistic data.

**CEFR review queue:** **2,740** exact senses, consisting of 460 null CEFR values and 2,280 C2 labels for investigation. C2 itself is valid, not an automatically erroneous assignment. Unscoped synonyms on polysemous entries count 4,717 canonical edges, which must be disambiguated before sense-specific assignment. The reader must not attach these edges indiscriminately.

**Automated R2, presentation identity and meaningSha checks: COMPLETE. Independent semantic translation, CEFR and relation correctness signoff: NOT COMPLETE.** No invented relations, no production write, no immutable release replacement and no `main` merge. Maintain the 20-stage merge gate.

## Phase 08 — 12 November 2026

Frozen source release: `rel-v1-1fa06d8d41d8ff701632573e`. Exactly **5,520 sense IDs** at sorted ranks **38,645–44,164**, with **3,304 distinct lexemes**. Cloudflare R2 shards `58`–`65` (14 files) were fetched and checked against Supabase descriptors: SHA-256 hash, compressed bytes, member count and lexeme shard assignment. Both boundary shards were filtered by the exact `lexeme_id/sense_id` pair.

- Source receipt: `content/dictionary/audit-20261112-phase08-flagged-records.json`.
- Presentation receipt: `content/dictionary/audit-20261112-phase08-presentation-coverage.json`.

| Check | Phase 08 |
| --- | ---: |
| Structurally audited senses | 5,520 |
| Missing translation / English definition / Uzbek definition | 0 / 0 / 0 |
| CEFR unset | 456 |
| Invalid non-empty CEFR labels | 0 |
| CEFR A1 / A2 / B1 / B2 / C1 / C2 | 64 / 158 / 699 / 961 / 796 / 2,386 |
| Canonical senses with no examples | 3,114 |
| AI draft senses | 61 |
| Duplicate source sense IDs / translations | 0 / 0 |
| Invalid canonical source sense references | 0 |
| Missing canonical synonyms / antonyms / collocations | 4,358 / 5,482 / 5,479 |
| Missing supplementary presentation sense rows | 48 |
| Existing presentation rows with stale `meaningSha` | **0** |
| Senses with synonym in canonical or presentation layer | 3,040 |
| Senses with collocation in canonical or presentation layer | 154 |
| Without synonyms / collocations in counted layers | 2,480 / 5,366 |

**New integrity evidence:** all **5,472 existing supplementary presentation sense rows** had their stored `meaningSha` compared against SHA-256 of the canonical serialized `{definition,lemma,pos}`. No mismatches were found. This does not verify semantic correctness or detect missing supplementary rows as necessarily erroneous.

The **2,842** exact-ID CEFR review records comprise 456 unset labels and 2,386 C2 labels. The C2 population is a review priority, not proof all those labels are false. Specialist and polysemous senses must be checked individually against reliable sources. Example: `puddle` has multiple noun senses, including a small water pool and a technical clay mixture; levels must be sense-specific rather than applied indiscriminately.

**Phase 08 automated structural, presentation and hash integrity checks: COMPLETE. Independent linguistic review of all 5,520 translations, CEFR, synonyms/antonyms/collocations: NOT COMPLETE.** No invented relationships, no unverified CEFR changes, no R2 overwrite, no production release switch, and no merge to `main`.

After phase 08, cumulative structural coverage is **44,164 / 110,409 senses**. Full merge and production publishing remain blocked on all 20 phases plus independent semantic quality signoff and immutable candidate release readback.


## Phase 09 — 12 November 2026 (structural pass)

Frozen release: `rel-v1-1fa06d8d41d8ff701632573e`. Exact ranks **44,165–49,685**: **5,521 senses / 3,279 lexemes**, across 14 R2 shards `65`–`72`. Each R2 object's compressed SHA-256, byte length and gzip-member count independently matched the production Supabase descriptor; each multi-member gzip entry was decompressed and parsed, and boundary lexeme/sense IDs were enforced. Evidence: `content/dictionary/audit-20261112-phase09-structural-receipt.json` (full shard hashes, scope and review examples).

| Check | Phase 09 |
| --- | ---: |
| Structurally audited senses | 5,521 |
| Missing EN definition / UZ definition / translation | 0 / 0 / 0 |
| CEFR A1 / A2 / B1 / B2 / C1 / C2 | 57 / 183 / 703 / 954 / 751 / 2,414 |
| Unassigned / invalid CEFR | 459 / 0 |
| No canonical examples | 3,073 |
| Duplicate sense IDs / duplicate translation texts | 0 / 0 |
| Invalid local relation / collocation source IDs | 0 / 0 |
| No canonical synonym / antonym / collocation | 4,277 / 5,491 / 5,500 |

**Review candidates:** **2,873 exact senses** with unset CEFR (459) or C2 (2,414). This is NOT proof those C2 labels are erroneous. Examples requiring source-backed review include `itself` (missing CEFR), `flake` meaning a snow crystal (C2), and `overwrite` meaning replace existing data (C2). No speculative CEFR replacement or invented relation was published.

**Signoff:** structural R2 read/checksum and JSON validation COMPLETE; **presentation coverage / `meaningSha` NOT YET AUDITED**, independent translation/CEFR/relationship semantic QA NOT COMPLETE. No candidate release creation, production mutation, deploy or `main` merge. Keep PR #149 Draft until all 20 phases and linguistic review are finished.

Cumulative exact-sense structural pass: **49,685 / 110,409** (phases 01–09). This is structural coverage only, not certified linguistic correctness.


### Phase 09 continuation — exact-sense CEFR, presentation and relation checks

- Complete exact-ID review queue: `content/dictionary/audit-20261112-phase09-flagged-records.json` (**2,873** senses: 459 unset, 2,414 C2). This is a source-review queue, **not 2,873 proven mistakes**.
- All 14 bundled presentation shards `65`–`72` were independently compared by exact `lexeme_id/sense_id`, including canonical `meaningSha` for every existing row: **5,521 senses, 36 without supplementary presentation records, 0 stale hashes**. **3,122** senses have synonym presence, **110** have collocation presence across canonical + presentation layers. **2,399 / 5,411** have neither synonym / collocation in counted layers; absence can be linguistically valid.
- Found **4,474 unscoped canonical synonym edges on polysemous entries**, which must **not** be attached to every sense. Presentation already separates `delectable` food/attraction senses and `flake` snow/odd-person/fragment senses, so preserve their curated targeting.
- Confirmed editorial defect: `itself`, exact reflexive sense `a09f14e9-8dde-5753-974e-67540f06f258`, currently lacks CEFR and has presentation "synonyms" `myself/ourselves/themselves/yourself`. These are other-person/number reflexive pronouns, **not substitutable synonyms**. Cambridge documents reflexive `itself` as **A2**, while its emphatic use is **B1**, which must not be mixed: https://dictionary.cambridge.org/dictionary/english/itself.
- The immutable-release candidate correction is staged in `content/dictionary/audit-20261112-phase09-reviewed-corrections.json`: propose reflexive `itself` CEFR A2 and remove the four false synonym edges from its presentation sense only. Existing canonical translation remains unchanged. **This proposal is not applied to the stable release**.
- `startup` includes a sentence about "inauguration of fluoridation" which does not contain the headword. Queued for review without altering the original source.
- `services/backend/tests/test_dictionary_audit_phase09.py` introduces four receipt/proposal assertions, added to the branch's focused CI workflow. **Tests must pass on GitHub Actions before describing this as a verified code change.**
- Remaining: independent translation and CEFR review for **every** sense, confirmed target senses for synonym/antonym edges, attested sense-specific collocations, rebuilt immutable R2+presentation+reader candidate, cross-release integrity tests, and controlled publication. No deploy, no production mutation, no `main` merge.

**Phase 09 status:** structural + presentation/meaning-hash integrity COMPLETE; independently certified linguistic correctness NOT COMPLETE.


## Direct example correction workflow — 12 November 2026

Editorial rule updated: **do not defer verified errors to a generic review queue**. Correct the individual frozen `lexeme_id/sense_id/example_id` record immediately in the versioned candidate correction layer, checking the original English and Uzbek text, grammar, target meaning and UI presentation. Preserve the stable R2 release unchanged until the completed 20-stage release gate. The existence of a CEFR-null value is **not** a defect: not every sense has evidence for a CEFR classification. Only assign a CEFR label when the referenced sense-specific level is substantiated; never downgrade all C2 entries automatically.

The screenshot's `happy` example was located in R2 shard `9e`, lexeme `9eae6a37-2750-5469-9403-8073c95d0a24`, sense `9a8f14f5-ea1c-4af7-afa2-ebeb957a8903`:
- Incorrect fragment: `spent many happy days on the beach` / `Sohilda ko'p baxtli kunlarni o'tkazdi.`
- Corrected full example: `We spent many happy days on the beach.` / `Biz sohilda ko‘p baxtli kunlarni o‘tkazdik.`

All **eight authored examples** spanning `happy`'s four source senses were repaired as complete, natural English sentences with aligned Uzbek translations. The `startup` sense `d7525883-85d3-4bd1-90f0-409545b4c051` received two corrected sentences; in particular, a semantically unrelated fluoridation/inauguration example was replaced with a genuinely relevant startup example.

Implementation:
- `services/backend/assets/dictionary/example_corrections.json` — exactly keyed bilingual replacements, expected original English and meaning SHA.
- `services/backend/app/dictionary_presentation.py` — `corrected_examples()` applies only when release, lexeme, sense, canonical meaning SHA, and original example ID/text match. The original frozen R2 data remains untouched. Legitimate examples from unaffected senses continue unchanged.
- `services/backend/tests/test_dictionary_reader_metadata.py` — correction count, exact content, release/sense/hash/source isolation and the formerly unrelated `startup` sentence.

**Scope:** Ten concrete examples repaired in the versioned presentation path, not all 110,409 dictionary senses. These are code changes on the audit branch; they do not yet constitute a new published immutable R2 release. The expanded CI has not yet been reported successful. Continue correcting individual examples in place rather than only accumulating issue lists.


### 9-bosqich — individual tuzatishlar, source audit va testlar

- R2 release `rel-v1-1fa06d8d41d8ff701632573e`, tartib 44,165–49,685: **5,521 senses**, **4,095 source examples**. All 14 shard members read and checked. The example scan detected **3,938 missing terminal punctuation**, **2,913 lowercase starts**, **3,634 heuristic fragment candidates**, and **2,288 examples where a simple exact-lemma/form match was absent**. These heuristic classes overlap and **are not verified defect totals** (inflection, idioms and genuinely complete sentences require interpretation).
- Added **33 more exact-example bilingual corrections** to `services/backend/assets/dictionary/example_corrections.json`, bringing the total to **43**, spanning `happy` and `startup` plus diverse Phase 09 senses: `hold fast`, `under the circumstances`, `countermand`, `overwrite`, `intrust`, `flake`, `hysterical`, `making`, `groove`, `leash`, `decry`, `nowadays`, `cake`, and `precede`. Corrections require exact matching `release_id`, `lexeme_id`, `sense_id`, `meaning_sha`, `example_id`, and original English text. The revised examples are complete English sentences paired with corresponding Uzbek sentences. Unchanged examples are preserved.
- Three precisely referenced CEFR changes recorded in `content/dictionary/audit-20261112-phase09-reviewed-corrections.json`: `itself` reflexive `null → A2` (Cambridge); `nowadays` meaning "at the present time" `A2 → B1` (Cambridge); `cake` meaning sweet baked food `B1 → A1` (Cambridge). The separate `cake` meaning "block of a substance" is **not** changed. CEFR can remain `null` where no appropriate sense-level source grade exists. No blanket null fill or C2 downgrade.
- `services/backend/assets/dictionary/sense_corrections.json` contains exact-sense suppression of **four non-interchangeable `itself` pronoun variants** from synonyms, and **five attested collocation phrases** applied to correct meanings: `delectable cheesecake`, `birthday cake`, `chocolate cake`, `countermand an order`, and `overwrite a file`. `dictionary_presentation.py` enforces frozen-release and `meaning_sha` matching. No changes to unrelated senses.
- Added regression coverage for bilingual examples, source/meaning/release isolation and sense-specific semantic overrides. The workflow already includes this test file. **CI execution is still to be confirmed**.
- **Production publication is blocked** until all 20 phases have completed source-backed linguistic validation and an immutable replacement release is built, indexed, checksum-checked and tested. The above is a real set of precise branch changes; it is **not evidence that all 5,521 meanings and all 4,095 example sentences are now linguistically correct**.

**Status:** Phase 09 structural/presentation inventory complete. Full sense-by-sense linguistic correction **not yet complete**. Continue in-scope verified fixes without inventing missing synonyms, antonyms, collocations or CEFR values.


### Phase 09 — final current-turn checkpoint, 12 November 2026

The first source-backed set of 43 example repairs was extended with **190 conservative mechanical sentence repairs** (pronoun-led sentences with identifiable finite verbs and exact headword/form match). Final candidate correction total: **233**, comprising **225 in Phase 09** and **8 out-of-band `happy` examples**. Corrections that only change punctuation/casing preserve the complete original sentence and Uzbek meaning. They do not convert isolated phrases into artificial sentences.

**Independent readback:** Re-fetched all 14 Phase 09 R2 shard objects and the out-of-band `9e` source shard; checked every editorial record against `lexeme_id`, `sense_id`, `example_id`, exact original English text and recomputed canonical meaning SHA-256. A typo in one original example UUID was caught and fixed before re-running. **233/233 exact matches; 0 failures**. Immutable original R2 objects were not overwritten.

Exact-sense, source-backed CEFR candidate edits now number **4**: `itself` reflexive `null→A2`, `nowadays` `A2→B1`, `cake` food `B1→A1`, and `hysterical` uncontrolled emotion `C2→C1`. The historic psychiatric `hysterical` sense is left untouched. Each has a Cambridge citation in the JSON correction source; no blanket level assignment. These remain edits for a future verified immutable release, **not active R2 metadata changes**.

The branch's `sense_corrections.json` and `dictionary_presentation.py` additionally suppress **four false reflexive-pronoun synonym edges** for `itself` and attach **five attested collocations** strictly to their correct source-sense hashes. All other relations and collocations remain unchanged.

**Verification boundary:** Existing automated structural inventory covers 5,521 meanings, presentation `meaningSha` checks have 0 stale rows, and 233 exact edited examples passed independent R2 readback. This **does not** certify that all 4,095 source examples, 5,521 meaning translations, remaining CEFR labels and semantic relations are correct. The unverified language content must not be labeled "finished" merely because it parsed. Focused regression tests were committed but their GitHub Actions pass status was not confirmed. `main`, live release, and production channel remain untouched.

Current-turn receipt: `content/dictionary/audit-20261112-phase09-correction-receipt.json`. No invented synonyms or antonyms and no mass downgrade.


### Phase 09 — lexical-first pass (no example work)

The owner requested **definitions and Uzbek translations, sense-specific CEFR, synonyms, antonyms and collocations before example sentences**. No example content was modified in this pass.

Verified semantic delta for this pass, consolidating previously committed work and new corrections:
- `services/backend/assets/dictionary/sense_corrections.json`: **12 lexemes / 18 senses** carrying exact-sense edits: **4 CEFR corrections**, **2 English definition corrections**, **2 Uzbek translation corrections**, **19 incorrect synonym links suppressed**, **1 exact-sense synonym added**, **9 exact-sense antonyms added**, **7 collocations added**.
- `terzetto` was incorrectly defined and translated as the cardinal number three. Collins describes the word as a musical/vocal trio. The obsolete numeric synonym group is excluded; the `trio` composition sense `24087232-6200-4e00-98d9-3212c842bf3b` is linked. Source: https://www.collinsdictionary.com/dictionary/english/terzetto.
- `actus reus` incorrectly carried a generic crime/misconduct definition. Cornell identifies it as the physical element of a criminal offence (an act or omission). The Uzbek rendering now specifies the criminal-law element. Generic `misconduct`, `wrongdoing` and `wrongful conduct` synonyms are excluded from this exact sense. Source: https://www.law.cornell.edu/wex/actus_reus.
- Sense-specific opposites now include `decry/praise`, distinct `unilateral/bilateral` senses, and distinct `deflate/inflate` air/economics/importance senses. All nine distinct target `lexeme_id/sense_id` pairs were verified against frozen Supabase `dictionary_entries.sense_ids`.
- `traineeship` with its financial-aid sense is **not** rewritten merely because it differs from the everyday training-period meaning; Collins attests the financial-grant sense. Source: https://www.collinsdictionary.com/dictionary/english/traineeship.
- Added `services/backend/app/dictionary_sense_curation.py` to transform exact, hash-verified entry copies in memory for a future **immutable replacement candidate**. This helper never writes to Supabase, live R2, active release, or examples. `dictionary_presentation.py` now recognizes exact-sense curated synonym and antonym additions/removals; it preserves unrelated meanings.
- The focused CI workflow was expanded to include `tests/test_dictionary_sense_curation_phase09.py` and new relation/meaning tests in `tests/test_dictionary_reader_metadata.py`.

Receipt: `content/dictionary/audit-20261112-phase09-semantic-delta.json`.

**Signoff:** Concrete corrections above are committed; examples intentionally deferred. Full linguistic correctness of all **5,521** Phase 09 senses and full CI green status remain unverified. Do not report Phase 09 as fully complete or publish any replacement release until these gates are satisfied.


**Phase 09 lexical candidate dry-run:** Independently re-read all 12 amended source lexemes from R2 shards `65`–`68`, and verified all **18** original `meaningSha` values, all **4** prior CEFR values, **2** prior English definitions and **2** prior Uzbek translations. All matched; **0 source mismatches**. A separate, in-memory candidate simulation removed 15 canonical misleading synonym edges (the other 4 are presentation-only), added 10 exact relations (1 synonym, 9 antonyms), and attached 7 sense-specific collocations. **0 invalid relation or collocation source IDs**. Source sense counts and all examples were preserved. See `audit-20261112-phase09-semantic-delta.json`. No R2 writes.


### Phase 09 — exact-sense translation/CEFR/relations continuation

This pass prioritizes lexical quality over sentence examples. Examples were not edited. New source-backed facts:

- `apprise` (inform someone) was mixed with `appreciate` (increase in value), and `apprize` contains the same misattributed value-increase senses. **Four exact incorrect senses** are excluded from an unpublished candidate copy, while all four valid inform/notify senses and their examples are kept unchanged. Cambridge and Collins confirm the inform meaning for both spellings. Some historical dictionaries attest the spelling `apprize` for *appraise* (estimate value), but that does not justify the distinct gloss *gain/increase in value*.
- Each retained informing sense has source-backed `notify` and `inform` target sense IDs and the respective `apprise/apprize someone of something` collocation. All 4 excluded glosses matched frozen R2 SHA-256 identities.
- Source scan found **8 incoming synonym relations** to the four excluded senses in the 14 Phase-09 R2 shards. Candidate curation now removes inbound references by the exact `target_lexeme_id/target_sense_id` pair, including when the source lexeme itself has no editorial changes. The remaining in-scope examples and senses are not altered.
- `demonstrate` meaning showing/exhibiting something to an audience changed **B1 → C1**, exactly matching Cambridge's SHOW HOW level. Its SHOW/PROVE and PROTEST senses were left as they were.
- The accumulated exact semantic candidate delta is **15 lexemes / 25 senses**, comprising **5 CEFR changes**, 2 corrected English definitions, 2 corrected Uzbek definitions, 2 corrected Uzbek translations, 19 removed incorrect synonym edges, 5 added synonyms, 9 added antonyms, 9 added collocations, and 4 candidate-only excluded misattributed senses.
- Independently re-read source R2 shard objects `65/66/67/68/6b/71`: **25/25 meaning hashes matched**, original CEFR values 5/5, original definitions and translations matched, all 4 exclusions source-matched, and zero missing lexemes or mismatches. Evidence: `content/dictionary/audit-20261112-phase09-semantic-continuation.json`.
- Regression tests cover preserving source entries and all retained example objects, preventing stale-source deletion, and preserving legitimate relation targets when pruning removed sense references. A full green CI for the latest commit is required before promoting the candidate.

**Publication stays blocked:** The all-senses lexical validation of 5,521 definitions/translations and all unscoped relations is still not independently complete. No release overwrite, merge, or production mutation.


### Phase 09 — latest exact-sense lexical expansion

Following the Cambridge-sourced `demonstrate` CEFR C1 correction, the **audible**, **appease** and **blurb** entries were verified at exact sense level. The frozen R2 readback completed across shards `65`, `66`, `67`, `68`, `69`, `6b`, and `71`, despite one transient and retried Cloudflare error.

Current candidate editorial totals: **18 lexemes / 30 sense records; 5 CEFR corrections, 2 English and 2 Uzbek definition corrections, 2 Uzbek translation corrections, 4 source-misattributed senses excluded only in a future candidate, 19 incorrect synonym links suppressed, 8 correct synonyms added, 10 exact antonym links added, 15 attested collocations added**. All **30/30** source meaning hashes matched, all 11 source field values matched, and four excluded original glosses matched. No R2 write or example editing.

In particular `audible` is linked to the matching `inaudible` adjective sense; `appease` senses link separately to `placate`, `pacify` (goodwill meaning, not the violence-suppression meaning), and `propitiate`; `blurb` has attested book-jacket collocations. The CI regression suite covers this separation. Evidence: `content/dictionary/audit-20261112-phase09-semantic-continuation.json`.

**Phase 09 is still not linguistically signed off as complete:** 5,521 source senses have been mechanically audited, but independent source-backed review has not established that every remaining translation, CEFR, synonym, antonym and collocation is correct. The unresolved ambiguity of unscoped polysemous relations must not be fabricated into sense-specific links. Examples remain deferred.


### Phase 09 — further lexical-first correction set

Corrected the `beep` **car-horn** verb sense from C2 to Oxford's **C1** (the separate `beep a person via pager` sense remains **C2**). The exact car-horn sense now links to `honk` and `blare` with verified target `sense_id` values. In `abide`, the *tolerate* meaning links only to `tolerate`, while the archaic *live in a place* meaning links only to `dwell`. Source-backed phrases were attached to `beep`, `archway`, `alms`, `abide`, and `blurb`. Example sentences remain untouched in this pass.

Current cumulative candidate delta: **22 lexemes / 35 individual sense patches, 6 CEFR updates, 2 English and 2 Uzbek definitions, 2 Uzbek translations, 4 misattributed senses excluded in candidate only, 19 excluded erroneous synonym links, 12 added sense-specific synonyms, 10 added antonyms, and 21 collocations**. All **35/35 original R2 meaning hashes**, six CEFR source values and six definition/translation source values matched in a read-only scan of nine source shards. No source mismatches, missing lexemes, or published changes.

The **5,521 Phase 09 senses have not been certified semantically in full**; structural integrity and the exact edited subset are distinct from comprehensive translation, CEFR and relation validation. No example edits in this continuation. Evidence: `content/dictionary/audit-20261112-phase09-semantic-continuation.json`.


### Phase 09 — targeted CEFR and relation repair, November 12, 2026

On the frozen release `rel-v1-1fa06d8d41d8ff701632573e`, Cambridge Dictionary explicitly supports **C1** for `chatty` in its friendly/talkative and conversational senses, and **C1** for `bribe` as a noun meaning corrupt payment. Both `chatty` source sense IDs and the `bribe` source sense ID were C2. Exact-source candidate patches change only these three senses to C1; source `meaningSha` and old CEFR values matched independently in the immutable R2 objects (3/3). The correct `talkative` sense is linked only to the friendly adjective meaning. Attested `chatty letter`, `chatty style`, `accept a bribe` and `take a bribe` phrases are attached by `sense_id`. No example sentences were edited in this pass.

Cumulative candidate changes: **24 lexemes / 38 sense-level patches, 9 source-backed CEFR updates, 2 EN definitions, 2 UZ definitions, 2 UZ translations, 4 misattributed candidate-only exclusions, 19 incorrect synonym links suppressed, 13 correct synonyms, 10 antonyms, 25 collocations**. R2 readback verified all **38/38** original meaning hashes, 9/9 CEFR originals, 2/2 each EN definition/UZ definition/UZ translation originals and 4/4 excluded source glosses; no missing lexemes or mismatches.

**Unresolved:** this does **not** constitute a full independent source-level check of all 5,521 meanings, so Phase 09 semantic completion cannot be claimed. Leave the immutable release unchanged, keep PR #149 Draft, and do not touch examples until the lexical verification finishes.


### Phase 09 — four further sense-exact Cambridge/Oxford corrections

Prioritize verified lexical meaning over example edits. Four further CEFR source mismatches were independently confirmed in frozen release `rel-v1-1fa06d8d41d8ff701632573e`:
- `baguette` (long, thin French stick loaf) **C2→B2**, Oxford Food classification, with exact-sense `fresh baguette`.
- `caregiver` (responsible for a child or dependent adult) **C2→C1**, Oxford. Its separate medically focused sense stays C2; its separate ungraded sense remains **without a CEFR label**. `primary caregiver` and `family caregiver` attached to the care-responsibility sense.
- `annoyance` (countable trouble-causing thing/person) **C2→C1** and clarified Uzbek as `bezovta qiladigan odam yoki narsa; boshog‘riq`, with the exact `nuisance` sense linked.
- `annoyance` (uncountable irritation/annoyed emotion) **C2→C1** with exact `irritation` emotional sense linked. Three other `annoyance` senses were preserved unchanged.

The four source `meaningSha` checks passed 4/4 and all four previous C2 labels matched R2. Added relations target Supabase-present `nuisance` and `irritation` sense UUIDs. The accumulated correction overlay now covers **27 lexemes / 42 exact senses**, **13 evidence-backed CEFR edits**, 3 translations, 15 sense-specific synonym additions, 10 antonym additions and 32 collocations. The previously verified 38 hashes plus four new hashes give **42 verified source hashes**, not 5,521 linguistically reviewed senses. No example text was modified in this continuation; production R2 remains untouched.

Evidence: `content/dictionary/audit-20261112-phase09-semantic-continuation.json`. Publication remains blocked pending complete sense-by-sense linguistic audit and all 20 phases.


### Phase 09 lexical continuation — four further exact-lexeme corrections

The owner prioritizes sense-accurate Uzbek translations, CEFR, synonym/antonym links and collocations before any further example edits.

**Oxford source-backed changes:** `brilliance` mental ability and magnificent/impressive quality both **C2→C1** (Oxford 5000 C1); the separate bright-light sense retains its existing C1. The edible-fruit sense of `blackberry` **C2→C1** using Oxford's explicit `Food c1` topical sense label. The page also displays the broader Oxford 3000 B1 word-list level; these levels differ, and the editorial correction deliberately prioritizes the **sense-specific** marker. The botanical blackberry-bush sense is unchanged.

**Meaning-specific relations:** `brilliance` now links *genius* to the unusual-mental-ability sense and *glare/blaze* solely to the dazzling-light sense, each with frozen `target_lexeme_id/target_sense_id` validated against R2 and Supabase. `brim` links *rim/lip* only to the container-edge sense. `full to the brim` / `fill something to the brim` apply to containers; `wide brim` / `beneath the brim` apply to hats. `burrow into the soil` and `burrow under the fence` apply to digging, without altering any CEFR grade. All cited collocations occur in the Oxford Learner's Dictionary entries.

The cumulative unpublished candidate overlay now covers **31 lexemes / 49 exact source senses**, with **16 CEFR updates**, two English definitions, two Uzbek definitions, three Uzbek translations, four candidate-only exclusions of demonstrably misattributed senses, 19 bad synonym links suppressed, 20 exact-sense synonyms added, 10 antonyms and 42 collocations. Independent read-only revalidation across all 14 Phase-09 R2 shards found **49/49 meaning hashes**, **16/16 original CEFR values**, all 7 original definition/translation values and all four excluded source glosses matching. Every referenced target sense ID in this continuation exists in the frozen Supabase registry. No source or production R2 objects were mutated, no example text was changed, and no merge was performed.

**Important boundary:** the complete 5,521-sense Phase-09 linguistic audit is *not* finished. These are verified targeted edits, not evidence that the remaining translations, CEFR tags or 7,983 ambiguous unscoped polysemous relations have been reviewed. Continue source-backed, identity-guarded corrections, never mass-populate missing CEFR or guess semantic targets. Receipt: `content/dictionary/audit-20261112-phase09-semantic-continuation.json`.


### Phase 09 — source attribution removed from dictionary content

At the owner's request, **publisher names, brand names used for source attribution, citations and source URLs must never appear in user-visible dictionary meanings, synonyms, antonyms, collocations or CEFR labels**.

- Removed **100 source URLs** and **12 internal sense-alignment annotations** from `services/backend/assets/dictionary/sense_corrections.json`. The original source records are preserved under `content/dictionary/audit-20261112-phase09-source-evidence.json` for internal validation only and are not sent to the public dictionary API.
- `dictionary_sense_curation.py` no longer depends on source URLs being present inside dictionary patches: exclusions remain guarded by frozen source `meaning_sha`, source definition text, and a concrete non-public reason.
- `dictionary_presentation.corrected_sense_presentation()` now uses a strict display-field allowlist. Synonyms and antonyms return only word text and exact lexeme/sense IDs; collocations return only phrase text. Source metadata is dropped even if someone accidentally inserts it into a future patch.
- Regression tests verify that the dictionary correction JSON, in-memory candidate and public presentation contain no source URLs or publisher attribution. A malicious/future source-metadata injection is also explicitly tested. These tests do not remove genuine proper nouns that happen to be legitimate dictionary headwords.
- **No example sentence revisions, no production R2 changes, no main merge.** Previous targeted linguistic QA remains in place. Structural Phase 09 signoff does not establish independent linguistic correctness for all 5,521 senses.
