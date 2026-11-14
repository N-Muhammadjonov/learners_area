-- Listening Tests 26–29 contextual lexical links.
-- Source-specific offsets only; no exam, grading, audio or user-vocabulary changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

WITH scope AS (
 SELECT o.id,o.segment_key,o.section_number,o.surface_form,o.start_char,o.end_char,
        p.payload::jsonb payload
 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-26','listening-test-27','listening-test-28','listening-test-29')
   AND o.source_type='listening'
   AND o.resolution_status='unresolved'
   AND o.lexeme_id IS NULL
),source_text AS (
 SELECT s.*,
 CASE
 WHEN segment_key='s'||section_number::text THEN payload->'sections'->(section_number-1)->>'transcript'
 WHEN segment_key~'^q[0-9]+:text$' THEN
  (SELECT q->>'text' FROM jsonb_array_elements(payload->'questions') q
   WHERE (q->>'number')::int=split_part(substring(segment_key FROM 2),':',1)::int LIMIT 1)
 WHEN segment_key~'^q[0-9]+:why$' THEN
  (SELECT q->'evidence'->>'why' FROM jsonb_array_elements(payload->'questions') q
   WHERE (q->>'number')::int=split_part(substring(segment_key FROM 2),':',1)::int LIMIT 1)
 WHEN segment_key~'^q[0-9]+:option:[0-9]+$' THEN
  (SELECT q->'options'->(split_part(segment_key,':',3)::int)#>>'{}'
   FROM jsonb_array_elements(payload->'questions') q
   WHERE (q->>'number')::int=split_part(substring(segment_key FROM 2),':',1)::int LIMIT 1)
 WHEN segment_key~'^v:[0-9]+:example$' THEN
  payload->'vocabulary'->(split_part(segment_key,':',2)::int)->>'ex'
 ELSE NULL END body
 FROM scope s
), candidates AS (
 SELECT s.id occurrence_id,l.id lexeme_id
 FROM source_text s JOIN lexemes l ON lower(l.term)=lower(s.surface_form)
 WHERE s.start_char>=0 AND s.end_char>s.start_char
   AND substring(s.body FROM s.start_char+1 FOR s.end_char-s.start_char)=s.surface_form
   AND nullif(trim(l.definition_en),'') IS NOT NULL
   AND nullif(trim(l.translation_uz),'') IS NOT NULL
   AND l.definition_en NOT ILIKE '%important expression%'
),unique_senses AS (
 SELECT occurrence_id,min(lexeme_id::text)::uuid lexeme_id
 FROM candidates GROUP BY occurrence_id HAVING count(*)=1
)
UPDATE lexical_occurrences o
SET lexeme_id=u.lexeme_id,resolution_status='resolved',resolution_source='exact_context'
FROM unique_senses u
WHERE o.id=u.occurrence_id AND o.resolution_status='unresolved' AND o.lexeme_id IS NULL;

-- Four polysemous/duplicate entries selected using the actual source sentences.
WITH selected(source_id,segment_key,surface,lemma,definition) AS (VALUES
 ('listening-test-27','s4','carry out a risk assessment','carry out a risk assessment','to systematically identify and evaluate possible risks'),
 ('listening-test-27','s4','phenomenal expansion','phenomenal expansion','extremely rapid and impressive growth'),
 ('listening-test-27','s4','distorted understanding','distorted understanding','an inaccurate or misleading interpretation of a subject'),
 ('listening-test-28','s2','environmental impact','environmental impact','the effect that an activity has on the natural environment.')
),match AS (
 SELECT o.id,o.section_number,o.segment_key,o.surface_form,o.start_char,o.end_char,
 p.payload::jsonb payload,l.id lexeme_id,
 count(*) OVER(PARTITION BY o.id) candidate_count
 FROM selected s JOIN listening_packages p ON p.source_id=s.source_id
 JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
  AND o.source_type='listening' AND o.segment_key=s.segment_key AND o.surface_form=s.surface
 JOIN lexemes l ON l.term=s.lemma AND l.definition_en=s.definition
 WHERE o.resolution_status='unresolved' AND o.lexeme_id IS NULL
),verified AS (
 SELECT m.id,m.lexeme_id FROM match m
 WHERE m.candidate_count=1 AND substring(
 m.payload->'sections'->(m.section_number-1)->>'transcript'
 FROM m.start_char+1 FOR m.end_char-m.start_char)=m.surface_form
)
UPDATE lexical_occurrences o
SET lexeme_id=v.lexeme_id,resolution_status='resolved',resolution_source='context_curated'
FROM verified v WHERE o.id=v.id AND o.resolution_status='unresolved';

-- Vocabulary Builder should display the exact sense and a real transcript example,
-- not merely "Part 1: ..." as its example sentence.
WITH items AS (
 SELECT p.test_id,p.source_id,x.ordinality::int position,x.value item,x.value->>'word' word
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') WITH ORDINALITY x(value,ordinality)
 WHERE p.source_id IN ('listening-test-26','listening-test-27','listening-test-28','listening-test-29')
),bound AS (
 SELECT i.*,o.sentence_text,l.definition_en,l.translation_uz,l.part_of_speech
 FROM items i JOIN LATERAL (
  SELECT o.sentence_text,o.lexeme_id FROM lexical_occurrences o
  WHERE o.listening_test_id=i.test_id
  AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
  AND o.resolution_status='resolved'
  AND lower(o.surface_form)=lower(i.word)
  ORDER BY o.section_number,o.start_char LIMIT 1
 ) o ON true
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE o.sentence_text ILIKE '%'||i.word||'%'
   AND nullif(trim(l.definition_en),'') IS NOT NULL
   AND nullif(trim(l.translation_uz),'') IS NOT NULL
   AND l.definition_en NOT ILIKE '%important expression%'
),reconstructed AS (
 SELECT test_id,jsonb_agg(item||jsonb_build_object(
 'def',definition_en,'uz',translation_uz,
 'pos',coalesce(part_of_speech,item->>'pos'),'ex',sentence_text
 ) ORDER BY position) vocab,count(*) n
 FROM bound GROUP BY test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{vocabulary}',r.vocab,false)
FROM reconstructed r WHERE p.test_id=r.test_id AND r.n=32
AND p.payload::jsonb->'vocabulary' IS DISTINCT FROM r.vocab;

DO $verify$
DECLARE parts int;
BEGIN
 SELECT count(*) INTO parts FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections') s(value)
 WHERE p.source_id IN ('listening-test-26','listening-test-27','listening-test-28','listening-test-29');
 IF parts<>16 THEN RAISE EXCEPTION 'Expected 16 transcripts; got %',parts; END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-26','listening-test-27','listening-test-28','listening-test-29')
 AND o.source_type='listening' AND (o.resolution_status<>'resolved' OR o.lexeme_id IS NULL)
 ) THEN RAISE EXCEPTION 'Unresolved Listening 26–29 occurrence'; END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-26','listening-test-27','listening-test-28','listening-test-29')
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form
 ) THEN RAISE EXCEPTION 'Wrong transcript lexical offset'; END IF;
 IF EXISTS (
 SELECT 1 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') x(value)
 WHERE p.source_id IN ('listening-test-26','listening-test-27','listening-test-28','listening-test-29')
 AND (x.value->>'ex' ILIKE 'Part %' OR x.value->>'def' ILIKE '%important expression%'
 OR x.value->>'uz' ILIKE '%kontekst orqali%')
 ) THEN RAISE EXCEPTION 'Vocabulary Builder still contains placeholder content'; END IF;
END $verify$;
COMMIT;
