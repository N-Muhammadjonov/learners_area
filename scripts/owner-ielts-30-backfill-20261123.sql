-- Owner-only IELTS 8.0 plan backfill, 2026-11-23.
-- Execute only after PR #217 backend/frontend are live. Use ROLLBACK for preflight.
-- Zero edits to published materials, test attempts, other learners, coins or authored packs.
-- Original owner cycle and tasks are snapshotted into audit_log atomically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(hashtext('owner-ielts-band8-20261123-safe-backfill'));

CREATE TEMP TABLE _owner_target ON COMMIT DROP AS
SELECT c.id,c.user_id,c.started_on,c.opened_at,c.current_day,c.status,c.revision,c.duration_days,c.cefr_level
FROM study_plan_30_cycles c JOIN users u ON u.id=c.user_id
WHERE u.role='owner';

DO $guard$
DECLARE rec record;
BEGIN
  IF (SELECT count(*) FROM users WHERE role='owner')<>1 OR
     (SELECT count(*) FROM _owner_target)<>1 THEN
    RAISE EXCEPTION 'Owner selection is ambiguous';
  END IF;
  SELECT * INTO STRICT rec FROM _owner_target;
  PERFORM id FROM study_plan_30_cycles WHERE id=rec.id FOR UPDATE;
  IF rec.started_on<>DATE '2026-11-22' OR rec.current_day<>1 OR
     rec.status<>'active' OR rec.duration_days<>30 OR rec.cefr_level<>'B2'
     OR rec.revision<>1 THEN
    RAISE EXCEPTION 'Owner cycle changed since preflight';
  END IF;
  IF (SELECT count(*) FROM study_plan_30_tasks WHERE cycle_id=rec.id)<>180
     OR EXISTS(SELECT 1 FROM study_plan_30_tasks
       WHERE cycle_id=rec.id AND (completed_at IS NOT NULL OR proof IS NOT NULL))
     OR EXISTS(SELECT 1 FROM study_plan_30_tasks WHERE cycle_id=rec.id
       GROUP BY day_number HAVING count(*)<>6 OR sum(minutes) NOT IN(180,390,420))
  THEN RAISE EXCEPTION 'Owner work exists or the old schedule is inconsistent'; END IF;
  IF EXISTS (SELECT 1 FROM listening_attempts WHERE user_id=rec.user_id AND started_at>=rec.opened_at)
     OR EXISTS (SELECT 1 FROM reading_attempts WHERE user_id=rec.user_id AND started_at>=rec.opened_at)
     OR EXISTS (SELECT 1 FROM writing_submissions WHERE user_id=rec.user_id AND created_at>=rec.opened_at)
     OR EXISTS (SELECT 1 FROM speaking_attempts WHERE user_id=rec.user_id AND created_at>=rec.opened_at)
     OR EXISTS (SELECT 1 FROM retention_attempts WHERE user_id=rec.user_id AND created_at>=rec.opened_at)
     OR EXISTS (SELECT 1 FROM activity_events WHERE user_id=rec.user_id AND created_at>=rec.opened_at
                 AND type IN('VOCAB_REVIEWED','VOCAB_GAME_PRACTICED',
                             'GRAMMAR_TOPIC_ATTEMPTED','READING_ARTICLE_PLAN_COMPLETED'))
  THEN RAISE EXCEPTION 'Owner already started a real practice attempt'; END IF;
END $guard$;

