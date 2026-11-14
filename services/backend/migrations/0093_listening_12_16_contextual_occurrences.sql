-- Listening Tests 12-16: repair transcript-bound lexical occurrences without
-- touching audio, source HTML, questions, exam results, or user vocabulary.
-- Idempotent: exact-offset and exact-lexeme guards protect re-runs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM lexical_occurrences o
    JOIN listening_packages p ON p.test_id=o.listening_test_id
    JOIN user_vocabulary_contexts c ON c.occurrence_id=o.id
    WHERE p.source_id IN ('listening-test-12','listening-test-13','listening-test-14','listening-test-15','listening-test-16')
      AND o.source_type='listening'
      AND o.section_number BETWEEN 1 AND 4
      AND (o.start_char<0 OR o.end_char<=o.start_char
        OR o.end_char>length(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript')
        OR substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
          from o.start_char+1 for greatest(0,o.end_char-o.start_char))<>o.surface_form)
  ) THEN
    RAISE EXCEPTION 'Refusing to remove a lexical occurrence referenced by user vocabulary';
  END IF;
END $guard$;

-- Previous attempts created misplaced spans at the beginning of some Parts.
-- Remove only exact-offset-invalid spans and never a saved user context.
DELETE FROM lexical_occurrences o
USING listening_packages p
WHERE p.test_id=o.listening_test_id
  AND p.source_id IN ('listening-test-12','listening-test-13','listening-test-14','listening-test-15','listening-test-16')
  AND o.source_type='listening' AND o.section_number BETWEEN 1 AND 4
  AND (o.start_char<0 OR o.end_char<=o.start_char
    OR o.end_char>length(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript')
    OR substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
      from o.start_char+1 for greatest(0,o.end_char-o.start_char))<>o.surface_form)
  AND NOT EXISTS (SELECT 1 FROM user_vocabulary_contexts c WHERE c.occurrence_id=o.id);

-- Link only unambiguous lexemes with matching spelling, supplied definitions
-- and translations. Do not choose a random sense when multiple lexemes match.
WITH eligible AS (
  SELECT o.id, o.surface_form
  FROM lexical_occurrences o
  JOIN listening_packages p ON p.test_id=o.listening_test_id
  WHERE p.source_id IN ('listening-test-12','listening-test-13','listening-test-14','listening-test-15','listening-test-16')
    AND o.source_type='listening'
    AND o.resolution_status='unresolved'
    AND o.section_number BETWEEN 1 AND 4
    AND o.segment_key='s'||o.section_number::text
    AND o.lexeme_id IS NULL
    AND o.start_char>=0 AND o.end_char>o.start_char
    AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
      from o.start_char+1 for o.end_char-o.start_char)=o.surface_form
), candidates AS (
  SELECT e.id AS occurrence_id,l.id AS lexeme_id
  FROM eligible e JOIN lexemes l ON lower(l.term)=lower(e.surface_form)
  WHERE nullif(trim(l.definition_en),'') IS NOT NULL
    AND nullif(trim(l.translation_uz),'') IS NOT NULL
), unique_candidates AS (
  SELECT occurrence_id,min(lexeme_id::text)::uuid AS lexeme_id
  FROM candidates GROUP BY occurrence_id HAVING count(*)=1
)
UPDATE lexical_occurrences o
SET lexeme_id=c.lexeme_id, resolution_status='resolved',
    resolution_source='verified_unique'
FROM unique_candidates c
WHERE o.id=c.occurrence_id AND o.resolution_status='unresolved';

-- Where inflection or duplicate dictionary senses prevent unique matching,
-- the exact original phrase and one checked dictionary definition determine
-- the intended meaning. None of these six mappings guesses by search ranking.
WITH checked_phrases(surface_form,lemma,definition_en) AS (
  VALUES
    ('jotted down','jot down','to write something quickly and briefly'),
    ('withstanding strong winds','withstand strong winds','to resist strong winds without being damaged'),
    ('evolved into','evolve into','develop or change into something'),
    ('vegetation','vegetation','plant life in an area'),
    ('environmentally friendly','environmentally friendly','designed to reduce environmental harm'),
    ('come in handy','come in handy','to be useful when something is needed')
), checked_matches AS (
  SELECT o.id AS occurrence_id,l.id AS lexeme_id,
         count(*) OVER (PARTITION BY o.id) AS candidates
  FROM lexical_occurrences o
  JOIN listening_packages p ON p.test_id=o.listening_test_id
  JOIN checked_phrases c ON lower(c.surface_form)=lower(o.surface_form)
  JOIN lexemes l ON lower(l.term)=lower(c.lemma) AND l.definition_en=c.definition_en
  WHERE p.source_id IN ('listening-test-12','listening-test-13','listening-test-14','listening-test-15','listening-test-16')
    AND o.source_type='listening' AND o.resolution_status='unresolved'
    AND o.section_number BETWEEN 1 AND 4
    AND o.segment_key='s'||o.section_number::text
    AND o.lexeme_id IS NULL
    AND nullif(trim(l.translation_uz),'') IS NOT NULL
    AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
      from o.start_char+1 for o.end_char-o.start_char)=o.surface_form
)
UPDATE lexical_occurrences o
SET lexeme_id=m.lexeme_id, resolution_status='resolved',
    resolution_source='verified_context_phrase'
FROM checked_matches m
WHERE o.id=m.occurrence_id AND m.candidates=1
  AND o.resolution_status='unresolved';

-- Never publish silently partially resolved or out-of-bounds source spans.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM lexical_occurrences o
    JOIN listening_packages p ON p.test_id=o.listening_test_id
    WHERE p.source_id IN ('listening-test-12','listening-test-13','listening-test-14','listening-test-15','listening-test-16')
      AND o.source_type='listening'
      AND (o.section_number NOT BETWEEN 1 AND 4
        OR o.segment_key IS DISTINCT FROM 's'||o.section_number::text
        OR o.resolution_status<>'resolved' OR o.lexeme_id IS NULL
        OR o.start_char<0 OR o.end_char<=o.start_char
        OR o.end_char>length(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript')
        OR substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
          from o.start_char+1 for greatest(0,o.end_char-o.start_char))<>o.surface_form)
  ) THEN RAISE EXCEPTION 'Listening Tests 12-16 lexical audit failed: unresolved or invalid spans remain';
  END IF;
END $verify$;
COMMIT;
