-- Targeted test-local meanings for missing, high-frequency words in Listening 1.
-- A contextual English/Uzbek sense is stored in lexemes for Vocabulary saves,
-- and materialized in the test's own contextualMeanings JSON.
-- Original questions, audio, and listening grading remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';

WITH editorial(form,term,pos,definition,uz) AS (
 VALUES
 ('recordings','recording','noun','an audio recording that can be listened to','audioyozuv'),
 ('recording','recording','noun','an audio recording that can be listened to','audioyozuv'),
 ('questions','question','noun','a question asking for an answer','savol'),
 ('question','question','noun','a question asking for an answer','savol'),
 ('instructions','instruction','noun','directions explaining what someone must do','ko‘rsatma'),
 ('instruction','instruction','noun','directions explaining what someone must do','ko‘rsatma'),
 ('booklet','booklet','noun','a small printed book containing examination questions','savollar kitobchasi'),
 ('sections','section','noun','a separate part of a text, test or recording','bo‘lim'),
 ('section','section','noun','a separate part of a text, test or recording','bo‘lim'),
 ('played','play','verb','to make a sound recording audible','audioyozuvni qo‘ymoq'),
 ('play','play','verb','to make a sound recording audible','audioyozuvni qo‘ymoq'),
 ('students','student','noun','a person studying at a school or university','talaba; o‘quvchi'),
 ('student','student','noun','a person studying at a school or university','talaba; o‘quvchi'),
 ('house','house','noun','a building where people live','uy'),
 ('room','room','noun','a separate enclosed space inside a building','xona'),
 ('hear','hear','verb','to perceive a sound with the ears','eshitmoq'),
 ('listen','listen','verb','to pay attention to sounds or speech','tinglamoq'),
 ('listening','listen','verb','to pay attention to sounds or speech','tinglamoq'),
 ('read','read','verb','to look at and understand written words','o‘qimoq'),
 ('write','write','verb','to put words or information in writing','yozmoq'),
 ('written','write','verb','to put words or information in writing','yozmoq'),
 ('minutes','minute','noun','a unit of time equal to sixty seconds','daqiqa'),
 ('minute','minute','noun','a unit of time equal to sixty seconds','daqiqa'),
 ('sheet','sheet','noun','a single piece of paper','qog‘oz varag‘i'),
 ('chance','chance','noun','an opportunity to do something','imkoniyat'),
 ('example','example','noun','an instance that demonstrates something','misol'),
 ('test','test','noun','an examination of knowledge or ability','test; imtihon'),
 ('time','time','noun','the available period in which to do something','vaqt'),
 ('times','time','noun','the available period in which to do something','vaqt'),
 ('transferring','transfer','verb','to move information from one place to another','ma’lumotni ko‘chirmoq'),
 ('transfer','transfer','verb','to move information from one place to another','ma’lumotni ko‘chirmoq'),
 ('work','work','noun','a task or activity that someone is doing','bajarilgan ish'),
 ('check','check','verb','to inspect something to see if it is correct','tekshirmoq'),
 ('answer','answer','verb','to respond to a question','savolga javob bermoq'),
 ('answers','answer','noun','a response given to a question','javob'),
 ('given','give','verb','to provide something to someone','bermoq')
),unique_senses AS(
 SELECT term,pos,definition,uz,
 'v2:'||encode(sha256(convert_to(replace(
 json_build_array(lower(term),lower(pos),lower(definition))::text,', ',','),'UTF8')),'hex') sense_key
 FROM editorial GROUP BY term,pos,definition,uz
)
INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,sense_key,provenance,verification_status)
SELECT term,pos,definition,uz,sense_key,'course_editorial','context_checked'
FROM unique_senses ON CONFLICT (sense_key) DO NOTHING;

