-- Restore context-verified Listening Tests 1–20 lexical meanings.
-- Safe to rerun: no DELETE, no user vocabulary edits, no audio or exam changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- Two inflected expressions require their own exact contextual senses.
WITH entries(term,pos,definition_en,translation_uz,example_sentence) AS (
 VALUES
 ('needn''t have worried','verb phrase','there was no need to feel anxious because the feared problem did not happen','xavotirlanishga hojat yo‘q ekan','I needn''t have worried about applying for the scholarship.'),
 ('being refurbished','verb phrase','currently being repaired, renovated or improved','hozirda ta’mirlanayotgan','The park is being refurbished at the moment.')
), normalized AS (
 SELECT *,
 'v2:'||encode(sha256(convert_to(replace(json_build_array(lower(term),lower(pos),lower(definition_en))::text,', ',','),'UTF8')),'hex') sense_key
 FROM entries
)
INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,example_sentence,sense_key,provenance,verification_status)
SELECT term,pos,definition_en,translation_uz,example_sentence,sense_key,'course_editorial','context_checked'
FROM normalized ON CONFLICT(sense_key) DO NOTHING;

-- Never publish spelling alone. The source span and a single existing sense must match.
WITH segments AS (
 SELECT p.test_id,o.id,o.surface_form,o.start_char,o.end_char,
 p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript' body
 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id ~ '^listening-test-([1-9]|1[0-9]|20)$'
   AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
   AND o.resolution_status='unresolved' AND o.lexeme_id IS NULL
), candidates AS (
 SELECT s.id occurrence_id,l.id lexeme_id
 FROM segments s JOIN lexemes l ON lower(l.term)=lower(s.surface_form)
 WHERE substring(s.body from s.start_char+1 for s.end_char-s.start_char)=s.surface_form
 AND nullif(trim(l.definition_en),'') IS NOT NULL AND nullif(trim(l.translation_uz),'') IS NOT NULL
), unique_senses AS (
 SELECT occurrence_id,min(lexeme_id::text)::uuid lexeme_id
 FROM candidates GROUP BY occurrence_id HAVING count(*)=1
)
UPDATE lexical_occurrences o
SET lexeme_id=s.lexeme_id,resolution_status='resolved',resolution_source='exact_context_audit'
FROM unique_senses s WHERE o.id=s.occurrence_id AND o.resolution_status='unresolved' AND o.lexeme_id IS NULL;

-- Explicitly disambiguated expressions, checked against their actual transcript sentences.
WITH checked(source_id,section,surface,lemma,meaning) AS (VALUES
 ('listening-test-3',4,'take into account','take into account','to consider a fact or circumstance when making a judgement'),
 ('listening-test-4',2,'needn''t have worried','needn''t have worried','there was no need to feel anxious because the feared problem did not happen'),
 ('listening-test-4',2,'fitted in with','fit in with','be compatible with a schedule or situation'),
 ('listening-test-4',4,'hands-on experience','hands-on experience','practical experience gained by doing something'),
 ('listening-test-7',2,'being refurbished','being refurbished','currently being repaired, renovated or improved'),
 ('listening-test-9',4,'profit margin','profit margin','the percentage or amount of sales revenue remaining as profit'),
 ('listening-test-11',3,'catch up with','catch up with','to reach the same level after falling behind'),
 ('listening-test-20',4,'grain patterns','grain patterns','the visible arrangements of fibres and lines in wood')
), candidates AS (
 SELECT o.id occurrence_id,l.id lexeme_id,
 count(*) OVER(PARTITION BY o.id) senses
 FROM checked c JOIN listening_packages p ON p.source_id=c.source_id
 JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
    AND o.section_number=c.section AND o.segment_key='s'||c.section::text
    AND o.surface_form=c.surface AND o.resolution_status='unresolved'
 JOIN lexemes l ON lower(l.term)=lower(c.lemma) AND l.definition_en=c.meaning
 WHERE substring(p.payload::jsonb->'sections'->(c.section-1)->>'transcript'
    from o.start_char+1 for o.end_char-o.start_char)=o.surface_form
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
)
UPDATE lexical_occurrences o
SET lexeme_id=c.lexeme_id,resolution_status='resolved',resolution_source='context_curated'
FROM candidates c WHERE o.id=c.occurrence_id AND c.senses=1 AND o.resolution_status='unresolved';

