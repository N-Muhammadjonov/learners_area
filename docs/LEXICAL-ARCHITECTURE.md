# Lexical architecture — final Work QA 2

Status: **PASS for the implemented closure scope**, with explicitly bounded future architecture work. The application keeps the existing model; no new Dictionary implementation or wholesale schema replacement.

## Source of truth and lineage

The current `lexemes` table represents **one canonical sense per row**, not a separate headword entity. `lexical_occurrences.lexeme_id` points to that exact row; `passage_id` currently restricts persisted occurrences to Reading. `user_vocabulary` separately owns the learner's saved state, folder, SRS, review counters and optional encounter snapshot.

Reading source/import → validated surface offsets → occurrence + canonical sense → authorized attempt/published passage → minimal ID/offset metadata in page → contextual lookup → server revalidation → transactional personal save → private library/SRS. Definitions are fetched on intentional activation rather than duplicated in every word's client payload. Lookup is private/no-store. Personal save, points and activity commit together under a learner-row lock.

The lookup route accepts source/occurrence UUIDs, never a client-selected canonical ID. It resolves an owned Reading attempt or currently published passage, then joins the occurrence within that passage. Global offsets must match the actual surface text. Draft or other-learner sources return the same generic 404. POST resolves this authority again and ignores forged client definitions/IDs.

Unknown or ambiguous offsets fail closed. For excerpts/paragraphs, an exact unique substring maps global offsets to the rendered region; repeated ambiguous fragments do not inherit a guessed sense. There is no spelling-based substitute when a known occurrence is submitted.

Without a contextual occurrence, personal search only recognizes one exact saved spelling; multiple senses do not select the first. Automatic catalogue enrichment similarly requires exactly one eligible sense. Unknowns/ambiguities request an explicit definition rather than silently saving an arbitrary meaning. No external dictionary adapter is currently registered.

## Implemented surface inventory

| Surface / implementation | Shared selectable text | Source descriptor | Canonical occurrence / saved context | Access authority |
|---|---|---|---|---|
| ReadingExam full passage and paragraphs | Yes | `reading`, owned attempt ID | Valid global occurrence offsets; exact sense + short snapshot | Active user + owned attempt |
| ReadingAnalysis evidence quote | Yes | `reading`, attempt ID | Only uniquely mapped original quote; exact occurrence if available | Owned attempt |
| ReadingAnalysis explanation | Yes | `reading`, attempt ID | Descriptor only; no fabricated source occurrence | Owned attempt |
| RetentionCheck inside analysis | Yes | `reading`, attempt ID | Full passage occurrence mapping + snapshot | Owned attempt |
| Standalone Reading retention | Yes | `reading`, published passage ID | Full passage occurrence mapping + snapshot | Published passage + active user |
| Completed Listening transcript | Yes | `listening`, attempt ID | Descriptor only; manual/unambiguous own-library path | Owned completed attempt |
| Listening revision explanations | Yes | `listening`, test ID | Descriptor only | Owned revision page |
| Listening SpeedTrainer transcript | Yes | `listening`, attempt ID | Descriptor only | Owned revision page |
| VideoLessonStudio timed transcript | Yes | `video_lesson`, lesson ID | Descriptor only | Existing lesson/publication/learner-access rules |
| ResourceBlocks text | Yes | `material`, resource-block ID | Descriptor only | Existing resource owner/read authorization |

Non-Reading source descriptors are historical labels, not authority to retrieve hidden source text. No context API is added for those descriptors. Personal save does not grant source access. ResourceBlocks is shared by material owners; that does not mean every Grammar/Speaking/Writing screen has occurrence annotations. PDFs, images, audio/video frames, editable fields and future podcast/Dictionary surfaces are not claimed as lexical text surfaces.

## Identity compatibility and proven collision repair

Focused tests reproduced two actual defects: parenthetical sense distinctions were discarded, and long keys collapsed after truncation. Coarse POS prefix matching also conflated noun/verb phrases with plain nouns/verbs. `normalizeMeaning` now normalizes typography/whitespace and a terminal full stop while preserving full parenthetical/semicolon content. POS uses exact aliases and keeps phrase distinctions.

