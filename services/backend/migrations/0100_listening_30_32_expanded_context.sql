-- Expand contextual Listening 30–32 coverage with unique, well-defined lexical senses.
-- Terms with multiple dictionary senses, short function words and overlapping spans
-- are excluded rather than assigned an arbitrary translation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

WITH parts AS (
 SELECT p.source_id,p.test_id,j.ordinality::int part,j.value->>'transcript' body
 FROM listening_packages p
 CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'sections') WITH ORDINALITY j(value,ordinality)
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
),lex AS (
 SELECT lower(term) term,min(id::text)::uuid lexeme_id,min(part_of_speech) pos
 FROM lexemes
 WHERE char_length(term) BETWEEN 6 AND 35 AND term ~ '^[A-Za-z][A-Za-z -]*$'
 AND part_of_speech IN ('noun','adjective','verb','noun phrase','verb phrase','phrasal verb','collocation','adjective phrase')
 AND nullif(trim(translation_uz),'') IS NOT NULL AND nullif(trim(definition_en),'') IS NOT NULL
 AND definition_en NOT ILIKE '%important expression%' AND definition_en NOT ILIKE '%expression used in part%'
 AND lower(term) NOT IN (
 'about','after','before','where','there','which','their','these','those','would','could',
 'should','other','every','being','going','thing','things','right','first','still','really',
 'quite','little','great','while','again','think','always','never','often','maybe','might',
 'since','until','under','between','because','through','people','something','someone',
 'anything','everything','another','already','actually','probably','rather','perhaps',
 'however','although','whether','today','tomorrow','yesterday','morning','evening',
 'afternoon','number','numbers','month','months','everybody','friday','monday','sunday',
 'saturday','thursday','tuesday','wednesday','three','several','mother','friend',
 'teacher','problem','minute','period','whole','quickly','usually','normally',
 'important','shopping','outside','living','broken','watch','bring','welcome',
 'happened','listen','different','children','school','student','students',
 'listen to','come on','find out','work out','take up','get back','go back')
 GROUP BY lower(term) HAVING count(*)=1
),matches AS (
 SELECT p.source_id,p.test_id,p.part,p.body,l.term,l.lexeme_id,l.pos,
 regexp_instr(p.body,'(^|[^[:alpha:]])('||l.term||')([^[:alpha:]]|$)',1,n.n,0,'i',2)-1 start_char
 FROM parts p JOIN lex l ON strpos(lower(p.body),l.term)>0
 CROSS JOIN LATERAL generate_series(1,5) n(n)
),valid AS (
 SELECT m.* FROM matches m WHERE start_char>=0
 AND NOT EXISTS(
 SELECT 1 FROM lexical_occurrences o WHERE o.listening_test_id=m.test_id
 AND o.section_number=m.part AND o.segment_key='s'||m.part::text
 AND o.start_char<m.start_char+length(m.term) AND o.end_char>m.start_char)
),winner AS (
 SELECT a.* FROM valid a WHERE NOT EXISTS(
 SELECT 1 FROM valid b
 WHERE b.test_id=a.test_id AND b.part=a.part
 AND (b.start_char<>a.start_char OR b.term<>a.term)
 AND b.start_char<a.start_char+length(a.term)
 AND b.start_char+length(b.term)>a.start_char
 AND (length(b.term)>length(a.term) OR (length(b.term)=length(a.term) AND b.term<a.term)))
)
INSERT INTO lexical_occurrences (
 source_type,listening_test_id,section_number,segment_key,
 surface_form,start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary,
 lexeme_id,resolution_status,resolution_source)
SELECT 'listening',test_id,part,'s'||part::text,
 substring(body FROM start_char+1 FOR length(term)),
 start_char,start_char+length(term),
 substring(body FROM greatest(1,start_char-75) FOR length(term)+150),
 CASE WHEN term LIKE '% %' THEN 'phrase' ELSE 'word' END,true,
 lexeme_id,'resolved','unique_context_30_32'
FROM winner ON CONFLICT DO NOTHING;

DO $verify$
DECLARE invalid_count integer;
BEGIN
 SELECT count(*) INTO invalid_count
 FROM lexical_occurrences o JOIN listening_packages p ON p.test_id=o.listening_test_id
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
 AND o.source_type='listening' AND o.segment_key='s'||o.section_number::text
 AND (o.resolution_status<>'resolved' OR o.lexeme_id IS NULL
 OR substring(p.payload::jsonb->'sections'->(o.section_number-1)->>'transcript'
 FROM o.start_char+1 FOR o.end_char-o.start_char) IS DISTINCT FROM o.surface_form);
 IF invalid_count<>0 THEN RAISE EXCEPTION 'Invalid lexical occurrences: %',invalid_count; END IF;
 IF EXISTS (
 SELECT 1 FROM lexical_occurrences a JOIN lexical_occurrences b
 ON a.listening_test_id=b.listening_test_id AND a.section_number=b.section_number
 AND a.segment_key=b.segment_key AND a.id<b.id
 AND a.start_char<b.end_char AND b.start_char<a.end_char
 JOIN listening_packages p ON p.test_id=a.listening_test_id
 WHERE p.source_id IN ('listening-test-30','listening-test-31','listening-test-32')
 AND a.source_type='listening' AND a.segment_key='s'||a.section_number::text
 ) THEN RAISE EXCEPTION 'Overlapping transcript dictionary spans'; END IF;
END $verify$;
COMMIT;
