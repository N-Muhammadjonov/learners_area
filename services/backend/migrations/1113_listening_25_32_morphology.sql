-- Exact one-sense morphology coverage. Each Listening test is an independent transaction.

-- TEST START 25
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-25'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-25'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-25'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 25'; END IF;
END $check$;
COMMIT;
-- TEST END 25


-- TEST START 26
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-26'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-26'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-26'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 26'; END IF;
END $check$;
COMMIT;
-- TEST END 26


-- TEST START 27
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-27'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-27'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-27'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 27'; END IF;
END $check$;
COMMIT;
-- TEST END 27


-- TEST START 28
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-28'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-28'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-28'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 28'; END IF;
END $check$;
COMMIT;
-- TEST END 28


-- TEST START 29
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-29'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-29'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-29'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 29'; END IF;
END $check$;
COMMIT;
-- TEST END 29


-- TEST START 30
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-30'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-30'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-30'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 30'; END IF;
END $check$;
COMMIT;
-- TEST END 30


-- TEST START 31
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-31'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-31'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-31'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 31'; END IF;
END $check$;
COMMIT;
-- TEST END 31


-- TEST START 32
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
WITH source AS(
 SELECT p.test_id,z.ordinality::int part,z.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections')
 WITH ORDINALITY z(value,ordinality)
 WHERE p.source_id='listening-test-32'
),tokens AS(
 SELECT s.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int cp_start,
 (sum(length(m.arr[1])+length(m.arr[2])+
 regexp_count(m.arr[1]||m.arr[2],'[𐀀-􏿿]')) OVER(
 PARTITION BY s.test_id,s.part ORDER BY m.ordinality ROWS UNBOUNDED PRECEDING
 )-length(m.arr[2]))::int start_utf16
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
),forms AS (
 SELECT t.*,root.lemma,root.rank,root.expected_pos FROM tokens t
 CROSS JOIN LATERAL(VALUES
 (t.word,0,null::text),
 (CASE WHEN length(t.word)>=5 AND right(t.word,1)='s'
 AND right(t.word,2) NOT IN ('ss','us','is')
 THEN left(t.word,length(t.word)-1) END,1,'noun'),
 (CASE WHEN right(t.word,3)='ies' THEN left(t.word,length(t.word)-3)||'y' END,1,'noun'),
 (CASE WHEN right(t.word,2)='es' THEN left(t.word,length(t.word)-2) END,2,'noun'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3) END,1,'verb'),
 (CASE WHEN right(t.word,3)='ing' THEN left(t.word,length(t.word)-3)||'e' END,2,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-2) END,1,'verb'),
 (CASE WHEN right(t.word,2)='ed' THEN left(t.word,length(t.word)-1) END,2,'verb')
 ) root(lemma,rank,expected_pos) WHERE root.lemma IS NOT NULL
),unique_senses AS(
 SELECT lower(term) lemma,min(id::text)::uuid lexeme_id,
 min(part_of_speech) pos
 FROM lexemes
 WHERE part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(definition_en),'') IS NOT NULL
 AND nullif(trim(translation_uz),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(term)
 HAVING count(DISTINCT (part_of_speech,definition_en,translation_uz))=1
),matched AS(
 SELECT f.*,u.lexeme_id,
 row_number() OVER(PARTITION BY f.test_id,f.part,f.cp_start
 ORDER BY f.rank,f.lemma) rn,
 count(*) OVER(PARTITION BY f.test_id,f.part,f.cp_start,f.rank) competitors
 FROM forms f JOIN unique_senses u ON u.lemma=f.lemma
 WHERE (f.expected_pos IS NULL OR f.expected_pos=u.pos)
 AND length(f.word)>2
 AND f.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','being','having','someone','something','anything','everything','nothing','another','enough','maybe','perhaps','some','any','every','none','else','whatever','whenever','wherever','whichever','each','few','many','several','one','two','three','four','five','six','seven','eight','nine','ten','first','second','third','fourth','fifth','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND f.surface !~ '^[A-Z]{2,}$'
 AND (f.surface ~ '^[a-z]' OR f.cp_start=0
 OR left(f.body,f.cp_start) ~ '[.!?][[:space:]]+$')
 AND f.cp_start>=0
 AND substring(f.body FROM f.cp_start+1 FOR length(f.surface))=f.surface
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=f.test_id
 AND o.segment_key='s'||f.part::text
 AND o.start_char<f.start_utf16+length(f.surface)
 AND o.end_char>f.start_utf16
 )
),eligible AS (
 SELECT * FROM matched WHERE rn=1 AND competitors=1
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,
 occurrence_type,is_target_vocabulary,lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 surface,start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-85) FOR length(surface)+170),
 'word',true,lexeme_id,'resolved','inflected_context'
FROM eligible ON CONFLICT DO NOTHING;

WITH embedded AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) senses
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-32'
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',e.senses,true)
FROM embedded e WHERE p.test_id=e.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM e.senses;

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM lexical_occurrences o
 JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id='listening-test-32'
 AND o.resolution_source='inflected_context'
 AND substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form)
 THEN RAISE EXCEPTION 'Lexical source offset did not match for Test 32'; END IF;
END $check$;
COMMIT;
-- TEST END 32