CREATE TEMP TABLE _owner_grammar
(day_number smallint PRIMARY KEY,title text,href text,source_key text,block_weights jsonb)
ON COMMIT DROP;
INSERT INTO _owner_grammar VALUES
  (1,'IELTS 7+ Grammar — Determiners · generic articles · mass / count shifts · Articles and countability: stop recurring noun-phrase errors · Tushunish','/app/grammar/lessons?book=b2-9','grammar-book:b2:b2-9:0','[8,6,6]'::jsonb),
  (2,'IELTS 7+ Grammar — Kelishuv: subject-verb agreement essada · Subject-verb agreement inside long academic sentences · Tushunish','/app/grammar?tab=writing&book=wr-083','skill-grammar:writing:task2:wr-083:0','[6,6,6]'::jsonb),
  (3,'IELTS 7+ Grammar — Fragment va run-on: to''liq gap · Eliminate fragments, comma splices and run-on sentences · Tushunish','/app/grammar?tab=writing&book=wr-086','skill-grammar:writing:task2:wr-086:0','[6,6,6]'::jsonb),
  (4,'IELTS 7+ Grammar — Punctuation · commas, semicolons, dashes, apostrophes · Punctuation: boundaries, commas and apostrophes · Tushunish','/app/grammar/lessons?book=b2-13','grammar-book:b2:b2-13:0','[8,6,6]'::jsonb),
  (5,'IELTS 7+ Grammar — Artikllar essada: generic, the, zero · Generic and specific noun phrases in Task 2 · Tushunish','/app/grammar?tab=writing&book=wr-082','skill-grammar:writing:task2:wr-082:0','[6,6,6]'::jsonb),
  (6,'IELTS 7+ Grammar — Perfect simple vs continuous · stative verbs · Tense and aspect accuracy in examples and narratives · Tushunish','/app/grammar/lessons?book=b2-1','grammar-book:b2:b2-1:0','[8,6,6]'::jsonb),
  (7,'IELTS 7+ Grammar — Gap xilma-xilligi: sodda, qo''shma, murakkab · Control varied simple, compound and complex sentences · Tushunish','/app/grammar?tab=writing&book=wr-085','skill-grammar:writing:task2:wr-085:0','[6,6,6]'::jsonb),
  (8,'IELTS 7+ Grammar — Relative clauses: who, which, whose, which-comment · Relative clauses without reference ambiguity · Tushunish','/app/grammar?tab=writing&book=wr-064','skill-grammar:writing:task2:wr-064:0','[6,6,6]'::jsonb),
  (9,'IELTS 7+ Grammar — Participial adjectives · reduced relatives · participle clauses · Reduced relatives and participial modifiers · Tushunish','/app/grammar/lessons?book=b2-6','grammar-book:b2:b2-6:0','[8,6,6]'::jsonb),
  (10,'IELTS 7+ Grammar — Shartli gaplar essada: if bilan natija va taxmin · Real and hypothetical conditionals with clear meaning · Tushunish','/app/grammar?tab=writing&book=wr-063','skill-grammar:writing:task2:wr-063:0','[6,6,6]'::jsonb),
  (11,'IELTS 7+ Grammar — Concession: although, admittedly, even though · Accurate concession instead of mechanical linking · Tushunish','/app/grammar?tab=writing&book=wr-058','skill-grammar:writing:task2:wr-058:0','[6,6,6]'::jsonb),
  (12,'IELTS 7+ Grammar — Academic nominalisation · parallelism · correlatives · Parallelism and academic nominalisation · Tushunish','/app/grammar/lessons?book=b2-10','grammar-book:b2:b2-10:0','[8,6,6]'::jsonb),
  (13,'IELTS 7+ Grammar — Nominalizatsiya: fe''l → ot · Nominalisation without awkward noun stacks · Tushunish','/app/grammar?tab=writing&book=wr-067','skill-grammar:writing:task2:wr-067:0','[6,6,6]'::jsonb),
  (14,'IELTS 7+ Grammar — Ehtiyotkor ifoda (hedging): tend to, may, arguably · Hedging: avoid unsupported absolute claims · Tushunish','/app/grammar?tab=writing&book=wr-062','skill-grammar:writing:task2:wr-062:0','[6,6,6]'::jsonb),
  (15,'IELTS 7+ Grammar — If I had to choose... · Natural comparative and hypothetical spoken choices · Tushunish','/app/grammar?tab=speaking&book=spk-58','skill-grammar:speaking:upper:spk-58:0','[6,6,6]'::jsonb),
  (16,'IELTS 7+ Grammar — If I were in that situation, I''d... · Spoken second conditional without tense errors · Tushunish','/app/grammar?tab=speaking&book=spk-66','skill-grammar:speaking:upper:spk-66:0','[6,6,6]'::jsonb),
  (17,'IELTS 7+ Grammar — It depends on whether... or ... · Whether/if clauses in nuanced spoken answers · Tushunish','/app/grammar?tab=speaking&book=spk-73','skill-grammar:speaking:upper:spk-73:0','[6,6,6]'::jsonb),
  (18,'IELTS 7+ Grammar — Sabab va oqibat: leads to, stems from, results in · Cause-effect syntax and preposition control · Tushunish','/app/grammar?tab=writing&book=wr-060','skill-grammar:writing:task2:wr-060:0','[6,6,6]'::jsonb),
  (19,'IELTS 7+ Grammar — Passive: ob''ektiv ohang, agentsiz · Impersonal passive with accurate agents and tense · Tushunish','/app/grammar?tab=writing&book=wr-066','skill-grammar:writing:task2:wr-066:0','[6,6,6]'::jsonb),
  (20,'IELTS 7+ Grammar — Noun clauses: the fact that, whether, what · Noun clauses in arguments and reporting · Tushunish','/app/grammar?tab=writing&book=wr-070','skill-grammar:writing:task2:wr-070:0','[6,6,6]'::jsonb),
  (21,'IELTS 7+ Grammar — Hedging · attribution · reporting stance · C1 reporting, attribution and calibrated uncertainty · Tushunish','/app/grammar/lessons?book=c1-8','grammar-book:c1:c1-8:0','[8,6,6]'::jsonb),
  (22,'IELTS 7+ Grammar — Advanced #91: Nominalised Cause-and-Effect · Nominalised cause-effect with unambiguous subjects · Tushunish','/app/grammar?tab=writing&book=wr-120','skill-grammar:writing:advanced:wr-120:0','[6,6,6]'::jsonb),
  (23,'IELTS 7+ Grammar — Participle and absolute clauses · Participle clauses with correct logical subjects · Tushunish','/app/grammar/lessons?book=c1-5','grammar-book:c1:c1-5:0','[8,6,6]'::jsonb),
  (24,'IELTS 7+ Grammar — Advanced #41: Impersonal Passive with Anticipatory ''It'' · Formal impersonal reporting passive · Tushunish','/app/grammar?tab=writing&book=wr-112','skill-grammar:writing:advanced:wr-112:0','[6,6,6]'::jsonb),
  (25,'IELTS 7+ Grammar — Advanced #61: Preposition + Relative Pronoun (Formal style) · Formal relative clauses and accurate prepositions · Tushunish','/app/grammar?tab=writing&book=wr-117','skill-grammar:writing:advanced:wr-117:0','[6,6,6]'::jsonb),
  (26,'IELTS 7+ Grammar — Taking X into account, … · Taking evidence into account while speaking · Tushunish','/app/grammar?tab=speaking&book=spk-47','skill-grammar:speaking:advanced:spk-47:0','[6,6,6]'::jsonb),
  (27,'IELTS 7+ Grammar — Given that ..., S + V · Given that: state justified reasons succinctly · Tushunish','/app/grammar?tab=speaking&book=spk-45','skill-grammar:speaking:advanced:spk-45:0','[6,6,6]'::jsonb),
  (28,'IELTS 7+ Grammar — Concession · advanced comparison · Advanced concession and nuanced comparisons · Tushunish','/app/grammar/lessons?book=c1-7','grammar-book:c1:c1-7:0','[8,6,6]'::jsonb),
  (29,'IELTS 7+ Grammar — Parentheticals and comma control · Commas, parentheticals and information flow · Tushunish','/app/grammar/lessons?book=c1-11','grammar-book:c1:c1-11:0','[8,6,6]'::jsonb),
  (30,'IELTS 7+ Grammar — Clefts · fronting · emphatic do · Clefts and focus for precise emphasis · Tushunish','/app/grammar/lessons?book=c1-2','grammar-book:c1:c1-2:0','[8,6,6]'::jsonb);

