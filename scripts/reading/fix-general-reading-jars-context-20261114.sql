-- Context-specific meaning of "jars" in passage 001 (A brief history of canned food).
-- This is the only meaning offered at all three literal positions of the word.
-- Idempotent and SHA256-guarded. Existing saved user vocabulary is not touched.
DO $jars$
DECLARE
    v_passage uuid := '8e89c71f-a866-4727-bbfe-460218ba9d08'::uuid;
    v_body text;
    v_unit uuid;
    v_lexeme uuid;
    v_sense_key text;
    v_index integer;
    v_start integer;
    v_existing integer;
BEGIN
    PERFORM pg_advisory_xact_lock(11061401);
    SELECT body_text INTO STRICT v_body FROM reading_passages WHERE id=v_passage
        AND test_no=1 AND passage_no=1;
    IF encode(extensions.digest(v_body,'sha256'),'hex')
        <> '400a46244f6309060b50c44d8cade0cf48c1aeaa920db936817eec7e42618ce8'
        OR regexp_count(v_body,'(?i)(?<![[:alpha:]])jars(?![[:alpha:]])') <> 3 THEN
        RAISE EXCEPTION 'Passage 001 source mismatch; refusing contextual jars migration';
    END IF;

    INSERT INTO lexical_units
      (language,lemma,lemma_norm,part_of_speech,lexical_type,is_function_word,provenance)
      VALUES ('en','jars','jars','noun','word',false,'reading_context')
      ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type) DO NOTHING;
    SELECT id INTO STRICT v_unit FROM lexical_units WHERE language='en'
      AND lemma_norm='jars' AND part_of_speech='noun' AND lexical_type='word';
    INSERT INTO lexical_unit_forms(lexical_unit_id,form,form_norm,form_type)
      VALUES(v_unit,'jars','jars','lemma')
      ON CONFLICT(lexical_unit_id,form_norm) DO NOTHING;

    v_sense_key := 'v2:' || encode(extensions.digest(
       json_build_array('jars','noun',
          'a cylindrical glass container used for storing or preserving food')::text,
       'sha256'),'hex');
    INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,
      lexical_unit_id,sense_key,provenance,verification_status,import_batch)
    VALUES ('jars','noun',
      'a cylindrical glass container used for storing or preserving food',
      'shisha bankalar',v_unit,v_sense_key,'reading_context',
      'context_checked','20261114-passages-001-018')
    ON CONFLICT(sense_key) DO NOTHING;
    SELECT id INTO STRICT v_lexeme FROM lexemes WHERE sense_key=v_sense_key;

    FOR v_index IN 1..3 LOOP
       v_start := regexp_instr(v_body,'(?i)(?<![[:alpha:]])jars(?![[:alpha:]])',1,v_index)-1;
       IF v_start < 0 OR lower(substr(v_body,v_start+1,4)) <> 'jars' THEN
           RAISE EXCEPTION 'Invalid source offset for jars occurrence %',v_index;
       END IF;
       SELECT count(*) INTO v_existing FROM lexical_occurrences o
         WHERE o.passage_id=v_passage
           AND o.start_char < v_start+4 AND o.end_char>v_start
           AND NOT (o.start_char=v_start AND o.end_char=v_start+4
             AND o.lexeme_id=v_lexeme);
       IF v_existing<>0 THEN
           RAISE EXCEPTION 'Existing contextual meaning overlaps jars occurrence %',v_index;
       END IF;
       INSERT INTO lexical_occurrences(source_type,passage_id,start_char,end_char,
           surface_form,lexeme_id,lexical_unit_id,resolution_status,
           resolution_source,sentence_text,occurrence_type,is_target_vocabulary)
       VALUES('reading',v_passage,v_start,v_start+4,substr(v_body,v_start+1,4),
           v_lexeme,v_unit,'resolved','context_editorial',
           substr(v_body,greatest(1,v_start-120),260),'vocabulary',true)
       ON CONFLICT(passage_id,start_char,end_char) DO NOTHING;
    END LOOP;
END
$jars$;
