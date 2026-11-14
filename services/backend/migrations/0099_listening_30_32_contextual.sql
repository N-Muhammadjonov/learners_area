-- Listening Tests 30–32 contextual lexical links.
-- Source-specific offsets only; no exam, grading, audio or user-vocabulary changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- Contextually, switch off means losing interest, not turning off a device.
WITH sense(term,pos,meaning,translation,sentence) AS (
 VALUES ('switch off','phrasal verb',
 'to stop paying attention because something becomes boring or uninteresting',
 'zerikib, tinglashdan to‘xtamoq',
 'If you start describing mechanical stuff, people will switch off.')
), keyed AS (
 SELECT *,
 'v2:'||encode(sha256(convert_to(replace(
 json_build_array(lower(term),lower(pos),lower(meaning))::text,', ',','),'UTF8')),'hex') sense_key
 FROM sense
)
INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,
 example_sentence,sense_key,provenance,verification_status)
SELECT term,pos,meaning,translation,sentence,sense_key,
 'course_editorial','context_checked'
FROM keyed ON CONFLICT(sense_key) DO NOTHING;

WITH scope AS (
 SELECT o.id,o.segment_key,o.section_number,o.surface_form,o.start_char,o.end_char,
        p.payload::jsonb payload
 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
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

-- Match existing inflected source phrases to the precise dictionary sense.
WITH selected(source_id,segment_key,surface,lemma,definition) AS (VALUES
 ('listening-test-32','s1','applying heat','apply heat','to use heat on an injured or painful area'),
 ('listening-test-32','s3','switch off','switch off',
  'to stop paying attention because something becomes boring or uninteresting')
),matches AS (
 SELECT o.id,o.start_char,o.end_char,o.surface_form,o.section_number,
 p.payload::jsonb payload,l.id lexeme_id,count(*) OVER(PARTITION BY o.id) matches
 FROM selected s JOIN listening_packages p ON p.source_id=s.source_id
 JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 AND o.source_type='listening' AND o.segment_key=s.segment_key
 AND o.surface_form=s.surface
 JOIN lexemes l ON l.term=s.lemma AND l.definition_en=s.definition
 WHERE o.resolution_status='unresolved' AND o.lexeme_id IS NULL
),verified AS (
 SELECT id,lexeme_id FROM matches
 WHERE matches=1
 AND substring(payload->'sections'->(section_number-1)->>'transcript'
 FROM start_char+1 FOR end_char-start_char)=surface_form
)
UPDATE lexical_occurrences o
SET lexeme_id=v.lexeme_id,resolution_status='resolved',resolution_source='context_curated'
FROM verified v WHERE o.id=v.id AND o.resolution_status='unresolved';

-- The remaining five Vocabulary expressions are grammatical variants or
-- contextual equivalents in the actual transcript, not literal source strings.
WITH entries(part,surface,lemma,definition,sentence) AS (VALUES
 (1,'makes any difference','make a difference',
  'to have a noticeable effect',
  'One thing you could do now is to see if ice makes any difference.'),
 (1,'dealing with this sort of problem','deal with a problem',
  'to take action to manage a problem',
  'That''s often the best way of dealing with this sort of problem.'),
 (2,'having a go','have a go',
  'to try doing something',
  'And that''s what the centre is all about, having a go.'),
 (3,'boundary','public-park boundary',
  'the exact limit of land belonging to a public park',
  'Where is the boundary exactly?'),
 (4,'increasingly dry and arid','increasingly arid',
  'becoming progressively drier',
  'the region became, and still is becoming, increasingly dry and arid.')
),verified AS (
 SELECT p.test_id,e.part,e.surface,e.sentence,l.id lexeme_id,
 j.value->>'transcript' body,
 strpos(j.value->>'transcript',e.surface)-1 pos,
 count(*) OVER(PARTITION BY e.part,e.surface) matches
 FROM entries e JOIN listening_packages p ON p.source_id='listening-test-32'
 JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY j(value,ordinality) ON j.ordinality=e.part
 JOIN lexemes l ON l.term=e.lemma AND l.definition_en=e.definition
 WHERE strpos(j.value->>'transcript',e.sentence)>0
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,occurrence_type,
 is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,pos,pos+length(surface),sentence,'phrase',true,
 lexeme_id,'resolved','context_curated'
FROM verified v
WHERE matches=1 AND pos>=0
AND substring(body FROM pos+1 FOR length(surface))=surface
AND NOT EXISTS (
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=v.test_id AND o.section_number=v.part
 AND o.segment_key='s'||v.part::text
 AND o.start_char<v.pos+length(v.surface) AND o.end_char>v.pos
)
ON CONFLICT DO NOTHING;

-- Restore full transcript sentences to the Vocabulary Builder. Six Test 32
-- entries are canonical dictionary forms which do not appear verbatim in audio.
WITH aliases(source_id,lemma,surface) AS (VALUES
 ('listening-test-32','apply heat','applying heat'),
 ('listening-test-32','make a difference','makes any difference'),
 ('listening-test-32','deal with a problem','dealing with this sort of problem'),
 ('listening-test-32','have a go','having a go'),
 ('listening-test-32','public-park boundary','boundary'),
 ('listening-test-32','increasingly arid','increasingly dry and arid')
),items AS (
 SELECT p.test_id,p.source_id,x.ordinality::int position,
 x.value item,x.value->>'word' word
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary')
 WITH ORDINALITY x(value,ordinality)
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
),bound AS (
 SELECT i.*,o.sentence_text,l.definition_en,l.translation_uz,l.part_of_speech
 FROM items i
 LEFT JOIN aliases a ON a.source_id=i.source_id AND lower(a.lemma)=lower(i.word)
 JOIN LATERAL (
  SELECT o.sentence_text,o.lexeme_id,o.surface_form
  FROM lexical_occurrences o
  WHERE o.listening_test_id=i.test_id
    AND o.source_type='listening'
    AND o.segment_key='s'||o.section_number::text
    AND o.resolution_status='resolved'
    AND lower(o.surface_form)=lower(coalesce(a.surface,i.word))
  ORDER BY o.section_number,o.start_char LIMIT 1
 ) o ON true
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE o.sentence_text ILIKE '%'||o.surface_form||'%'
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
FROM reconstructed r
WHERE p.test_id=r.test_id AND r.n=32
AND p.payload::jsonb->'vocabulary' IS DISTINCT FROM r.vocab;

DO $verify$
DECLARE parts int;
BEGIN
 SELECT count(*) INTO parts FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections') s(value)
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32');
 IF parts<>12 THEN RAISE EXCEPTION 'Expected 12 transcripts; got %',parts; END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
 AND o.source_type='listening' AND (o.resolution_status<>'resolved' OR o.lexeme_id IS NULL)
 ) THEN RAISE EXCEPTION 'Unresolved Listening 30–32 occurrence'; END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form
 ) THEN RAISE EXCEPTION 'Wrong transcript lexical offset'; END IF;
 IF EXISTS (
 SELECT 1 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') x(value)
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
 AND (x.value->>'ex' ILIKE 'Part %' OR x.value->>'def' ILIKE '%important expression%'
 OR x.value->>'uz' ILIKE '%kontekst orqali%')
 ) THEN RAISE EXCEPTION 'Vocabulary Builder still contains placeholder content'; END IF;
END $verify$;
COMMIT;