CREATE TEMP TABLE _owner_days ON COMMIT DROP AS
SELECT x.day_number,(DATE '2026-11-23'+(x.day_number-1)) AS study_date,
  EXTRACT(ISODOW FROM (DATE '2026-11-23'+(x.day_number-1)))::int AS weekday,
  (EXTRACT(ISODOW FROM (DATE '2026-11-23'+(x.day_number-1)))::int IN(1,3,5)) AS course,
  (EXTRACT(ISODOW FROM (DATE '2026-11-23'+(x.day_number-1)))::int=7) AS sunday
FROM generate_series(1,30) x(day_number);

CREATE TEMP TABLE _owner_media_spec
(media_rank smallint PRIMARY KEY,kind text,source text,objective text,article_title text)
ON COMMIT DROP;
INSERT INTO _owner_media_spec VALUES
  (1,'article','advertising','Identify assertion, concession and fragment-free examples','Advertising: how it influences children and teenagers'),
  (2,'video','iG9CE55wbtY','Recast three broad claims as precise academic propositions',NULL),
  (3,'article','air-pollution','Paraphrase causes and effects with varied sentence forms','Air Pollution - Preventive Measures, Causes and Types'),
  (4,'video','RKK7wGAYP6k','Explain a hypothesis using accurate conditionals',NULL),
  (5,'article','remote-work-wars','Extract balanced claims and nominalise causes','Remote Work Wars: Dropbox And Nike Remind Us About The Future Of Work.'),
  (6,'video','qp0HIF3SfI4','Separate evidence from opinion and hedge conclusions',NULL),
  (7,'article','unemployment','Construct nuanced claims about conditional outcomes','The consequences of unemployment'),
  (8,'video','D9Ihs241zeg','Report a speaker''s argument accurately and attribute ideas',NULL),
  (9,'article','artificial-intelligence','Qualify uncertain future predictions','Advantages and Disadvantages of Artificial Intelligence'),
  (10,'video','_6xlNyWPpB8','Summarise processes using accurate passive clauses',NULL),
  (11,'article','sleep-wellbeing','Compare evidence, limitations and alternative views','Sleep: here''s how much you really need for optimal cognition and wellbeing – new research'),
  (12,'video','n3kNlFMXslo','Contrast time-management approaches without overclaiming',NULL);

