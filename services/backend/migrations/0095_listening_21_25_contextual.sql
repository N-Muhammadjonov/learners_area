-- Listening Tests 21–25: context-verified dictionary senses.
-- Does not modify original exam HTML, audio, answers, scores, or user vocabulary.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- Resolve exact text spans only when one defined, translated dictionary sense exists.
WITH scoped AS (
 SELECT o.id,o.segment_key,o.section_number,o.surface_form,o.start_char,o.end_char,
        p.payload::jsonb payload
 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-21','listening-test-22','listening-test-23','listening-test-24','listening-test-25')
 AND o.source_type='listening' AND o.resolution_status='unresolved' AND o.lexeme_id IS NULL
),source_text AS (
 SELECT s.*,
 CASE
 WHEN segment_key='s'||section_number::text THEN payload->'sections'->(section_number-1)->>'transcript'
 WHEN segment_key~'^q[0-9]+:text$' THEN
  (SELECT q->>'text' FROM jsonb_array_elements(payload->'questions') q
   WHERE (q->>'number')::int=split_part(substring(segment_key from 2),':',1)::int LIMIT 1)
 WHEN segment_key~'^q[0-9]+:why$' THEN
  (SELECT q->'evidence'->>'why' FROM jsonb_array_elements(payload->'questions') q
   WHERE (q->>'number')::int=split_part(substring(segment_key from 2),':',1)::int LIMIT 1)
 WHEN segment_key~'^q[0-9]+:option:[0-9]+$' THEN
  (SELECT q->'options'->(split_part(segment_key,':',3)::int)#>>'{}'
   FROM jsonb_array_elements(payload->'questions') q
   WHERE (q->>'number')::int=split_part(substring(segment_key from 2),':',1)::int LIMIT 1)
 WHEN segment_key~'^v:[0-9]+:example$' THEN
  payload->'vocabulary'->(split_part(segment_key,':',2)::int)->>'ex'
 ELSE NULL END body FROM scoped s
), candidates AS (
 SELECT s.id occurrence_id,l.id lexeme_id
 FROM source_text s JOIN lexemes l ON lower(l.term)=lower(s.surface_form)
 WHERE s.start_char>=0 AND s.end_char>s.start_char
 AND substring(s.body FROM s.start_char+1 FOR s.end_char-s.start_char)=s.surface_form
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 AND l.definition_en NOT ILIKE '%important expression%'
), unique_senses AS (
 SELECT occurrence_id,min(lexeme_id::text)::uuid lexeme_id
 FROM candidates GROUP BY occurrence_id HAVING count(*)=1
)
UPDATE lexical_occurrences o
SET lexeme_id=u.lexeme_id,resolution_status='resolved',resolution_source='exact_context'
FROM unique_senses u WHERE o.id=u.occurrence_id
AND o.resolution_status='unresolved' AND o.lexeme_id IS NULL;

-- Multiple dictionary senses: choose using the passage's actual meaning.
WITH selections(source_id,segment_key,surface,lemma,definition) AS (VALUES
 ('listening-test-21','s2','take the register','take the register','to check and record which students are present'),
 ('listening-test-21','s3','background reading','background reading','reading done to build broader knowledge before or around a task'),
 ('listening-test-21','s3','technical side of things','technical side of things','the practical or specialist technical aspects of a task'),
 ('listening-test-25','s4','grain patterns','grain patterns','the visible arrangements of fibres and lines in wood'),
 ('listening-test-25','q36:why','grain patterns','grain patterns','the visible arrangements of fibres and lines in wood')
), scoped AS (
 SELECT o.id,o.surface_form,o.start_char,o.end_char,o.section_number,o.segment_key,
 p.payload::jsonb payload,l.id lexeme_id,
 count(*) OVER(PARTITION BY o.id) possibilities
 FROM selections s JOIN listening_packages p ON p.source_id=s.source_id
 JOIN lexical_occurrences o ON o.listening_test_id=p.test_id AND o.source_type='listening'
  AND o.segment_key=s.segment_key AND o.surface_form=s.surface
 JOIN lexemes l ON l.term=s.lemma AND l.definition_en=s.definition
 WHERE o.resolution_status='unresolved' AND o.lexeme_id IS NULL
), verified AS (
 SELECT s.id,s.lexeme_id FROM scoped s WHERE possibilities=1
 AND substring(
 CASE WHEN s.segment_key='s'||s.section_number::text
 THEN s.payload->'sections'->(s.section_number-1)->>'transcript'
 WHEN s.segment_key='q36:why' THEN
 (SELECT q->'evidence'->>'why' FROM jsonb_array_elements(s.payload->'questions') q WHERE q->>'number'='36' LIMIT 1)
 END FROM s.start_char+1 FOR s.end_char-s.start_char)=s.surface_form
)
UPDATE lexical_occurrences o
SET lexeme_id=v.lexeme_id,resolution_status='resolved',resolution_source='context_curated'
FROM verified v WHERE o.id=v.id AND o.resolution_status='unresolved';

