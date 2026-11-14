-- Preserve the curated longest-match occurrence in Test 5 Passage 2.
-- Remove one unsaved, redundant nested "disruption" span.
DO $repair$
DECLARE
  v_bad uuid := '2cc2ca06-7547-4fbd-a3f2-3880dd31a762'::uuid;
  v_long uuid := 'd0d0c793-e786-40af-9d94-dc5a3b6bd7cb'::uuid;
  v_record record;
BEGIN
  PERFORM pg_advisory_xact_lock(11061401);
  SELECT p.id,p.body_text,o.start_char,o.end_char,o.surface_form
    INTO v_record FROM reading_passages p JOIN lexical_occurrences o ON o.passage_id=p.id
    WHERE p.test_no=5 AND p.passage_no=2 AND o.id=v_bad;
  IF NOT FOUND THEN RETURN; END IF;

  IF encode(extensions.digest(v_record.body_text,'sha256'),'hex')
       <> '86c59557f74d9bca757ecaa5998788e3c069884e8645976bd4746c5d97656018'
     OR v_record.surface_form <> 'disruption'
     OR v_record.start_char <> 2119
     OR v_record.end_char <> 2129 THEN
    RAISE EXCEPTION 'Legacy reading span changed: %',v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM user_vocabulary_contexts WHERE occurrence_id=v_bad) THEN
    RAISE EXCEPTION 'Cannot remove saved occurrence: %',v_bad;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM lexical_occurrences o
    WHERE o.id=v_long AND o.passage_id=v_record.id
      AND o.start_char <= v_record.start_char
      AND o.end_char >= v_record.end_char
      AND o.end_char-o.start_char > v_record.end_char-v_record.start_char
  ) THEN
    RAISE EXCEPTION 'Containing phrase missing, refusing cleanup';
  END IF;
  DELETE FROM lexical_occurrences WHERE id=v_bad;
END
$repair$;