CREATE TEMP TABLE _owner_media_days ON COMMIT DROP AS
SELECT day_number,ROW_NUMBER() OVER(ORDER BY day_number)::smallint AS media_rank
FROM _owner_days WHERE weekday IN (2,4,6);

CREATE TEMP TABLE _owner_media_tasks ON COMMIT DROP AS
SELECT md.day_number,ms.kind,
 CASE WHEN ms.kind='article'
   THEN LEFT('Article — '||ms.article_title||' · '||ms.objective||
            '; complete all questions',350)
   ELSE LEFT('TED — '||v.title||' · '||ms.objective||
             '; shadow and summarise',350) END AS title,
 CASE WHEN ms.kind='article'
   THEN '/app/reading/articles/'||ms.source
   ELSE '/app/video-lessons/'||v.id::text END AS href,
 CASE WHEN ms.kind='article' THEN 'article:'||ms.source
      ELSE 'video:'||v.id::text END AS source_key
FROM _owner_media_days md
JOIN _owner_media_spec ms ON ms.media_rank=md.media_rank
LEFT JOIN video_lessons v ON ms.kind='video' AND v.video_id=ms.source
 AND v.lesson_id IS NULL AND v.is_active AND v.provider='youtube'
 AND v.media_kind='video'
 AND (v.publication_state='published'
      OR (v.publication_state='scheduled' AND v.publish_at<=NOW()));

CREATE TEMP TABLE _owner_general_candidates ON COMMIT DROP AS
SELECT g.set_id,g.passage_id,g.passage_no,p.title,
 ROW_NUMBER() OVER(ORDER BY
 (SELECT count(*) FROM reading_questions q WHERE q.passage_id=g.passage_id),
 COALESCE(p.suggested_minutes,20),g.passage_id)::int AS seq
