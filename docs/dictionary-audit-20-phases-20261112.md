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
| 02 | 5,522–11,041 | 5,520 | Not started |
| 03 | 11,042–16,562 | 5,521 | Not started |
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