-- Non-transcript occurrences have their own coordinate systems.
WITH pending AS (
 SELECT o.id,o.segment_key,o.surface_form,o.start_char,o.end_char,p.payload::jsonb payload
 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id ~ '^listening-test-([1-9]|1[0-9]|20)$'
 AND o.source_type='listening' AND o.resolution_status='unresolved' AND o.lexeme_id IS NULL
), source_text AS (
 SELECT pending.*,
 CASE
 WHEN segment_key ~ '^v:[0-9]+:example$' THEN payload->'vocabulary'->(split_part(segment_key,':',2)::int)->>'ex'
 WHEN segment_key ~ '^q[0-9]+:text$' THEN
  (SELECT x->>'text' FROM jsonb_array_elements(payload->'questions') x
   WHERE (x->>'number')::int=split_part(substring(segment_key from 2),':',1)::int LIMIT 1)
 WHEN segment_key ~ '^q[0-9]+:why$' THEN
  (SELECT x->'evidence'->>'why' FROM jsonb_array_elements(payload->'questions') x
   WHERE (x->>'number')::int=split_part(substring(segment_key from 2),':',1)::int LIMIT 1)
 WHEN segment_key ~ '^q[0-9]+:option:[0-9]+$' THEN
  (SELECT x->'options'->(split_part(segment_key,':',3)::int)#>>'{}'
   FROM jsonb_array_elements(payload->'questions') x
   WHERE (x->>'number')::int=split_part(substring(segment_key from 2),':',1)::int LIMIT 1)
 ELSE NULL END body FROM pending
), candidates AS (
 SELECT t.id occurrence_id,l.id lexeme_id FROM source_text t
 JOIN lexemes l ON lower(l.term)=lower(t.surface_form)
 WHERE substring(t.body from t.start_char+1 for t.end_char-t.start_char)=t.surface_form
 AND nullif(trim(l.definition_en),'') IS NOT NULL AND nullif(trim(l.translation_uz),'') IS NOT NULL
), single_sense AS (
 SELECT occurrence_id,min(lexeme_id::text)::uuid lexeme_id FROM candidates
 GROUP BY occurrence_id HAVING count(*)=1
)
UPDATE lexical_occurrences o
SET lexeme_id=s.lexeme_id,resolution_status='resolved',resolution_source='exact_context_audit'
FROM single_sense s WHERE o.id=s.occurrence_id AND o.resolution_status='unresolved';

-- Remaining meanings whose inflection or duplicate dictionary senses require an editor choice.
WITH chosen(source_id,segment_key,surface,lemma,definition) AS (VALUES
 ('listening-test-1','k1:106:heard','move in','move in','to begin living in a new home'),
 ('listening-test-1','k1:106:text','move in','move in','to begin living in a new home'),
 ('listening-test-1','q37:text','desiccation','desiccation','the process of becoming completely dry or losing water'),
 ('listening-test-1','q37:why','desiccation','desiccation','the process of becoming completely dry or losing water'),
 ('listening-test-7','q21:why','booked up','book up','become fully reserved or unavailable'),
 ('listening-test-7','q34:why','ruled out','rule out','exclude something as a possibility or option'),
 ('listening-test-9','q36:why','profit margin','profit margin','the percentage or amount of sales revenue remaining as profit')
), mapped AS (
 SELECT o.id occurrence_id,l.id lexeme_id FROM chosen c
 JOIN listening_packages p ON p.source_id=c.source_id
 JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
   AND o.source_type='listening' AND o.segment_key=c.segment_key
   AND o.surface_form=c.surface AND o.resolution_status='unresolved'
 JOIN lexemes l ON l.term=c.lemma AND l.definition_en=c.definition
)
UPDATE lexical_occurrences o
SET lexeme_id=m.lexeme_id,resolution_status='resolved',resolution_source='context_curated'
FROM mapped m WHERE o.id=m.occurrence_id AND o.resolution_status='unresolved';