FROM general_reading_passages g JOIN general_reading_sets s ON s.id=g.set_id
JOIN reading_passages p ON p.id=g.passage_id
WHERE g.reading_mode='general_practice'
 AND (s.publication_state='published' OR
      (s.publication_state='scheduled' AND s.publish_at<=NOW()))
 AND (p.publication_state='published' OR
      (p.publication_state='scheduled' AND p.publish_at<=NOW()))
 AND EXISTS (SELECT 1 FROM reading_questions q WHERE q.passage_id=g.passage_id)
 AND NOT EXISTS(SELECT 1 FROM activity_events e
       WHERE e.id=md5('deleted-content:'||s.id::text)::uuid
       AND e.type='CONTENT_DELETED');

CREATE TEMP TABLE _owner_academic_candidates ON COMMIT DROP AS
SELECT s.id,s.title,ROW_NUMBER() OVER(ORDER BY
 (s.source_ref LIKE 'reading30:%'),
 CASE WHEN s.source_ref LIKE 'reading30:%'
      THEN substring(s.source_ref FROM '[0-9]+$')::int ELSE 0 END,
 (SELECT min(p.test_no) FROM general_reading_passages g
  JOIN reading_passages p ON p.id=g.passage_id WHERE g.set_id=s.id) NULLS LAST,
 (SELECT min(p.external_id) FROM general_reading_passages g
  JOIN reading_passages p ON p.id=g.passage_id WHERE g.set_id=s.id) NULLS LAST,
 s.created_at,s.id)::int AS seq
FROM general_reading_sets s
WHERE (s.publication_state='published' OR
       (s.publication_state='scheduled' AND s.publish_at<=NOW()))
 AND (SELECT count(*) FROM general_reading_passages g WHERE g.set_id=s.id)=3
 AND (SELECT count(*) FROM reading_questions q JOIN general_reading_passages g
      ON g.passage_id=q.passage_id WHERE g.set_id=s.id)=40
 AND NOT EXISTS(SELECT 1 FROM general_reading_passages g
    JOIN reading_passages p ON p.id=g.passage_id WHERE g.set_id=s.id
    AND (g.passage_no NOT IN (1,2,3)
         OR NOT (p.publication_state='published'
                 OR (p.publication_state='scheduled' AND p.publish_at<=NOW()))
         OR NOT EXISTS(SELECT 1 FROM reading_questions q WHERE q.passage_id=p.id)))
 AND NOT EXISTS(SELECT 1 FROM activity_events e
       WHERE e.id=md5('deleted-content:'||s.id::text)::uuid
       AND e.type='CONTENT_DELETED');

CREATE TEMP TABLE _owner_reading_tasks ON COMMIT DROP AS
WITH numbered AS
 (SELECT day_number,course,
    ROW_NUMBER() OVER(PARTITION BY course ORDER BY day_number)::int AS seq
  FROM _owner_days)
SELECT d.day_number,
 CASE WHEN d.course
 THEN LEFT('General Reading — '||g.title||' · Course day: One passage, annotate recurring errors',350)
 ELSE LEFT('Academic Reading — '||a.title||' · Intensive day: Timed test, detailed answer and evidence analysis',350) END AS title,
 CASE WHEN d.course THEN '/app/reading/general/'||g.set_id::text||'?passage='||g.passage_no::text
 ELSE '/app/reading/academic/'||a.id::text END AS href,
 CASE WHEN d.course THEN 'reading-practice:'||g.passage_id::text
 ELSE 'reading:'||a.id::text END AS source_key
FROM numbered d
LEFT JOIN _owner_general_candidates g ON d.course AND g.seq=d.seq
LEFT JOIN _owner_academic_candidates a ON NOT d.course AND a.seq=d.seq;

