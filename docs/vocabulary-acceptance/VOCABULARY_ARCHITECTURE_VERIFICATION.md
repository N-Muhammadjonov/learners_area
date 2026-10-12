# Vocabulary — architecture verification

Four layers, verified from schema + tests (details: VOCABULARY_REQUIREMENT_TRACEABILITY_MATRIX.json).

| Layer | Question | Table | Key evidence |
|---|---|---|---|
| Lexical unit | What word/expression is this? | `lexical_units`, `lexical_unit_forms` | unique (language, lemma_norm, part_of_speech, lexical_type) |
| Sense | What does it mean here? | `lexemes` (one row = one sense, `lexical_unit_id`) | unique `sense_key`; financial vs river bank are two rows |
| Occurrence | Where did we see it? | `lexical_occurrences` (`passage_id` or `listening_test_id`, offsets, `lexeme_id` NULL = unresolved) | offsets re-checked against the source text on every resolve |
| Student state | What did this learner do with it? | `user_vocabulary` (user × sense), `user_vocabulary_contexts`, `vocabulary_usages` | unique (user_id, lexeme_id) and (user_vocabulary_id, occurrence_id) |

One canonical dictionary: Academic Reading, General Reading (0030 adds only membership and
progress tables), Listening (packages are presentation; canonical sense wins) and the
Vocabulary pages all point at `lexemes` / `lexical_units`. No source owns a dictionary.

Mode decisions (server, from persisted data only):

| Environment | Vocabulary | Decided by |
|---|---|---|
| Academic Reading, active attempt | OFF (403 on lookup, save with or without occurrence, passage-id bypass, forged mode) | `reading_attempts` status |
| Academic Review | ON after submission; re-locked by any open retake | `reading_attempts` |
| General Reading | ON during reading (P1/P2/P3/Full) | row in `general_reading_passages` (`reading_mode = general_practice`) |
| Listening Full Exam | OFF (lookup, meaning, save, Activity 5 save → 403) | `listening_attempts` |
| Listening Review / Control | ON after submission; re-locked by an open attempt | `listening_attempts` |
| Listening Vocabulary Session | canonical sense; forged sessionSenseId → 404 | session built from the test's ingested occurrences |

Residual (external) items: EXT-1 Preview/Production migrations not applied; EXT-2 no
browser; EXT-3 `user_vocabulary_user_sense_idx` depends on target data (see 0029).
