-- Repair legacy General Reading Test 4 spans after contextual enrichment.
-- No learner-owned vocabulary context may be deleted.
-- The SHA-256 source text checks prevent writing offsets to changed passages.
DO $repair$
DECLARE
  v_passage record;
  v_fix record;
  v_row record;
  v_existing integer;
  v_relocated integer := 0;
  v_deduplicated integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(11061401);
  FOR v_passage IN SELECT p.id,p.passage_no,p.body_text FROM reading_passages p WHERE p.test_no=4 LOOP
    IF encode(extensions.digest(v_passage.body_text,'sha256'),'hex') <> CASE v_passage.passage_no
       WHEN 1 THEN '5626d877355a0e2e0cc6ea8e52fb9b6b210470d00eb63b8525ff771661326c71'
       WHEN 2 THEN '33376b2a24d307970aee77859c3626abfd9b1903532c5f8499d6793139fc07c6'
       WHEN 3 THEN '0dea39927145308aa6989ce628a3547de74dbd2bd39b9ddb35c864a7bacc6925'
       ELSE '' END THEN
      RAISE EXCEPTION 'Source checksum changed, aborting correction for Test 4 Passage %',v_passage.passage_no;
    END IF;
  END LOOP;
  FOR v_fix IN SELECT * FROM (VALUES
    ('9a3479c1-7380-447b-bf44-668486582191'::uuid, 229, 2345, 'beak'),
    ('cdb7e99e-e97b-439b-90f3-e9302d1b26f9'::uuid, 257, 2373, 'beak'),
    ('5314b46b-ca58-45c5-9b49-18ca3e50ff51'::uuid,100, 871, 'status quo'),
    ('2f88bddb-54c0-4939-b044-32af839d634b'::uuid,181, 2639, 'niches'),
    ('13912af1-fdcd-4889-8e3f-e2f147c63938'::uuid,302,3943, 'cross-docking')
  ) AS t(id,old_start,new_start,surface) LOOP
    SELECT o.id,o.passage_id,o.start_char,o.end_char,o.surface_form,p.body_text
      INTO v_row FROM lexical_occurrences o JOIN reading_passages p ON p.id=o.passage_id
      WHERE o.id=v_fix.id AND p.test_no=4 FOR UPDATE OF o;
    IF NOT FOUND OR lower(v_row.surface_form)<>lower(v_fix.surface)
       OR v_row.start_char NOT IN (v_fix.old_start,v_fix.new_start)
       OR lower(substr(v_row.body_text,v_fix.new_start+1,length(v_fix.surface)))<>lower(v_fix.surface) THEN
      RAISE EXCEPTION 'Unexpected legacy position or source for %',v_fix.id;
    END IF;
    IF v_row.start_char=v_fix.new_start THEN CONTINUE; END IF;
    SELECT count(*) INTO v_existing FROM lexical_occurrences o
      WHERE o.passage_id=v_row.passage_id AND o.id<>v_fix.id
        AND o.start_char<v_fix.new_start+length(v_fix.surface)
        AND o.end_char>v_fix.new_start;
    IF v_existing<>0 THEN RAISE EXCEPTION 'Overlap at repaired position %',v_fix.id; END IF;
    UPDATE lexical_occurrences SET start_char=v_fix.new_start,
      end_char=v_fix.new_start+length(v_fix.surface),
      sentence_text=substr(v_row.body_text,greatest(1,v_fix.new_start-120),260)
      WHERE id=v_fix.id;
    v_relocated:=v_relocated+1;
  END LOOP;
  -- Older overlapping short spans are redundant because the longer exact
  -- contextual expressions remain linked, and no learner saved their IDs.
  FOR v_fix IN SELECT * FROM (VALUES
    ('1471284a-f86f-4632-a3f0-479ffae51042'::uuid,'blockbuster',484),
    ('7d1f265f-3198-41ff-bb72-f79d597e6419'::uuid,'innovations',1657),
    ('d9bdac40-fd3d-4b32-9b1c-42b23b5e38cd'::uuid,'innovations',1945),
    ('5d2a1643-f171-4dd8-9310-a664146f43a8'::uuid,'innovations',3774),
    ('c1a1cc6c-20ac-4864-942d-cda1900f013c'::uuid,'innovations',4220),
    ('e9fb03a3-6458-4816-a08f-ef9711738ca4'::uuid,'innovations',4852),
    ('6f97de49-f93e-427d-a7dd-0fe173fa1664'::uuid,'innovations',5224)
  ) AS t(id,surface,old_start) LOOP
    SELECT o.id,o.passage_id,o.start_char,o.surface_form,p.body_text
      INTO v_row FROM lexical_occurrences o JOIN reading_passages p ON p.id=o.passage_id
      WHERE o.id=v_fix.id AND p.test_no=4 FOR UPDATE OF o;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_row.start_char<>v_fix.old_start OR lower(v_row.surface_form)<>v_fix.surface THEN
      RAISE EXCEPTION 'Legacy duplicate changed: %',v_fix.id;
    END IF;
    IF EXISTS(SELECT 1 FROM user_vocabulary_contexts u WHERE u.occurrence_id=v_fix.id) THEN
      RAISE EXCEPTION 'Learner saved this occurrence: %',v_fix.id;
    END IF;
    IF v_fix.surface='blockbuster' THEN
      IF NOT EXISTS(SELECT 1 FROM lexical_occurrences o
        WHERE o.passage_id=v_row.passage_id AND o.id<>v_fix.id
          AND lower(o.surface_form)='blockbuster'
          AND substr(v_row.body_text,o.start_char+1,o.end_char-o.start_char) ILIKE 'blockbuster') THEN
        RAISE EXCEPTION 'No correctly linked blockbuster remains';
      END IF;
    ELSE
      IF NOT EXISTS(SELECT 1 FROM lexical_occurrences o
        WHERE o.passage_id=v_row.passage_id AND o.id<>v_fix.id
        AND o.start_char<v_fix.old_start+length(v_fix.surface)
        AND o.end_char>v_fix.old_start
        AND o.end_char-o.start_char>length(v_fix.surface)) THEN
        RAISE EXCEPTION 'No containing multi-word expression remains for %',v_fix.id;
      END IF;
    END IF;
    DELETE FROM lexical_occurrences WHERE id=v_fix.id;
    v_deduplicated:=v_deduplicated+1;
  END LOOP;
  RAISE NOTICE 'Legacy spans fixed %, redundant overlapping spans removed %',
    v_relocated,v_deduplicated;
END
$repair$;