DO $catalog$
BEGIN
 IF (SELECT COUNT(*) FROM _owner_grammar)<>30
 OR (SELECT COUNT(*) FROM _owner_media_tasks)<>12
 OR (SELECT COUNT(*) FROM _owner_media_tasks WHERE href IS NULL OR title IS NULL OR source_key IS NULL)>0
 OR (SELECT COUNT(*) FROM _owner_reading_tasks)<>30
 OR (SELECT COUNT(*) FROM _owner_reading_tasks WHERE href IS NULL OR title IS NULL OR source_key IS NULL)>0
 OR (SELECT COUNT(*) FROM _owner_reading_tasks WHERE source_key LIKE 'reading:%')<>17
 OR (SELECT COUNT(*) FROM _owner_reading_tasks WHERE source_key LIKE 'reading-practice:%')<>13
 THEN RAISE EXCEPTION 'Curated references are unavailable in published materials'; END IF;
END $catalog$;

-- Retain a transactional, recoverable copy of the precise prior plan.
INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
SELECT c.user_id,'owner_ielts_curriculum_snapshot','study_plan_30_cycle',c.id::text,
 jsonb_build_object(
  'cycle',to_jsonb(c),
  'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.day_number,t.slot)
           FROM study_plan_30_tasks t WHERE t.cycle_id=c.id))
FROM study_plan_30_cycles c JOIN _owner_target o ON o.id=c.id;

UPDATE study_plan_30_tasks t SET
 title = CASE t.kind
   WHEN 'grammar' THEN g.title
   WHEN 'reading' THEN r.title
   WHEN 'listening' THEN LEFT(split_part(t.title,' · ',1)||' · '||
          (CASE WHEN d.course THEN 'Course day: One verified test, review misheard answers'
           ELSE 'Intensive day: Full test, transcript, spelling and distractor drill' END),350)
   WHEN 'writing' THEN LEFT(split_part(t.title,' · ',1)||' · '||
          (CASE WHEN d.course THEN 'Course day: One timed response, check four rubric criteria'
           ELSE 'Intensive day: Timed response, rubric analysis and paragraph rewrite' END),350)
   WHEN 'speaking' THEN LEFT(split_part(t.title,' · ',1)||' · '||
          (CASE WHEN d.course THEN 'Course day: One recording, transcribe and fix key errors'
           ELSE 'Intensive day: Record, transcribe, correct, re-record and expand answers' END),350)
   WHEN 'vocabulary' THEN LEFT(split_part(t.title,' · ',1)||' · '||
          (CASE WHEN t.day_number%2=1 THEN
            'Learn the pack, then complete 10+ real SRS reviews or verified game recalls'
           ELSE 'Retrieve yesterday''s words, then complete 10+ SRS reviews or verified game recalls' END)||
          ' · Retain previous errors (days 1, 3, 7 and 16)',350)
   ELSE t.title END,
 href=CASE WHEN t.kind='grammar' THEN g.href
           WHEN t.kind='reading' THEN r.href ELSE t.href END,
 source_key=CASE WHEN t.kind='grammar' THEN g.source_key
           WHEN t.kind='reading' THEN r.source_key ELSE t.source_key END,
 minutes=CASE
   WHEN t.kind='grammar' THEN CASE WHEN d.course THEN 15 ELSE 20 END
   WHEN t.kind='reading' THEN CASE WHEN d.course THEN 20 WHEN d.sunday THEN 70 ELSE 68 END
   WHEN t.kind='listening' THEN CASE WHEN d.course THEN 33 WHEN d.sunday THEN 80 ELSE 67 END
   WHEN t.kind='writing' THEN CASE WHEN d.course THEN 40 ELSE 90 END
   WHEN t.kind='speaking' THEN CASE WHEN d.course THEN 40 ELSE 90 END
   WHEN t.kind='vocabulary' THEN CASE WHEN d.course THEN 20 WHEN d.sunday THEN 50
         WHEN EXISTS(SELECT 1 FROM _owner_media_tasks m WHERE m.day_number=t.day_number) THEN 20
         ELSE 40 END
   ELSE t.minutes END,
 stage_index=CASE WHEN t.kind='grammar' THEN 0 ELSE t.stage_index END,
 block_weights=CASE WHEN t.kind='grammar' THEN g.block_weights ELSE t.block_weights END
