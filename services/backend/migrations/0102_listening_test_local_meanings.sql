-- Snapshot the single editor-selected meaning INSIDE each Listening Test.
-- After this one-time materialization, Script popup displays test-local HTML data;
-- it does not search dictionary releases or choose alternative meanings at click time.
-- Idempotent; keeps original audio, questions, grading and user saves untouched.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

WITH authored AS (
 SELECT p.test_id,p.source_id,
 jsonb_agg(jsonb_build_object(
   'part',o.section_number,
   'start',o.start_char,
   'end',o.end_char,
   'surface',o.surface_form,
   'occurrenceId',o.id::text,
   'definitionEn',l.definition_en,
   'translationUz',l.translation_uz,
   'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) AS meanings,
 count(*) AS number_of_meanings
 FROM listening_packages p
 JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
   AND o.source_type='listening'
   AND o.segment_key='s'||o.section_number::text
   AND o.resolution_status='resolved'
   AND o.lexeme_id IS NOT NULL
   AND nullif(trim(l.definition_en),'') IS NOT NULL
   AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id,p.source_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',a.meanings,true)
FROM authored a
WHERE p.test_id=a.test_id
  AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM a.meanings;

DO $verify$
DECLARE test_count int;
DECLARE mapped_count int;
DECLARE missing_def int;
BEGIN
 SELECT count(*),sum(jsonb_array_length(p.payload::jsonb->'contextualMeanings'))
 INTO test_count,mapped_count
 FROM listening_packages p
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$';
 IF test_count<>32 THEN RAISE EXCEPTION 'Expected 32 tests, found %',test_count; END IF;
 IF mapped_count<6800 THEN RAISE EXCEPTION 'Missing source-local meanings: %',mapped_count; END IF;
 SELECT count(*) INTO missing_def
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'contextualMeanings') row(value)
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND (nullif(trim(row.value->>'definitionEn'),'') IS NULL
 OR nullif(trim(row.value->>'translationUz'),'') IS NULL);
 IF missing_def<>0 THEN RAISE EXCEPTION 'Source-local meanings missing: %',missing_def; END IF;
END $verify$;
COMMIT;
