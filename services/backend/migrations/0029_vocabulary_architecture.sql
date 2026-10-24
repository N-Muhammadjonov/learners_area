-- 0029 Vocabulary architecture (docs/VOCABULARY-ARCHITECTURE.md, B12 M1-M6).
-- Additive only. Existing lexemes.id values are the SENSE identity and are never
-- changed; every existing reference (user_vocabulary, lexical_occurrences,
-- vocabulary_usages) stays valid. No row is deleted. No sense is guessed.

-- M1 lexical units (the LEXEME layer above today's sense rows) + forms
-- Guard: the backfill uses normalize(NFKC) and multi-byte apostrophe folding, which
-- are only correct on a UTF8 database (hosted PostgreSQL defaults to UTF8; the
-- Preview/Production encoding was not inspected from this sandbox). Fail closed -
-- the whole migration rolls back - instead of writing byte-mangled identities.
DO $$ BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION '0029 requires a UTF8 database (found %)', current_setting('server_encoding');
  END IF;
END $$
--> statement-breakpoint
CREATE TABLE lexical_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 language varchar(8) NOT NULL DEFAULT 'en',
 lemma varchar(120) NOT NULL,
 lemma_norm varchar(120) NOT NULL,
 part_of_speech varchar(30) NOT NULL DEFAULT '',
 lexical_type varchar(24) NOT NULL DEFAULT 'word' CHECK (lexical_type IN ('word','noun_phrase','verb_phrase','collocation','phrasal_verb','idiom','fixed_expression','compound','technical_term','phrase')),
 is_function_word boolean NOT NULL DEFAULT false,
 provenance varchar(24),
 created_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX lexical_units_identity_idx ON lexical_units (language, lemma_norm, part_of_speech, lexical_type)
--> statement-breakpoint
CREATE TABLE lexical_unit_forms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lexical_unit_id uuid NOT NULL REFERENCES lexical_units(id) ON DELETE CASCADE,
 form varchar(160) NOT NULL,
 form_norm varchar(160) NOT NULL,
 form_type varchar(16) NOT NULL CHECK (form_type IN ('lemma','regular','irregular','authored'))
)
--> statement-breakpoint
CREATE UNIQUE INDEX lexical_unit_forms_unit_form_idx ON lexical_unit_forms (lexical_unit_id, form_norm)
--> statement-breakpoint
CREATE INDEX lexical_unit_forms_form_idx ON lexical_unit_forms (form_norm)
--> statement-breakpoint
ALTER TABLE lexemes ADD COLUMN lexical_unit_id uuid REFERENCES lexical_units(id) ON DELETE RESTRICT
--> statement-breakpoint
CREATE INDEX lexemes_lexical_unit_idx ON lexemes (lexical_unit_id)
--> statement-breakpoint
-- Deterministic backfill (the key subquery is repeated verbatim in the INSERT
-- and the UPDATE so no helper object has to be created and dropped):
-- Deterministic backfill: one unit per (normalized lemma, normalized POS, type).
-- Mirrors lemmaNorm / partOfSpeechNorm / lexicalTypeFor / isFunctionWord in
-- src/lib/text/lexical-normalize.ts (parity proven by a database test).
INSERT INTO lexical_units (language, lemma, lemma_norm, part_of_speech, lexical_type, is_function_word, provenance)
SELECT DISTINCT ON (lemma_norm, pos_norm, lexical_type) 'en', left(term, 120), left(lemma_norm, 120), left(pos_norm, 30), lexical_type,
 (position(' ' in lemma_norm) = 0 AND lemma_norm = ANY(ARRAY['a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must']::text[])), 'backfill_0029'
