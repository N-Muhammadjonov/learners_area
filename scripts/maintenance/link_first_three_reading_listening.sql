-- Safe, idempotent dictionary association for General Reading Test 1 (passages 1-3)
-- and Listening Test 1 (Script Completion sections 1-3).
-- Only a unique previously verified dictionary lexeme is ever assigned;
-- ambiguous/missing senses are left to the existing context-sensitive dictionary lookup.
-- Never change pre-existing occurrences, answers, user vocabulary or passages.
BEGIN;
WITH target_sources AS (
  SELECT 'reading'::text AS source_type, p.id AS source_id, 1::int AS part, p.body_text AS body
    FROM general_reading_sets s
    JOIN general_reading_passages g ON g.set_id=s.id
    JOIN reading_passages p ON p.id=g.passage_id
   WHERE s.title='Reading Test 1' AND g.reading_mode='general_practice'
     AND g.passage_no BETWEEN 1 AND 3
  UNION ALL
  SELECT 'listening', p.test_id, s.n::int, s.part->>'transcript'
    FROM listening_packages p
    CROSS JOIN LATERAL jsonb_array_elements(p.payload->'sections')
       WITH ORDINALITY AS s(part,n)
   WHERE p.source_id='listening-test-1' AND s.n BETWEEN 1 AND 3
), tokens AS (
  SELECT s.source_type,s.source_id,s.part,s.body,
         regexp_substr(s.body,'[A-Za-z]{2,}',1,n.seq) AS surface,
         regexp_instr(s.body,'[A-Za-z]{2,}',1,n.seq)-1 AS start_char
    FROM target_sources s
    CROSS JOIN LATERAL generate_series(1,regexp_count(s.body,'[A-Za-z]{2,}')) AS n(seq)
), unique_lexemes AS (
  SELECT lower(l.term) AS term,min(l.id::text)::uuid AS id
    FROM lexemes l GROUP BY lower(l.term) HAVING count(*)=1
), candidates AS (
  SELECT t.source_type,t.source_id,t.part,t.body,t.surface,t.start_char,
         u.id AS lexeme_id,l.lexical_unit_id
    FROM tokens t JOIN unique_lexemes u ON u.term=lower(t.surface)
    JOIN lexemes l ON l.id=u.id
   WHERE l.verification_status='verified' AND nullif(trim(l.translation_uz),'') IS NOT NULL
     AND lower(t.surface) NOT IN (
      'i','you','he','she','it','we','they','me','him','her','us','them',
      'my','your','his','its','our','their','a','an','the','am','is','are',
      'was','were','be','been','being','do','does','did','to','of','in',
      'on','at','and','or','but','if','as','by','for','with','this','that',
      'these','those','there','here','what','which','who','when','where',
      'why','how','not','no','yes','then','than','very','just','also',
      'one','two','three','many','some','any','all','each','every','other',
      'more','most','less','few','much','can','could','would','should',
      'will','shall','may','might','must','have','has','had','having',
      'were','was','did','does','done','get','got','right','make','made',
      'take','took','say','said','see','seen','go','went','come','came',
      'know','known','think','thought','like','only','even','still',
      'before','after','since','while','until','because','about','into',
      'from','over','under','around','through','between','among','during',
      'up','down','out','off','back','again','too','so','such','both',
      'either','neither','ours','theirs','somewhere','anything','someone')
), eligible AS (
  SELECT c.* FROM candidates c
   WHERE c.start_char>=0 AND c.start_char+length(c.surface)<=length(c.body)
     AND substr(c.body,c.start_char+1,length(c.surface))=c.surface
     AND NOT EXISTS (
       SELECT 1 FROM lexical_occurrences o
       WHERE (c.source_type='reading' AND o.passage_id=c.source_id
               OR c.source_type='listening' AND o.listening_test_id=c.source_id
                 AND o.section_number=c.part AND o.segment_key='s'||c.part)
         AND o.start_char<c.start_char+length(c.surface) AND o.end_char>c.start_char
     )
)
INSERT INTO lexical_occurrences (
 source_type,passage_id,listening_test_id,section_number,segment_key,
 lexeme_id,lexical_unit_id,surface_form,start_char,end_char,
 sentence_text,occurrence_type,is_target_vocabulary,
 resolution_status,resolution_source
)
SELECT c.source_type,
 CASE WHEN c.source_type='reading' THEN c.source_id END,
 CASE WHEN c.source_type='listening' THEN c.source_id END,
 CASE WHEN c.source_type='listening' THEN c.part END,
 CASE WHEN c.source_type='listening' THEN 's'||c.part END,
 c.lexeme_id,c.lexical_unit_id,c.surface,c.start_char,c.start_char+length(c.surface),
 substring(c.body FROM greatest(1,c.start_char-110) FOR 240),
 'token',true,'resolved','unique_verified_dictionary'
FROM eligible c
ON CONFLICT DO NOTHING;
COMMIT;
