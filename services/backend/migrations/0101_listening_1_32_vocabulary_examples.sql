-- Final full-corpus Listening 1–32 Vocabulary Builder recovery.
-- Replaces legacy placeholder examples with genuine source sentences.
-- Only package vocabulary JSON is updated; original tests and user saves unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

WITH items AS (
 SELECT p.test_id,p.source_id,x.ordinality::int position,x.value item,x.value->>'word' word
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') WITH ORDINALITY x(value,ordinality)
 WHERE p.source_id IN ('listening-test-14','listening-test-15','listening-test-16','listening-test-24','listening-test-25')
),bound AS (
 SELECT i.*,o.sentence_text,l.definition_en,l.translation_uz,l.part_of_speech
 FROM items i JOIN LATERAL (
  SELECT o.sentence_text,o.lexeme_id,o.surface_form FROM lexical_occurrences o
  WHERE o.listening_test_id=i.test_id AND o.source_type='listening'
    AND o.segment_key='s'||o.section_number::text
    AND o.resolution_status='resolved'
    AND lower(o.surface_form)=lower(i.word)
  ORDER BY o.section_number,o.start_char LIMIT 1
 ) o ON true JOIN lexemes l ON l.id=o.lexeme_id
 WHERE o.sentence_text ILIKE '%'||o.surface_form||'%'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 AND l.definition_en NOT ILIKE '%important expression%'
),reconstructed AS (
 SELECT test_id,
 jsonb_agg(item||jsonb_build_object(
  'def',definition_en,'uz',translation_uz,
  'pos',coalesce(part_of_speech,item->>'pos'),'ex',sentence_text
 ) ORDER BY position) vocab,count(*) n
 FROM bound GROUP BY test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{vocabulary}',r.vocab,false)
FROM reconstructed r WHERE p.test_id=r.test_id
AND r.n=jsonb_array_length(p.payload::jsonb->'vocabulary')
AND p.payload::jsonb->'vocabulary' IS DISTINCT FROM r.vocab;

-- Two Test 9 expressions appear in their inflected plural forms.
-- Preserve the canonical vocabulary term, using a real sentence from the recording.
WITH examples(word,part,sentence) AS (VALUES
 ('hall of residence',2,
  'I''m here to tell you about the various halls of residence we have available should you choose to come here.'),
 ('news source',4,
  'In the USA the main news sources without doubt are TV, the internet and the press - that is traditional newspapers.')
),validated AS (
 SELECT e.word,e.sentence
 FROM examples e JOIN listening_packages p ON p.source_id='listening-test-9'
 JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY s(value,ordinality) ON s.ordinality=e.part
 WHERE strpos(s.value->>'transcript',e.sentence)>0
),rewritten AS (
 SELECT p.test_id,jsonb_agg(
 CASE WHEN v.value->>'word'=e.word THEN v.value||jsonb_build_object('ex',e.sentence)
 ELSE v.value END ORDER BY v.ordinality
 ) items
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') WITH ORDINALITY v(value,ordinality)
 LEFT JOIN validated e ON e.word=v.value->>'word'
 WHERE p.source_id='listening-test-9' GROUP BY p.test_id
)
UPDATE listening_packages p SET payload=jsonb_set(p.payload::jsonb,'{vocabulary}',r.items,false)
FROM rewritten r WHERE r.test_id=p.test_id
AND p.payload::jsonb->'vocabulary' IS DISTINCT FROM r.items;

DO $verify$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') x(value)
 WHERE p.source_id ~ '^listening-test-([1-9]|[12][0-9]|3[0-2])$'
 AND (x.value->>'ex' ILIKE 'Part %'
 OR x.value->>'def' ILIKE '%important expression%'
 OR x.value->>'uz' ILIKE '%kontekst orqali%');
 IF n<>0 THEN RAISE EXCEPTION 'Listening 1–32 still contains % legacy placeholder vocabulary examples',n; END IF;
END $verify$;
COMMIT;