FROM (
SELECT k.id, k.term, k.lemma_norm, k.pos_norm,
 CASE k.pos_norm WHEN 'noun phrase' THEN 'noun_phrase' WHEN 'verb phrase' THEN 'verb_phrase' WHEN 'phrasal verb' THEN 'phrasal_verb'
  WHEN 'idiom' THEN 'idiom' WHEN 'collocation' THEN 'collocation' WHEN 'fixed expression' THEN 'fixed_expression' WHEN 'compound' THEN 'compound'
  ELSE CASE WHEN position(' ' in k.lemma_norm) > 0 THEN 'phrase' ELSE 'word' END END AS lexical_type
FROM (
 SELECT l.id, l.term, btrim(regexp_replace(translate(lower(normalize(l.term, NFKC)), '‘’ʻʼ`´′', ''''''''''''''''), '\s+', ' ', 'g')) AS lemma_norm,
  CASE r.raw WHEN 'n' THEN 'noun' WHEN 'v' THEN 'verb' WHEN 'adj' THEN 'adjective' WHEN 'adv' THEN 'adverb' WHEN 'phr' THEN 'phrase'
   WHEN 'prep' THEN 'preposition' WHEN 'n.phrase' THEN 'noun phrase' WHEN 'v.phrase' THEN 'verb phrase'
   ELSE regexp_replace(r.raw, '\s+', ' ', 'g') END AS pos_norm
 FROM lexemes l CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(btrim(lower(normalize(coalesce(l.part_of_speech, ''), NFKC))), '^\((.*)\)$', '\1'), '\.$', '') AS raw) r
) k
) keys ORDER BY lemma_norm, pos_norm, lexical_type, term, id
ON CONFLICT DO NOTHING
--> statement-breakpoint
UPDATE lexemes SET lexical_unit_id = u.id
FROM (
SELECT k.id, k.term, k.lemma_norm, k.pos_norm,
 CASE k.pos_norm WHEN 'noun phrase' THEN 'noun_phrase' WHEN 'verb phrase' THEN 'verb_phrase' WHEN 'phrasal verb' THEN 'phrasal_verb'
  WHEN 'idiom' THEN 'idiom' WHEN 'collocation' THEN 'collocation' WHEN 'fixed expression' THEN 'fixed_expression' WHEN 'compound' THEN 'compound'
  ELSE CASE WHEN position(' ' in k.lemma_norm) > 0 THEN 'phrase' ELSE 'word' END END AS lexical_type
FROM (
 SELECT l.id, l.term, btrim(regexp_replace(translate(lower(normalize(l.term, NFKC)), '‘’ʻʼ`´′', ''''''''''''''''), '\s+', ' ', 'g')) AS lemma_norm,
  CASE r.raw WHEN 'n' THEN 'noun' WHEN 'v' THEN 'verb' WHEN 'adj' THEN 'adjective' WHEN 'adv' THEN 'adverb' WHEN 'phr' THEN 'phrase'
   WHEN 'prep' THEN 'preposition' WHEN 'n.phrase' THEN 'noun phrase' WHEN 'v.phrase' THEN 'verb phrase'
   ELSE regexp_replace(r.raw, '\s+', ' ', 'g') END AS pos_norm
 FROM lexemes l CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(btrim(lower(normalize(coalesce(l.part_of_speech, ''), NFKC))), '^\((.*)\)$', '\1'), '\.$', '') AS raw) r
) k
) k JOIN lexical_units u
 ON u.language = 'en' AND u.lemma_norm = left(k.lemma_norm, 120) AND u.part_of_speech = left(k.pos_norm, 30) AND u.lexical_type = k.lexical_type
WHERE lexemes.id = k.id AND lexemes.lexical_unit_id IS NULL
--> statement-breakpoint
INSERT INTO lexical_unit_forms (lexical_unit_id, form, form_norm, form_type)
SELECT id, lemma, lemma_norm, 'lemma' FROM lexical_units ON CONFLICT DO NOTHING
--> statement-breakpoint
-- M2 occurrences beyond Reading. Existing rows: source_type='reading', resolved.
ALTER TABLE lexical_occurrences ADD COLUMN source_type varchar(16) NOT NULL DEFAULT 'reading'
--> statement-breakpoint
ALTER TABLE lexical_occurrences ALTER COLUMN passage_id DROP NOT NULL
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN listening_test_id uuid REFERENCES listening_tests(id) ON DELETE CASCADE
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN video_lesson_id uuid REFERENCES video_lessons(id) ON DELETE CASCADE
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN section_number smallint
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN start_ms integer
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN end_ms integer
--> statement-breakpoint
ALTER TABLE lexical_occurrences ALTER COLUMN lexeme_id DROP NOT NULL
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN lexical_unit_id uuid REFERENCES lexical_units(id) ON DELETE SET NULL
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN resolution_status varchar(16) NOT NULL DEFAULT 'resolved'
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD COLUMN resolution_source varchar(24)
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD CONSTRAINT lexical_occurrences_source_check CHECK (
 (source_type = 'reading' AND passage_id IS NOT NULL AND listening_test_id IS NULL AND video_lesson_id IS NULL)
 OR (source_type = 'listening' AND listening_test_id IS NOT NULL AND passage_id IS NULL AND video_lesson_id IS NULL)
 OR (source_type = 'video' AND video_lesson_id IS NOT NULL AND passage_id IS NULL AND listening_test_id IS NULL))
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD CONSTRAINT lexical_occurrences_resolution_check CHECK (
 resolution_status IN ('resolved','unresolved','review') AND ((resolution_status = 'resolved') = (lexeme_id IS NOT NULL)))
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD CONSTRAINT lexical_occurrences_time_check CHECK (start_ms IS NULL OR (start_ms >= 0 AND (end_ms IS NULL OR end_ms > start_ms)))
--> statement-breakpoint
CREATE UNIQUE INDEX lexical_occurrences_listening_offset_idx ON lexical_occurrences (listening_test_id, section_number, start_char, end_char) WHERE listening_test_id IS NOT NULL
--> statement-breakpoint
CREATE INDEX lexical_occurrences_unit_idx ON lexical_occurrences (lexical_unit_id)
--> statement-breakpoint
-- M3 many source contexts per saved sense, backfilled 1:1 from source_snapshot.
CREATE TABLE user_vocabulary_contexts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_vocabulary_id uuid NOT NULL REFERENCES user_vocabulary(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 occurrence_id uuid REFERENCES lexical_occurrences(id) ON DELETE SET NULL,
 source_type varchar(16) NOT NULL CHECK (source_type IN ('reading','listening','video','podcast')),
 source_id uuid,
 snapshot jsonb NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX user_vocabulary_contexts_item_occurrence_idx ON user_vocabulary_contexts (user_vocabulary_id, occurrence_id)
--> statement-breakpoint
CREATE INDEX user_vocabulary_contexts_user_idx ON user_vocabulary_contexts (user_id, user_vocabulary_id)
--> statement-breakpoint
CREATE INDEX user_vocabulary_contexts_occurrence_idx ON user_vocabulary_contexts (occurrence_id)
--> statement-breakpoint
INSERT INTO user_vocabulary_contexts (user_vocabulary_id, user_id, occurrence_id, source_type, source_id, snapshot, seen_at)
SELECT v.id, v.user_id,
 (SELECT o.id FROM lexical_occurrences o WHERE (v.source_snapshot->>'occurrenceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND o.id = (v.source_snapshot->>'occurrenceId')::uuid),
 CASE WHEN v.source_type IN ('reading','listening','video','podcast') THEN v.source_type ELSE 'reading' END,
 v.source_id, v.source_snapshot, v.created_at
FROM user_vocabulary v WHERE v.source_snapshot IS NOT NULL
--> statement-breakpoint
-- M4 exposure tracking on the student item.
ALTER TABLE user_vocabulary ADD COLUMN first_seen_at timestamptz
--> statement-breakpoint
ALTER TABLE user_vocabulary ADD COLUMN last_seen_at timestamptz
--> statement-breakpoint
ALTER TABLE user_vocabulary ADD COLUMN seen_count integer NOT NULL DEFAULT 1 CHECK (seen_count >= 1)
--> statement-breakpoint
UPDATE user_vocabulary SET first_seen_at = created_at, last_seen_at = created_at
--> statement-breakpoint
ALTER TABLE user_vocabulary ALTER COLUMN first_seen_at SET DEFAULT now(), ALTER COLUMN first_seen_at SET NOT NULL, ALTER COLUMN last_seen_at SET DEFAULT now(), ALTER COLUMN last_seen_at SET NOT NULL
--> statement-breakpoint
-- M5 one student item per (user, sense) — only when existing data already obeys it.
-- Duplicates are NEVER merged automatically; scripts/vocabulary-duplicate-report.mjs lists them.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM user_vocabulary GROUP BY user_id, lexeme_id HAVING count(*) > 1) THEN
  RAISE WARNING '0029: duplicate (user_id, lexeme_id) rows exist; user_vocabulary_user_sense_idx NOT created. Run scripts/vocabulary-duplicate-report.mjs';
 ELSE
  CREATE UNIQUE INDEX user_vocabulary_user_sense_idx ON user_vocabulary (user_id, lexeme_id);
 END IF;
END $$
--> statement-breakpoint
-- M6 pronunciation (nullable by absence: no row = not known; never fabricated).
CREATE TABLE lexical_unit_pronunciations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lexical_unit_id uuid NOT NULL REFERENCES lexical_units(id) ON DELETE CASCADE,
 ipa varchar(120) NOT NULL CHECK (length(btrim(ipa)) > 0),
 variant varchar(8) NOT NULL DEFAULT '' CHECK (variant IN ('','uk','us')),
 audio_object_key text,
 provenance varchar(24) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX lexical_unit_pronunciations_unit_variant_idx ON lexical_unit_pronunciations (lexical_unit_id, variant)