-- Curated additional 16 non-overlapping phrases for Listening 17–20.
WITH selection(source_id,section,term) AS (VALUES
 ('listening-test-17',1,'adapt to'),('listening-test-17',1,'get back into'),('listening-test-17',1,'secondary school'),
 ('listening-test-17',4,'assembly instructions'),('listening-test-17',4,'business model'),('listening-test-17',4,'piece together'),('listening-test-17',4,'subject to'),
 ('listening-test-18',2,'dominated by'),('listening-test-18',3,'body language'),
 ('listening-test-19',3,'cope with'),('listening-test-19',3,'real eye-opener'),('listening-test-19',3,'managed to'),('listening-test-19',4,'give rise to'),
 ('listening-test-20',2,'packed lunch'),('listening-test-20',2,'on time'),('listening-test-20',4,'treated with preservatives')
), spans AS (
 SELECT p.test_id,s.section,s.term,
 p.payload::jsonb->'sections'->(s.section-1)->>'transcript' body,
 strpos(lower(p.payload::jsonb->'sections'->(s.section-1)->>'transcript'),s.term)-1 pos,l.id lexeme_id,
 count(*) OVER(PARTITION BY p.test_id,s.section,s.term) sense_count
 FROM selection s JOIN listening_packages p ON p.source_id=s.source_id
 JOIN lexemes l ON lower(l.term)=s.term
 AND nullif(trim(l.definition_en),'') IS NOT NULL AND nullif(trim(l.translation_uz),'') IS NOT NULL
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,surface_form,start_char,end_char,
 sentence_text,occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,section,'s'||section::text,
 substring(body from pos+1 for length(term)),pos,pos+length(term),
 substring(body from greatest(1,pos-75) for length(term)+150),
 'phrase',true,lexeme_id,'resolved','context_curated'
FROM spans s
WHERE pos>=0 AND sense_count=1
AND (pos=0 OR substring(body from pos for 1) !~ '[[:alpha:]]')
AND (pos+length(term)>=length(body) OR substring(body from pos+length(term)+1 for 1) !~ '[[:alpha:]]')
AND NOT EXISTS(SELECT 1 FROM lexical_occurrences o WHERE o.listening_test_id=s.test_id
 AND o.section_number=s.section AND o.segment_key='s'||s.section::text
 AND o.start_char<pos+length(term) AND o.end_char>pos)
ON CONFLICT DO NOTHING;

-- Replace placeholder Vocabulary Builder definitions with real, context-aligned examples.
WITH items AS (
 SELECT p.test_id,j.ordinality::int n,j.value item,j.value->>'word' word
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') WITH ORDINALITY j(value,ordinality)
 WHERE p.source_id IN ('listening-test-17','listening-test-18','listening-test-19','listening-test-20')
), chosen AS (
 SELECT i.*,o.sentence_text,l.definition_en,l.translation_uz,l.part_of_speech
 FROM items i JOIN LATERAL (
 SELECT o.sentence_text,o.lexeme_id FROM lexical_occurrences o
 WHERE o.listening_test_id=i.test_id AND o.source_type='listening'
 AND o.segment_key='s'||o.section_number::text AND o.resolution_status='resolved'
 AND lower(o.surface_form)=lower(i.word)
 ORDER BY o.section_number,o.start_char LIMIT 1) o ON true
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE o.sentence_text ILIKE '%'||i.word||'%'
 AND nullif(trim(l.definition_en),'') IS NOT NULL AND nullif(trim(l.translation_uz),'') IS NOT NULL
 AND l.definition_en NOT ILIKE '%important expression from%'
), reconstructed AS (
 SELECT test_id,jsonb_agg(item||jsonb_build_object(
  'def',definition_en,'uz',translation_uz,'pos',coalesce(part_of_speech,item->>'pos'),'ex',sentence_text)
 ORDER BY n) vocabulary,count(*) n
 FROM chosen GROUP BY test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{vocabulary}',r.vocabulary,false)
FROM reconstructed r
WHERE p.test_id=r.test_id AND r.n=32
AND p.payload::jsonb->'vocabulary' IS DISTINCT FROM r.vocabulary;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM listening_packages p CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections') s(value)
     WHERE p.source_id ~ '^listening-test-([1-9]|1[0-9]|20)$')<>80
 THEN RAISE EXCEPTION 'Listening 1–20 must contain 80 transcript Parts';END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id ~ '^listening-test-([1-9]|1[0-9]|20)$'
 AND o.source_type='listening' AND (o.resolution_status<>'resolved' OR o.lexeme_id IS NULL)
 ) THEN RAISE EXCEPTION 'Listening 1–20 still have unresolved lexical occurrences';END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id ~ '^listening-test-([1-9]|1[0-9]|20)$'
 AND o.segment_key='s'||o.section_number::text
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
    from o.start_char+1 for o.end_char-o.start_char) IS DISTINCT FROM o.surface_form
 ) THEN RAISE EXCEPTION 'Transcript occurrence does not match the exact source';END IF;
 IF EXISTS (
 SELECT 1 FROM listening_packages p CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'vocabulary') v(item)
 WHERE p.source_id IN ('listening-test-17','listening-test-18','listening-test-19','listening-test-20')
 AND (v.item->>'def' ILIKE '%important expression from%' OR v.item->>'uz' ILIKE '%kontekst orqali%')
 ) THEN RAISE EXCEPTION 'Listening 17–20 still have placeholder vocabulary';END IF;
END $verify$;
COMMIT;