-- Add a small set of separately contextualized terms, without touching overlap spans.
WITH selection(source_id,part,term) AS (VALUES
 ('listening-test-21',1,'find out'),('listening-test-21',1,'public transport'),
 ('listening-test-21',1,'bus stop'),('listening-test-21',3,'work out'),
 ('listening-test-21',3,'literature review'),('listening-test-21',4,'life cycle'),
 ('listening-test-21',4,'adapt to'),('listening-test-22',1,'find out'),
 ('listening-test-22',3,'a reduction in'),('listening-test-22',3,'frozen foods'),
 ('listening-test-22',4,'extended family'),('listening-test-22',4,'crop rotation'),
 ('listening-test-23',2,'the public'),('listening-test-23',4,'intelligence quotient'),
 ('listening-test-23',4,'genetic influence'),('listening-test-24',1,'post office'),
 ('listening-test-24',1,'plenty of room'),('listening-test-24',3,'find out'),
 ('listening-test-24',3,'work out'),('listening-test-24',3,'come across'),
 ('listening-test-24',3,'up to date'),('listening-test-25',3,'on its own'),
 ('listening-test-25',4,'black velvet')
), candidates AS (
 SELECT p.test_id,s.part,s.term,l.id lexeme_id,
 p.payload::jsonb->'sections'->(s.part-1)->>'transcript' body,
 strpos(lower(p.payload::jsonb->'sections'->(s.part-1)->>'transcript'),s.term)-1 AS pos,
 count(*) OVER(PARTITION BY p.test_id,s.part,s.term) senses
 FROM selection s JOIN listening_packages p ON p.source_id=s.source_id
 JOIN lexemes l ON lower(l.term)=s.term
 WHERE nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 AND l.definition_en NOT ILIKE '%important expression%'
), verified AS (
 SELECT c.*,substring(body FROM pos+1 FOR length(term)) surface
 FROM candidates c WHERE pos>=0 AND senses=1
 AND (pos=0 OR substring(body FROM pos FOR 1) !~ '[[:alpha:]]')
 AND (pos+length(term)>=length(body) OR substring(body FROM pos+length(term)+1 FOR 1) !~ '[[:alpha:]]')
 AND NOT EXISTS (
 SELECT 1 FROM lexical_occurrences o WHERE o.listening_test_id=c.test_id AND o.section_number=c.part
 AND o.segment_key='s'||c.part::text AND o.start_char<c.pos+length(c.term) AND o.end_char>c.pos)
)
INSERT INTO lexical_occurrences(source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary,
 lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,pos,pos+length(term),
 substring(body FROM greatest(1,pos-75) FOR length(term)+150),
 'phrase',true,lexeme_id,'resolved','context_curated'
FROM verified ON CONFLICT DO NOTHING;

-- Replace misleading generic Vocabulary Builder text with the matched, context-specific sense.
WITH original_items AS (
 SELECT p.test_id,p.source_id,x.ordinality::int position,x.value item,x.value->>'word' word
 FROM listening_packages p CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary')
 WITH ORDINALITY x(value,ordinality)
 WHERE p.source_id IN ('listening-test-21','listening-test-23')
), linked AS (
 SELECT i.*,o.sentence_text,l.definition_en,l.translation_uz,l.part_of_speech
 FROM original_items i JOIN LATERAL (
  SELECT o.sentence_text,o.lexeme_id FROM lexical_occurrences o
  WHERE o.listening_test_id=i.test_id AND o.source_type='listening'
    AND o.segment_key='s'||o.section_number::text
    AND o.resolution_status='resolved'
    AND lower(o.surface_form)=lower(i.word)
  ORDER BY o.section_number,o.start_char LIMIT 1
 ) o ON true
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE o.sentence_text ILIKE '%'||i.word||'%'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 AND l.definition_en NOT ILIKE '%important expression%'
), replacement AS (
 SELECT test_id,jsonb_agg(item||jsonb_build_object('def',definition_en,
 'uz',translation_uz,'pos',coalesce(part_of_speech,item->>'pos'),
 'ex',sentence_text) ORDER BY position) new_vocab,count(*) item_count
 FROM linked GROUP BY test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{vocabulary}',r.new_vocab,false)
FROM replacement r WHERE p.test_id=r.test_id AND r.item_count=32
AND p.payload::jsonb->'vocabulary' IS DISTINCT FROM r.new_vocab;

DO $verify$
DECLARE parts_count int;
BEGIN
 SELECT count(*) INTO parts_count FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections') s(value)
 WHERE p.source_id IN ('listening-test-21','listening-test-22','listening-test-23','listening-test-24','listening-test-25');
 IF parts_count<>20 THEN RAISE EXCEPTION 'Expected 20 Listening transcript parts, got %',parts_count; END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-21','listening-test-22','listening-test-23','listening-test-24','listening-test-25')
 AND o.source_type='listening' AND (o.resolution_status<>'resolved' OR o.lexeme_id IS NULL)
 ) THEN RAISE EXCEPTION 'Some Listening 21–25 occurrences remain unresolved'; END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-21','listening-test-22','listening-test-23','listening-test-24','listening-test-25')
 AND o.segment_key='s'||o.section_number::text
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form
 ) THEN RAISE EXCEPTION 'Invalid transcript offset'; END IF;
 IF EXISTS (
 SELECT 1 FROM listening_packages p CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') v(value)
 WHERE p.source_id IN ('listening-test-21','listening-test-23')
 AND (v.value->>'def' ILIKE '%important expression%' OR v.value->>'uz' ILIKE '%Kontekst orqali%')
 ) THEN RAISE EXCEPTION 'Placeholder Vocabulary Builder definitions remain'; END IF;
END $verify$;
COMMIT;