FROM _owner_days d JOIN _owner_grammar g ON g.day_number=d.day_number
JOIN _owner_reading_tasks r ON r.day_number=d.day_number
WHERE t.cycle_id=(SELECT id FROM _owner_target) AND t.day_number=d.day_number;

INSERT INTO study_plan_30_tasks
(cycle_id,day_number,slot,kind,title,href,source_key,minutes,stage_index,block_weights)
SELECT o.id,d.day_number,6,'retention',
 'Retention '||CASE WHEN d.day_number>=21 THEN 'C1' ELSE 'B2' END||
 ' — read 2 min, blind recall 3 min, correct omissions',
 '/app/reading/retention?level='||CASE WHEN d.day_number>=21 THEN 'C1' ELSE 'B2' END,
 'retention:'||CASE WHEN d.day_number>=21 THEN 'C1' ELSE 'B2' END,
 CASE WHEN d.course THEN 12 WHEN d.sunday THEN 20 ELSE 15 END,
 NULL,NULL
FROM _owner_target o CROSS JOIN _owner_days d;

INSERT INTO study_plan_30_tasks
(cycle_id,day_number,slot,kind,title,href,source_key,minutes,stage_index,block_weights)
SELECT o.id,m.day_number,7,m.kind,m.title,m.href,m.source_key,20,NULL,NULL
FROM _owner_target o CROSS JOIN _owner_media_tasks m;

UPDATE study_plan_30_cycles c SET started_on=DATE '2026-11-23',
 opened_at=NOW(),revision=revision+1,updated_at=NOW()
WHERE c.id=(SELECT id FROM _owner_target);

DO $validate$
DECLARE active_cycle uuid;
BEGIN
 SELECT id INTO STRICT active_cycle FROM _owner_target;
 IF (SELECT count(*) FROM study_plan_30_tasks WHERE cycle_id=active_cycle)<>222
 OR (SELECT count(DISTINCT day_number) FROM study_plan_30_tasks WHERE cycle_id=active_cycle)<>30
 OR (SELECT count(*) FROM study_plan_30_tasks WHERE cycle_id=active_cycle AND kind='retention')<>30
 OR (SELECT count(*) FROM study_plan_30_tasks WHERE cycle_id=active_cycle AND kind IN('article','video'))<>12
 OR EXISTS(SELECT 1 FROM study_plan_30_tasks WHERE cycle_id=active_cycle
           AND (completed_at IS NOT NULL OR proof IS NOT NULL
                OR href NOT LIKE '/app/%' OR minutes NOT BETWEEN 1 AND 90))
 OR EXISTS(SELECT 1 FROM study_plan_30_tasks t JOIN _owner_days d
            ON d.day_number=t.day_number WHERE t.cycle_id=active_cycle
            GROUP BY t.day_number,d.course,d.sunday
            HAVING count(*)<>CASE WHEN d.weekday IN(2,4,6) AND t.day_number IN
              (SELECT day_number FROM _owner_media_tasks) THEN 8 ELSE 7 END
            OR sum(t.minutes)<>CASE WHEN d.course THEN 180 WHEN d.sunday THEN 420 ELSE 390 END)
 THEN RAISE EXCEPTION 'Curated IELTS daily task verification failed'; END IF;
END $validate$;

SELECT (SELECT count(*) FROM study_plan_30_tasks
        WHERE cycle_id=(SELECT id FROM _owner_target))::int AS tasks,
       (SELECT count(*) FROM study_plan_30_tasks
        WHERE cycle_id=(SELECT id FROM _owner_target) AND kind='retention')::int AS retention,
       (SELECT count(*) FROM study_plan_30_tasks
        WHERE cycle_id=(SELECT id FROM _owner_target) AND kind IN('article','video'))::int AS media,
       (SELECT count(*) FROM audit_log
        WHERE action='owner_ielts_curriculum_snapshot'
          AND target_id=(SELECT id::text FROM _owner_target))::int AS backup_snapshots;
ROLLBACK;
