-- Correct context-specific senses spotted in the full 32-test audit.
-- Store the reviewed sense in its own Listening Test AND use the same
-- lexeme when adding the word to a learner's Vocabulary folder.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

WITH reviewed(term,pos,definition,translation,example) AS (VALUES
 ('opposite','preposition','on the other side of or facing a place',
 'ro‘parasida, qarama-qarshi tomonda',
 'The new barbecue area is opposite the kitchen.'),
 ('opposite','adjective','different or contrary in opinion, direction or meaning',
 'qarama-qarshi, teskari',
 'I wanted to show the opposite view.'),
 ('fine','interjection','used to express agreement or acceptance',
 'xo‘p, bo‘ldi, mayli',
 'Fine. Now, what about phone calls?'),
 ('fine','adjective','acceptable, suitable or satisfactory for the situation',
 'ma’qul, mos, yaxshi',
 'That sounds fine.')
), keyed AS (
 SELECT *, 'v2:'||encode(sha256(convert_to(replace(
 json_build_array(lower(term),lower(pos),lower(definition))::text,', ',','),'UTF8')),'hex') AS sense_key
 FROM reviewed
)
INSERT INTO lexemes(
 term,part_of_speech,definition_en,translation_uz,example_sentence,
 sense_key,provenance,verification_status)
SELECT term,pos,definition,translation,example,sense_key,
 'course_editorial','context_checked'
FROM keyed ON CONFLICT(sense_key) DO NOTHING;

WITH choices AS (
 SELECT o.id,
 CASE
 WHEN lower(o.surface_form)='opposite' AND lower(
  substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
  FROM o.start_char+1 FOR 27)) LIKE 'opposite view%'
 THEN 'different or contrary in opinion, direction or meaning'
 WHEN lower(o.surface_form)='opposite'
 THEN 'on the other side of or facing a place'
 WHEN o.surface_form='Fine'
 THEN 'used to express agreement or acceptance'
 WHEN lower(o.surface_form)='fine'
 THEN 'acceptable, suitable or satisfactory for the situation'
 END AS definition
 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND lower(o.surface_form) IN ('opposite','fine')
),updated AS (
 SELECT c.id,l.id lexeme_id
 FROM choices c JOIN lexemes l ON l.term=CASE WHEN c.definition LIKE 'used to%' OR c.definition LIKE 'acceptable%' THEN 'fine' ELSE 'opposite' END
 AND l.definition_en=c.definition AND l.provenance='course_editorial'
)
UPDATE lexical_occurrences o
SET lexeme_id=u.lexeme_id,resolution_status='resolved',
 resolution_source='context_curated'
FROM updated u WHERE o.id=u.id AND o.lexeme_id IS DISTINCT FROM u.lexeme_id;

-- Re-materialize each test's owned meanings after editing these few senses.
WITH data AS (
 SELECT p.test_id,
 jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) AS embedded
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',d.embedded,true)
FROM data d WHERE p.test_id=d.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM d.embedded;

DO $verify$
BEGIN
 IF EXISTS (
 SELECT 1 FROM listening_packages p,
 LATERAL jsonb_array_elements(p.payload::jsonb->'contextualMeanings') item(value)
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND lower(item.value->>'surface')='opposite'
 AND item.value->>'definitionEn'='moving or facing away from each other'
 ) THEN RAISE EXCEPTION 'Obsolete opposite sense remains'; END IF;
 IF (SELECT count(*) FROM listening_packages p
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND jsonb_typeof(p.payload::jsonb->'contextualMeanings')='array')<>32
 THEN RAISE EXCEPTION 'Incomplete test-local meanings'; END IF;
END $verify$;
COMMIT;
