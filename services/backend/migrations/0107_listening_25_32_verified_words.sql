-- Listening Tests 25-32: materialize verified, uniquely translated
-- content words in their original transcript. No live dictionary lookup on click.
-- Safe to repeat: exact offsets, no overlap, preserve audio/questions/user saves.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

WITH source AS (
 SELECT p.source_id,p.test_id,j.ordinality::int part,j.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections') WITH ORDINALITY j(value,ordinality)
 WHERE p.source_id IN ('listening-test-25','listening-test-26','listening-test-27','listening-test-28','listening-test-29','listening-test-30','listening-test-31','listening-test-32')
), tokens AS (
 SELECT s.*,m.arr[1] surface,lower(m.arr[1]) word,
 row_number() OVER (PARTITION BY s.test_id,s.part,lower(m.arr[1]) ORDER BY m.ordinality)::int word_n
 FROM source s CROSS JOIN LATERAL regexp_matches(
 s.body,'([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g'
 ) WITH ORDINALITY m(arr,ordinality)
), eligible AS (
 SELECT lower(l.term) term,min(l.id::text)::uuid lexeme_id
 FROM lexemes l
 WHERE l.verification_status IN ('verified','context_checked')
 AND l.part_of_speech IN ('noun','adjective','verb','adverb')
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 AND l.definition_en NOT ILIKE '%important expression%'
 GROUP BY lower(l.term)
 HAVING count(DISTINCT lower(trim(l.translation_uz)))=1
 AND count(DISTINCT lower(trim(l.part_of_speech)))=1
), matches AS (
 SELECT t.*,e.lexeme_id,
 regexp_instr(t.body,'\m'||t.word||'\M',1,t.word_n,0,'i')-1 cp_start
 FROM tokens t JOIN eligible e ON e.term=t.word
 WHERE length(t.word)>=3
 AND t.word NOT IN ('a','an','the','and','or','but','nor','so','yet','of','to','in','on','at','by','for','from','with','into','onto','about','as','than','that','this','these','those','it','its','is','are','was','were','be','been','am','do','does','did','have','has','had','i','you','he','she','we','they','me','him','her','us','them','my','your','his','our','their','not','no','if','then','there','here','what','which','who','whom','whose','will','would','can','could','shall','should','may','might','must','cannot','january','february','march','april','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday')
 AND t.surface !~ '^[A-Z]{2,}$'
), offsets AS (
 SELECT m.*,m.cp_start+regexp_count(left(m.body,m.cp_start),'[𐀀-􏿿]') start_utf16
 FROM matches m WHERE m.cp_start>=0
), safe AS (
 SELECT o.* FROM offsets o
 WHERE substring(o.body FROM o.cp_start+1 FOR length(o.surface))=o.surface
 -- Keep names and speaker labels out of the vocabulary projection.
 AND substring(o.body FROM o.cp_start+length(o.surface)+1 FOR 1)<>':'
 AND (
    o.surface ~ '^[a-z]'
    OR (o.surface ~ '^[A-Z][a-z]+$' AND
        (o.cp_start=0 OR right(rtrim(left(o.body,o.cp_start)),1) IN ('.','!','?',':'))
        AND NOT EXISTS (SELECT 1 FROM lexemes l WHERE l.id=o.lexeme_id
                        AND l.part_of_speech='noun'))
 )
 AND NOT EXISTS (
    SELECT 1 FROM lexical_occurrences old
    WHERE old.listening_test_id=o.test_id AND old.section_number=o.part
      AND old.segment_key='s'||o.part::text
      AND old.start_char<o.start_utf16+length(o.surface)
      AND old.end_char>o.start_utf16
 )
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,surface_form,
 start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary,
 lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,surface,
 start_utf16,start_utf16+length(surface),
 substring(body FROM greatest(1,cp_start-100) FOR length(surface)+200),
 'word',true,lexeme_id,'resolved','verified_test_local_word'
FROM safe
ON CONFLICT DO NOTHING;

-- A test owns its meanings. Refresh its embedded snapshot after each batch.
WITH source_bound AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
  'part',o.section_number,'start',o.start_char,'end',o.end_char,
  'surface',o.surface_form,'occurrenceId',o.id::text,
  'definitionEn',l.definition_en,'translationUz',l.translation_uz,
  'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) meanings
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id IN ('listening-test-25','listening-test-26','listening-test-27','listening-test-28','listening-test-29','listening-test-30','listening-test-31','listening-test-32')
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',b.meanings,true)
FROM source_bound b WHERE p.test_id=b.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM b.meanings;

DO $verify$
BEGIN
 IF EXISTS(
  SELECT 1 FROM lexical_occurrences o
  JOIN listening_packages p ON p.test_id=o.listening_test_id
  WHERE p.source_id IN ('listening-test-25','listening-test-26','listening-test-27','listening-test-28','listening-test-29','listening-test-30','listening-test-31','listening-test-32') AND o.source_type='listening'
  AND o.segment_key='s'||o.section_number::text
  AND (o.resolution_status<>'resolved' OR o.lexeme_id IS NULL)
 ) THEN RAISE EXCEPTION 'Unresolved Listening occurrence';END IF;
END $verify$;
COMMIT;