WITH src AS (
 SELECT p.test_id,p.payload::jsonb->'sections'->0->>'transcript' body
 FROM listening_packages p WHERE p.source_id='listening-test-1'
),tokens AS (
 SELECT src.*,m.arr[2] surface,lower(m.arr[2]) word,
 (sum(length(m.arr[1])+length(m.arr[2])) OVER (ORDER BY m.ordinality)-length(m.arr[2]))::int pos
 FROM src CROSS JOIN LATERAL regexp_matches(src.body,'([^A-Za-z]*)([A-Za-z]+(?:[''’-][A-Za-z]+)*)','g')
 WITH ORDINALITY m(arr,ordinality)
),mapped AS (
 SELECT t.*,e.term,e.pos AS grammatical_pos,e.definition,
 l.id lexeme_id
 FROM tokens t JOIN (VALUES
 ('recordings','recording','noun','an audio recording that can be listened to'),
 ('recording','recording','noun','an audio recording that can be listened to'),
 ('questions','question','noun','a question asking for an answer'),
 ('question','question','noun','a question asking for an answer'),
 ('instructions','instruction','noun','directions explaining what someone must do'),
 ('instruction','instruction','noun','directions explaining what someone must do'),
 ('booklet','booklet','noun','a small printed book containing examination questions'),
 ('sections','section','noun','a separate part of a text, test or recording'),
 ('section','section','noun','a separate part of a text, test or recording'),
 ('played','play','verb','to make a sound recording audible'),
 ('students','student','noun','a person studying at a school or university'),
 ('house','house','noun','a building where people live'),
 ('room','room','noun','a separate enclosed space inside a building'),
 ('hear','hear','verb','to perceive a sound with the ears'),
 ('listen','listen','verb','to pay attention to sounds or speech'),
 ('listening','listen','verb','to pay attention to sounds or speech'),
 ('read','read','verb','to look at and understand written words'),
 ('write','write','verb','to put words or information in writing'),
 ('written','write','verb','to put words or information in writing'),
 ('minutes','minute','noun','a unit of time equal to sixty seconds'),
 ('minute','minute','noun','a unit of time equal to sixty seconds'),
 ('sheet','sheet','noun','a single piece of paper'),
 ('chance','chance','noun','an opportunity to do something'),
 ('example','example','noun','an instance that demonstrates something'),
 ('test','test','noun','an examination of knowledge or ability'),
 ('time','time','noun','the available period in which to do something'),
 ('transfer','transfer','verb','to move information from one place to another'),
 ('work','work','noun','a task or activity that someone is doing'),
 ('check','check','verb','to inspect something to see if it is correct'),
 ('answer','answer','verb','to respond to a question'),
 ('answers','answer','noun','a response given to a question'),
 ('given','give','verb','to provide something to someone')
 ) e(surface,term,pos,definition) ON e.surface=t.word
 JOIN lexemes l ON l.term=e.term AND l.part_of_speech=e.pos AND l.definition_en=e.definition
 WHERE
 -- Questions and recordings are often repeated; exact position is used.
 (t.word NOT IN ('answer','room','time','test','work')
 OR (t.word='answer' AND (left(t.body,t.pos) ~* '(to|will|should|must)[[:space:]]+$'))
 OR (t.word='room' AND substring(t.body FROM t.pos+length(t.surface)+1 FOR 12) !~* '^[[:space:]]+(for|to)[[:space:]]')
 OR (t.word='time' AND left(t.body,t.pos) !~* '([0-9]+|one|two|three|four|five)[[:space:]]+$')
 OR t.word='test'
 OR t.word='work')
 AND NOT (t.surface ~ '^[A-Z][a-z]+$' AND t.word NOT IN ('recordings','sections','write'))
 AND NOT EXISTS (
 SELECT 1 FROM lexical_occurrences o
 WHERE o.listening_test_id=t.test_id AND o.segment_key='s1'
 AND o.start_char<t.pos+length(t.surface) AND o.end_char>t.pos
 )
)
INSERT INTO lexical_occurrences(
 source_type,listening_test_id,section_number,segment_key,surface_form,
 start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary,
 lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,1,'s1',surface,pos,pos+length(surface),
 substring(body FROM greatest(1,pos-75) FOR length(surface)+150),
 'word',true,lexeme_id,'resolved','curated_test1_context'
FROM mapped
WHERE substring(body FROM pos+1 FOR length(surface))=surface
ON CONFLICT DO NOTHING;

WITH grouped AS (
 SELECT p.test_id,jsonb_agg(jsonb_build_object(
 'part',o.section_number,'start',o.start_char,'end',o.end_char,
 'surface',o.surface_form,'occurrenceId',o.id::text,
 'definitionEn',l.definition_en,'translationUz',l.translation_uz,
 'partOfSpeech',l.part_of_speech
 ) ORDER BY o.section_number,o.start_char,o.end_char) meanings
 FROM listening_packages p JOIN lexical_occurrences o ON o.listening_test_id=p.test_id
 JOIN lexemes l ON l.id=o.lexeme_id
 WHERE p.source_id='listening-test-1' AND o.source_type='listening'
 AND o.segment_key='s'||o.section_number::text AND o.resolution_status='resolved'
 AND nullif(trim(l.definition_en),'') IS NOT NULL
 AND nullif(trim(l.translation_uz),'') IS NOT NULL
 GROUP BY p.test_id
)
UPDATE listening_packages p
SET payload=jsonb_set(p.payload::jsonb,'{contextualMeanings}',g.meanings,true)
FROM grouped g WHERE p.test_id=g.test_id
AND p.payload::jsonb->'contextualMeanings' IS DISTINCT FROM g.meanings;
COMMIT;