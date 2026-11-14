-- General Reading 001 additional context: reviewed contextual vocabulary and existing-row repairs.
-- Idempotent. Source-SHA guarded; only the three canonical passages are touched.
-- Previous learner vocabulary, SRS state and saved source IDs remain unchanged.
-- Requires: public reading_passages, lexical_occurrences, lexemes, lexical_units,
-- lexical_unit_forms, and extensions.digest.
DO $executor$
DECLARE
  v_plan jsonb := $plan${"version":1,"release":"reading-001-additional-vocabulary-20261114","repository":"N-Muhammadjonov/learners_area","passages":{"1-1":"400a46244f6309060b50c44d8cade0cf48c1aeaa920db936817eec7e42618ce8"},"terms":[{"testNo":1,"passageNo":1,"surface":"canning","partOfSpeech":"noun","translationUz":"konservalash","definitionEn":"the process of preserving food in sealed containers"},{"testNo":1,"passageNo":1,"surface":"canned","partOfSpeech":"adjective","translationUz":"konservalangan","definitionEn":"preserved and sealed inside a container"},{"testNo":1,"passageNo":1,"surface":"companies","partOfSpeech":"noun","translationUz":"kompaniyalar","definitionEn":"commercial organisations"},{"testNo":1,"passageNo":1,"surface":"cans","partOfSpeech":"noun","translationUz":"konserva bankalari","definitionEn":"metal containers used for preserved food"},{"testNo":1,"passageNo":1,"surface":"color","partOfSpeech":"noun","translationUz":"rang","definitionEn":"the appearance of an object depending on reflected light"},{"testNo":1,"passageNo":1,"surface":"still","partOfSpeech":"adverb","translationUz":"hanuz","definitionEn":"continuing to happen or remain true"},{"testNo":1,"passageNo":1,"surface":"used","partOfSpeech":"verb","translationUz":"qo‘llanilgan","definitionEn":"employed for a particular purpose"},{"testNo":1,"passageNo":1,"surface":"aseptic","partOfSpeech":"adjective","translationUz":"mikroblardan xoli","definitionEn":"free from disease-causing microorganisms"},{"testNo":1,"passageNo":1,"surface":"container","partOfSpeech":"noun","translationUz":"idish","definitionEn":"a vessel for holding or storing food"},{"testNo":1,"passageNo":1,"surface":"flavor","partOfSpeech":"noun","translationUz":"ta’m","definitionEn":"the taste of food"},{"testNo":1,"passageNo":1,"surface":"glass","partOfSpeech":"noun","translationUz":"shisha","definitionEn":"a transparent material used for jars"},{"testNo":1,"passageNo":1,"surface":"high","partOfSpeech":"adjective","translationUz":"yuqori","definitionEn":"at an elevated level of intensity"},{"testNo":1,"passageNo":1,"surface":"hot","partOfSpeech":"adjective","translationUz":"issiq","definitionEn":"having a high temperature"},{"testNo":1,"passageNo":1,"surface":"kettle","partOfSpeech":"noun","translationUz":"qozon","definitionEn":"a vessel used for cooking"},{"testNo":1,"passageNo":1,"surface":"long","partOfSpeech":"adjective","translationUz":"uzoq","definitionEn":"lasting for a considerable period"},{"testNo":1,"passageNo":1,"surface":"made","partOfSpeech":"verb","translationUz":"tayyorlangan","definitionEn":"produced or prepared"},{"testNo":1,"passageNo":1,"surface":"make","partOfSpeech":"verb","translationUz":"qilmoq","definitionEn":"bring about an intended result"},{"testNo":1,"passageNo":1,"surface":"precise","partOfSpeech":"adjective","translationUz":"aniq","definitionEn":"exact and carefully controlled"},{"testNo":1,"passageNo":1,"surface":"spoiled","partOfSpeech":"adjective","translationUz":"aynigan","definitionEn":"no longer safe or pleasant to eat"},{"testNo":1,"passageNo":1,"surface":"time","partOfSpeech":"noun","translationUz":"vaqt","definitionEn":"a duration in which something happens"},{"testNo":1,"passageNo":1,"surface":"workers","partOfSpeech":"noun","translationUz":"ishchilar","definitionEn":"people employed at a workplace"},{"testNo":1,"passageNo":1,"surface":"addition","partOfSpeech":"noun","translationUz":"qo‘shish","definitionEn":"the act of adding something"},{"testNo":1,"passageNo":1,"surface":"adopted","partOfSpeech":"verb","translationUz":"joriy etilgan","definitionEn":"introduced and put into regular practice"},{"testNo":1,"passageNo":1,"surface":"advanced","partOfSpeech":"adjective","translationUz":"ilg‘or","definitionEn":"using sophisticated modern technology"},{"testNo":1,"passageNo":1,"surface":"also","partOfSpeech":"adverb","translationUz":"shuningdek","definitionEn":"in addition"},{"testNo":1,"passageNo":1,"surface":"alternatives","partOfSpeech":"noun","translationUz":"muqobil variantlar","definitionEn":"other choices that could be used instead"},{"testNo":1,"passageNo":1,"surface":"appeal","partOfSpeech":"noun","translationUz":"joziba","definitionEn":"the quality of being attractive"},{"testNo":1,"passageNo":1,"surface":"applied","partOfSpeech":"verb","translationUz":"ariza bergan","definitionEn":"formally submitted a request"},{"testNo":1,"passageNo":1,"surface":"art","partOfSpeech":"noun","translationUz":"san’at","definitionEn":"creative skill or craft"},{"testNo":1,"passageNo":1,"surface":"bean","partOfSpeech":"noun","translationUz":"loviya","definitionEn":"an edible legume"},{"testNo":1,"passageNo":1,"surface":"beans","partOfSpeech":"noun","translationUz":"loviyalar","definitionEn":"edible legume seeds or pods"},{"testNo":1,"passageNo":1,"surface":"benzoate","partOfSpeech":"noun","translationUz":"benzoat","definitionEn":"a salt of benzoic acid"},{"testNo":1,"passageNo":1,"surface":"cancer","partOfSpeech":"noun","translationUz":"saraton","definitionEn":"a disease involving uncontrolled cell growth"},{"testNo":1,"passageNo":1,"surface":"cases","partOfSpeech":"noun","translationUz":"holatlar","definitionEn":"individual instances of an event"},{"testNo":1,"passageNo":1,"surface":"change","partOfSpeech":"verb","translationUz":"almashtirmoq","definitionEn":"replace one item with another"},{"testNo":1,"passageNo":1,"surface":"chemical","partOfSpeech":"adjective","translationUz":"kimyoviy","definitionEn":"relating to chemical substances"},{"testNo":1,"passageNo":1,"surface":"consistent","partOfSpeech":"adjective","translationUz":"barqaror","definitionEn":"showing the same results over time"},{"testNo":1,"passageNo":1,"surface":"continued","partOfSpeech":"verb","translationUz":"davom etdi","definitionEn":"carried on doing something"},{"testNo":1,"passageNo":1,"surface":"cooked","partOfSpeech":"verb","translationUz":"pishirilgan","definitionEn":"prepared by heating"},{"testNo":1,"passageNo":1,"surface":"covered","partOfSpeech":"adjective","translationUz":"yopiq","definitionEn":"having a lid or covering"},{"testNo":1,"passageNo":1,"surface":"creating","partOfSpeech":"verb","translationUz":"hosil qilib","definitionEn":"bringing something into existence"},{"testNo":1,"passageNo":1,"surface":"decades","partOfSpeech":"noun","translationUz":"o‘n yilliklar","definitionEn":"periods of ten years"},{"testNo":1,"passageNo":1,"surface":"developed","partOfSpeech":"verb","translationUz":"ishlab chiqilgan","definitionEn":"produced through research and innovation"},{"testNo":1,"passageNo":1,"surface":"discover","partOfSpeech":"verb","translationUz":"aniqlamoq","definitionEn":"find out something through research"},{"testNo":1,"passageNo":1,"surface":"discovered","partOfSpeech":"verb","translationUz":"aniqlagan","definitionEn":"found something previously unknown"},{"testNo":1,"passageNo":1,"surface":"early","partOfSpeech":"adjective","translationUz":"dastlabki","definitionEn":"belonging to the beginning of a period"},{"testNo":1,"passageNo":1,"surface":"eating","partOfSpeech":"verb","translationUz":"iste’mol qilish","definitionEn":"taking food into the body"},{"testNo":1,"passageNo":1,"surface":"employees","partOfSpeech":"noun","translationUz":"xodimlar","definitionEn":"people working for an employer"},{"testNo":1,"passageNo":1,"surface":"engines","partOfSpeech":"noun","translationUz":"dvigatellar","definitionEn":"machines converting energy into motion"},{"testNo":1,"passageNo":1,"surface":"enough","partOfSpeech":"adverb","translationUz":"yetarli darajada","definitionEn":"sufficiently to achieve a result"},{"testNo":1,"passageNo":1,"surface":"error","partOfSpeech":"noun","translationUz":"xato","definitionEn":"a mistake in a method"},{"testNo":1,"passageNo":1,"surface":"explains","partOfSpeech":"verb","translationUz":"tushuntiradi","definitionEn":"gives a clear account"},{"testNo":1,"passageNo":1,"surface":"fatal","partOfSpeech":"adjective","translationUz":"o‘limga olib keluvchi","definitionEn":"causing death"},{"testNo":1,"passageNo":1,"surface":"fingernails","partOfSpeech":"noun","translationUz":"tirnoqlar","definitionEn":"hard coverings at the ends of fingers"},{"testNo":1,"passageNo":1,"surface":"followed","partOfSpeech":"verb","translationUz":"keyingi","definitionEn":"came after a previous event"},{"testNo":1,"passageNo":1,"surface":"franc","partOfSpeech":"noun","translationUz":"frank","definitionEn":"a historical French unit of currency"},{"testNo":1,"passageNo":1,"surface":"happening","partOfSpeech":"verb","translationUz":"sodir bo‘lish","definitionEn":"taking place"},{"testNo":1,"passageNo":1,"surface":"helped","partOfSpeech":"verb","translationUz":"yordam berdi","definitionEn":"made a result possible"},{"testNo":1,"passageNo":1,"surface":"improved","partOfSpeech":"adjective","translationUz":"yaxshilangan","definitionEn":"made better in quality"},{"testNo":1,"passageNo":1,"surface":"industrial","partOfSpeech":"adjective","translationUz":"sanoatga oid","definitionEn":"related to large-scale production"},{"testNo":1,"passageNo":1,"surface":"known","partOfSpeech":"adjective","translationUz":"ma’lum","definitionEn":"recognised as a fact"},{"testNo":1,"passageNo":1,"surface":"late","partOfSpeech":"adjective","translationUz":"oxirgi","definitionEn":"occurring near the end of a period"},{"testNo":1,"passageNo":1,"surface":"later","partOfSpeech":"adverb","translationUz":"keyinroq","definitionEn":"at a subsequent time"},{"testNo":1,"passageNo":1,"surface":"least","partOfSpeech":"noun","translationUz":"hech bo‘lmasa","definitionEn":"the smallest acceptable amount"},{"testNo":1,"passageNo":1,"surface":"like","partOfSpeech":"preposition","translationUz":"singari","definitionEn":"similar to something"},{"testNo":1,"passageNo":1,"surface":"months","partOfSpeech":"noun","translationUz":"oylar","definitionEn":"periods of several months"},{"testNo":1,"passageNo":1,"surface":"more","partOfSpeech":"adverb","translationUz":"ko‘proq","definitionEn":"to a greater extent"},{"testNo":1,"passageNo":1,"surface":"now","partOfSpeech":"adverb","translationUz":"hozir","definitionEn":"at the present time"},{"testNo":1,"passageNo":1,"surface":"periods","partOfSpeech":"noun","translationUz":"davrlar","definitionEn":"lengths of time"},{"testNo":1,"passageNo":1,"surface":"principles","partOfSpeech":"noun","translationUz":"tamoyillar","definitionEn":"fundamental rules of a field"},{"testNo":1,"passageNo":1,"surface":"reason","partOfSpeech":"noun","translationUz":"sabab","definitionEn":"an explanation for an event"},{"testNo":1,"passageNo":1,"surface":"results","partOfSpeech":"noun","translationUz":"natijalar","definitionEn":"outcomes of an activity"},{"testNo":1,"passageNo":1,"surface":"safe","partOfSpeech":"adjective","translationUz":"xavfsiz","definitionEn":"not likely to cause harm"},{"testNo":1,"passageNo":1,"surface":"small","partOfSpeech":"adjective","translationUz":"kichik","definitionEn":"of limited size"},{"testNo":1,"passageNo":1,"surface":"technique","partOfSpeech":"noun","translationUz":"usul","definitionEn":"a procedure for achieving an outcome"},{"testNo":1,"passageNo":1,"surface":"times","partOfSpeech":"noun","translationUz":"muddatlar","definitionEn":"lengths of time"},{"testNo":1,"passageNo":1,"surface":"trial","partOfSpeech":"noun","translationUz":"sinov","definitionEn":"a test of a method"},{"testNo":1,"passageNo":1,"surface":"visual","partOfSpeech":"adjective","translationUz":"ko‘rishga oid","definitionEn":"relating to appearance"},{"testNo":1,"passageNo":1,"surface":"water","partOfSpeech":"noun","translationUz":"suv","definitionEn":"a common liquid essential to life"},{"testNo":1,"passageNo":1,"surface":"well","partOfSpeech":"adverb","translationUz":"yaxshi","definitionEn":"in a satisfactory way"}],"corrections":[],"offsetRepairs":[]}$plan$::jsonb;
  v_check record;
  v_repair record;
  v_item record;
  v_old record;
  v_passage_id uuid;
  v_body text;
  v_word text;
  v_part text;
  v_lexical_type text;
  v_unit_id uuid;
  v_lexeme_id uuid;
  v_sense_key text;
  v_regex text;
  v_start integer;
  v_total integer;
  v_ordinal integer;
  v_rows integer;
  v_repaired integer := 0;
  v_corrected integer := 0;
  v_inserted integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(11061401);

  -- Fail before any mutation if any source text or catalogue slot changed.
  FOR v_check IN SELECT key, value FROM jsonb_each_text(v_plan->'passages') LOOP
    SELECT COUNT(*), MIN(body_text) INTO v_total, v_body
      FROM reading_passages
      WHERE test_no=split_part(v_check.key,'-',1)::integer
        AND passage_no=split_part(v_check.key,'-',2)::integer;
    IF v_total <> 1 OR v_body IS NULL
       OR encode(extensions.digest(v_body,'sha256'),'hex') <> v_check.value THEN
      RAISE EXCEPTION 'Reading source checksum mismatch: %', v_check.key;
    END IF;
  END LOOP;

  -- Repair exact incorrect spans in passages 002 and 003 without changing IDs.
  FOR v_repair IN
    SELECT * FROM jsonb_to_recordset(v_plan->'offsetRepairs')
      AS r("testNo" integer,"passageNo" integer,id text,surface text,
           "expectedStart" integer,"matchOrdinal" integer)
  LOOP
    SELECT p.id,p.body_text,o.start_char,o.end_char,o.surface_form
      INTO v_old
      FROM lexical_occurrences o
      JOIN reading_passages p ON p.id=o.passage_id
      WHERE o.id=v_repair.id::uuid
        AND p.test_no=v_repair."testNo"
        AND p.passage_no=v_repair."passageNo";
    IF NOT FOUND OR lower(v_old.surface_form) <> lower(v_repair.surface) THEN
      RAISE EXCEPTION 'Reading repair target changed: %',v_repair.id;
    END IF;
    v_regex:='(?i)(?<![[:alpha:]])'||v_repair.surface||'(?![[:alpha:]])';
    v_start:=regexp_instr(v_old.body_text,v_regex,1,v_repair."matchOrdinal")-1;
    IF v_start<0 OR lower(substr(v_old.body_text,v_start+1,length(v_repair.surface)))
       <> lower(v_repair.surface) THEN
      RAISE EXCEPTION 'Reading repair missing or mismatched surface: %',v_repair.id;
    END IF;
    IF v_old.start_char=v_start AND v_old.end_char=v_start+length(v_repair.surface) THEN
      CONTINUE;
    END IF;
    IF v_old.start_char<>v_repair."expectedStart"
       OR EXISTS(SELECT 1 FROM lexical_occurrences o
         WHERE o.passage_id=v_old.id AND o.id<>v_repair.id::uuid
           AND o.start_char<v_start+length(v_repair.surface) AND o.end_char>v_start) THEN
      RAISE EXCEPTION 'Reading repair conflicts with prior span: %',v_repair.id;
    END IF;
    UPDATE lexical_occurrences o
      SET start_char=v_start,end_char=v_start+length(v_repair.surface),
        sentence_text=substr(v_old.body_text,greatest(1,v_start-120),260)
      WHERE o.id=v_repair.id::uuid;
    v_repaired:=v_repaired+1;
  END LOOP;

  -- Correct polysemous meanings in 001-003 and enrich 007-009.
  FOR v_item IN
    SELECT x.kind,x.test_no,x.passage_no,x.surface,x.pos,x.uz,x.definition
    FROM (
      SELECT 'correction'::text AS kind,c."testNo" AS test_no,
        c."passageNo" AS passage_no,c.surface,c."partOfSpeech" AS pos,
        c."translationUz" AS uz,c."definitionEn" AS definition
        FROM jsonb_to_recordset(v_plan->'corrections')
        AS c("testNo" integer,"passageNo" integer,surface text,
             "partOfSpeech" text,"translationUz" text,"definitionEn" text)
      UNION ALL
      SELECT 'new'::text AS kind,t."testNo" AS test_no,
        t."passageNo" AS passage_no,t.surface,t."partOfSpeech" AS pos,
        t."translationUz" AS uz,t."definitionEn" AS definition
        FROM jsonb_to_recordset(v_plan->'terms')
        AS t("testNo" integer,"passageNo" integer,surface text,
             "partOfSpeech" text,"translationUz" text,"definitionEn" text)
    ) AS x
    ORDER BY CASE WHEN x.kind='correction' THEN 0 ELSE 1 END,
      LENGTH(x.surface) DESC,x.test_no,x.passage_no,x.surface
  LOOP
    SELECT id,body_text INTO v_passage_id,v_body FROM reading_passages
      WHERE test_no=v_item.test_no AND passage_no=v_item.passage_no;
    IF v_passage_id IS NULL THEN
      RAISE EXCEPTION 'Reading passage missing: %-%',v_item.test_no,v_item.passage_no;
    END IF;
    v_word:=lower(trim(regexp_replace(v_item.surface,'[[:space:]]+',' ','g')));
    v_part:=lower(trim(v_item.pos));
    v_regex:='(?i)(?<![[:alpha:]])'||v_item.surface||'(?![[:alpha:]])';
    v_total:=regexp_count(v_body,v_regex);
    IF v_total<1 THEN
      RAISE EXCEPTION 'Reading vocabulary surface absent: %-%, %',v_item.test_no,v_item.passage_no,v_item.surface;
    END IF;
    IF v_item.kind='correction' THEN
      SELECT COUNT(*) INTO v_rows FROM lexical_occurrences
        WHERE passage_id=v_passage_id AND lower(surface_form)=v_word;
      IF v_rows<1 THEN
        RAISE EXCEPTION 'Reading correction cardinality changed: %-%, %',v_item.test_no,v_item.passage_no,v_item.surface;
      END IF;
    END IF;
    v_lexical_type:=CASE v_part
      WHEN 'noun phrase' THEN 'noun_phrase'
      WHEN 'verb phrase' THEN 'verb_phrase'
      WHEN 'phrasal verb' THEN 'phrasal_verb'
      WHEN 'idiom' THEN 'idiom'
      WHEN 'collocation' THEN 'collocation'
      WHEN 'fixed expression' THEN 'fixed_expression'
      WHEN 'compound' THEN 'compound'
      WHEN 'phrase' THEN 'phrase'
      ELSE CASE WHEN position(' ' IN v_word)>0 THEN 'phrase' ELSE 'word' END
    END;
    -- Reuse a lexical unit of the same lemma, POS and lexical type.
    INSERT INTO lexical_units
      (language,lemma,lemma_norm,part_of_speech,lexical_type,
       is_function_word,provenance)
      VALUES('en',v_item.surface,v_word,v_part,v_lexical_type,false,
             'reading_context')
      ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type) DO NOTHING;
    SELECT id INTO STRICT v_unit_id FROM lexical_units
      WHERE language='en' AND lemma_norm=v_word
        AND part_of_speech=v_part AND lexical_type=v_lexical_type;
    INSERT INTO lexical_unit_forms
      (lexical_unit_id,form,form_norm,form_type)
      VALUES(v_unit_id,v_item.surface,v_word,'lemma')
      ON CONFLICT(lexical_unit_id,form_norm) DO NOTHING;

    -- The v2 key is SHA256(JSON([normalised term, POS, English meaning])).
    v_sense_key:='v2:'||encode(extensions.digest(
      replace(json_build_array(v_word,v_part,lower(trim(v_item.definition)))::text,
              '", "', '","'),'sha256'),'hex');
    SELECT id INTO v_lexeme_id FROM lexemes
      WHERE sense_key=v_sense_key;
    IF v_lexeme_id IS NULL THEN
      -- Honor exact legacy senses too; do not duplicate identical meanings.
      SELECT id INTO v_lexeme_id FROM lexemes
        WHERE lower(trim(term))=v_word AND lower(trim(coalesce(part_of_speech,'')))=v_part
          AND lower(trim(definition_en))=lower(trim(v_item.definition))
        ORDER BY id LIMIT 1;
    END IF;
    IF v_lexeme_id IS NULL THEN
      INSERT INTO lexemes
        (term,part_of_speech,definition_en,translation_uz,example_sentence,
         lexical_unit_id,sense_key,provenance,verification_status,import_batch)
        VALUES(v_item.surface,v_item.pos,v_item.definition,v_item.uz,
               NULL,v_unit_id,v_sense_key,'reading_context',
               'context_checked','20261114-passage-001-context')
        ON CONFLICT(sense_key) DO NOTHING
        RETURNING id INTO v_lexeme_id;
      IF v_lexeme_id IS NULL THEN
        SELECT id INTO STRICT v_lexeme_id FROM lexemes WHERE sense_key=v_sense_key;
      END IF;
    END IF;
    SELECT coalesce(lexical_unit_id,v_unit_id) INTO v_unit_id
      FROM lexemes WHERE id=v_lexeme_id;

    IF v_item.kind='correction' THEN
      UPDATE lexical_occurrences
        SET lexeme_id=v_lexeme_id,lexical_unit_id=v_unit_id,
            resolution_status='resolved',resolution_source='context_editorial'
        WHERE passage_id=v_passage_id AND lower(surface_form)=v_word;
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      v_corrected:=v_corrected+v_rows;
      CONTINUE;
    END IF;

    FOR v_ordinal IN 1..v_total LOOP
      v_start:=regexp_instr(v_body,v_regex,1,v_ordinal)-1;
      IF v_start<0 OR lower(substr(v_body,v_start+1,length(v_item.surface)))
        <> lower(v_item.surface) THEN
        RAISE EXCEPTION 'Source text shifted while linking: %-%, %',v_item.test_no,v_item.passage_no,v_item.surface;
      END IF;
      -- Keep pre-existing curated multiword senses authoritative.
      IF EXISTS(SELECT 1 FROM lexical_occurrences o
          WHERE o.passage_id=v_passage_id
            AND o.start_char<v_start+length(v_item.surface)
            AND o.end_char>v_start) THEN
        CONTINUE;
      END IF;
      INSERT INTO lexical_occurrences
        (source_type,passage_id,start_char,end_char,surface_form,lexeme_id,
         lexical_unit_id,resolution_status,resolution_source,sentence_text,
         occurrence_type,is_target_vocabulary)
        VALUES('reading',v_passage_id,v_start,v_start+length(v_item.surface),
               substr(v_body,v_start+1,length(v_item.surface)),
               v_lexeme_id,v_unit_id,'resolved','context_editorial',
               substr(v_body,greatest(1,v_start-120),260),
               'vocabulary',true)
        ON CONFLICT(passage_id,start_char,end_char) DO NOTHING;
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      v_inserted:=v_inserted+v_rows;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'reading contextual links: repaired %, corrected %, added %',
    v_repaired,v_corrected,v_inserted;
END
$executor$;
