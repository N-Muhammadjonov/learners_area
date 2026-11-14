-- Listening 1–32: correct old "once" ambiguity and remove grammatical
-- determiners/connectors from source-owned interactive vocabulary snapshots.
-- User vocabulary/ledger, audio, grading, questions and lexical history unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='65s';

WITH editorial(term,pos,def,uz) AS (
 VALUES
 ('once','adverb','on one occasion; a single time','bir marta'),
 ('once','conjunction','as soon as or after the stated event happens','...gach; ...bilanoq'),
 ('once','adverb','again, for another occurrence','yana bir marta')
),hashed AS (
 SELECT *, 'v2:'||encode(sha256(convert_to(replace(
 json_build_array(lower(term),lower(pos),lower(def))::text,', ',','),'UTF8')),'hex') AS key
 FROM editorial
)
INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,sense_key,provenance,verification_status)
SELECT term,pos,def,uz,key,'course_editorial','context_checked' FROM hashed
ON CONFLICT(sense_key) DO NOTHING;

WITH occurrences AS (
 SELECT o.id,o.start_char,o.section_number,
 p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript' AS body
 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND o.segment_key='s'||o.section_number::text AND lower(o.surface_form)='once'
),context AS (
 SELECT o.id,
 lower(substring(o.body FROM greatest(1,o.start_char-25) FOR 25)) before,
 lower(substring(o.body FROM o.start_char+5 FOR 55)) following
 FROM occurrences o
),meaning AS (
 SELECT c.id,
 CASE
 WHEN c.following LIKE ' again%' THEN 'again, for another occurrence'
 WHEN c.following ~ '^ (only|a |or |more|twice)' OR c.before ~ 'more than |like that |escaped |at least '
 THEN 'on one occasion; a single time'
 WHEN c.before ~ '\m(was|were|had|have|has)\s+$' THEN NULL
 ELSE 'as soon as or after the stated event happens'
 END definition_en
 FROM context c
),selected AS (
 SELECT m.id,l.id lexeme_id
 FROM meaning m JOIN lexemes l ON l.term='once'
 AND l.definition_en=m.definition_en AND l.provenance='course_editorial'
 WHERE m.definition_en IS NOT NULL
)
UPDATE lexical_occurrences o
SET lexeme_id=s.lexeme_id,resolution_source='context_curated'
FROM selected s WHERE s.id=o.id AND o.lexeme_id IS DISTINCT FROM s.lexeme_id;

WITH materialized AS (
 SELECT p.test_id,
 jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) meanings
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND lower(o.surface_form) NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','all','some','any','each','every','few','many','several','both','either','neither','another','other','before','after','until','since','therefore','however','first','second','third','fourth','fifth')
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',m.meanings,true)
FROM materialized m
WHERE p.test_id=m.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM m.meanings;

DO $verify$
BEGIN
 IF EXISTS(
 SELECT 1 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'contextualMeanings') x(value)
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND lower(x.value->>'surface') IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','all','some','any','each','every','few','many','several','both','either','neither','another','other','before','after','until','since','therefore','however','first','second','third','fourth','fifth')
 ) THEN RAISE EXCEPTION 'Function words remain inside a Listening test vocabulary snapshot';END IF;
END $verify$;
COMMIT;
