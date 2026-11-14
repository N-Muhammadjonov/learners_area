-- Complete the source-local positions of stable articles and conjunctions.
-- This deliberately does NOT guess polysemous vocabulary senses. It is safe
-- for all canonical Reading passages and leaves existing multiword spans intact.
-- Exact source offsets, learner-owned vocabulary IDs and old highlights remain unchanged.
DO $reading_grammar$
DECLARE
  v_entry record;
  v_unit_id uuid;
  v_lexeme_id uuid;
  v_sense_key text;
  v_added integer;
  v_total integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(11061401);
  FOR v_entry IN
    SELECT * FROM (VALUES
      ('the','article','aniq artikl (o‘zbekchada alohida tarjima qilinmaydi)','definite article marking a known or specific noun'),
      ('a','article','bir (noaniq artikl)','indefinite article before a singular countable noun'),
      ('an','article','bir (noaniq artikl)','indefinite article used before a vowel sound'),
      ('and','conjunction','va','connects words, phrases, or clauses'),
      ('or','conjunction','yoki','presents a choice or alternative'),
      ('but','conjunction','ammo, lekin','introduces an opposing or contrasting idea'),
      ('if','conjunction','agar','introduces a condition'),
      ('because','conjunction','chunki','introduces the reason for an event')
    ) AS t(surface,pos,uz,definition)
  LOOP
    INSERT INTO lexical_units(
      language,lemma,lemma_norm,part_of_speech,lexical_type,is_function_word,provenance
    ) VALUES('en',v_entry.surface,v_entry.surface,v_entry.pos,'word',true,'reading_context')
    ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type) DO NOTHING;
    SELECT id INTO STRICT v_unit_id FROM lexical_units
     WHERE language='en' AND lemma_norm=v_entry.surface
       AND part_of_speech=v_entry.pos AND lexical_type='word';
    INSERT INTO lexical_unit_forms(lexical_unit_id,form,form_norm,form_type)
      VALUES(v_unit_id,v_entry.surface,v_entry.surface,'lemma')
      ON CONFLICT(lexical_unit_id,form_norm) DO NOTHING;

    v_sense_key := 'v2:' || encode(extensions.digest(
       replace(json_build_array(v_entry.surface,v_entry.pos,lower(trim(v_entry.definition)))::text,
       '", "', '","'),'sha256'),'hex');
    SELECT id INTO v_lexeme_id FROM lexemes WHERE sense_key=v_sense_key;
    IF v_lexeme_id IS NULL THEN
      INSERT INTO lexemes(
        term,part_of_speech,definition_en,translation_uz,lexical_unit_id,
        sense_key,provenance,verification_status,import_batch
      ) VALUES(
        v_entry.surface,v_entry.pos,v_entry.definition,v_entry.uz,v_unit_id,
        v_sense_key,'reading_context','context_checked','20261114-reading-function-words'
      ) ON CONFLICT(sense_key) DO NOTHING
      RETURNING id INTO v_lexeme_id;
      IF v_lexeme_id IS NULL THEN
        SELECT id INTO STRICT v_lexeme_id FROM lexemes WHERE sense_key=v_sense_key;
      END IF;
    END IF;

    WITH candidates AS (
      SELECT p.id passage_id,p.body_text,
        regexp_instr(p.body_text,
          '(?i)(?<![[:alpha:]])'||v_entry.surface||'(?![[:alpha:]])',1,number.n)-1 start_char
      FROM reading_passages p
      CROSS JOIN LATERAL generate_series(1,
         regexp_count(p.body_text,
           '(?i)(?<![[:alpha:]])'||v_entry.surface||'(?![[:alpha:]])')) number(n)
      WHERE p.body_text IS NOT NULL
    )
    INSERT INTO lexical_occurrences(
      source_type,passage_id,start_char,end_char,surface_form,lexeme_id,
      lexical_unit_id,resolution_status,resolution_source,sentence_text,
      occurrence_type,is_target_vocabulary
    )
    SELECT 'reading',c.passage_id,c.start_char,c.start_char+length(v_entry.surface),
      substr(c.body_text,c.start_char+1,length(v_entry.surface)),
      v_lexeme_id,v_unit_id,'resolved','context_editorial',
      substr(c.body_text,greatest(1,c.start_char-120),260),'vocabulary',true
    FROM candidates c
    WHERE c.start_char>=0
      AND lower(substr(c.body_text,c.start_char+1,length(v_entry.surface)))=v_entry.surface
      AND NOT EXISTS(
        SELECT 1 FROM lexical_occurrences o
         WHERE o.passage_id=c.passage_id
           AND o.start_char<c.start_char+length(v_entry.surface)
           AND o.end_char>c.start_char
      )
    ON CONFLICT(passage_id,start_char,end_char) DO NOTHING;
    GET DIAGNOSTICS v_added=ROW_COUNT;
    v_total:=v_total+v_added;
  END LOOP;
  RAISE NOTICE 'Reading function-word occurrence links inserted: %',v_total;
END
$reading_grammar$;