New identities use `v2:` plus a SHA-256 of the complete normalized term/POS/meaning tuple. They fit the existing key column without truncating semantic input. Existing IDs and keys are not rewritten. Before insertion the writer compares full normalized fingerprints of candidate historical rows; it reuses a legacy row only when equivalent, and preserves that row's key. Server-resolved occurrence IDs bypass recalculation.

The old algorithm is explicitly frozen as `legacySenseKeyOf` for seed/import compatibility, not used as sufficient proof of meaning equality. The Reading importer checks collisions both within its plan and against existing DB keys, refusing conflicting identities before import writes commit. Its full source bundle was not reimported in closure; these compatibility guards were code-reviewed. No silent reconciliation of historic duplicate review histories or key rewrites is attempted.

## Provenance

Manual/custom inserts are `user_provided` and `unverified`. Automatic catalogue lookup excludes those rows. Trusted server topic-pack calls can mark authored content; the HTTP schema does not accept an `authored` privilege flag. Existing unknown provenance is not relabelled verified. Context popup explicitly labels whether the source meaning is editorially verified. A future adapter cannot supply a trusted canonical row ID through its response.

## Retention, deletion and recovery

`user_vocabulary.source_snapshot` is nullable JSONB with occurrence ID, canonical ID, short source title, surface form and authentic short sentence/excerpt. It intentionally has no source FK, so source deletion does not erase the saved encounter. Existing saves remain null; there is no fabricated backfill. The snapshot is private learning data and follows the personal record's lifecycle, not the course-content lifecycle.

Deleting a Reading passage removes its occurrences only. Saved entries, canonical senses and SRS remain. Migration **0020** changes `user_vocabulary → lexemes` from `ON DELETE CASCADE` to `ON DELETE RESTRICT`, preventing destructive canonical deletion while saved references exist. Other FK directions remain unchanged. A future archive/deprecation workflow is P2 follow-up; destructive cascade is not used as an admin convenience.

0020 adds nullable metadata without rewriting keys/IDs/SRS. No JSON index is needed because current queries do not filter snapshots. Existing canonical/FK indexes remain. DDL locks/FK validation require an approved production maintenance window; production has not been migrated. Tested: empty 0000–0020 chain, populated 0019→0020 preserving IDs, counters and SRS, and repeated migrate no-op. Snapshot diff contains only the new column/FK rule plus expected migration metadata IDs.

## Evidence

- Final full suite: **300/300**, no failures/skips with real PostgreSQL enabled; ordinary npm test 281 pass/19 intentionally skipped DB cases.
- Six DB vocabulary-integrity cases: concurrent save/one award, whole-batch rollback, source deletion, own/foreign/nonexistent/unfiled folder behavior, exact contextual `bank`, compatibility-safe distinct new senses.
- `bank`: river and financial canonical rows coexist; Reading's river occurrence saves the river ID and original key. Other-user attempt/draft lookup fails. Used canonical deletion fails; source deletion leaves snapshot and personal row intact.
- Context HTTP **16/16**: login, anonymous/foreign denial, EN/UZ/provenance, forged-ID/meaning resistance, folder validation, exact save, no-op replay, known exact sense and post-deletion library context.
- Vocabulary/SRS/games HTTP **103/103**; games never advance the review ladder.
- Shared React DOM **15/15** nested cases: cancellation/stale responses, folder/save state, selection/drag/hold suppression, double-click deferral, keyboard and positioning.
- Real browser widths and physical-pointer limitation are documented in [WORK-FINAL-AUDIT.md](WORK-FINAL-AUDIT.md). Unit/DOM results are not physical selection/copy PASS.

## Non-blocking Dictionary architecture follow-up

Separate headword identity/inflections, cross-source occurrence storage/ownership, legacy duplicate and provenance reconciliation, canonical archival and 60k+ load/index measurements remain future work. Existing `lexemes` are sense rows; claiming a completed separate Lexeme→Sense→Occurrence schema would be inaccurate. Current source-aware Reading identity is protected without introducing module-specific dictionaries. This is compatibility groundwork, not a completed Dictionary product or scale certification.
