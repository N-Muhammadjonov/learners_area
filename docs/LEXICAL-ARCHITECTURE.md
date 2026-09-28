# Lexical architecture audit — Work QA 2

Status: IN PROGRESS. This is evidence from the existing implementation, not an
assertion that the intended Lexeme → Sense → Occurrence architecture is complete.
No Dictionary implementation or new lexical architecture has been introduced.

## Current data path

- `scripts/import-reading-105.mjs` maps each source sense to `senseKeyOf`, inserts
  one `lexemes` row per sense, then inserts `lexical_occurrences` with passage,
  surface, offsets and sentence. Canonical sense uniqueness is enforced on
  `lexemes.sense_key`; passage/start/end enforces occurrence uniqueness. The
  source's separate lexical identity is flattened into each sense row. There is
  no separate persistent headword entity or inflection mapping today.
- `lexical_occurrences.lexeme_id` references that sense row; `passage_id` is
  mandatory. Other source modules therefore cannot yet use this occurrence table
  without a schema extension. This is not a proven cross-source occurrence store.
- `ReadingExam` passes paragraph text and the *attempt* ID to `ClickableText`.
  `ClickableText` calls the personal `/api/vocabulary/search` endpoint and then
  POSTs text definitions to `/api/vocabulary`. It never reads lexical occurrences,
  offsets or their relevant sense. Imported contextual definitions are not wired
  to the reader. The popup now anchors to the clicked word and offers owned-folder selection.
  Retained occurrence context is still missing.
- `enrichment.ts` reads the shared catalogue, then optional adapters. It does not
  itself insert rows. No adapter is registered. Its same-spelling lookup selects
  one row ordered only by the spelling, which cannot disambiguate contextual
  senses or deterministically break equal-spelling ties. Unknowns return null.
- POST enrichment fills missing definitions, then `addVocabularyBatch` is the
  shared writer. It calculates the sense key again. Personal entries store
  `source_type/source_id` but have no occurrence FK or sentence snapshot.
- User library ownership is enforced by user-scoped reads and folder checks.
  SRS and review state live in `user_vocabulary`, not in shared `lexemes`. Existing
  real DB tests verify games leave SRS unchanged. A custom word's definition is
  currently inserted into the shared catalogue without provenance; such rows
  must not be represented as verified editorial data. Trust filtering is open.

## Reproduced and fixed at this checkpoint

Three overlapping saves for one learner produced three personal entries for one
canonical sense. A failed second item also left the first word/award committed.
The shared writer now locks the learner row before reading deduplication state
and writes canonical rows, personal entries, awards and activity in one DB
transaction. Existing IDs/keys and SRS behavior are preserved. Duplicate replies
now count existing words as duplicates, not zero. No new migration.

`tests/vocabulary-integrity-db.test.ts` uses real isolated PostgreSQL. It observes
three concurrent requests at DB locks, verifies a single entry/award, and tests
rollback after a real invalid second insert. No permissions or validation were
weakened to pass the tests. Direct legacy/import writes outside this writer are
not protected by its learner lock. Existing duplicate rows were not silently
merged: their independent review history needs reconciliation before a new DB
uniqueness constraint could be safely applied.

## Source deletion evidence

A real DB test creates two senses shared by two learners and occurrences in two
passages. Deleting one passage removes only its occurrence. Both canonical senses,
all four saved entries and the other passage's occurrence survive. FK cascading
is from the deleted source to its children; it does not delete their parent sense.
However, a personal `source_id` can then dangle and there is no saved context
snapshot. Directly deleting a canonical sense would cascade into saved entries;
this destructive administrative path still requires review.

## Remaining integrity investigation

- Full contextual occurrence-to-reader-to-save wiring and source authorization.
- Ambiguous spelling lookup must not silently choose an unrelated sense.
- `normalizeMeaning` currently splits at punctuation and its nullish-coalescing
  precedence leaves later whitespace/length normalization unapplied for normal
  strings. Sense-key truncation and coarse POS normalization need reproduced
  collision tests and a compatibility-safe repair, not a blind identity rewrite.
- Canonical provenance/verification versus learner-provided custom definitions.
- Explicit lexical identity shared by multiple senses, inflected forms, and
  occurrence ownership for already implemented non-Reading sources.
- Query/index and payload behavior at 60k+ entries has not been load-tested.

The earlier 103-check Vocabulary HTTP script verifies ordinary saving, ownership,
SRS, games, search and catalogue enrichment. It contains no occurrence-context
assertion. Therefore its PASS must not be used as proof of Reading contextual
sense selection or future Dictionary readiness.

## Interrupted popup checkpoint recovered (2026-09-28)

Word changes remount transient state; cancelled and late old lookups cannot
overwrite a new selection. Shared bounded requests end loading on network, body,
JSON and server failures, with explicit retry. Save retains input on failure and
uses the existing atomic writer with an owned folder or null. A body portal
anchors to the word, clamps to viewport/text column, tracks scroll/resize, and
focuses only after becoming visible. Escape restores focus; outside click closes.

Evidence saved before the interruption: 294/294 full regression, 10/10 real React
DOM cases, typecheck/lint/build PASS; 4/4 real DB integrity cases including folder
ownership, nonexistent folder no-write/no-award, owned and unfiled idempotency.
Real browser verified desktop positioning and 320px fit, state reset, Escape,
outside close, and save/reload of decades and growing. The decades DB row matched
the selected QA Reading-context folder. Vocabulary-list/growing-row confirmation
was interrupted, so remains pending. Resume lint passed without changing code.

This checkpoint still uses word buttons; the newly requested selectable text
contract and global surface inventory are the next phase, not claimed complete.
