-- ONLY Supabase learners-area-qa bpexpsugmuhwmztacbqd, immediately after backup + enum.
-- 15 exact reviewed canonical migrations, no reset/replay/drop of owner data.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(20261012,3852);
LOCK TABLE drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $locks$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t.tablename); END LOOP; END $locks$;
DO $journal$ BEGIN IF (SELECT count(*) FROM drizzle.__drizzle_migrations)<>38 OR EXISTS(SELECT 1 FROM jsonb_array_elements('[{"hash":"d149017a39cfaf517789938cb802ba79120bdab1a3f0c498fd670a75c0a48c69","created_at":1790188219029},{"hash":"190c03262689fe1e2b3d19f36301325a7371ac417533eb01e5d5430f9549a2e4","created_at":1790189397777},{"hash":"5d7e5bb9f40c2a88ec36915b937fc44ac673085bf82c66a2ae47833c868fd255","created_at":1790191131151},{"hash":"0519ca31d9a2862f309c7679cb62645be3c11bcdb6c3f338e5e5c5253c0f7005","created_at":1790275357849},{"hash":"a449a08648b90ddf84c09c1ef6c3be99d4e826adee0828735e798e2d0eaa1386","created_at":1790276380642},{"hash":"bd709e30eb0eec7f35ee21718ee11fd1bb6a16f58d0d7dd25592a75f221ae3bc","created_at":1790299753865},{"hash":"c5528a3321a819b1e258e4341c901edd4f9df00fb8212404f6ada52dc75cfc64","created_at":1790300320283},{"hash":"038ca444dd47bbcb8e69607104fffc4eea3899862689ddc8cfa7bd6df9ab5d52","created_at":1790300889330},{"hash":"cc629a8023010503cd10e324b3a51ba490af40ccc7449e03c1bb6407cd421f41","created_at":1790301301541},{"hash":"a9dc2fdd20ee9f143e00691a7497ceb48cad895efb1cda6e54d1777fbc459e14","created_at":1790361168134},{"hash":"007dbef62c06873bece2ec1ee62395608255ddbdc8e178381fcff956c310cfeb","created_at":1790361524937},{"hash":"c3d2617870a2b33cc6690410b05a4fe303ac2fe927487413a15a720f0290d1db","created_at":1790362848900},{"hash":"5b9dee31abe37c5bbfbd312261ea34c4cbf04f13c55c976d143edc3ce38f5d15","created_at":1790390667608},{"hash":"3d8620f16e431a40eecb998721a9cc8f57ebcd5b2d9e05112fa45ada68b39e52","created_at":1790391090261},{"hash":"1a0f569675807bde417cb0b80ef3de342f05daa13c2818cb76fc7c9bcc115b0e","created_at":1790392022049},{"hash":"e2eaa95546d55cd43b8427cd21ae763612154df24e2902c8c891da9edde9a299","created_at":1790395150776},{"hash":"e50c6bb5ed9ccbb2682c8307de36f040461898047ec318f1ff8b01c365d29986","created_at":1790403060935},{"hash":"55bba8c1941c7185cc7405cfb1a7f209579a01f39274a8b1c78db11bf28b07c5","created_at":1790425259055},{"hash":"5d8355ddad0962744f07758759bf28d0868122339eef86477a1b9fe8c6fbd290","created_at":1790429326290},{"hash":"d749c650685c693eb0f15b994272b59dca56eaed0ca886a2b87fca23787de816","created_at":1790559351334},{"hash":"9e2d6b3ffbc7ea27c683350c6494e94d7c1d3d1e796f982443f4a9b32be49140","created_at":1790620308660},{"hash":"ba209a85c50ecf0818933f31896769bde1a1540ee21364bc18d3024e99f83d4a","created_at":1790734416580},{"hash":"8294e9c9e9c93116a6168e609d39fba4da7292f38ac27f726a90116b24814bb8","created_at":1790756280556},{"hash":"e4ca1c6e2afdbd9f3360156eb4f9c932e7febfbe091a818c61160b2f359f2a27","created_at":1790759035406},{"hash":"4a5d5159f325884fd8e26ac5d7477a35e2280b812c8c9551a94ae2423b79806d","created_at":1790785789328},{"hash":"79ecefbd9fd75b36126ba330d117954091f0f0525f76370a3f337f4f021f4d74","created_at":1790845294168},{"hash":"2a3104169e142576e4afff2e4fd37566890acd49280df25155f2258acbf000d4","created_at":1790845470436},{"hash":"b76f9776ab6ff57208f9a8ab3b8e9ca692c8baa7173d26bb98efa920c4b12285","created_at":1790845656316},{"hash":"09fa9dbc01efb0ce477c59cb02c9e5624421fcc3c6879f442031ede12001b3c7","created_at":1790857800000},{"hash":"050fa13dda1883a949ca0537c4b25a49f3d340a44066487441d631361ba7a774","created_at":1790900000000},{"hash":"3d99ff8db195587609046a112b6efc21878e4defaf9cc3b2134b32ef75a90574","created_at":1791000000000},{"hash":"bcbe2a3f24b884611cfbeb2d423bf3e1db09de104056b269c356afeb8dee24b8","created_at":1791100000000},{"hash":"57686828eb5f61a381a9f324d9ccbd4cea533ecbc947ca2a7cd76c5ac9bdb07f","created_at":1791200000000},{"hash":"128394ec0a6016c3c78564d977638dd06b2642ffcdbfb331ca8ec9a68c5ad7fc","created_at":1791300000000},{"hash":"3eb1e502b6102e3476b6d8e120f699bd0c596e123d10103b5d27d645e7f12fcc","created_at":1791400000000},{"hash":"1244008086904ae204bfcf3244f68d91abac0750e73a1893cd6b74b204a6ec79","created_at":1791500000000},{"hash":"2287d37ada3bd0d542ecdc9fb966dd024c903f04f6f8d3c274294d73d3b071da","created_at":1791600000000},{"hash":"32890672239b62b019331a43c72d1102d48cd66651c156662c1cbad5a98f0341","created_at":1791700000000}]'::jsonb) e WHERE NOT EXISTS(SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash=e->>'hash' AND m.created_at=(e->>'created_at')::bigint)) THEN RAISE EXCEPTION 'STOP: expected exact 38-entry canonical primary migration prefix'; END IF; END $journal$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"tbl":"assignments","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"assignments","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"assignments","col":"description","typ":"text","nn":false,"def":null},{"tbl":"assignments","col":"created_by_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"assignments","col":"target_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"assignments","col":"related_writing_prompt_id","typ":"uuid","nn":false,"def":null},{"tbl":"assignments","col":"status","typ":"assignment_status","nn":true,"def":"''not_started''::assignment_status"},{"tbl":"assignments","col":"due_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"assignments","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"grammar_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"grammar_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"grammar_attempts","col":"exercise_id","typ":"uuid","nn":true,"def":null},{"tbl":"grammar_attempts","col":"selected_option","typ":"text","nn":true,"def":"''''::text"},{"tbl":"grammar_attempts","col":"is_correct","typ":"boolean","nn":true,"def":null},{"tbl":"grammar_attempts","col":"attempted_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"grammar_attempts","col":"activity","typ":"grammar_activity","nn":true,"def":"''correct_it''::grammar_activity"},{"tbl":"grammar_attempts","col":"response_text","typ":"text","nn":false,"def":null},{"tbl":"grammar_topics","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"grammar_topics","col":"skill_area","typ":"grammar_skill_area","nn":true,"def":"''writing''::grammar_skill_area"},{"tbl":"grammar_topics","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"grammar_topics","col":"explanation","typ":"text","nn":true,"def":null},{"tbl":"grammar_topics","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"lesson_progress","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"lesson_progress","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_progress","col":"lesson_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_progress","col":"state","typ":"content_state","nn":true,"def":"''available''::content_state"},{"tbl":"lesson_progress","col":"notes","typ":"text","nn":false,"def":null},{"tbl":"lesson_progress","col":"completed_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"lesson_progress","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lessons","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"lessons","col":"unit_id","typ":"uuid","nn":true,"def":null},{"tbl":"lessons","col":"slug","typ":"character varying(60)","nn":true,"def":null},{"tbl":"lessons","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"lessons","col":"summary","typ":"text","nn":false,"def":null},{"tbl":"lessons","col":"default_state","typ":"content_state","nn":true,"def":"''locked''::content_state"},{"tbl":"lessons","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"lessons","col":"recording_url","typ":"text","nn":false,"def":null},{"tbl":"listening_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"listening_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_attempts","col":"test_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_attempts","col":"status","typ":"attempt_status","nn":true,"def":"''in_progress''::attempt_status"},{"tbl":"listening_attempts","col":"score","typ":"integer","nn":false,"def":null},{"tbl":"listening_attempts","col":"total_questions","typ":"integer","nn":false,"def":null},{"tbl":"listening_attempts","col":"started_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"listening_attempts","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"listening_packages","col":"test_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_packages","col":"source_id","typ":"character varying(80)","nn":true,"def":null},{"tbl":"listening_packages","col":"payload","typ":"jsonb","nn":true,"def":null},{"tbl":"listening_packages","col":"audio_object_key","typ":"text","nn":true,"def":null},{"tbl":"listening_packages","col":"image_object_key","typ":"text","nn":false,"def":null},{"tbl":"listening_packages","col":"source_hash","typ":"character varying(64)","nn":true,"def":null},{"tbl":"listening_packages","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"listening_questions","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"listening_questions","col":"test_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_questions","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"listening_questions","col":"type","typ":"listening_question_type","nn":true,"def":null},{"tbl":"listening_questions","col":"question_text","typ":"text","nn":true,"def":null},{"tbl":"listening_questions","col":"options","typ":"jsonb","nn":false,"def":null},{"tbl":"listening_questions","col":"correct_answer","typ":"text","nn":true,"def":null},{"tbl":"listening_questions","col":"explanation","typ":"text","nn":true,"def":null},{"tbl":"listening_questions","col":"keywords","typ":"text","nn":false,"def":null},{"tbl":"listening_questions","col":"paraphrases","typ":"jsonb","nn":false,"def":null},{"tbl":"listening_tests","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"listening_tests","col":"created_by_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_tests","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"listening_tests","col":"audio_type","typ":"material_type","nn":true,"def":null},{"tbl":"listening_tests","col":"audio_url","typ":"text","nn":false,"def":null},{"tbl":"listening_tests","col":"transcript","typ":"text","nn":false,"def":null},{"tbl":"listening_tests","col":"difficulty_level","typ":"character varying(10)","nn":true,"def":"''B2''::character varying"},{"tbl":"listening_tests","col":"is_active","typ":"boolean","nn":true,"def":"true"},{"tbl":"listening_tests","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"listening_tests","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"listening_tests","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"mock_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"mock_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"mock_attempts","col":"mock_test_id","typ":"uuid","nn":true,"def":null},{"tbl":"mock_attempts","col":"started_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"mock_attempts","col":"finished_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"mock_attempts","col":"raw_score","typ":"real","nn":false,"def":null},{"tbl":"mock_attempts","col":"estimated_band","typ":"real","nn":false,"def":null},{"tbl":"mock_attempts","col":"skill_breakdown","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_tests","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"mock_tests","col":"course_id","typ":"uuid","nn":true,"def":null},{"tbl":"mock_tests","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"mock_tests","col":"skill","typ":"character varying(20)","nn":true,"def":null},{"tbl":"reading_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"reading_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_attempts","col":"passage_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_attempts","col":"status","typ":"attempt_status","nn":true,"def":"''in_progress''::attempt_status"},{"tbl":"reading_attempts","col":"score","typ":"integer","nn":false,"def":null},{"tbl":"reading_attempts","col":"total_questions","typ":"integer","nn":false,"def":null},{"tbl":"reading_attempts","col":"started_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"reading_attempts","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"reading_questions","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"reading_questions","col":"passage_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_questions","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"reading_questions","col":"type","typ":"reading_question_type","nn":true,"def":null},{"tbl":"reading_questions","col":"question_text","typ":"text","nn":true,"def":null},{"tbl":"reading_questions","col":"options","typ":"jsonb","nn":false,"def":null},{"tbl":"reading_questions","col":"correct_answer","typ":"text","nn":true,"def":null},{"tbl":"reading_questions","col":"evidence_quote","typ":"text","nn":false,"def":null},{"tbl":"reading_questions","col":"explanation","typ":"text","nn":true,"def":null},{"tbl":"reading_questions","col":"group_id","typ":"uuid","nn":false,"def":null},{"tbl":"reading_questions","col":"question_no","typ":"integer","nn":false,"def":null},{"tbl":"reading_questions","col":"type_code","typ":"character varying(16)","nn":false,"def":null},{"tbl":"reading_questions","col":"answer_slots","typ":"jsonb","nn":true,"def":"''[]''::jsonb"},{"tbl":"reading_questions","col":"accepted_answers","typ":"jsonb","nn":true,"def":"''[]''::jsonb"},{"tbl":"reading_questions","col":"answer_constraint","typ":"jsonb","nn":false,"def":null},{"tbl":"reading_questions","col":"render_mode","typ":"character varying(32)","nn":false,"def":null},{"tbl":"reading_questions","col":"evidence_start_char","typ":"integer","nn":false,"def":null},{"tbl":"reading_questions","col":"evidence_end_char","typ":"integer","nn":false,"def":null},{"tbl":"reading_questions","col":"evidence_type","typ":"character varying(24)","nn":false,"def":null},{"tbl":"reading_questions","col":"source_key","typ":"character varying(40)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"speaking_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"speaking_attempts","col":"prompt_id","typ":"uuid","nn":false,"def":null},{"tbl":"speaking_attempts","col":"part","typ":"speaking_part","nn":true,"def":null},{"tbl":"speaking_attempts","col":"status","typ":"speaking_attempt_status","nn":true,"def":"''recording''::speaking_attempt_status"},{"tbl":"speaking_attempts","col":"recording_object_key","typ":"text","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_original_name","typ":"character varying(255)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_mime_type","typ":"character varying(120)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_size","typ":"integer","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_duration_ms","typ":"integer","nn":false,"def":null},{"tbl":"speaking_attempts","col":"transcript","typ":"text","nn":false,"def":null},{"tbl":"speaking_attempts","col":"transcript_provider","typ":"character varying(60)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"started_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"speaking_attempts","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"speaking_attempts","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"speaking_attempts","col":"transcript_origin","typ":"character varying(10)","nn":false,"def":null},{"tbl":"typing_run_texts","col":"run_id","typ":"uuid","nn":true,"def":null},{"tbl":"typing_run_texts","col":"model_text_id","typ":"uuid","nn":true,"def":null},{"tbl":"typing_run_texts","col":"mistakes","typ":"integer","nn":true,"def":"0"},{"tbl":"typing_run_texts","col":"preset_seconds","typ":"smallint","nn":false,"def":null},{"tbl":"typing_runs","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"typing_runs","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"typing_runs","col":"target_chars","typ":"integer","nn":true,"def":null},{"tbl":"typing_runs","col":"typed_chars","typ":"integer","nn":true,"def":null},{"tbl":"typing_runs","col":"duration_ms","typ":"integer","nn":true,"def":null},{"tbl":"typing_runs","col":"wpm","typ":"numeric(6,1)","nn":true,"def":null},{"tbl":"typing_runs","col":"accuracy","typ":"numeric(5,1)","nn":true,"def":null},{"tbl":"typing_runs","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"video_lessons","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"video_lessons","col":"lesson_id","typ":"uuid","nn":false,"def":null},{"tbl":"video_lessons","col":"provider","typ":"character varying(30)","nn":true,"def":"''youtube''::character varying"},{"tbl":"video_lessons","col":"video_id","typ":"character varying(40)","nn":true,"def":null},{"tbl":"video_lessons","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"video_lessons","col":"before_you_watch","typ":"text","nn":false,"def":null},{"tbl":"video_lessons","col":"duration_seconds","typ":"integer","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript","typ":"jsonb","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript_source","typ":"character varying(20)","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript_attribution","typ":"character varying(200)","nn":false,"def":null},{"tbl":"video_lessons","col":"created_by_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"video_lessons","col":"is_active","typ":"boolean","nn":true,"def":"true"},{"tbl":"video_lessons","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"video_lessons","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"video_lessons","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"video_lessons","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"video_lessons","col":"notes","typ":"text","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript_text","typ":"text","nn":false,"def":null},{"tbl":"writing_prompts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"writing_prompts","col":"task_type","typ":"writing_task_type","nn":true,"def":null},{"tbl":"writing_prompts","col":"category","typ":"character varying(60)","nn":true,"def":null},{"tbl":"writing_prompts","col":"prompt","typ":"text","nn":true,"def":null},{"tbl":"writing_prompts","col":"target_word_count","typ":"integer","nn":true,"def":null},{"tbl":"writing_prompts","col":"is_active","typ":"boolean","nn":true,"def":"true"},{"tbl":"writing_prompts","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"writing_prompts","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"writing_prompts","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"writing_submissions","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"writing_submissions","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"writing_submissions","col":"prompt_id","typ":"uuid","nn":true,"def":null},{"tbl":"writing_submissions","col":"content","typ":"text","nn":true,"def":"''''::text"},{"tbl":"writing_submissions","col":"word_count","typ":"integer","nn":true,"def":"0"},{"tbl":"writing_submissions","col":"status","typ":"writing_status","nn":true,"def":"''draft''::writing_status"},{"tbl":"writing_submissions","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"writing_submissions","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"writing_submissions","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT c.relname AS tbl,a.attname AS col,format_type(a.atttypid,a.atttypmod) AS typ,a.attnotnull AS nn,pg_get_expr(d.adbin,d.adrelid) AS def FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum) x WHERE to_jsonb(x)->>'tbl'=wanted->>'tbl' AND to_jsonb(x)->>'col'=wanted->>'col'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'baseline column mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"tbl":"assignments","name":"assignments_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id)","validated":true},{"tbl":"assignments","name":"assignments_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"assignments","name":"assignments_related_writing_prompt_id_writing_prompts_id_fk","def":"FOREIGN KEY (related_writing_prompt_id) REFERENCES writing_prompts(id)","validated":true},{"tbl":"assignments","name":"assignments_target_user_id_users_id_fk","def":"FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"grammar_attempts","name":"grammar_attempts_exercise_id_grammar_exercises_id_fk","def":"FOREIGN KEY (exercise_id) REFERENCES grammar_exercises(id) ON DELETE CASCADE","validated":true},{"tbl":"grammar_attempts","name":"grammar_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"grammar_attempts","name":"grammar_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"grammar_topics","name":"grammar_topics_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lesson_progress","name":"lesson_progress_lesson_id_lessons_id_fk","def":"FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_progress","name":"lesson_progress_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lesson_progress","name":"lesson_progress_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"lessons","name":"lessons_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lessons","name":"lessons_unit_id_units_id_fk","def":"FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_attempts","name":"listening_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"listening_attempts","name":"listening_attempts_test_id_listening_tests_id_fk","def":"FOREIGN KEY (test_id) REFERENCES listening_tests(id)","validated":true},{"tbl":"listening_attempts","name":"listening_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_packages","name":"listening_packages_pkey","def":"PRIMARY KEY (test_id)","validated":true},{"tbl":"listening_packages","name":"listening_packages_source_id_key","def":"UNIQUE (source_id)","validated":true},{"tbl":"listening_packages","name":"listening_packages_test_id_fkey","def":"FOREIGN KEY (test_id) REFERENCES listening_tests(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_questions","name":"listening_questions_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"listening_questions","name":"listening_questions_test_id_listening_tests_id_fk","def":"FOREIGN KEY (test_id) REFERENCES listening_tests(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_tests","name":"listening_tests_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id)","validated":true},{"tbl":"listening_tests","name":"listening_tests_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"mock_attempts","name":"mock_attempts_mock_test_id_mock_tests_id_fk","def":"FOREIGN KEY (mock_test_id) REFERENCES mock_tests(id) ON DELETE CASCADE","validated":true},{"tbl":"mock_attempts","name":"mock_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"mock_attempts","name":"mock_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"mock_tests","name":"mock_tests_course_id_courses_id_fk","def":"FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE","validated":true},{"tbl":"mock_tests","name":"mock_tests_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"reading_attempts","name":"reading_attempts_passage_id_reading_passages_id_fk","def":"FOREIGN KEY (passage_id) REFERENCES reading_passages(id)","validated":true},{"tbl":"reading_attempts","name":"reading_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"reading_attempts","name":"reading_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"reading_questions","name":"reading_questions_group_id_reading_question_groups_id_fk","def":"FOREIGN KEY (group_id) REFERENCES reading_question_groups(id) ON DELETE CASCADE","validated":true},{"tbl":"reading_questions","name":"reading_questions_passage_id_reading_passages_id_fk","def":"FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE","validated":true},{"tbl":"reading_questions","name":"reading_questions_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"speaking_attempts","name":"speaking_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"speaking_attempts","name":"speaking_attempts_prompt_id_speaking_prompts_id_fk","def":"FOREIGN KEY (prompt_id) REFERENCES speaking_prompts(id) ON DELETE SET NULL","validated":true},{"tbl":"speaking_attempts","name":"speaking_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_mistakes_check","def":"CHECK ((mistakes >= 0))","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_model_text_id_fkey","def":"FOREIGN KEY (model_text_id) REFERENCES writing_model_texts(id) ON DELETE CASCADE","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_pkey","def":"PRIMARY KEY (run_id)","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_preset_seconds_check","def":"CHECK (((preset_seconds IS NULL) OR (preset_seconds = ANY (ARRAY[60, 120, 180]))))","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_run_id_fkey","def":"FOREIGN KEY (run_id) REFERENCES typing_runs(id) ON DELETE CASCADE","validated":true},{"tbl":"typing_runs","name":"typing_runs_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"typing_runs","name":"typing_runs_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"video_lessons","name":"video_lessons_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"video_lessons","name":"video_lessons_lesson_id_lessons_id_fk","def":"FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE","validated":true},{"tbl":"video_lessons","name":"video_lessons_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"writing_prompts","name":"writing_prompts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"writing_submissions","name":"writing_submissions_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"writing_submissions","name":"writing_submissions_prompt_id_writing_prompts_id_fk","def":"FOREIGN KEY (prompt_id) REFERENCES writing_prompts(id)","validated":true},{"tbl":"writing_submissions","name":"writing_submissions_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT c.relname AS tbl,p.conname AS name,pg_get_constraintdef(p.oid) AS def,p.convalidated AS validated FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND p.contype <> 'n' ORDER BY c.relname,p.conname) x WHERE to_jsonb(x)->>'tbl'=wanted->>'tbl' AND to_jsonb(x)->>'name'=wanted->>'name'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'baseline constraint mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $absent$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['assignment_targets','content_imports','content_versions','dictionary_channels','dictionary_drafts','dictionary_entries','dictionary_owner_events','dictionary_publish_jobs','dictionary_recent_searches','dictionary_releases','dictionary_search_terms','dictionary_sense_mappings','lesson_block_responses','lesson_blocks','lesson_notes','mock_sections','reading_assessment_passages','reading_assessments','typing_texts','vocabulary_topic_pack_words','vocabulary_topic_packs'] LOOP IF to_regclass('public.'||quote_ident(t)) IS NOT NULL THEN RAISE EXCEPTION 'STOP: pending table % already exists without journal; reconcile separately',t; END IF; END LOOP; END $absent$;
DO $preserve$ DECLARE t record; extra text[]; n bigint; h text; expected_h text; BEGIN FOR t IN SELECT * FROM qa_recovery_20261012.table_manifest ORDER BY table_name LOOP SELECT coalesce(array_agg(a.attname),ARRAY[]::text[]) INTO extra FROM pg_attribute a WHERE a.attrelid=format('public.%I',t.table_name)::regclass AND a.attnum>0 AND NOT a.attisdropped AND NOT(a.attname=ANY(t.original_columns)); EXECUTE format('SELECT count(*),md5(coalesce(string_agg(md5((to_jsonb(r)-$1)::text),%L ORDER BY md5((to_jsonb(r)-$1)::text)),%L)) FROM public.%I r','','',t.table_name) USING extra INTO n,h; expected_h:=t.rows_md5;  IF n<>t.row_count OR h<>expected_h THEN RAISE EXCEPTION 'STOP: original rows changed unexpectedly for %, count % / %, hash % / %',t.table_name,n,t.row_count,h,expected_h; END IF; END LOOP; END $preserve$;

-- BEGIN canonical 0038_dictionary_releases, SHA256 b54e0187c6c5bcafdd7070437c5a9a27d7d3259ba1a93976544da26da74e916d
CREATE TABLE dictionary_releases (
 id text PRIMARY KEY CHECK (id ~ '^rel-v1-[a-f0-9]{24}$'),
 base_release_id text REFERENCES dictionary_releases(id),
 state text NOT NULL CHECK (state IN ('building','validated','failed')),
 manifest jsonb, manifest_sha text, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), validated_at timestamptz,
 CHECK ((state = 'validated') = (manifest IS NOT NULL AND manifest_sha IS NOT NULL AND validated_at IS NOT NULL))
);


CREATE TABLE dictionary_channels (
 name text PRIMARY KEY CHECK (name = 'stable'),
 active_release_id text NOT NULL REFERENCES dictionary_releases(id),
 previous_release_id text REFERENCES dictionary_releases(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE dictionary_entries (
 release_id text NOT NULL REFERENCES dictionary_releases(id), lexeme_id uuid NOT NULL,
 lemma_norm text NOT NULL, part_of_speech text NOT NULL, lexical_type text NOT NULL,
 payload jsonb NOT NULL, content_sha text NOT NULL,
 PRIMARY KEY(release_id,lexeme_id),
 UNIQUE(release_id,lemma_norm,part_of_speech,lexical_type,lexeme_id)
);


CREATE INDEX dictionary_entries_identity_idx ON dictionary_entries(release_id,lemma_norm,part_of_speech,lexical_type);


CREATE TABLE dictionary_search_terms (
 release_id text NOT NULL, lexeme_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN ('EN','UZ')),
 term text NOT NULL, rank integer NOT NULL CHECK(rank BETWEEN 0 AND 2),
 PRIMARY KEY(release_id,lexeme_id,direction,term),
 FOREIGN KEY(release_id,lexeme_id) REFERENCES dictionary_entries(release_id,lexeme_id)
);


CREATE INDEX dictionary_terms_entry_idx ON dictionary_search_terms(release_id,lexeme_id);


CREATE INDEX dictionary_search_prefix_idx ON dictionary_search_terms(release_id,direction,term text_pattern_ops);


CREATE TABLE dictionary_sense_mappings (
 sense_id uuid PRIMARY KEY, app_sense_id uuid NOT NULL REFERENCES lexemes(id) ON DELETE RESTRICT,
 app_unit_id uuid REFERENCES lexical_units(id) ON DELETE RESTRICT,
 mapping_method text NOT NULL CHECK(mapping_method IN ('canonical_id','exact_identity','new_canonical')),
 created_at timestamptz NOT NULL DEFAULT now()
);


CREATE UNIQUE INDEX dictionary_sense_app_identity_idx ON dictionary_sense_mappings(app_sense_id);


CREATE TABLE dictionary_recent_searches (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 direction text NOT NULL CHECK(direction IN ('EN','UZ')), query_norm text NOT NULL,
 query_display text NOT NULL, lexeme_id uuid NOT NULL,
 searched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,lexeme_id)
);


CREATE INDEX dictionary_recent_user_idx ON dictionary_recent_searches(user_id,searched_at DESC);


CREATE TABLE dictionary_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES users(id),
 base_release_id text NOT NULL REFERENCES dictionary_releases(id), changes jsonb NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','discarded')),
 result_release_id text REFERENCES dictionary_releases(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE dictionary_owner_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 operation text NOT NULL, entity_id text, base_release_id text, candidate_release_id text,result_release_id text,
 before_state jsonb, after_state jsonb, validation_result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE dictionary_publish_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES users(id),
 base_release_id text NOT NULL REFERENCES dictionary_releases(id), candidate_release_id text NOT NULL REFERENCES dictionary_releases(id),
 draft_ids uuid[] NOT NULL, phase text NOT NULL CHECK(phase IN ('copy','apply','index','validate','activate','complete','failed')),
 cursor_id uuid, error text, updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE UNIQUE INDEX dictionary_one_publish_job_idx ON dictionary_publish_jobs((true)) WHERE phase NOT IN ('complete','failed');


CREATE FUNCTION dictionary_immutable_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM dictionary_releases WHERE id IN (OLD.release_id, NEW.release_id) AND state = 'validated') THEN
  RAISE EXCEPTION 'immutable_dictionary_release';
 END IF;
 RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;


CREATE TRIGGER dictionary_entries_immutable BEFORE INSERT OR UPDATE OR DELETE ON dictionary_entries FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release();


CREATE TRIGGER dictionary_terms_immutable BEFORE INSERT OR UPDATE OR DELETE ON dictionary_search_terms FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release();



CREATE FUNCTION dictionary_immutable_registry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state = 'validated' AND (TG_OP = 'DELETE' OR
   ROW(NEW.id,NEW.base_release_id,NEW.state,NEW.manifest,NEW.manifest_sha,NEW.validated_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.base_release_id,OLD.state,OLD.manifest,OLD.manifest_sha,OLD.validated_at)) THEN
  RAISE EXCEPTION 'immutable_dictionary_registry';
 END IF;
 RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;


CREATE TRIGGER dictionary_registry_immutable BEFORE UPDATE OR DELETE ON dictionary_releases FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_registry();

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('b54e0187c6c5bcafdd7070437c5a9a27d7d3259ba1a93976544da26da74e916d',1791800000000);

-- BEGIN canonical 0039_academic_reading_sets, SHA256 7d4bb56a0cbc516f7be38da90c46b55e64be2fc7bd4816b1b6fe993642e0ebbd
CREATE TABLE reading_assessments (
 attempt_id uuid PRIMARY KEY REFERENCES reading_attempts(id) ON DELETE CASCADE,
 set_id uuid NOT NULL REFERENCES general_reading_sets(id),
 title text NOT NULL,
 duration_minutes integer NOT NULL DEFAULT 60 CHECK(duration_minutes = 60)
);


CREATE TABLE reading_assessment_passages (
 attempt_id uuid NOT NULL REFERENCES reading_assessments(attempt_id) ON DELETE CASCADE,
 passage_id uuid NOT NULL REFERENCES reading_passages(id),
 passage_no integer NOT NULL CHECK(passage_no BETWEEN 1 AND 3),
 PRIMARY KEY(attempt_id,passage_no), UNIQUE(attempt_id,passage_id)
);

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('7d4bb56a0cbc516f7be38da90c46b55e64be2fc7bd4816b1b6fe993642e0ebbd',1791900000000);

-- BEGIN canonical 0040_content_imports, SHA256 07061c332c848f89d17fd0510884a097eaabd01a429bf2d1f846e56d02a0a397
-- 0040 Structured content imports (canonical Learners Area Content Package ingest).
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops
-- at 0027 (0028-0039 were hand-written too), so `drizzle-kit generate` would
-- regenerate the whole schema instead of a delta.
--
-- Adds:
--   1. content_imports        — the canonical ingest ledger (provenance,
--                               content hash, content version, actor, result)
--   2. listening_packages.legacy_runtime — the EXPLICIT legacy marker, backfilled
--                               from the structural fact (an authoredRuntime
--                               payload), never from a title or a filename.
CREATE TYPE "public"."content_import_status" AS ENUM('validated', 'created', 'updated', 'unchanged', 'rejected', 'converted');

CREATE TABLE IF NOT EXISTS "content_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" varchar(20) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"schema_version" integer NOT NULL,
	"import_version" integer DEFAULT 1 NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"status" "content_import_status" NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid,
	"actor_user_id" uuid,
	"original_filename" varchar(255),
	"legacy_runtime" boolean DEFAULT false NOT NULL,
	"assets" jsonb,
	"provenance" jsonb,
	"result" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "content_imports_source_idx" ON "content_imports" USING btree ("module","content_type","source_ref");

CREATE INDEX IF NOT EXISTS "content_imports_created_idx" ON "content_imports" USING btree ("created_at");

ALTER TABLE "listening_packages" ADD COLUMN IF NOT EXISTS "legacy_runtime" boolean DEFAULT false NOT NULL;

UPDATE "listening_packages" SET "legacy_runtime" = true WHERE "payload" -> 'authoredRuntime' IS NOT NULL AND "legacy_runtime" = false;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('07061c332c848f89d17fd0510884a097eaabd01a429bf2d1f846e56d02a0a397',1792000000000);

-- BEGIN canonical 0041_content_versions, SHA256 594b74d0e36b1dda3a9e783d5de1f880fbe176e63e0209f7c4f2772c94640e35
-- 0041 Content versions + attempt version binding (+ score policy versioning).
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027 (0028-0040 were hand-written too), so `drizzle-kit generate` would
-- re-emit the whole schema instead of a delta.
--
-- Why this exists (Master Prompt 2 §13, §22, §33, §42, §71, §72):
--   • an EDIT of an answer key, prompt or question wording must never silently
--     change what a historical attempt appears to have tested;
--   • a formal composition (mock, sectional mock) must reference an EXACT
--     version, so composing it twice cannot pick up a later edit;
--   • a raw score must be convertible to a band by a policy that is versioned,
--     so an old result keeps the conversion that was valid for it.
--
--  1. content_versions                 — one immutable row per accepted content
--                                        revision, keyed by module + contentType +
--                                        sourceRef + version number.
--  2. attempt binding columns          — every assessment attempt records the
--                                        content version it started with.
--  3. score_policy_version columns      — a result records the conversion policy
--                                        that produced its band.
CREATE TYPE "public"."content_version_status" AS ENUM('draft', 'published', 'superseded', 'archived');

CREATE TABLE IF NOT EXISTS "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" varchar(20) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"version_no" integer NOT NULL,
	"status" "content_version_status" DEFAULT 'draft' NOT NULL,
	"title" varchar(200) NOT NULL,
	"track" varchar(24) DEFAULT 'unspecified' NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"semantic_hash" varchar(64) NOT NULL,
	"answer_key_hash" varchar(64) NOT NULL,
	"publication_state" varchar(16) DEFAULT 'draft' NOT NULL,
	"target_type" varchar(40),
	"target_id" uuid,
	"content_import_id" uuid,
	"created_by_user_id" uuid,
	"change_kind" varchar(24) DEFAULT 'created' NOT NULL,
	"provenance" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);

ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_import_id_content_imports_id_fk" FOREIGN KEY ("content_import_id") REFERENCES "public"."content_imports"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "content_versions_identity_idx" ON "content_versions" USING btree ("module","content_type","source_ref","version_no");

CREATE INDEX IF NOT EXISTS "content_versions_target_idx" ON "content_versions" USING btree ("target_type","target_id");

CREATE INDEX IF NOT EXISTS "content_versions_ref_idx" ON "content_versions" USING btree ("module","content_type","source_ref","status");

ALTER TABLE "listening_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;

ALTER TABLE "listening_attempts" ADD COLUMN IF NOT EXISTS "score_policy_version" varchar(24);

ALTER TABLE "reading_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;

ALTER TABLE "reading_attempts" ADD COLUMN IF NOT EXISTS "score_policy_version" varchar(24);

ALTER TABLE "writing_submissions" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;

ALTER TABLE "speaking_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;

ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "score_policy_version" varchar(24);

-- A version that is deleted must not take an attempt with it: the binding is a
-- historical fact, and a missing version degrades to "unknown version", never to
-- a lost attempt.
ALTER TABLE "listening_attempts" ADD CONSTRAINT "listening_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "writing_submissions" ADD CONSTRAINT "writing_submissions_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('594b74d0e36b1dda3a9e783d5de1f880fbe176e63e0209f7c4f2772c94640e35',1792100000000);

-- BEGIN canonical 0042_mock_composition, SHA256 7323615d9a62864532b1e23a48d20c7a11654eeba34278554303c73eec0b00f9
-- 0042 Mock composition: a mock is an ORCHESTRATION OBJECT, never copied content.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027 (0028-0041 were hand-written too), so `drizzle-kit generate` would
-- re-emit the whole schema instead of a delta.
--
-- Before this migration `mock_tests` was a catalogue row (id, course_id, title,
-- skill) and `mock_attempts` held a score — there was no way to say WHICH
-- Listening test a mock contained, no way to pin the revision a learner was
-- graded against, and no place for the assessment policy that §15/§16 require to
-- live outside React.
--
--  1. mock_tests gains the assessment policy: track, kind, timing policy,
--     navigation policy, score-policy references, publication state, version.
--  2. mock_sections holds the MEMBERSHIP: which canonical content, at which
--     exact content version, in which order, with how long. Nothing is copied —
--     a section is a reference.
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "description" text;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "track" varchar(24) DEFAULT 'unspecified' NOT NULL;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "kind" varchar(24) DEFAULT 'sectional' NOT NULL;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "timing_policy_id" varchar(40);

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "timing_policy_version" varchar(24);

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "navigation" jsonb;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "score_policies" jsonb;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "publication_state" "publication_state" DEFAULT 'draft' NOT NULL;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "publish_at" timestamp with time zone;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "provenance" jsonb;

ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "mock_tests" ADD CONSTRAINT "mock_tests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "mock_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mock_test_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"skill" varchar(16) NOT NULL,
	"module" varchar(20) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"content_version_id" uuid,
	"label" varchar(120),
	"question_count" integer,
	"seconds" integer,
	"optional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "mock_sections" ADD CONSTRAINT "mock_sections_mock_test_id_mock_tests_id_fk" FOREIGN KEY ("mock_test_id") REFERENCES "public"."mock_tests"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "mock_sections" ADD CONSTRAINT "mock_sections_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "mock_sections_position_idx" ON "mock_sections" USING btree ("mock_test_id","position");

CREATE INDEX IF NOT EXISTS "mock_sections_version_idx" ON "mock_sections" USING btree ("content_version_id");

-- A learner's mock attempt records the mock VERSION it started, so a later edit of
-- the composition cannot rewrite what that attempt was (§13).
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "mock_version" integer;

ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "section_results" jsonb;

ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "status" varchar(24) DEFAULT 'in_progress' NOT NULL;

ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "content_version_bindings" jsonb;


-- Learner history must outlive the thing it was taken against (§94, §103).
-- Deleting a mock removes its composition, never the learner's record of it.
ALTER TABLE "mock_attempts" ALTER COLUMN "mock_test_id" DROP NOT NULL;

ALTER TABLE "mock_attempts" DROP CONSTRAINT IF EXISTS "mock_attempts_mock_test_id_mock_tests_id_fk";

ALTER TABLE "mock_attempts" ADD CONSTRAINT "mock_attempts_mock_test_id_mock_tests_id_fk" FOREIGN KEY ("mock_test_id") REFERENCES "public"."mock_tests"("id") ON DELETE set null ON UPDATE no action;

-- Snapshot of what the attempt was taken against, copied at start time so an
-- orphaned attempt is still readable without the mock row.
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "mock_snapshot" jsonb;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('7323615d9a62864532b1e23a48d20c7a11654eeba34278554303c73eec0b00f9',1792200000000);

-- BEGIN canonical 0043_authoring_identity, SHA256 e517578ebdf508d5490f0b66236358f1f054100745aa1aa62e5eef8f3d4dc52c
-- Authoring identity + canonical question type codes (Phase 2, §38/§43/§41).
--
-- Three small gaps that authoring exposed, none of them a redesign:
--
--   1. A listening QUESTION could not record WHICH of the 14 canonical Listening
--      types it is: the storage enum only knows multiple_choice/short_answer, so
--      "practise Matching Features" was unrecoverable for hand-authored material
--      (imported material kept the type inside the package). `type_code` holds the
--      canonical type id, exactly like reading_questions already does.
--   2. A listening TEST had no stable source identity, while reading passages and
--      speaking prompts both do. A versioned content row needs something to be the
--      version OF, and re-authoring the same test must not create a second copy.
--   3. Grammar topics and writing prompts had no `source_ref`, so the authored
--      versions of them could not be pinned to the row they describe.
--
-- Additive only: no column is dropped, no row is rewritten, and every new column
-- is nullable except grammar_topics.publication_state, whose default 'published'
-- keeps existing topics visible exactly as they are today.

ALTER TABLE "listening_questions" ADD COLUMN IF NOT EXISTS "type_code" varchar(40);

ALTER TABLE "listening_tests" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);

ALTER TABLE "writing_prompts" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);

ALTER TABLE "grammar_topics" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);

ALTER TABLE "grammar_topics" ADD COLUMN IF NOT EXISTS "publication_state" "publication_state" DEFAULT 'published' NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "listening_tests_source_ref_idx" ON "listening_tests" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "writing_prompts_source_ref_idx" ON "writing_prompts" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "grammar_topics_source_ref_idx" ON "grammar_topics" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "listening_questions_type_code_idx" ON "listening_questions" USING btree ("type_code");

-- Canonical Reading type ids are longer than the 16 characters the imported
-- library's short source codes needed ("true_false_not_given" is 20), and a
-- hand-authored question has only its canonical id to go by.
ALTER TABLE "reading_questions" ALTER COLUMN "type_code" TYPE varchar(40);

-- A pinned revision must be READABLE, not just hashable: composition and review
-- re-read the content a learner actually sat, so the canonical content of every
-- revision is stored alongside its hashes (§71). Bounded: one row per revision,
-- never per attempt, and revisions are created by staff, not by traffic.
ALTER TABLE "content_versions" ADD COLUMN IF NOT EXISTS "content_snapshot" jsonb;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('e517578ebdf508d5490f0b66236358f1f054100745aa1aa62e5eef8f3d4dc52c',1792200100000);

-- BEGIN canonical 0044_lesson_blocks, SHA256 85b33a5fdecfa4240ea5281c6dd4ce73ae9e3d7e43fb7ef376cedfd363b314a9
-- Lesson architecture + typed native content blocks (Phase 2, §26, §27, §28, §84).
--
-- The course structure (courses → course_modules → units → lessons) already
-- existed; what a lesson could CONTAIN did not. This migration gives a lesson:
--
--   1. a publication lifecycle and stable identity, so an authored lesson is a
--      draft until someone publishes it, exactly like every other content type;
--   2. typed native blocks. A lesson is a sequence of typed blocks, never an
--      embedded mini application: `text` is plain text, `link` is an https URL,
--      `file`/`image`/`audio`/`video` are private storage keys, `quiz` is a
--      canonical question type + its answer model, and `content_reference` points
--      at canonical content (pinned or latest) instead of copying it.
--   3. learner answers to quiz blocks, graded through the shared question-type
--      registry, so a lesson quiz cannot invent its own grading rules.
--
-- Additive only. Existing lessons become published (the column default), so no
-- learner surface changes because of this migration. No column is dropped.

ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);

ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "publication_state" "publication_state" DEFAULT 'published' NOT NULL;

ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "publish_at" timestamp with time zone;

ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "estimated_minutes" integer;

ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;

ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "lessons_source_ref_idx" ON "lessons" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "lessons_unit_order_idx" ON "lessons" USING btree ("unit_id","order");

CREATE TYPE "public"."lesson_block_type" AS ENUM('text', 'image', 'audio', 'video', 'file', 'link', 'quiz', 'content_reference');

CREATE TABLE IF NOT EXISTS "lesson_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "lesson_block_type" NOT NULL,
	"text_content" text,
	"link_url" text,
	"object_key" text,
	"original_name" varchar(255),
	"mime_type" varchar(120),
	"size" integer,
	"ref_module" varchar(20),
	"ref_content_type" varchar(40),
	"ref_source_ref" varchar(80),
	"ref_content_version_id" uuid,
	"quiz_question_type" varchar(40),
	"quiz_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "lesson_blocks" ADD CONSTRAINT "lesson_blocks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "lesson_blocks" ADD CONSTRAINT "lesson_blocks_ref_content_version_id_content_versions_id_fk" FOREIGN KEY ("ref_content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "lesson_blocks_position_idx" ON "lesson_blocks" USING btree ("lesson_id","position");

CREATE INDEX IF NOT EXISTS "lesson_blocks_lesson_idx" ON "lesson_blocks" USING btree ("lesson_id");

CREATE INDEX IF NOT EXISTS "lesson_blocks_reference_idx" ON "lesson_blocks" USING btree ("ref_module","ref_content_type","ref_source_ref");

CREATE TABLE IF NOT EXISTS "lesson_block_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"answer" jsonb,
	"correct" boolean,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "lesson_block_responses" ADD CONSTRAINT "lesson_block_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "lesson_block_responses" ADD CONSTRAINT "lesson_block_responses_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "lesson_block_responses" ADD CONSTRAINT "lesson_block_responses_block_id_lesson_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."lesson_blocks"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "lesson_block_responses_user_block_idx" ON "lesson_block_responses" USING btree ("user_id","block_id");

CREATE INDEX IF NOT EXISTS "lesson_block_responses_lesson_idx" ON "lesson_block_responses" USING btree ("lesson_id","user_id");

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('85b33a5fdecfa4240ea5281c6dd4ce73ae9e3d7e43fb7ef376cedfd363b314a9',1792200200000);

-- BEGIN canonical 0045_media_lessons, SHA256 c9d728b966b5334ffac970a0346023071f78da4b3f0388758bb99fbab578d7d3
-- Media lessons: video AND audio as first-class content (Phase 2, §27, §28, §29).
--
-- TED / Podcast items already live in `video_lessons` (provider reference,
-- transcript, notes, authored questions, vocabulary ingested into the canonical
-- lexical system). Two things were missing for them to be content like everything
-- else:
--
--   1. `media_kind` — a Podcast episode is an AUDIO lesson, not a video with a
--      missing picture. The kind decides which content type the item's revision is
--      recorded under (`video_lesson` / `audio_lesson`) and which renderer the
--      learner gets.
--   2. `source_ref` — stable identity, so re-authoring the same item revises it
--      instead of creating a second copy, and so a lesson block or an assignment
--      can reference it.
--
-- Additive and backwards compatible: every existing row is a video lesson, which is
-- what the default says.

ALTER TABLE "video_lessons" ADD COLUMN IF NOT EXISTS "media_kind" varchar(10) DEFAULT 'video' NOT NULL;

ALTER TABLE "video_lessons" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);

CREATE UNIQUE INDEX IF NOT EXISTS "video_lessons_source_ref_idx" ON "video_lessons" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "video_lessons_media_kind_idx" ON "video_lessons" USING btree ("media_kind","publication_state");

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('c9d728b966b5334ffac970a0346023071f78da4b3f0388758bb99fbab578d7d3',1792200300000);

-- BEGIN canonical 0046_vocabulary_topic_packs, SHA256 d0251d7d0f4fda6a838c330fc51fe6adebc0c150cf020141db53968b983f577a
-- Vocabulary topic packs as canonical content (Phase 2, §31, §76, §100).
--
-- Topic packs existed only as a TypeScript constant, so adding one required a
-- deployment. They now live in the database — WITHOUT becoming a second word
-- store:
--
--   * every word in a pack IS a `lexemes` row (the one canonical sense table the
--     whole vocabulary system already uses: the same table Reading, Listening and
--     TED/Podcast occurrences resolve into);
--   * a pack is a relational MEMBERSHIP list over those senses, with a stable
--     identity, a publication lifecycle and revision history like every other
--     content type;
--   * nothing here duplicates a definition. The glosses stay on the lexeme.
--
-- Additive only. Existing installs keep working from the built-in packs until the
-- migration tool seeds them (see scripts/content-backfill-vocabulary-packs.ts),
-- and `vocabulary_topic_pack_words.lexeme_id` is what makes the two impossible to
-- drift apart.

CREATE TABLE IF NOT EXISTS "vocabulary_topic_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"label_en" varchar(120) NOT NULL,
	"label_uz" varchar(120),
	"topic_code" varchar(40),
	"position" integer DEFAULT 0 NOT NULL,
	"level" varchar(10),
	"publication_state" "publication_state" DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "vocabulary_topic_packs" ADD CONSTRAINT "vocabulary_topic_packs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_packs_source_ref_idx" ON "vocabulary_topic_packs" USING btree ("source_ref");

CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_packs_slug_idx" ON "vocabulary_topic_packs" USING btree ("slug");

CREATE TABLE IF NOT EXISTS "vocabulary_topic_pack_words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "vocabulary_topic_pack_words" ADD CONSTRAINT "vocabulary_topic_pack_words_pack_id_vocabulary_topic_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."vocabulary_topic_packs"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "vocabulary_topic_pack_words" ADD CONSTRAINT "vocabulary_topic_pack_words_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_pack_words_position_idx" ON "vocabulary_topic_pack_words" USING btree ("pack_id","position");

CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_pack_words_lexeme_idx" ON "vocabulary_topic_pack_words" USING btree ("pack_id","lexeme_id");

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('d0251d7d0f4fda6a838c330fc51fe6adebc0c150cf020141db53968b983f577a',1792200400000);

-- BEGIN canonical 0047_assignments_canonical, SHA256 210927a617c29017ee9ba5e05f4155ce3c707895a7cb3b1e62ba1cc532885cf4
-- Assignments over canonical content + grammar attempt binding (Phase 2, §24, §25,
-- §30, §71, §99).
--
-- An assignment used to be prose pointing at an optional writing prompt, with one
-- student per row. A task must now reference CANONICAL content — module, content
-- type, source ref and the EXACT revision assigned — so a learner's work stays
-- connected to what they were actually given, even after the content is edited.
--
-- Three changes, all additive:
--
--   1. `assignments` gains the canonical reference (module/content_type/source_ref
--      plus `content_version_id`). The old `related_writing_prompt_id` stays and is
--      kept in step for writing prompts, so existing screens keep working
--      (COMPATIBILITY ONLY — the canonical columns are what new code reads).
--   2. New `assignment_targets`: one row per student a task is set for, with its own
--      status. `assignments.target_user_id` remains the PRIMARY target of legacy
--      rows, so nothing that reads it breaks.
--   3. `grammar_attempts` gains `content_version_id`, so a grammar attempt records
--      the topic revision it was answered against (§71).

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "module" varchar(20);

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "content_type" varchar(40);

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "instructions" text;

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "assignments" ADD CONSTRAINT "assignments_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "assignments_content_idx" ON "assignments" USING btree ("module","content_type","source_ref");

CREATE INDEX IF NOT EXISTS "assignments_version_idx" ON "assignments" USING btree ("content_version_id");

CREATE TABLE IF NOT EXISTS "assignment_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'not_started' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "assignment_targets_pair_idx" ON "assignment_targets" USING btree ("assignment_id","student_user_id");

CREATE INDEX IF NOT EXISTS "assignment_targets_student_idx" ON "assignment_targets" USING btree ("student_user_id","status");

ALTER TABLE "grammar_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;

ALTER TABLE "grammar_attempts" ADD CONSTRAINT "grammar_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('210927a617c29017ee9ba5e05f4155ce3c707895a7cb3b1e62ba1cc532885cf4',1792200500000);

-- BEGIN canonical 0048_typing_trainer, SHA256 813f3c8566afa4c1c6df10584e7041f58576d9558f384cb81cfe623c8c415ef0
-- Learners Area Writing → Typing trainer.
-- Additive migration: keep legacy model-text typing history and add the
-- owner-supplied 30-text B1/B2 corpus + server-verifiable run metrics.

CREATE TABLE IF NOT EXISTS "typing_texts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_id" varchar(80) NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "language" varchar(10) DEFAULT 'en' NOT NULL,
  "word_count" integer NOT NULL,
  "difficulty" varchar(20),
  "topic" varchar(160),
  "provenance" varchar(200) NOT NULL,
  "publication_state" "publication_state" DEFAULT 'draft' NOT NULL,
  "publish_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "typing_texts_word_count_chk" CHECK ("word_count" >= 100)
);


CREATE UNIQUE INDEX IF NOT EXISTS "typing_texts_external_id_uq" ON "typing_texts" ("external_id");


CREATE INDEX IF NOT EXISTS "typing_texts_publication_idx" ON "typing_texts" ("publication_state","language");



ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "run_token_id" uuid;


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "raw_wpm" numeric(6,1);


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "consistency" numeric(5,1);


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_correct" integer;


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_incorrect" integer;


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_extra" integer;


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_missed" integer;


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;


ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;


CREATE UNIQUE INDEX IF NOT EXISTS "typing_runs_run_token_uq" ON "typing_runs" ("run_token_id") WHERE "run_token_id" IS NOT NULL;



ALTER TABLE "typing_run_texts" ALTER COLUMN "model_text_id" DROP NOT NULL;


ALTER TABLE "typing_run_texts" ADD COLUMN IF NOT EXISTS "typing_text_id" uuid REFERENCES "typing_texts"("id") ON DELETE RESTRICT;


DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'typing_run_texts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%preset_seconds%'
  LOOP
    EXECUTE format('ALTER TABLE typing_run_texts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;


ALTER TABLE "typing_run_texts" ADD CONSTRAINT "typing_run_texts_preset_seconds_chk"
  CHECK ("preset_seconds" IS NULL OR "preset_seconds" IN (30,60,120,180));


ALTER TABLE "typing_run_texts" DROP CONSTRAINT IF EXISTS "typing_run_texts_one_target_chk";


ALTER TABLE "typing_run_texts" ADD CONSTRAINT "typing_run_texts_one_target_chk"
  CHECK (("model_text_id" IS NOT NULL) <> ("typing_text_id" IS NOT NULL));



INSERT INTO "typing_texts"
  ("external_id","title","body","language","word_count","difficulty","topic","provenance","publication_state")
VALUES
(
  'la-typing-b1b2-01',
  $la$A Healthy Morning Routine$la$,
  $la$A good morning routine can make the whole day easier. Many students wake up, check their phones, and stay in bed for a long time. This can make them feel tired before the day has really started. A better routine does not need to be complicated. First, try to wake up at the same time every day. Open the window, drink a glass of water, and move your body for a few minutes. You can stretch, walk around the room, or do some simple exercises. After that, wash your face and eat a basic breakfast. Eggs, bread, fruit, or yogurt can give you energy for study. It is also useful to look at your plan for the day. Choose two or three important tasks instead of making a very long list. If possible, do not open social media during the first thirty minutes after waking up. A calm start can help you think clearly, feel more active, and begin your work with less stress.$la$,
  'en',
  164,
  'B1/B2',
  $la$A Healthy Morning Routine$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-02',
  $la$Learning English Every Day$la$,
  $la$Learning English becomes easier when you practise a little every day. You do not need to study for five hours at once. In fact, short and regular practice is often more useful. For example, you can spend fifteen minutes reading a simple article, ten minutes learning new words, and ten minutes listening to English. You can also speak to yourself about your day. This may feel strange at first, but it helps you become more confident. When you learn a new word, do not only write the translation. Try to make your own sentence with it. This helps you remember the word in a real situation. Watching short videos with English subtitles can also be helpful. If the video is too difficult, choose an easier one instead of stopping completely. The most important thing is consistency. Some days will be better than others, and that is normal. If you continue practising, your reading, listening, speaking, and writing will slowly improve over time.$la$,
  'en',
  162,
  'B1/B2',
  $la$Learning English Every Day$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-03',
  $la$Why Walking Is Good for You$la$,
  $la$Walking is one of the simplest ways to stay healthy. You do not need special equipment, an expensive gym, or a personal trainer. A comfortable pair of shoes is usually enough. Walking for thirty minutes a day can improve your mood, help your heart, and give you more energy. It is also a good activity for people who spend many hours sitting at school or at a computer. You can walk in the morning, after lunch, or in the evening. Some people enjoy walking alone because it gives them time to think. Others prefer walking with a friend or family member because they can talk at the same time. If thirty minutes feels difficult, begin with ten minutes and increase the time slowly. You can also choose stairs instead of a lift or walk to a nearby shop. Small choices can make a real difference. The best exercise is often the one that is easy enough to continue regularly for many months.$la$,
  'en',
  162,
  'B1/B2',
  $la$Why Walking Is Good for You$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-04',
  $la$My Ideal Study Place$la$,
  $la$Everyone studies better in a different environment, but a good study place usually has a few important things. It should be quiet enough for concentration and comfortable enough for long study sessions. A simple desk and chair are often better than studying in bed because the brain connects the bed with sleep. Good light is also important. Natural light from a window is ideal during the day, while a desk lamp can help in the evening. I also think the study area should be clean. Too many books, cables, clothes, or other objects can make the mind feel busy. Before studying, I like to prepare everything I need, such as a notebook, pens, water, and my laptop. I also put my phone away or turn off unnecessary notifications. Sometimes soft background music helps, but music with lyrics can be distracting. A good study place does not have to be beautiful or expensive. It only needs to help you focus and make studying easier.$la$,
  'en',
  163,
  'B1/B2',
  $la$My Ideal Study Place$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-05',
  $la$The Value of Reading Books$la$,
  $la$Reading books is a useful habit for students of all ages. Books can teach us new information, improve our vocabulary, and help us understand different ideas. Reading also trains the mind to stay focused for a longer time. This is especially important today because many people spend hours watching short videos and quickly moving from one post to another. At first, reading for thirty or forty minutes may feel difficult. A simple way to start is to read five or ten pages each day. Choosing the right book is also important. If a book is too difficult or boring, you may lose interest quickly. It is better to begin with a topic you already enjoy. Students who are learning English can read short stories or easy non-fiction books. They do not need to understand every word. The main goal is to follow the general meaning. Over time, regular reading can improve language skills, concentration, imagination, and even writing ability.$la$,
  'en',
  159,
  'B1/B2',
  $la$The Value of Reading Books$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-06',
  $la$Using Social Media Wisely$la$,
  $la$Social media can be useful, but it can also take a lot of time. People use it to talk to friends, follow news, learn new skills, and enjoy entertainment. However, it is easy to spend much longer online than planned. A person may open an app for five minutes and still be scrolling one hour later. One way to control this habit is to decide when to use social media. For example, you can avoid it during study time and check it only after finishing an important task. Turning off unnecessary notifications can also help because every sound or message can break your concentration. Another useful idea is to stop following pages that do not give you anything valuable. You can replace some entertainment accounts with educational ones. It is not necessary to completely delete every app. The main goal is to use technology on purpose instead of using it automatically. Social media should be a tool in your life, not something that controls your attention.$la$,
  'en',
  166,
  'B1/B2',
  $la$Using Social Media Wisely$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-07',
  $la$A Weekend in the Countryside$la$,
  $la$Spending a weekend in the countryside can be a pleasant break from a busy city. The air is often cleaner, the streets are quieter, and there is usually less traffic. In the morning, people may wake up to the sound of birds instead of cars. A countryside weekend can include simple activities such as walking, helping in the garden, riding a bicycle, or having tea outside. It is also a good chance to spend time with family without constantly checking a phone. Some people think the countryside is boring because there are fewer shops, cinemas, and restaurants. However, this slower lifestyle can be relaxing. It gives the mind time to rest. The countryside also teaches people to enjoy simple things, such as fresh food, open space, and quiet evenings. Of course, living there permanently is different from visiting for a weekend. Still, a short visit can help people return to work or study feeling calmer and more refreshed.$la$,
  'en',
  158,
  'B1/B2',
  $la$A Weekend in the Countryside$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-08',
  $la$Why Sleep Matters for Students$la$,
  $la$Sleep is very important for students because the brain needs rest to work well. When people do not sleep enough, they often find it harder to concentrate, remember information, and control their mood. Some students stay awake late because they want more time to study. However, studying when the brain is extremely tired is not always effective. A better plan is to finish important work earlier and try to sleep at a regular time. Most young adults need several hours of good-quality sleep every night. The bedroom should be dark, quiet, and comfortable. Using a phone in bed can make sleeping more difficult because bright screens and exciting content keep the mind active. It can help to stop using screens thirty or sixty minutes before bedtime. Reading a simple book, preparing clothes for the next day, or writing a short plan can be calmer choices. Good sleep is not wasted time. It is part of successful learning and healthy daily life.$la$,
  'en',
  161,
  'B1/B2',
  $la$Why Sleep Matters for Students$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-09',
  $la$Saving Money as a Student$la$,
  $la$Saving money can be difficult for students because they often have limited income. However, even small amounts can become useful over time. The first step is to understand where your money goes. You can write down your spending for one or two weeks and divide it into categories such as food, transport, study, and entertainment. After that, it becomes easier to see unnecessary expenses. For example, buying a drink or snack every day may seem cheap, but the total cost at the end of the month can be surprising. Students can also compare prices before buying something and avoid shopping when they are bored. It is useful to save a fixed amount as soon as money arrives instead of waiting to see what is left later. Saving does not mean never enjoying life. It means making choices. A simple budget can help students prepare for important needs, reduce stress, and learn financial habits that will be valuable in the future.$la$,
  'en',
  160,
  'B1/B2',
  $la$Saving Money as a Student$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-10',
  $la$Learning from Mistakes$la$,
  $la$Making mistakes is a normal part of learning. Students sometimes feel embarrassed when they give a wrong answer, pronounce a word incorrectly, or receive a low score. However, mistakes can show exactly what needs more practice. For example, if you often make the same grammar error, you can write several correct examples and review them later. If you miss questions in a reading test, you can study why your answer was wrong instead of only looking at the correct letter. It is important to separate a mistake from your identity. One bad result does not mean you are a bad student. Progress usually happens slowly and includes many small failures. Teachers can help by giving clear feedback, but students also need to review that feedback carefully. The most useful question is not, “Why am I bad at this?” but, “What can I do differently next time?” People who learn from mistakes become more independent, patient, and confident because they understand that improvement is a process.$la$,
  'en',
  165,
  'B1/B2',
  $la$Learning from Mistakes$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-11',
  $la$Cooking at Home$la$,
  $la$Cooking at home has many advantages. It can be cheaper than eating at restaurants, and it gives you more control over what you eat. When you prepare your own food, you can choose fresh ingredients and reduce the amount of oil, sugar, or salt. Cooking is also a practical skill that becomes more valuable when people start living independently. Beginners do not need to make difficult meals. Simple dishes such as rice, eggs, soup, pasta, salads, and baked vegetables are enough to start. It is useful to learn a few basic recipes and repeat them until they become easy. Planning meals before going shopping can also save both money and time. Of course, cooking every day requires effort, and sometimes people are too busy. In that case, preparing extra food for the next day can help. Cooking can even become an enjoyable activity. Some people listen to music or cook with family members. A simple homemade meal can be healthy, affordable, and satisfying.$la$,
  'en',
  163,
  'B1/B2',
  $la$Cooking at Home$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-12',
  $la$The Importance of Good Friends$la$,
  $la$Good friends can make life happier and easier. A real friend is not only someone who spends time with you when everything is going well. Good friends also listen when you have a problem, give honest advice, and respect your feelings. Friendship is a two-way relationship, so both people need to make an effort. This includes keeping promises, apologising after mistakes, and being happy when the other person succeeds. It is normal for friends to disagree sometimes. A healthy friendship does not require two people to have the same opinion about everything. The important thing is how they communicate during a disagreement. Shouting, insulting, or trying to control another person can damage trust. Good friends can also encourage positive habits. For example, they may study together, exercise, or remind each other about goals. Quality is usually more important than quantity. Having a few people you can trust may be more valuable than knowing hundreds of people online but feeling alone when you need real support.$la$,
  'en',
  165,
  'B1/B2',
  $la$The Importance of Good Friends$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-13',
  $la$Studying with a Plan$la$,
  $la$A study plan can help students use their time more effectively. Without a plan, it is easy to spend a long time deciding what to do and then begin too late. A useful plan does not need to include every minute of the day. It can simply show the main tasks and the time available for them. First, choose the most important subjects or skills. Then divide large tasks into smaller steps. For example, “study English” is too general, while “read one passage and review ten words” is much clearer. It is also helpful to include short breaks because concentration becomes weaker after a long period of work. Some students prefer studying in the morning, while others work better in the afternoon or evening. The best schedule is one that matches your real life. At the end of the day, look at what you completed and adjust the next plan if necessary. A plan should guide you, not make you feel guilty when something changes.$la$,
  'en',
  165,
  'B1/B2',
  $la$Studying with a Plan$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-14',
  $la$Public Transport in Cities$la$,
  $la$Public transport is an important part of life in many cities. Buses, trains, and underground systems help large numbers of people travel without using private cars. This can reduce traffic and pollution, especially when the service is reliable and affordable. Public transport is also useful for students and workers who cannot or do not want to drive. However, there can be problems. During busy hours, buses and trains may become crowded. Delays can also cause people to arrive late at school or work. A good transport system should be clean, safe, frequent, and easy to understand. Clear maps and digital information can help passengers plan their journeys. Cities can also create special lanes for buses so they do not spend too much time in traffic. Although public transport may not be perfect, improving it can make city life easier for everyone. When more people choose buses or trains, roads can become less crowded and the environment can benefit as well.$la$,
  'en',
  160,
  'B1/B2',
  $la$Public Transport in Cities$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-15',
  $la$Learning a New Skill$la$,
  $la$Learning a new skill can be exciting, but the beginning is often difficult. Whether a person wants to learn coding, cooking, drawing, chess, or a new language, the first steps usually feel slow. Many beginners make the mistake of trying to learn everything at the same time. A better method is to focus on one small skill and practise it regularly. For example, someone learning to type faster can first work on correct finger position before trying to increase speed. It is also useful to track progress. Small improvements may be difficult to notice from day to day, but they become clear after several weeks. Beginners should expect to make mistakes and sometimes feel confused. This does not mean they are failing. It usually means the brain is learning something unfamiliar. Finding a good teacher, course, book, or practice system can save time. Most importantly, regular practice is more powerful than occasional motivation. Skill grows through repetition, patience, and useful feedback.$la$,
  'en',
  161,
  'B1/B2',
  $la$Learning a New Skill$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-16',
  $la$A Simple Digital Detox$la$,
  $la$Many people spend several hours a day looking at screens. Phones and computers are useful for work, study, communication, and entertainment, but too much screen time can make the mind feel tired. A digital detox does not mean giving up technology forever. It can simply mean taking a planned break. For example, you can choose one evening a week when you do not use social media. During that time, you can walk, read, talk with family, clean your room, or prepare for the next day. Another idea is to keep the phone away from the table during meals. This makes conversations more natural and helps people pay attention to their food. You can also remove apps from the home screen if you open them automatically. The goal is not to hate technology. The goal is to control when and why you use it. Even a short break can improve concentration and remind you that many enjoyable activities do not require a screen.$la$,
  'en',
  162,
  'B1/B2',
  $la$A Simple Digital Detox$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-17',
  $la$The Benefits of Learning to Type$la$,
  $la$Typing is a useful skill for students because much of modern study happens on computers. Faster typing can save time when writing essays, taking notes, answering online questions, or doing research. However, speed is not the only goal. Accuracy is equally important. A person who types very quickly but makes many mistakes may spend extra time correcting them. Beginners should first learn where the keys are and try to use the correct fingers. It can feel slower at the beginning, but this method helps build good habits. Short daily practice is usually better than one very long session each week. Five or ten minutes can be enough if the practice is focused. Students can copy simple texts, type common words, and gradually work with longer paragraphs. They should also sit comfortably and keep their wrists relaxed. Over time, typing can become automatic. When students no longer need to search for every key, they can focus more on their ideas and less on the keyboard.$la$,
  'en',
  164,
  'B1/B2',
  $la$The Benefits of Learning to Type$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-18',
  $la$Keeping Your Room Organised$la$,
  $la$A clean and organised room can make daily life easier. When everything has a place, you spend less time looking for books, clothes, chargers, or important papers. A messy room can also make some people feel stressed because there are many things competing for attention. The best way to organise a room is not to clean everything once and then forget about it. Small daily habits are more effective. For example, make the bed in the morning, put dirty clothes in one place, and return books to the shelf after using them. It is also helpful to remove things you no longer need. Old papers, broken items, and unused objects can take up valuable space. You do not need to buy expensive boxes or furniture. Simple containers and labels can be enough. Spending five or ten minutes cleaning at the end of the day can prevent a large mess from developing. An organised room can make studying, sleeping, and preparing for the day more comfortable.$la$,
  'en',
  165,
  'B1/B2',
  $la$Keeping Your Room Organised$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-19',
  $la$Helping Others in Small Ways$la$,
  $la$Helping other people does not always require money or a lot of free time. Small actions can still make a difference. For example, you can help a classmate understand a difficult topic, carry something heavy for an older person, or listen to a friend who is having a bad day. At home, helping with cleaning, shopping, or cooking can reduce stress for family members. These actions may seem simple, but they show care and responsibility. Helping others can also improve your own mood because it gives a sense of purpose. However, it is important to help in a healthy way. You do not need to say yes to every request or ignore your own important responsibilities. Good support should be reasonable and respectful. Sometimes the best help is not solving another person’s problem but encouraging them to solve it themselves. Communities become stronger when people are willing to support one another. Kindness is often remembered much longer than we expect, even when the action itself is very small.$la$,
  'en',
  168,
  'B1/B2',
  $la$Helping Others in Small Ways$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-20',
  $la$Using the Internet for Learning$la$,
  $la$The internet gives students access to a huge amount of information. They can watch lessons, read articles, use dictionaries, practise tests, and learn from teachers in other countries. This makes education more flexible than it was in the past. However, having a lot of information does not always mean learning well. Students need to choose reliable sources and avoid spending all their time collecting videos and notes without actually practising. It is useful to have a clear purpose before going online. For example, instead of searching “learn English,” a student can search for “B1 listening practice about travel.” This saves time and gives more useful results. Students should also be careful with information from unknown websites because not everything online is correct. Comparing two or three sources can help. Another problem is distraction. Educational websites are often only one click away from entertainment. A simple plan, a timer, and a small number of trusted resources can make online learning much more effective.$la$,
  'en',
  162,
  'B1/B2',
  $la$Using the Internet for Learning$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-21',
  $la$A Day Without Complaining$la$,
  $la$Complaining is a normal part of life, but doing it too often can affect our mood. People complain about weather, traffic, homework, family, money, and many other things. Sometimes a complaint is necessary because it helps us explain a real problem. However, repeating the same negative thought many times does not always improve the situation. One useful exercise is to try spending one day without unnecessary complaining. When something goes wrong, you can ask, “Can I change this?” If the answer is yes, take a small action. If the answer is no, try to accept it and focus on something else. This does not mean pretending that every problem is good. It simply means using energy in a more useful way. You may also notice how often negative language appears in everyday conversations. Replacing one complaint with one practical idea can change the tone of a situation. A calmer attitude can help people solve problems more clearly and communicate better with others.$la$,
  'en',
  162,
  'B1/B2',
  $la$A Day Without Complaining$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-22',
  $la$The Importance of Drinking Water$la$,
  $la$Water is essential for the body, but many people forget to drink enough during the day. When a person is busy studying or working, they may not notice thirst until they already feel tired or have a headache. Keeping a bottle of water nearby can make drinking regularly much easier. Some people find plain water boring, so they add a slice of lemon, cucumber, or fruit for a little flavour. It is also useful to drink more water during hot weather or after exercise. Sweet drinks can be enjoyable, but they are not always a good replacement for water because they may contain a lot of sugar. There is no single perfect amount for every person because needs can change depending on weather, activity, and body size. A simple habit is to drink some water after waking up, with meals, and during study breaks. Good hydration supports concentration, energy, and general health, so it is a small habit that can have useful results.$la$,
  'en',
  163,
  'B1/B2',
  $la$The Importance of Drinking Water$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-23',
  $la$Learning to Speak with Confidence$la$,
  $la$Many English learners understand grammar and vocabulary but still feel nervous when they speak. This is common because speaking happens quickly, and there is less time to think. Confidence usually grows through practice, not by waiting until your English becomes perfect. One useful method is to speak about simple topics every day. You can describe your room, explain what you did yesterday, or talk about your plans for the weekend. Recording yourself can also help. When you listen again, you may notice pronunciation problems or places where you pause too often. It is important not to focus on every small mistake at the same time. Choose one thing to improve, such as speaking more slowly or using complete sentences. Talking with a supportive partner can also make practice easier. Remember that communication is the main goal. Native speakers also pause, change words, and correct themselves. Speaking clearly and confidently is more important than trying to sound perfect in every sentence.$la$,
  'en',
  160,
  'B1/B2',
  $la$Learning to Speak with Confidence$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-24',
  $la$Why People Enjoy Travelling$la$,
  $la$People travel for many different reasons. Some want to relax, while others enjoy seeing new places and learning about different cultures. Travelling can introduce people to new food, languages, traditions, and ways of life. Even a short trip to another city can be interesting because daily routines change. Travelling can also teach practical skills. People learn how to plan, manage money, read maps, solve small problems, and communicate with strangers. Of course, travel can be expensive and sometimes stressful. Flights may be delayed, hotels may not look like the pictures, and plans can change because of weather. Good preparation can reduce some of these problems. It is useful to check important documents, transport, accommodation, and basic costs before leaving. Travellers should also respect local customs and rules. The best trips are not always the most expensive ones. Sometimes a simple journey with good company can create stronger memories than a luxury holiday with a very busy schedule.$la$,
  'en',
  157,
  'B1/B2',
  $la$Why People Enjoy Travelling$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-25',
  $la$A Balanced Approach to Exercise$la$,
  $la$Exercise is important for health, but people do not need to train like professional athletes. A balanced routine can include strength, movement, and rest. For beginners, three or four short workouts each week may be enough. Simple exercises such as squats, push-ups, walking, stretching, and light running can improve fitness over time. The body also needs recovery. Training hard every day without rest can cause tiredness or injury. Sleep and food are part of exercise too because muscles need energy and time to recover. Beginners should avoid comparing themselves with people who have trained for many years. Progress is personal. It can be measured by doing more repetitions, walking farther, feeling less tired, or simply staying consistent. It is also important to choose activities you enjoy. If you hate running, you may prefer cycling, swimming, or team sports. A good exercise plan should support daily life, not make a person feel exhausted all the time.$la$,
  'en',
  155,
  'B1/B2',
  $la$A Balanced Approach to Exercise$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-26',
  $la$The Habit of Writing a Daily Journal$la$,
  $la$Writing a short journal can be a useful daily habit. You do not need to write several pages or use difficult language. Five or ten sentences can be enough. A journal gives you a place to record what happened, what you learned, and how you felt. It can also help you notice patterns in your life. For example, you may discover that you study better in the morning or feel more stressed when you sleep late. English learners can use journaling as writing practice. They can describe simple events and try to use new vocabulary. The goal should not be perfect grammar in every sentence. First, focus on expressing ideas clearly. Later, you can review one paragraph and correct a few mistakes. Some people also write three things they are thankful for each day. This can help them pay attention to positive moments. A journal is private, simple, and flexible. Over time, it becomes a record of progress, problems, decisions, and everyday memories.$la$,
  'en',
  163,
  'B1/B2',
  $la$The Habit of Writing a Daily Journal$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-27',
  $la$Why Time Management Is Important$la$,
  $la$Time management is not about filling every minute with work. It is about using time for the things that matter most. Students often feel busy because they have classes, homework, family responsibilities, social media, and personal goals. Without planning, small tasks can take over the whole day. A useful first step is to decide what is important and what can wait. Some tasks are urgent, while others are important for long-term progress. For example, preparing for tomorrow’s test may be urgent, while practising English every day is important over many months. A calendar or simple to-do list can help. It is also useful to estimate how long a task will really take. People often plan too much and then feel disappointed. Leaving some free time makes a schedule more realistic. Rest should also be included. Good time management allows people to work, sleep, exercise, and relax without feeling that everything is happening at the same time.$la$,
  'en',
  156,
  'B1/B2',
  $la$Why Time Management Is Important$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-28',
  $la$The Benefits of Learning with a Partner$la$,
  $la$Studying with a partner can make learning more interesting and more active. A good study partner can ask questions, explain ideas, and help you stay responsible for your goals. For language learning, a partner is especially useful because both students can practise speaking and listening. They can choose a topic, speak for two minutes, and then give simple feedback. Partners can also test each other on vocabulary or compare answers after a reading exercise. However, studying together only works well when both people actually want to study. If the session becomes mostly chatting, it may not be useful. It helps to decide the goal before starting. For example, you can agree to study for forty minutes and then take a ten-minute break. Partners should also be respectful. One person should not make the other feel embarrassed about mistakes. The best study partners encourage improvement without creating unnecessary pressure. When used correctly, shared study can improve motivation, understanding, and confidence.$la$,
  'en',
  159,
  'B1/B2',
  $la$The Benefits of Learning with a Partner$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-29',
  $la$Building a Better Evening Routine$la$,
  $la$A good evening routine can make the next morning easier. Many people finish the day by watching videos or checking social media until they fall asleep. This can make it difficult to sleep well and may leave them tired the next day. A calmer routine can begin thirty or sixty minutes before bedtime. First, finish important messages and put the phone away if possible. Then prepare a few things for the next day, such as clothes, books, or a bag. This reduces morning stress. You can also write down tomorrow’s main tasks so you do not keep thinking about them in bed. A warm shower, light stretching, or reading a book can help the body relax. Try to avoid very heavy meals or too much caffeine late in the evening. It is not necessary to follow the routine perfectly every night. The goal is to create a clear signal that the day is ending. Regular evening habits can improve sleep and make mornings more organised.$la$,
  'en',
  165,
  'B1/B2',
  $la$Building a Better Evening Routine$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-30',
  $la$Why Simple Goals Work Better$la$,
  $la$People often set large goals because they feel exciting. A student may decide to study five hours every day, read fifty books, or become fluent in English in a very short time. The problem is that large goals can become difficult to follow when motivation falls. Smaller goals are often easier to continue. For example, reading five pages every day may not sound impressive, but after one year it becomes a large amount of reading. The same idea works for exercise, language learning, saving money, and many other habits. A good goal should be clear and realistic. “Improve my English” is too general, but “learn ten useful words and review them tonight” is specific. It is also helpful to focus on the action instead of only the final result. You cannot control exactly when you will become fluent, but you can control whether you practise today. Small actions repeated for a long time often produce stronger results than short periods of extreme effort.$la$,
  'en',
  163,
  'B1/B2',
  $la$Why Simple Goals Work Better$la$,
  'learners-area-owner-supplied',
  'published'
)
ON CONFLICT ("external_id") DO NOTHING;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('813f3c8566afa4c1c6df10584e7041f58576d9558f384cb81cfe623c8c415ef0',1792200600000);

-- BEGIN canonical 0049_lesson_notes, SHA256 5896ddea2edf4916cd7c8c6889b999452a6a0d708dcc0d79b6478ded56f6f841
-- 0049 Private lesson student notes ("Xulosangiz").
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027, so `drizzle-kit generate` would regenerate the whole schema instead of a
-- delta.
--
-- WHY A DEDICATED TABLE RATHER THAN lesson_progress.notes
--
--   * Privacy by construction. `lesson_progress.notes` is selected by ordinary
--     progress reads (src/lib/data/roadmap.ts renders it) — private learner text in
--     a progress row can be exposed by any future query that widens its SELECT.
--     A note that lives in its own table cannot leak through a progress read.
--   * Truthfulness. A note is not progress: writing one must never create the
--     impression that a lesson was started or completed. Here a note row carries no
--     state and touches nothing else.
--   * Race safety. `lesson_progress` has NO unique key on (user_id, lesson_id), so
--     its notes path is a read-then-write upsert: two concurrent saves can create
--     two rows and `findFirst` may return either. `lesson_notes` is keyed by a
--     unique index, so ON CONFLICT makes the save atomic (upsert semantics).
--
-- Identity is (user_id, lesson_id): `lessons.id` is the stable LOGICAL lesson
-- (revisions live in content_versions and the row keeps its identity across them),
-- so a new revision does not orphan the learner's note. Never keyed by title.
--
-- Ownership is enforced in the service layer, which only ever queries by the
-- session user's id; this table deliberately has no "author" column to confuse
-- with "reader". Learner history is not cascade-deleted by content edits: the
-- lesson FK cascades only when the lesson row itself is deleted, exactly like
-- `lesson_progress`.
CREATE TABLE IF NOT EXISTS "lesson_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "lesson_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;


ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;


-- One note per learner per lesson: this index IS the upsert contract.
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_notes_user_lesson_uq" ON "lesson_notes" ("user_id","lesson_id");


CREATE INDEX IF NOT EXISTS "lesson_notes_lesson_idx" ON "lesson_notes" ("lesson_id");


-- A note is bounded text, never a second content store (matches the 4,000-character
-- limit the lesson-note API enforces) and never empty: clearing a note deletes the
-- row, so "a row exists" always means "there is something to read".
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_body_len_chk" CHECK (char_length("body") BETWEEN 1 AND 4000);


ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_body_not_blank_chk" CHECK (btrim("body") <> '');


-- Move existing course-lesson notes ("My notes") into the private table so nobody
-- loses writing they already did. This is the point of the dedicated table: the
-- same text stops living in a progress row that ordinary progress reads render.
-- The legacy column is cleared ONLY for rows whose text is verifiably present in
-- lesson_notes, so a partial or failed copy cannot destroy anything.
INSERT INTO "lesson_notes" ("user_id", "lesson_id", "body", "created_at", "updated_at")
SELECT "user_id", "lesson_id", "notes", now(), "updated_at"
FROM "lesson_progress"
WHERE "notes" IS NOT NULL AND btrim("notes") <> ''
ON CONFLICT ("user_id", "lesson_id") DO NOTHING;


UPDATE "lesson_progress" AS p
SET "notes" = NULL
WHERE p."notes" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "lesson_notes" AS n
    WHERE n."user_id" = p."user_id" AND n."lesson_id" = p."lesson_id" AND n."body" = p."notes"
  );

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('5896ddea2edf4916cd7c8c6889b999452a6a0d708dcc0d79b6478ded56f6f841',1792200700000);

-- BEGIN canonical 0050_lesson_learning_area, SHA256 ff5d754833e804723c198ab3ebefb0553006ae47e7e6908c06757f3d5865089d
-- 0050 Lesson learning area + canonical lesson-level Teacher Notes.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027, so `drizzle-kit generate` would regenerate the whole schema instead of a delta.
--
-- WHY THESE TWO COLUMNS, AND WHY ON `lessons`
--
--   * `learning_area` — what a lesson is ABOUT (listening / reading / writing /
--     speaking / grammar / vocabulary / general). Until now the subject could only be
--     guessed from the media type (an audio block) or from display text (a title
--     containing "Listening"), and both are wrong: an MCQ-strategy lesson taught by a
--     YouTube video is a Listening lesson, and an audio lesson about Reading is not a
--     Listening lesson. The subject is authored, so it is stored.
--
--     Location: the LESSON row, not `course_modules`. A lesson is the unit that is
--     authored, versioned and published, and a course module is a curriculum container
--     whose children may legitimately mix subjects; putting the area on the module
--     would forbid that and would make the area unreachable for a lesson that stands
--     alone. The same column is read by Listening and (later) Reading.
--
--     NULLABLE ON PURPOSE: existing rows are NOT classified. NULL means "not
--     classified yet", which is different from the explicit choice 'general'. No
--     backfill is performed here because the repository holds no unambiguous mapping
--     from (course, module, unit, title) to subject — inferring one would manufacture
--     exactly the false classification this column exists to prevent.
--
--   * `teacher_notes` — the centre's own notes for a lesson. They are lesson metadata,
--     independent of the media type: a video lesson, an audio lesson and a text lesson
--     must all be able to carry them. `video_lessons.notes` keeps its own MEDIA meaning
--     and is untouched (it stays available to a learner surface as a compatibility
--     fallback), but it can no longer be the primary store for lesson notes.
--
-- Both columns are additive and reversible in the sense that nothing existing is
-- rewritten: no row is updated, no column is dropped, no constraint is tightened on
-- existing data.
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "learning_area" varchar(20);


ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "teacher_notes" text;


-- The vocabulary is a closed set an author chooses from; NULL stays allowed for
-- historical rows. A CHECK (rather than a pg enum) keeps adding an area later a small
-- additive migration instead of an enum-type dance, and it makes the closed set true in
-- the database, not only in the application.
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_learning_area_chk";


ALTER TABLE "lessons" ADD CONSTRAINT "lessons_learning_area_chk"
  CHECK ("learning_area" IS NULL OR "learning_area" IN ('listening','reading','writing','speaking','grammar','vocabulary','general'));


-- Teacher notes are authored text, bounded like every other long-form field here, and
-- never blank: clearing them stores NULL rather than an empty string, so "has notes"
-- stays a single unambiguous question.
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_teacher_notes_len_chk";


ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_notes_len_chk"
  CHECK ("teacher_notes" IS NULL OR (char_length("teacher_notes") BETWEEN 1 AND 8000 AND btrim("teacher_notes") <> ''));


-- A learner-facing lesson library reads one area, live only, newest first, and the
-- existing index set has nothing for that predicate.
CREATE INDEX IF NOT EXISTS "lessons_learning_area_idx" ON "lessons" ("learning_area", "publication_state","updated_at");


-- A lesson's teaching material can be a VIDEO, so the upload taxonomy gains a video
-- block kind. Additive to the enum only: no existing intent row changes meaning.
-- Enum committed in separate step; verified below.

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('ff5d754833e804723c198ab3ebefb0553006ae47e7e6908c06757f3d5865089d',1792200800000);

-- BEGIN canonical 0051_listening_question_revision, SHA256 f5b7a259f2643de8155cf66188d3d8b7a7313ca804ceb9920bebe306bb9ec26c
-- 0051 Listening question SETS are version-bound.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027, so `drizzle-kit generate` would regenerate the whole schema instead of a
-- delta.
--
-- WHAT DEFECT THIS CLOSES
--
--   `listening_questions` was keyed only by `test_id`. Publishing a revised
--   Listening item therefore had no way to hold two sets of questions at once: the
--   author replaced the set in place (DELETE + INSERT). Because
--   `listening_answers.question_id` references `listening_questions(id)`
--   ON DELETE CASCADE, replacing the set DELETED the questions, which CASCADED to
--   the answers of every historical attempt. A learner's score survived in
--   `listening_attempts`, but the per-question review behind it was gone — and a
--   learner who was mid-attempt could resume into DIFFERENT questions.
--
--   The same in-place write also let a DRAFT revision silently change the PUBLISHED
--   row: saving a draft mutated the live title/audio/transcript and replaced the live
--   questions, so "editing a draft" was really "editing production".
--
-- WHY A COLUMN ON `listening_questions` (and not a new table)
--
--   The question text, options, key and explanation already live here, and the
--   attempt → revision binding already exists (`listening_attempts.content_version_id`,
--   written at attempt start). What was missing is the same identity on the QUESTION
--   side, so "the set of questions revision N published" is expressible. A new table
--   would duplicate the question shape and force every existing reader to change at
--   once; a nullable discriminator lets readers migrate one at a time and keeps
--   legacy content working exactly as it does today.
--
-- WHY NULLABLE, AND WHAT NULL MEANS
--
--   NULL = "the legacy set": rows written before this migration, and rows of items
--   that were never published through the CMS. Readers resolve an item to
--   "the published revision's set, else the NULL set" — so every existing test keeps
--   the set it has always had, and nothing needs backfilling.
--
-- WHY ON DELETE SET NULL
--
--   Deleting a revision must never delete questions (and through them, answers).
--   Losing the LABEL is recoverable; losing a learner's review is not.
--
-- This migration is additive: one nullable column, one index, no row rewritten, no
-- constraint tightened on existing data, no backfill.
ALTER TABLE "listening_questions" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;


ALTER TABLE "listening_questions" DROP CONSTRAINT IF EXISTS "listening_questions_content_version_id_content_versions_id_fk";


ALTER TABLE "listening_questions" ADD CONSTRAINT "listening_questions_content_version_id_content_versions_id_fk"
  FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- Readers ask for one item's set (a published revision, or the NULL set), which is
-- exactly this pair; the existing indexes only cover `test_id` alone.
CREATE INDEX IF NOT EXISTS "listening_questions_version_set_idx"
  ON "listening_questions" ("test_id","content_version_id");

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('f5b7a259f2643de8155cf66188d3d8b7a7313ca804ceb9920bebe306bb9ec26c',1792200900000);

-- BEGIN canonical 0052_listening_mcq_program_days, SHA256 ebb72044b2474bf3f22fd2f6e3be88591a5d24db9c66800fdec3f18c6cd8f742
-- 0052 A Listening item can belong to a PROGRAM at an explicit ordinal.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at 0027, so
-- `drizzle-kit generate` would regenerate the whole schema instead of a delta.
--
-- WHAT THIS CLOSES
--
--   The dedicated Listening MCQ programme is DAY 1 → DAY 30, five questions per day. A Day is a
--   canonical Listening item: one `listening_tests` row, its own `listening_questions` (the five
--   MCQs, in their authored order), its own content revisions and its own audio — exactly the shape
--   a General Listening SECTION already has. The learner's staged work is already persisted per
--   (user, question) by `listening_mcq_sessions`, so nothing about progress is missing.
--
--   What was missing is the RELATION: which programme an item belongs to, and WHICH DAY it is. The
--   only existing place to say "this is an MCQ item" was the package's `collection`, which states
--   the PRODUCT (`mcq`) but cannot distinguish Day 4 from Day 5, cannot order them, and would force
--   the day number to be parsed back out of a title — the one thing the owner forbade.
--
-- WHY TWO COLUMNS AND NOT THREE TABLES
--
--   A `programs → days → day_questions` model would need a container item anyway (questions are
--   owned by an item: `listening_questions.test_id`), so the membership table would restate the
--   item's own question set, and the day's position would exist TWICE — in the membership row and
--   in `listening_questions.order` — with no way to keep the two truths from drifting. The
--   `order` column is already this product's single ordering truth (attempts, review, practice and
--   the MCQ drill all read it). So the day's membership and its position are ALREADY expressible;
--   only the programme relation was not. Two nullable columns close exactly that gap, and leave one
--   order truth in the system.
--
-- WHY NULLABLE, AND WHAT NULL MEANS
--
--   NULL = "this item is not part of a programme" — every existing Listening row, every Academic
--   full test, every General section, unchanged. Nothing needs backfilling, no reader has to change
--   at once, and a row that never joins a programme keeps its current behaviour exactly.
--
-- WHY THE GUARDS ARE STRICTER THAN "TWO COLUMNS"
--
--   • both-or-neither: a programme reference without a position (or a position without a programme)
--     is an incomplete statement about a learner-visible day, and no code should have to guess which
--     half is missing;
--   • ordinal >= 1: "DAY 0" is not a day;
--   • UNIQUE (program_ref, program_ordinal): the database refuses a second item claiming the same
--     day of the same programme, so a duplicated or re-run import cannot silently create two Day 6s.
--
-- Additive: two nullable columns, three guarded constraints, two indexes. No row rewritten, no
-- existing constraint tightened, no backfill, nothing deleted.
ALTER TABLE "listening_tests" ADD COLUMN IF NOT EXISTS "program_ref" varchar(80);


ALTER TABLE "listening_tests" ADD COLUMN IF NOT EXISTS "program_ordinal" integer;


ALTER TABLE "listening_tests" DROP CONSTRAINT IF EXISTS "listening_tests_program_pair_check";


ALTER TABLE "listening_tests" ADD CONSTRAINT "listening_tests_program_pair_check"
  CHECK (("program_ref" IS NULL) = ("program_ordinal" IS NULL));


ALTER TABLE "listening_tests" DROP CONSTRAINT IF EXISTS "listening_tests_program_ordinal_positive_check";


ALTER TABLE "listening_tests" ADD CONSTRAINT "listening_tests_program_ordinal_positive_check"
  CHECK ("program_ordinal" IS NULL OR "program_ordinal" >= 1);


CREATE UNIQUE INDEX IF NOT EXISTS "listening_tests_program_ordinal_idx"
  ON "listening_tests" ("program_ref","program_ordinal")
  WHERE "program_ref" IS NOT NULL AND "program_ordinal" IS NOT NULL;


CREATE INDEX IF NOT EXISTS "listening_tests_program_idx"
  ON "listening_tests" ("program_ref")
  WHERE "program_ref" IS NOT NULL;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('ebb72044b2474bf3f22fd2f6e3be88591a5d24db9c66800fdec3f18c6cd8f742',1792201000000);

ALTER TABLE public."assignment_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."assignment_targets" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."content_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."content_imports" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."content_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."content_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_channels" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_drafts" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_owner_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_owner_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_publish_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_publish_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_recent_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_recent_searches" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_releases" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_search_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_search_terms" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_sense_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."dictionary_sense_mappings" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."lesson_block_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."lesson_block_responses" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."lesson_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."lesson_blocks" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."lesson_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."lesson_notes" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."mock_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mock_sections" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."reading_assessment_passages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."reading_assessment_passages" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."reading_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."reading_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."typing_texts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."typing_texts" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."vocabulary_topic_pack_words" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vocabulary_topic_pack_words" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."vocabulary_topic_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vocabulary_topic_packs" FORCE ROW LEVEL SECURITY;
DO $journal$ BEGIN IF (SELECT count(*) FROM drizzle.__drizzle_migrations)<>53 OR EXISTS(SELECT 1 FROM jsonb_array_elements('[{"hash":"d149017a39cfaf517789938cb802ba79120bdab1a3f0c498fd670a75c0a48c69","created_at":1790188219029},{"hash":"190c03262689fe1e2b3d19f36301325a7371ac417533eb01e5d5430f9549a2e4","created_at":1790189397777},{"hash":"5d7e5bb9f40c2a88ec36915b937fc44ac673085bf82c66a2ae47833c868fd255","created_at":1790191131151},{"hash":"0519ca31d9a2862f309c7679cb62645be3c11bcdb6c3f338e5e5c5253c0f7005","created_at":1790275357849},{"hash":"a449a08648b90ddf84c09c1ef6c3be99d4e826adee0828735e798e2d0eaa1386","created_at":1790276380642},{"hash":"bd709e30eb0eec7f35ee21718ee11fd1bb6a16f58d0d7dd25592a75f221ae3bc","created_at":1790299753865},{"hash":"c5528a3321a819b1e258e4341c901edd4f9df00fb8212404f6ada52dc75cfc64","created_at":1790300320283},{"hash":"038ca444dd47bbcb8e69607104fffc4eea3899862689ddc8cfa7bd6df9ab5d52","created_at":1790300889330},{"hash":"cc629a8023010503cd10e324b3a51ba490af40ccc7449e03c1bb6407cd421f41","created_at":1790301301541},{"hash":"a9dc2fdd20ee9f143e00691a7497ceb48cad895efb1cda6e54d1777fbc459e14","created_at":1790361168134},{"hash":"007dbef62c06873bece2ec1ee62395608255ddbdc8e178381fcff956c310cfeb","created_at":1790361524937},{"hash":"c3d2617870a2b33cc6690410b05a4fe303ac2fe927487413a15a720f0290d1db","created_at":1790362848900},{"hash":"5b9dee31abe37c5bbfbd312261ea34c4cbf04f13c55c976d143edc3ce38f5d15","created_at":1790390667608},{"hash":"3d8620f16e431a40eecb998721a9cc8f57ebcd5b2d9e05112fa45ada68b39e52","created_at":1790391090261},{"hash":"1a0f569675807bde417cb0b80ef3de342f05daa13c2818cb76fc7c9bcc115b0e","created_at":1790392022049},{"hash":"e2eaa95546d55cd43b8427cd21ae763612154df24e2902c8c891da9edde9a299","created_at":1790395150776},{"hash":"e50c6bb5ed9ccbb2682c8307de36f040461898047ec318f1ff8b01c365d29986","created_at":1790403060935},{"hash":"55bba8c1941c7185cc7405cfb1a7f209579a01f39274a8b1c78db11bf28b07c5","created_at":1790425259055},{"hash":"5d8355ddad0962744f07758759bf28d0868122339eef86477a1b9fe8c6fbd290","created_at":1790429326290},{"hash":"d749c650685c693eb0f15b994272b59dca56eaed0ca886a2b87fca23787de816","created_at":1790559351334},{"hash":"9e2d6b3ffbc7ea27c683350c6494e94d7c1d3d1e796f982443f4a9b32be49140","created_at":1790620308660},{"hash":"ba209a85c50ecf0818933f31896769bde1a1540ee21364bc18d3024e99f83d4a","created_at":1790734416580},{"hash":"8294e9c9e9c93116a6168e609d39fba4da7292f38ac27f726a90116b24814bb8","created_at":1790756280556},{"hash":"e4ca1c6e2afdbd9f3360156eb4f9c932e7febfbe091a818c61160b2f359f2a27","created_at":1790759035406},{"hash":"4a5d5159f325884fd8e26ac5d7477a35e2280b812c8c9551a94ae2423b79806d","created_at":1790785789328},{"hash":"79ecefbd9fd75b36126ba330d117954091f0f0525f76370a3f337f4f021f4d74","created_at":1790845294168},{"hash":"2a3104169e142576e4afff2e4fd37566890acd49280df25155f2258acbf000d4","created_at":1790845470436},{"hash":"b76f9776ab6ff57208f9a8ab3b8e9ca692c8baa7173d26bb98efa920c4b12285","created_at":1790845656316},{"hash":"09fa9dbc01efb0ce477c59cb02c9e5624421fcc3c6879f442031ede12001b3c7","created_at":1790857800000},{"hash":"050fa13dda1883a949ca0537c4b25a49f3d340a44066487441d631361ba7a774","created_at":1790900000000},{"hash":"3d99ff8db195587609046a112b6efc21878e4defaf9cc3b2134b32ef75a90574","created_at":1791000000000},{"hash":"bcbe2a3f24b884611cfbeb2d423bf3e1db09de104056b269c356afeb8dee24b8","created_at":1791100000000},{"hash":"57686828eb5f61a381a9f324d9ccbd4cea533ecbc947ca2a7cd76c5ac9bdb07f","created_at":1791200000000},{"hash":"128394ec0a6016c3c78564d977638dd06b2642ffcdbfb331ca8ec9a68c5ad7fc","created_at":1791300000000},{"hash":"3eb1e502b6102e3476b6d8e120f699bd0c596e123d10103b5d27d645e7f12fcc","created_at":1791400000000},{"hash":"1244008086904ae204bfcf3244f68d91abac0750e73a1893cd6b74b204a6ec79","created_at":1791500000000},{"hash":"2287d37ada3bd0d542ecdc9fb966dd024c903f04f6f8d3c274294d73d3b071da","created_at":1791600000000},{"hash":"32890672239b62b019331a43c72d1102d48cd66651c156662c1cbad5a98f0341","created_at":1791700000000},{"hash":"b54e0187c6c5bcafdd7070437c5a9a27d7d3259ba1a93976544da26da74e916d","created_at":1791800000000},{"hash":"7d4bb56a0cbc516f7be38da90c46b55e64be2fc7bd4816b1b6fe993642e0ebbd","created_at":1791900000000},{"hash":"07061c332c848f89d17fd0510884a097eaabd01a429bf2d1f846e56d02a0a397","created_at":1792000000000},{"hash":"594b74d0e36b1dda3a9e783d5de1f880fbe176e63e0209f7c4f2772c94640e35","created_at":1792100000000},{"hash":"7323615d9a62864532b1e23a48d20c7a11654eeba34278554303c73eec0b00f9","created_at":1792200000000},{"hash":"e517578ebdf508d5490f0b66236358f1f054100745aa1aa62e5eef8f3d4dc52c","created_at":1792200100000},{"hash":"85b33a5fdecfa4240ea5281c6dd4ce73ae9e3d7e43fb7ef376cedfd363b314a9","created_at":1792200200000},{"hash":"c9d728b966b5334ffac970a0346023071f78da4b3f0388758bb99fbab578d7d3","created_at":1792200300000},{"hash":"d0251d7d0f4fda6a838c330fc51fe6adebc0c150cf020141db53968b983f577a","created_at":1792200400000},{"hash":"210927a617c29017ee9ba5e05f4155ce3c707895a7cb3b1e62ba1cc532885cf4","created_at":1792200500000},{"hash":"813f3c8566afa4c1c6df10584e7041f58576d9558f384cb81cfe623c8c415ef0","created_at":1792200600000},{"hash":"5896ddea2edf4916cd7c8c6889b999452a6a0d708dcc0d79b6478ded56f6f841","created_at":1792200700000},{"hash":"ff5d754833e804723c198ab3ebefb0553006ae47e7e6908c06757f3d5865089d","created_at":1792200800000},{"hash":"f5b7a259f2643de8155cf66188d3d8b7a7313ca804ceb9920bebe306bb9ec26c","created_at":1792200900000},{"hash":"ebb72044b2474bf3f22fd2f6e3be88591a5d24db9c66800fdec3f18c6cd8f742","created_at":1792201000000}]'::jsonb) e WHERE NOT EXISTS(SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash=e->>'hash' AND m.created_at=(e->>'created_at')::bigint)) THEN RAISE EXCEPTION 'STOP: expected exact 53-entry canonical primary migration prefix'; END IF; END $journal$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"tbl":"assignment_targets","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"assignment_targets","col":"assignment_id","typ":"uuid","nn":true,"def":null},{"tbl":"assignment_targets","col":"student_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"assignment_targets","col":"status","typ":"assignment_status","nn":true,"def":"''not_started''::assignment_status"},{"tbl":"assignment_targets","col":"due_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"assignment_targets","col":"completed_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"assignment_targets","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"assignment_targets","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"assignments","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"assignments","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"assignments","col":"description","typ":"text","nn":false,"def":null},{"tbl":"assignments","col":"created_by_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"assignments","col":"target_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"assignments","col":"related_writing_prompt_id","typ":"uuid","nn":false,"def":null},{"tbl":"assignments","col":"status","typ":"assignment_status","nn":true,"def":"''not_started''::assignment_status"},{"tbl":"assignments","col":"due_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"assignments","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"assignments","col":"module","typ":"character varying(20)","nn":false,"def":null},{"tbl":"assignments","col":"content_type","typ":"character varying(40)","nn":false,"def":null},{"tbl":"assignments","col":"source_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"assignments","col":"content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"assignments","col":"instructions","typ":"text","nn":false,"def":null},{"tbl":"assignments","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"content_imports","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"content_imports","col":"module","typ":"character varying(20)","nn":true,"def":null},{"tbl":"content_imports","col":"content_type","typ":"character varying(40)","nn":true,"def":null},{"tbl":"content_imports","col":"schema_version","typ":"integer","nn":true,"def":null},{"tbl":"content_imports","col":"import_version","typ":"integer","nn":true,"def":"1"},{"tbl":"content_imports","col":"source_ref","typ":"character varying(80)","nn":true,"def":null},{"tbl":"content_imports","col":"content_hash","typ":"character varying(64)","nn":true,"def":null},{"tbl":"content_imports","col":"content_version","typ":"integer","nn":true,"def":"1"},{"tbl":"content_imports","col":"status","typ":"content_import_status","nn":true,"def":null},{"tbl":"content_imports","col":"target_type","typ":"character varying(40)","nn":true,"def":null},{"tbl":"content_imports","col":"target_id","typ":"uuid","nn":false,"def":null},{"tbl":"content_imports","col":"actor_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"content_imports","col":"original_filename","typ":"character varying(255)","nn":false,"def":null},{"tbl":"content_imports","col":"legacy_runtime","typ":"boolean","nn":true,"def":"false"},{"tbl":"content_imports","col":"assets","typ":"jsonb","nn":false,"def":null},{"tbl":"content_imports","col":"provenance","typ":"jsonb","nn":false,"def":null},{"tbl":"content_imports","col":"result","typ":"jsonb","nn":false,"def":null},{"tbl":"content_imports","col":"note","typ":"text","nn":false,"def":null},{"tbl":"content_imports","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"content_versions","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"content_versions","col":"module","typ":"character varying(20)","nn":true,"def":null},{"tbl":"content_versions","col":"content_type","typ":"character varying(40)","nn":true,"def":null},{"tbl":"content_versions","col":"source_ref","typ":"character varying(80)","nn":true,"def":null},{"tbl":"content_versions","col":"version_no","typ":"integer","nn":true,"def":null},{"tbl":"content_versions","col":"status","typ":"content_version_status","nn":true,"def":"''draft''::content_version_status"},{"tbl":"content_versions","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"content_versions","col":"track","typ":"character varying(24)","nn":true,"def":"''unspecified''::character varying"},{"tbl":"content_versions","col":"content_hash","typ":"character varying(64)","nn":true,"def":null},{"tbl":"content_versions","col":"semantic_hash","typ":"character varying(64)","nn":true,"def":null},{"tbl":"content_versions","col":"answer_key_hash","typ":"character varying(64)","nn":true,"def":null},{"tbl":"content_versions","col":"publication_state","typ":"character varying(16)","nn":true,"def":"''draft''::character varying"},{"tbl":"content_versions","col":"target_type","typ":"character varying(40)","nn":false,"def":null},{"tbl":"content_versions","col":"target_id","typ":"uuid","nn":false,"def":null},{"tbl":"content_versions","col":"content_import_id","typ":"uuid","nn":false,"def":null},{"tbl":"content_versions","col":"created_by_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"content_versions","col":"change_kind","typ":"character varying(24)","nn":true,"def":"''created''::character varying"},{"tbl":"content_versions","col":"provenance","typ":"jsonb","nn":false,"def":null},{"tbl":"content_versions","col":"note","typ":"text","nn":false,"def":null},{"tbl":"content_versions","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"content_versions","col":"published_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"content_versions","col":"superseded_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"content_versions","col":"content_snapshot","typ":"jsonb","nn":false,"def":null},{"tbl":"dictionary_channels","col":"name","typ":"text","nn":true,"def":null},{"tbl":"dictionary_channels","col":"active_release_id","typ":"text","nn":true,"def":null},{"tbl":"dictionary_channels","col":"previous_release_id","typ":"text","nn":false,"def":null},{"tbl":"dictionary_channels","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"dictionary_drafts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"dictionary_drafts","col":"owner_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_drafts","col":"base_release_id","typ":"text","nn":true,"def":null},{"tbl":"dictionary_drafts","col":"changes","typ":"jsonb","nn":true,"def":null},{"tbl":"dictionary_drafts","col":"state","typ":"text","nn":true,"def":"''draft''::text"},{"tbl":"dictionary_drafts","col":"result_release_id","typ":"text","nn":false,"def":null},{"tbl":"dictionary_drafts","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"dictionary_drafts","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"dictionary_entries","col":"release_id","typ":"text","nn":true,"def":null},{"tbl":"dictionary_entries","col":"lexeme_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_entries","col":"lemma_norm","typ":"text","nn":true,"def":null},{"tbl":"dictionary_entries","col":"part_of_speech","typ":"text","nn":true,"def":null},{"tbl":"dictionary_entries","col":"lexical_type","typ":"text","nn":true,"def":null},{"tbl":"dictionary_entries","col":"payload","typ":"jsonb","nn":true,"def":null},{"tbl":"dictionary_entries","col":"content_sha","typ":"text","nn":true,"def":null},{"tbl":"dictionary_owner_events","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"dictionary_owner_events","col":"owner_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"dictionary_owner_events","col":"operation","typ":"text","nn":true,"def":null},{"tbl":"dictionary_owner_events","col":"entity_id","typ":"text","nn":false,"def":null},{"tbl":"dictionary_owner_events","col":"base_release_id","typ":"text","nn":false,"def":null},{"tbl":"dictionary_owner_events","col":"candidate_release_id","typ":"text","nn":false,"def":null},{"tbl":"dictionary_owner_events","col":"result_release_id","typ":"text","nn":false,"def":null},{"tbl":"dictionary_owner_events","col":"before_state","typ":"jsonb","nn":false,"def":null},{"tbl":"dictionary_owner_events","col":"after_state","typ":"jsonb","nn":false,"def":null},{"tbl":"dictionary_owner_events","col":"validation_result","typ":"jsonb","nn":true,"def":null},{"tbl":"dictionary_owner_events","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"dictionary_publish_jobs","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"dictionary_publish_jobs","col":"owner_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_publish_jobs","col":"base_release_id","typ":"text","nn":true,"def":null},{"tbl":"dictionary_publish_jobs","col":"candidate_release_id","typ":"text","nn":true,"def":null},{"tbl":"dictionary_publish_jobs","col":"draft_ids","typ":"uuid[]","nn":true,"def":null},{"tbl":"dictionary_publish_jobs","col":"phase","typ":"text","nn":true,"def":null},{"tbl":"dictionary_publish_jobs","col":"cursor_id","typ":"uuid","nn":false,"def":null},{"tbl":"dictionary_publish_jobs","col":"error","typ":"text","nn":false,"def":null},{"tbl":"dictionary_publish_jobs","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"dictionary_recent_searches","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_recent_searches","col":"direction","typ":"text","nn":true,"def":null},{"tbl":"dictionary_recent_searches","col":"query_norm","typ":"text","nn":true,"def":null},{"tbl":"dictionary_recent_searches","col":"query_display","typ":"text","nn":true,"def":null},{"tbl":"dictionary_recent_searches","col":"lexeme_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_recent_searches","col":"searched_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"dictionary_releases","col":"id","typ":"text","nn":true,"def":null},{"tbl":"dictionary_releases","col":"base_release_id","typ":"text","nn":false,"def":null},{"tbl":"dictionary_releases","col":"state","typ":"text","nn":true,"def":null},{"tbl":"dictionary_releases","col":"manifest","typ":"jsonb","nn":false,"def":null},{"tbl":"dictionary_releases","col":"manifest_sha","typ":"text","nn":false,"def":null},{"tbl":"dictionary_releases","col":"created_by","typ":"uuid","nn":false,"def":null},{"tbl":"dictionary_releases","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"dictionary_releases","col":"validated_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"dictionary_search_terms","col":"release_id","typ":"text","nn":true,"def":null},{"tbl":"dictionary_search_terms","col":"lexeme_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_search_terms","col":"direction","typ":"text","nn":true,"def":null},{"tbl":"dictionary_search_terms","col":"term","typ":"text","nn":true,"def":null},{"tbl":"dictionary_search_terms","col":"rank","typ":"integer","nn":true,"def":null},{"tbl":"dictionary_sense_mappings","col":"sense_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_sense_mappings","col":"app_sense_id","typ":"uuid","nn":true,"def":null},{"tbl":"dictionary_sense_mappings","col":"app_unit_id","typ":"uuid","nn":false,"def":null},{"tbl":"dictionary_sense_mappings","col":"mapping_method","typ":"text","nn":true,"def":null},{"tbl":"dictionary_sense_mappings","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"grammar_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"grammar_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"grammar_attempts","col":"exercise_id","typ":"uuid","nn":true,"def":null},{"tbl":"grammar_attempts","col":"selected_option","typ":"text","nn":true,"def":"''''::text"},{"tbl":"grammar_attempts","col":"is_correct","typ":"boolean","nn":true,"def":null},{"tbl":"grammar_attempts","col":"attempted_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"grammar_attempts","col":"activity","typ":"grammar_activity","nn":true,"def":"''correct_it''::grammar_activity"},{"tbl":"grammar_attempts","col":"response_text","typ":"text","nn":false,"def":null},{"tbl":"grammar_attempts","col":"content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"grammar_topics","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"grammar_topics","col":"skill_area","typ":"grammar_skill_area","nn":true,"def":"''writing''::grammar_skill_area"},{"tbl":"grammar_topics","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"grammar_topics","col":"explanation","typ":"text","nn":true,"def":null},{"tbl":"grammar_topics","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"grammar_topics","col":"source_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"grammar_topics","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"lesson_block_responses","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"lesson_block_responses","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_block_responses","col":"lesson_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_block_responses","col":"block_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_block_responses","col":"answer","typ":"jsonb","nn":false,"def":null},{"tbl":"lesson_block_responses","col":"correct","typ":"boolean","nn":false,"def":null},{"tbl":"lesson_block_responses","col":"answered_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lesson_block_responses","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lesson_blocks","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"lesson_blocks","col":"lesson_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_blocks","col":"position","typ":"integer","nn":true,"def":null},{"tbl":"lesson_blocks","col":"type","typ":"lesson_block_type","nn":true,"def":null},{"tbl":"lesson_blocks","col":"text_content","typ":"text","nn":false,"def":null},{"tbl":"lesson_blocks","col":"link_url","typ":"text","nn":false,"def":null},{"tbl":"lesson_blocks","col":"object_key","typ":"text","nn":false,"def":null},{"tbl":"lesson_blocks","col":"original_name","typ":"character varying(255)","nn":false,"def":null},{"tbl":"lesson_blocks","col":"mime_type","typ":"character varying(120)","nn":false,"def":null},{"tbl":"lesson_blocks","col":"size","typ":"integer","nn":false,"def":null},{"tbl":"lesson_blocks","col":"ref_module","typ":"character varying(20)","nn":false,"def":null},{"tbl":"lesson_blocks","col":"ref_content_type","typ":"character varying(40)","nn":false,"def":null},{"tbl":"lesson_blocks","col":"ref_source_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"lesson_blocks","col":"ref_content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"lesson_blocks","col":"quiz_question_type","typ":"character varying(40)","nn":false,"def":null},{"tbl":"lesson_blocks","col":"quiz_payload","typ":"jsonb","nn":false,"def":null},{"tbl":"lesson_blocks","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lesson_notes","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"lesson_notes","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_notes","col":"lesson_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_notes","col":"body","typ":"text","nn":true,"def":null},{"tbl":"lesson_notes","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lesson_notes","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lesson_progress","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"lesson_progress","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_progress","col":"lesson_id","typ":"uuid","nn":true,"def":null},{"tbl":"lesson_progress","col":"state","typ":"content_state","nn":true,"def":"''available''::content_state"},{"tbl":"lesson_progress","col":"notes","typ":"text","nn":false,"def":null},{"tbl":"lesson_progress","col":"completed_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"lesson_progress","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lessons","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"lessons","col":"unit_id","typ":"uuid","nn":true,"def":null},{"tbl":"lessons","col":"slug","typ":"character varying(60)","nn":true,"def":null},{"tbl":"lessons","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"lessons","col":"summary","typ":"text","nn":false,"def":null},{"tbl":"lessons","col":"default_state","typ":"content_state","nn":true,"def":"''locked''::content_state"},{"tbl":"lessons","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"lessons","col":"recording_url","typ":"text","nn":false,"def":null},{"tbl":"lessons","col":"source_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"lessons","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"lessons","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"lessons","col":"estimated_minutes","typ":"integer","nn":false,"def":null},{"tbl":"lessons","col":"created_by_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"lessons","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"lessons","col":"learning_area","typ":"character varying(20)","nn":false,"def":null},{"tbl":"lessons","col":"teacher_notes","typ":"text","nn":false,"def":null},{"tbl":"listening_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"listening_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_attempts","col":"test_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_attempts","col":"status","typ":"attempt_status","nn":true,"def":"''in_progress''::attempt_status"},{"tbl":"listening_attempts","col":"score","typ":"integer","nn":false,"def":null},{"tbl":"listening_attempts","col":"total_questions","typ":"integer","nn":false,"def":null},{"tbl":"listening_attempts","col":"started_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"listening_attempts","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"listening_attempts","col":"content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"listening_attempts","col":"score_policy_version","typ":"character varying(24)","nn":false,"def":null},{"tbl":"listening_packages","col":"test_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_packages","col":"source_id","typ":"character varying(80)","nn":true,"def":null},{"tbl":"listening_packages","col":"payload","typ":"jsonb","nn":true,"def":null},{"tbl":"listening_packages","col":"audio_object_key","typ":"text","nn":true,"def":null},{"tbl":"listening_packages","col":"image_object_key","typ":"text","nn":false,"def":null},{"tbl":"listening_packages","col":"source_hash","typ":"character varying(64)","nn":true,"def":null},{"tbl":"listening_packages","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"listening_packages","col":"legacy_runtime","typ":"boolean","nn":true,"def":"false"},{"tbl":"listening_questions","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"listening_questions","col":"test_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_questions","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"listening_questions","col":"type","typ":"listening_question_type","nn":true,"def":null},{"tbl":"listening_questions","col":"question_text","typ":"text","nn":true,"def":null},{"tbl":"listening_questions","col":"options","typ":"jsonb","nn":false,"def":null},{"tbl":"listening_questions","col":"correct_answer","typ":"text","nn":true,"def":null},{"tbl":"listening_questions","col":"explanation","typ":"text","nn":true,"def":null},{"tbl":"listening_questions","col":"keywords","typ":"text","nn":false,"def":null},{"tbl":"listening_questions","col":"paraphrases","typ":"jsonb","nn":false,"def":null},{"tbl":"listening_questions","col":"type_code","typ":"character varying(40)","nn":false,"def":null},{"tbl":"listening_questions","col":"content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"listening_tests","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"listening_tests","col":"created_by_user_id","typ":"uuid","nn":true,"def":null},{"tbl":"listening_tests","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"listening_tests","col":"audio_type","typ":"material_type","nn":true,"def":null},{"tbl":"listening_tests","col":"audio_url","typ":"text","nn":false,"def":null},{"tbl":"listening_tests","col":"transcript","typ":"text","nn":false,"def":null},{"tbl":"listening_tests","col":"difficulty_level","typ":"character varying(10)","nn":true,"def":"''B2''::character varying"},{"tbl":"listening_tests","col":"is_active","typ":"boolean","nn":true,"def":"true"},{"tbl":"listening_tests","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"listening_tests","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"listening_tests","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"listening_tests","col":"source_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"listening_tests","col":"program_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"listening_tests","col":"program_ordinal","typ":"integer","nn":false,"def":null},{"tbl":"mock_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"mock_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"mock_attempts","col":"mock_test_id","typ":"uuid","nn":false,"def":null},{"tbl":"mock_attempts","col":"started_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"mock_attempts","col":"finished_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"mock_attempts","col":"raw_score","typ":"real","nn":false,"def":null},{"tbl":"mock_attempts","col":"estimated_band","typ":"real","nn":false,"def":null},{"tbl":"mock_attempts","col":"skill_breakdown","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_attempts","col":"score_policy_version","typ":"character varying(24)","nn":false,"def":null},{"tbl":"mock_attempts","col":"mock_version","typ":"integer","nn":false,"def":null},{"tbl":"mock_attempts","col":"section_results","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_attempts","col":"status","typ":"character varying(24)","nn":true,"def":"''in_progress''::character varying"},{"tbl":"mock_attempts","col":"content_version_bindings","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_attempts","col":"mock_snapshot","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_sections","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"mock_sections","col":"mock_test_id","typ":"uuid","nn":true,"def":null},{"tbl":"mock_sections","col":"position","typ":"integer","nn":true,"def":null},{"tbl":"mock_sections","col":"skill","typ":"character varying(16)","nn":true,"def":null},{"tbl":"mock_sections","col":"module","typ":"character varying(20)","nn":true,"def":null},{"tbl":"mock_sections","col":"content_type","typ":"character varying(40)","nn":true,"def":null},{"tbl":"mock_sections","col":"source_ref","typ":"character varying(80)","nn":true,"def":null},{"tbl":"mock_sections","col":"content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"mock_sections","col":"label","typ":"character varying(120)","nn":false,"def":null},{"tbl":"mock_sections","col":"question_count","typ":"integer","nn":false,"def":null},{"tbl":"mock_sections","col":"seconds","typ":"integer","nn":false,"def":null},{"tbl":"mock_sections","col":"optional","typ":"boolean","nn":true,"def":"false"},{"tbl":"mock_sections","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"mock_tests","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"mock_tests","col":"course_id","typ":"uuid","nn":true,"def":null},{"tbl":"mock_tests","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"mock_tests","col":"skill","typ":"character varying(20)","nn":true,"def":null},{"tbl":"mock_tests","col":"description","typ":"text","nn":false,"def":null},{"tbl":"mock_tests","col":"track","typ":"character varying(24)","nn":true,"def":"''unspecified''::character varying"},{"tbl":"mock_tests","col":"kind","typ":"character varying(24)","nn":true,"def":"''sectional''::character varying"},{"tbl":"mock_tests","col":"timing_policy_id","typ":"character varying(40)","nn":false,"def":null},{"tbl":"mock_tests","col":"timing_policy_version","typ":"character varying(24)","nn":false,"def":null},{"tbl":"mock_tests","col":"navigation","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_tests","col":"score_policies","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_tests","col":"publication_state","typ":"publication_state","nn":true,"def":"''draft''::publication_state"},{"tbl":"mock_tests","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"mock_tests","col":"version","typ":"integer","nn":true,"def":"1"},{"tbl":"mock_tests","col":"created_by_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"mock_tests","col":"provenance","typ":"jsonb","nn":false,"def":null},{"tbl":"mock_tests","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"reading_assessment_passages","col":"attempt_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_assessment_passages","col":"passage_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_assessment_passages","col":"passage_no","typ":"integer","nn":true,"def":null},{"tbl":"reading_assessments","col":"attempt_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_assessments","col":"set_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_assessments","col":"title","typ":"text","nn":true,"def":null},{"tbl":"reading_assessments","col":"duration_minutes","typ":"integer","nn":true,"def":"60"},{"tbl":"reading_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"reading_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_attempts","col":"passage_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_attempts","col":"status","typ":"attempt_status","nn":true,"def":"''in_progress''::attempt_status"},{"tbl":"reading_attempts","col":"score","typ":"integer","nn":false,"def":null},{"tbl":"reading_attempts","col":"total_questions","typ":"integer","nn":false,"def":null},{"tbl":"reading_attempts","col":"started_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"reading_attempts","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"reading_attempts","col":"content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"reading_attempts","col":"score_policy_version","typ":"character varying(24)","nn":false,"def":null},{"tbl":"reading_questions","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"reading_questions","col":"passage_id","typ":"uuid","nn":true,"def":null},{"tbl":"reading_questions","col":"order","typ":"integer","nn":true,"def":null},{"tbl":"reading_questions","col":"type","typ":"reading_question_type","nn":true,"def":null},{"tbl":"reading_questions","col":"question_text","typ":"text","nn":true,"def":null},{"tbl":"reading_questions","col":"options","typ":"jsonb","nn":false,"def":null},{"tbl":"reading_questions","col":"correct_answer","typ":"text","nn":true,"def":null},{"tbl":"reading_questions","col":"evidence_quote","typ":"text","nn":false,"def":null},{"tbl":"reading_questions","col":"explanation","typ":"text","nn":true,"def":null},{"tbl":"reading_questions","col":"group_id","typ":"uuid","nn":false,"def":null},{"tbl":"reading_questions","col":"question_no","typ":"integer","nn":false,"def":null},{"tbl":"reading_questions","col":"type_code","typ":"character varying(40)","nn":false,"def":null},{"tbl":"reading_questions","col":"answer_slots","typ":"jsonb","nn":true,"def":"''[]''::jsonb"},{"tbl":"reading_questions","col":"accepted_answers","typ":"jsonb","nn":true,"def":"''[]''::jsonb"},{"tbl":"reading_questions","col":"answer_constraint","typ":"jsonb","nn":false,"def":null},{"tbl":"reading_questions","col":"render_mode","typ":"character varying(32)","nn":false,"def":null},{"tbl":"reading_questions","col":"evidence_start_char","typ":"integer","nn":false,"def":null},{"tbl":"reading_questions","col":"evidence_end_char","typ":"integer","nn":false,"def":null},{"tbl":"reading_questions","col":"evidence_type","typ":"character varying(24)","nn":false,"def":null},{"tbl":"reading_questions","col":"source_key","typ":"character varying(40)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"speaking_attempts","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"speaking_attempts","col":"prompt_id","typ":"uuid","nn":false,"def":null},{"tbl":"speaking_attempts","col":"part","typ":"speaking_part","nn":true,"def":null},{"tbl":"speaking_attempts","col":"status","typ":"speaking_attempt_status","nn":true,"def":"''recording''::speaking_attempt_status"},{"tbl":"speaking_attempts","col":"recording_object_key","typ":"text","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_original_name","typ":"character varying(255)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_mime_type","typ":"character varying(120)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_size","typ":"integer","nn":false,"def":null},{"tbl":"speaking_attempts","col":"recording_duration_ms","typ":"integer","nn":false,"def":null},{"tbl":"speaking_attempts","col":"transcript","typ":"text","nn":false,"def":null},{"tbl":"speaking_attempts","col":"transcript_provider","typ":"character varying(60)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"started_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"speaking_attempts","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"speaking_attempts","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"speaking_attempts","col":"transcript_origin","typ":"character varying(10)","nn":false,"def":null},{"tbl":"speaking_attempts","col":"content_version_id","typ":"uuid","nn":false,"def":null},{"tbl":"typing_run_texts","col":"run_id","typ":"uuid","nn":true,"def":null},{"tbl":"typing_run_texts","col":"model_text_id","typ":"uuid","nn":false,"def":null},{"tbl":"typing_run_texts","col":"mistakes","typ":"integer","nn":true,"def":"0"},{"tbl":"typing_run_texts","col":"preset_seconds","typ":"smallint","nn":false,"def":null},{"tbl":"typing_run_texts","col":"typing_text_id","typ":"uuid","nn":false,"def":null},{"tbl":"typing_runs","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"typing_runs","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"typing_runs","col":"target_chars","typ":"integer","nn":true,"def":null},{"tbl":"typing_runs","col":"typed_chars","typ":"integer","nn":true,"def":null},{"tbl":"typing_runs","col":"duration_ms","typ":"integer","nn":true,"def":null},{"tbl":"typing_runs","col":"wpm","typ":"numeric(6,1)","nn":true,"def":null},{"tbl":"typing_runs","col":"accuracy","typ":"numeric(5,1)","nn":true,"def":null},{"tbl":"typing_runs","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"typing_runs","col":"run_token_id","typ":"uuid","nn":false,"def":null},{"tbl":"typing_runs","col":"raw_wpm","typ":"numeric(6,1)","nn":false,"def":null},{"tbl":"typing_runs","col":"consistency","typ":"numeric(5,1)","nn":false,"def":null},{"tbl":"typing_runs","col":"chars_correct","typ":"integer","nn":false,"def":null},{"tbl":"typing_runs","col":"chars_incorrect","typ":"integer","nn":false,"def":null},{"tbl":"typing_runs","col":"chars_extra","typ":"integer","nn":false,"def":null},{"tbl":"typing_runs","col":"chars_missed","typ":"integer","nn":false,"def":null},{"tbl":"typing_runs","col":"started_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"typing_runs","col":"finished_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"typing_texts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"typing_texts","col":"external_id","typ":"character varying(80)","nn":true,"def":null},{"tbl":"typing_texts","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"typing_texts","col":"body","typ":"text","nn":true,"def":null},{"tbl":"typing_texts","col":"language","typ":"character varying(10)","nn":true,"def":"''en''::character varying"},{"tbl":"typing_texts","col":"word_count","typ":"integer","nn":true,"def":null},{"tbl":"typing_texts","col":"difficulty","typ":"character varying(20)","nn":false,"def":null},{"tbl":"typing_texts","col":"topic","typ":"character varying(160)","nn":false,"def":null},{"tbl":"typing_texts","col":"provenance","typ":"character varying(200)","nn":true,"def":null},{"tbl":"typing_texts","col":"publication_state","typ":"publication_state","nn":true,"def":"''draft''::publication_state"},{"tbl":"typing_texts","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"typing_texts","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"typing_texts","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"video_lessons","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"video_lessons","col":"lesson_id","typ":"uuid","nn":false,"def":null},{"tbl":"video_lessons","col":"provider","typ":"character varying(30)","nn":true,"def":"''youtube''::character varying"},{"tbl":"video_lessons","col":"video_id","typ":"character varying(40)","nn":true,"def":null},{"tbl":"video_lessons","col":"title","typ":"character varying(200)","nn":true,"def":null},{"tbl":"video_lessons","col":"before_you_watch","typ":"text","nn":false,"def":null},{"tbl":"video_lessons","col":"duration_seconds","typ":"integer","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript","typ":"jsonb","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript_source","typ":"character varying(20)","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript_attribution","typ":"character varying(200)","nn":false,"def":null},{"tbl":"video_lessons","col":"created_by_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"video_lessons","col":"is_active","typ":"boolean","nn":true,"def":"true"},{"tbl":"video_lessons","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"video_lessons","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"video_lessons","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"video_lessons","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"video_lessons","col":"notes","typ":"text","nn":false,"def":null},{"tbl":"video_lessons","col":"transcript_text","typ":"text","nn":false,"def":null},{"tbl":"video_lessons","col":"media_kind","typ":"character varying(10)","nn":true,"def":"''video''::character varying"},{"tbl":"video_lessons","col":"source_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"vocabulary_topic_pack_words","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"vocabulary_topic_pack_words","col":"pack_id","typ":"uuid","nn":true,"def":null},{"tbl":"vocabulary_topic_pack_words","col":"lexeme_id","typ":"uuid","nn":true,"def":null},{"tbl":"vocabulary_topic_pack_words","col":"position","typ":"integer","nn":true,"def":null},{"tbl":"vocabulary_topic_pack_words","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"vocabulary_topic_packs","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"vocabulary_topic_packs","col":"source_ref","typ":"character varying(80)","nn":true,"def":null},{"tbl":"vocabulary_topic_packs","col":"slug","typ":"character varying(60)","nn":true,"def":null},{"tbl":"vocabulary_topic_packs","col":"label_en","typ":"character varying(120)","nn":true,"def":null},{"tbl":"vocabulary_topic_packs","col":"label_uz","typ":"character varying(120)","nn":false,"def":null},{"tbl":"vocabulary_topic_packs","col":"topic_code","typ":"character varying(40)","nn":false,"def":null},{"tbl":"vocabulary_topic_packs","col":"position","typ":"integer","nn":true,"def":"0"},{"tbl":"vocabulary_topic_packs","col":"level","typ":"character varying(10)","nn":false,"def":null},{"tbl":"vocabulary_topic_packs","col":"publication_state","typ":"publication_state","nn":true,"def":"''draft''::publication_state"},{"tbl":"vocabulary_topic_packs","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"vocabulary_topic_packs","col":"created_by_user_id","typ":"uuid","nn":false,"def":null},{"tbl":"vocabulary_topic_packs","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"vocabulary_topic_packs","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"writing_prompts","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"writing_prompts","col":"task_type","typ":"writing_task_type","nn":true,"def":null},{"tbl":"writing_prompts","col":"category","typ":"character varying(60)","nn":true,"def":null},{"tbl":"writing_prompts","col":"prompt","typ":"text","nn":true,"def":null},{"tbl":"writing_prompts","col":"target_word_count","typ":"integer","nn":true,"def":null},{"tbl":"writing_prompts","col":"is_active","typ":"boolean","nn":true,"def":"true"},{"tbl":"writing_prompts","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"writing_prompts","col":"publication_state","typ":"publication_state","nn":true,"def":"''published''::publication_state"},{"tbl":"writing_prompts","col":"publish_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"writing_prompts","col":"source_ref","typ":"character varying(80)","nn":false,"def":null},{"tbl":"writing_submissions","col":"id","typ":"uuid","nn":true,"def":"gen_random_uuid()"},{"tbl":"writing_submissions","col":"user_id","typ":"uuid","nn":true,"def":null},{"tbl":"writing_submissions","col":"prompt_id","typ":"uuid","nn":true,"def":null},{"tbl":"writing_submissions","col":"content","typ":"text","nn":true,"def":"''''::text"},{"tbl":"writing_submissions","col":"word_count","typ":"integer","nn":true,"def":"0"},{"tbl":"writing_submissions","col":"status","typ":"writing_status","nn":true,"def":"''draft''::writing_status"},{"tbl":"writing_submissions","col":"submitted_at","typ":"timestamp with time zone","nn":false,"def":null},{"tbl":"writing_submissions","col":"created_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"writing_submissions","col":"updated_at","typ":"timestamp with time zone","nn":true,"def":"now()"},{"tbl":"writing_submissions","col":"content_version_id","typ":"uuid","nn":false,"def":null}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT c.relname AS tbl,a.attname AS col,format_type(a.atttypid,a.atttypmod) AS typ,a.attnotnull AS nn,pg_get_expr(d.adbin,d.adrelid) AS def FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum) x WHERE to_jsonb(x)->>'tbl'=wanted->>'tbl' AND to_jsonb(x)->>'col'=wanted->>'col'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'final column mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"tbl":"assignment_targets","name":"assignment_targets_assignment_id_assignments_id_fk","def":"FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE","validated":true},{"tbl":"assignment_targets","name":"assignment_targets_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"assignment_targets","name":"assignment_targets_student_user_id_users_id_fk","def":"FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"assignments","name":"assignments_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"assignments","name":"assignments_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id)","validated":true},{"tbl":"assignments","name":"assignments_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"assignments","name":"assignments_related_writing_prompt_id_writing_prompts_id_fk","def":"FOREIGN KEY (related_writing_prompt_id) REFERENCES writing_prompts(id)","validated":true},{"tbl":"assignments","name":"assignments_target_user_id_users_id_fk","def":"FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"content_imports","name":"content_imports_actor_user_id_users_id_fk","def":"FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"content_imports","name":"content_imports_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"content_versions","name":"content_versions_content_import_id_content_imports_id_fk","def":"FOREIGN KEY (content_import_id) REFERENCES content_imports(id) ON DELETE SET NULL","validated":true},{"tbl":"content_versions","name":"content_versions_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"content_versions","name":"content_versions_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"dictionary_channels","name":"dictionary_channels_active_release_id_fkey","def":"FOREIGN KEY (active_release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_channels","name":"dictionary_channels_name_check","def":"CHECK ((name = ''stable''::text))","validated":true},{"tbl":"dictionary_channels","name":"dictionary_channels_pkey","def":"PRIMARY KEY (name)","validated":true},{"tbl":"dictionary_channels","name":"dictionary_channels_previous_release_id_fkey","def":"FOREIGN KEY (previous_release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_drafts","name":"dictionary_drafts_base_release_id_fkey","def":"FOREIGN KEY (base_release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_drafts","name":"dictionary_drafts_owner_user_id_fkey","def":"FOREIGN KEY (owner_user_id) REFERENCES users(id)","validated":true},{"tbl":"dictionary_drafts","name":"dictionary_drafts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"dictionary_drafts","name":"dictionary_drafts_result_release_id_fkey","def":"FOREIGN KEY (result_release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_drafts","name":"dictionary_drafts_state_check","def":"CHECK ((state = ANY (ARRAY[''draft''::text, ''published''::text, ''discarded''::text])))","validated":true},{"tbl":"dictionary_entries","name":"dictionary_entries_pkey","def":"PRIMARY KEY (release_id, lexeme_id)","validated":true},{"tbl":"dictionary_entries","name":"dictionary_entries_release_id_fkey","def":"FOREIGN KEY (release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_entries","name":"dictionary_entries_release_id_lemma_norm_part_of_speech_lex_key","def":"UNIQUE (release_id, lemma_norm, part_of_speech, lexical_type, lexeme_id)","validated":true},{"tbl":"dictionary_owner_events","name":"dictionary_owner_events_owner_user_id_fkey","def":"FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"dictionary_owner_events","name":"dictionary_owner_events_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"dictionary_publish_jobs","name":"dictionary_publish_jobs_base_release_id_fkey","def":"FOREIGN KEY (base_release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_publish_jobs","name":"dictionary_publish_jobs_candidate_release_id_fkey","def":"FOREIGN KEY (candidate_release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_publish_jobs","name":"dictionary_publish_jobs_owner_user_id_fkey","def":"FOREIGN KEY (owner_user_id) REFERENCES users(id)","validated":true},{"tbl":"dictionary_publish_jobs","name":"dictionary_publish_jobs_phase_check","def":"CHECK ((phase = ANY (ARRAY[''copy''::text, ''apply''::text, ''index''::text, ''validate''::text, ''activate''::text, ''complete''::text, ''failed''::text])))","validated":true},{"tbl":"dictionary_publish_jobs","name":"dictionary_publish_jobs_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"dictionary_recent_searches","name":"dictionary_recent_searches_direction_check","def":"CHECK ((direction = ANY (ARRAY[''EN''::text, ''UZ''::text])))","validated":true},{"tbl":"dictionary_recent_searches","name":"dictionary_recent_searches_pkey","def":"PRIMARY KEY (user_id, lexeme_id)","validated":true},{"tbl":"dictionary_recent_searches","name":"dictionary_recent_searches_user_id_fkey","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"dictionary_releases","name":"dictionary_releases_base_release_id_fkey","def":"FOREIGN KEY (base_release_id) REFERENCES dictionary_releases(id)","validated":true},{"tbl":"dictionary_releases","name":"dictionary_releases_check","def":"CHECK (((state = ''validated''::text) = ((manifest IS NOT NULL) AND (manifest_sha IS NOT NULL) AND (validated_at IS NOT NULL))))","validated":true},{"tbl":"dictionary_releases","name":"dictionary_releases_created_by_fkey","def":"FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"dictionary_releases","name":"dictionary_releases_id_check","def":"CHECK ((id ~ ''^rel-v1-[a-f0-9]{24}$''::text))","validated":true},{"tbl":"dictionary_releases","name":"dictionary_releases_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"dictionary_releases","name":"dictionary_releases_state_check","def":"CHECK ((state = ANY (ARRAY[''building''::text, ''validated''::text, ''failed''::text])))","validated":true},{"tbl":"dictionary_search_terms","name":"dictionary_search_terms_direction_check","def":"CHECK ((direction = ANY (ARRAY[''EN''::text, ''UZ''::text])))","validated":true},{"tbl":"dictionary_search_terms","name":"dictionary_search_terms_pkey","def":"PRIMARY KEY (release_id, lexeme_id, direction, term)","validated":true},{"tbl":"dictionary_search_terms","name":"dictionary_search_terms_rank_check","def":"CHECK (((rank >= 0) AND (rank <= 2)))","validated":true},{"tbl":"dictionary_search_terms","name":"dictionary_search_terms_release_id_lexeme_id_fkey","def":"FOREIGN KEY (release_id, lexeme_id) REFERENCES dictionary_entries(release_id, lexeme_id)","validated":true},{"tbl":"dictionary_sense_mappings","name":"dictionary_sense_mappings_app_sense_id_fkey","def":"FOREIGN KEY (app_sense_id) REFERENCES lexemes(id) ON DELETE RESTRICT","validated":true},{"tbl":"dictionary_sense_mappings","name":"dictionary_sense_mappings_app_unit_id_fkey","def":"FOREIGN KEY (app_unit_id) REFERENCES lexical_units(id) ON DELETE RESTRICT","validated":true},{"tbl":"dictionary_sense_mappings","name":"dictionary_sense_mappings_mapping_method_check","def":"CHECK ((mapping_method = ANY (ARRAY[''canonical_id''::text, ''exact_identity''::text, ''new_canonical''::text])))","validated":true},{"tbl":"dictionary_sense_mappings","name":"dictionary_sense_mappings_pkey","def":"PRIMARY KEY (sense_id)","validated":true},{"tbl":"grammar_attempts","name":"grammar_attempts_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"grammar_attempts","name":"grammar_attempts_exercise_id_grammar_exercises_id_fk","def":"FOREIGN KEY (exercise_id) REFERENCES grammar_exercises(id) ON DELETE CASCADE","validated":true},{"tbl":"grammar_attempts","name":"grammar_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"grammar_attempts","name":"grammar_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"grammar_topics","name":"grammar_topics_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lesson_block_responses","name":"lesson_block_responses_block_id_lesson_blocks_id_fk","def":"FOREIGN KEY (block_id) REFERENCES lesson_blocks(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_block_responses","name":"lesson_block_responses_lesson_id_lessons_id_fk","def":"FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_block_responses","name":"lesson_block_responses_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lesson_block_responses","name":"lesson_block_responses_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_blocks","name":"lesson_blocks_lesson_id_lessons_id_fk","def":"FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_blocks","name":"lesson_blocks_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lesson_blocks","name":"lesson_blocks_ref_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (ref_content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"lesson_notes","name":"lesson_notes_body_len_chk","def":"CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))","validated":true},{"tbl":"lesson_notes","name":"lesson_notes_body_not_blank_chk","def":"CHECK ((btrim(body) <> ''''::text))","validated":true},{"tbl":"lesson_notes","name":"lesson_notes_lesson_id_lessons_id_fk","def":"FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_notes","name":"lesson_notes_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lesson_notes","name":"lesson_notes_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_progress","name":"lesson_progress_lesson_id_lessons_id_fk","def":"FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE","validated":true},{"tbl":"lesson_progress","name":"lesson_progress_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lesson_progress","name":"lesson_progress_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"lessons","name":"lessons_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"lessons","name":"lessons_learning_area_chk","def":"CHECK (((learning_area IS NULL) OR ((learning_area)::text = ANY ((ARRAY[''listening''::character varying, ''reading''::character varying, ''writing''::character varying, ''speaking''::character varying, ''grammar''::character varying, ''vocabulary''::character varying, ''general''::character varying])::text[]))))","validated":true},{"tbl":"lessons","name":"lessons_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"lessons","name":"lessons_teacher_notes_len_chk","def":"CHECK (((teacher_notes IS NULL) OR (((char_length(teacher_notes) >= 1) AND (char_length(teacher_notes) <= 8000)) AND (btrim(teacher_notes) <> ''''::text))))","validated":true},{"tbl":"lessons","name":"lessons_unit_id_units_id_fk","def":"FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_attempts","name":"listening_attempts_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"listening_attempts","name":"listening_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"listening_attempts","name":"listening_attempts_test_id_listening_tests_id_fk","def":"FOREIGN KEY (test_id) REFERENCES listening_tests(id)","validated":true},{"tbl":"listening_attempts","name":"listening_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_packages","name":"listening_packages_pkey","def":"PRIMARY KEY (test_id)","validated":true},{"tbl":"listening_packages","name":"listening_packages_source_id_key","def":"UNIQUE (source_id)","validated":true},{"tbl":"listening_packages","name":"listening_packages_test_id_fkey","def":"FOREIGN KEY (test_id) REFERENCES listening_tests(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_questions","name":"listening_questions_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"listening_questions","name":"listening_questions_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"listening_questions","name":"listening_questions_test_id_listening_tests_id_fk","def":"FOREIGN KEY (test_id) REFERENCES listening_tests(id) ON DELETE CASCADE","validated":true},{"tbl":"listening_tests","name":"listening_tests_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id)","validated":true},{"tbl":"listening_tests","name":"listening_tests_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"listening_tests","name":"listening_tests_program_ordinal_positive_check","def":"CHECK (((program_ordinal IS NULL) OR (program_ordinal >= 1)))","validated":true},{"tbl":"listening_tests","name":"listening_tests_program_pair_check","def":"CHECK (((program_ref IS NULL) = (program_ordinal IS NULL)))","validated":true},{"tbl":"mock_attempts","name":"mock_attempts_mock_test_id_mock_tests_id_fk","def":"FOREIGN KEY (mock_test_id) REFERENCES mock_tests(id) ON DELETE SET NULL","validated":true},{"tbl":"mock_attempts","name":"mock_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"mock_attempts","name":"mock_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"mock_sections","name":"mock_sections_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"mock_sections","name":"mock_sections_mock_test_id_mock_tests_id_fk","def":"FOREIGN KEY (mock_test_id) REFERENCES mock_tests(id) ON DELETE CASCADE","validated":true},{"tbl":"mock_sections","name":"mock_sections_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"mock_tests","name":"mock_tests_course_id_courses_id_fk","def":"FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE","validated":true},{"tbl":"mock_tests","name":"mock_tests_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"mock_tests","name":"mock_tests_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"reading_assessment_passages","name":"reading_assessment_passages_attempt_id_fkey","def":"FOREIGN KEY (attempt_id) REFERENCES reading_assessments(attempt_id) ON DELETE CASCADE","validated":true},{"tbl":"reading_assessment_passages","name":"reading_assessment_passages_attempt_id_passage_id_key","def":"UNIQUE (attempt_id, passage_id)","validated":true},{"tbl":"reading_assessment_passages","name":"reading_assessment_passages_passage_id_fkey","def":"FOREIGN KEY (passage_id) REFERENCES reading_passages(id)","validated":true},{"tbl":"reading_assessment_passages","name":"reading_assessment_passages_passage_no_check","def":"CHECK (((passage_no >= 1) AND (passage_no <= 3)))","validated":true},{"tbl":"reading_assessment_passages","name":"reading_assessment_passages_pkey","def":"PRIMARY KEY (attempt_id, passage_no)","validated":true},{"tbl":"reading_assessments","name":"reading_assessments_attempt_id_fkey","def":"FOREIGN KEY (attempt_id) REFERENCES reading_attempts(id) ON DELETE CASCADE","validated":true},{"tbl":"reading_assessments","name":"reading_assessments_duration_minutes_check","def":"CHECK ((duration_minutes = 60))","validated":true},{"tbl":"reading_assessments","name":"reading_assessments_pkey","def":"PRIMARY KEY (attempt_id)","validated":true},{"tbl":"reading_assessments","name":"reading_assessments_set_id_fkey","def":"FOREIGN KEY (set_id) REFERENCES general_reading_sets(id)","validated":true},{"tbl":"reading_attempts","name":"reading_attempts_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"reading_attempts","name":"reading_attempts_passage_id_reading_passages_id_fk","def":"FOREIGN KEY (passage_id) REFERENCES reading_passages(id)","validated":true},{"tbl":"reading_attempts","name":"reading_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"reading_attempts","name":"reading_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"reading_questions","name":"reading_questions_group_id_reading_question_groups_id_fk","def":"FOREIGN KEY (group_id) REFERENCES reading_question_groups(id) ON DELETE CASCADE","validated":true},{"tbl":"reading_questions","name":"reading_questions_passage_id_reading_passages_id_fk","def":"FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE","validated":true},{"tbl":"reading_questions","name":"reading_questions_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"speaking_attempts","name":"speaking_attempts_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"speaking_attempts","name":"speaking_attempts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"speaking_attempts","name":"speaking_attempts_prompt_id_speaking_prompts_id_fk","def":"FOREIGN KEY (prompt_id) REFERENCES speaking_prompts(id) ON DELETE SET NULL","validated":true},{"tbl":"speaking_attempts","name":"speaking_attempts_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_mistakes_check","def":"CHECK ((mistakes >= 0))","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_model_text_id_fkey","def":"FOREIGN KEY (model_text_id) REFERENCES writing_model_texts(id) ON DELETE CASCADE","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_one_target_chk","def":"CHECK (((model_text_id IS NOT NULL) <> (typing_text_id IS NOT NULL)))","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_pkey","def":"PRIMARY KEY (run_id)","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_preset_seconds_chk","def":"CHECK (((preset_seconds IS NULL) OR (preset_seconds = ANY (ARRAY[30, 60, 120, 180]))))","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_run_id_fkey","def":"FOREIGN KEY (run_id) REFERENCES typing_runs(id) ON DELETE CASCADE","validated":true},{"tbl":"typing_run_texts","name":"typing_run_texts_typing_text_id_fkey","def":"FOREIGN KEY (typing_text_id) REFERENCES typing_texts(id) ON DELETE RESTRICT","validated":true},{"tbl":"typing_runs","name":"typing_runs_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"typing_runs","name":"typing_runs_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true},{"tbl":"typing_texts","name":"typing_texts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"typing_texts","name":"typing_texts_word_count_chk","def":"CHECK ((word_count >= 100))","validated":true},{"tbl":"video_lessons","name":"video_lessons_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"video_lessons","name":"video_lessons_lesson_id_lessons_id_fk","def":"FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE","validated":true},{"tbl":"video_lessons","name":"video_lessons_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"vocabulary_topic_pack_words","name":"vocabulary_topic_pack_words_lexeme_id_lexemes_id_fk","def":"FOREIGN KEY (lexeme_id) REFERENCES lexemes(id) ON DELETE CASCADE","validated":true},{"tbl":"vocabulary_topic_pack_words","name":"vocabulary_topic_pack_words_pack_id_vocabulary_topic_packs_id_f","def":"FOREIGN KEY (pack_id) REFERENCES vocabulary_topic_packs(id) ON DELETE CASCADE","validated":true},{"tbl":"vocabulary_topic_pack_words","name":"vocabulary_topic_pack_words_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"vocabulary_topic_packs","name":"vocabulary_topic_packs_created_by_user_id_users_id_fk","def":"FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL","validated":true},{"tbl":"vocabulary_topic_packs","name":"vocabulary_topic_packs_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"writing_prompts","name":"writing_prompts_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"writing_submissions","name":"writing_submissions_content_version_id_content_versions_id_fk","def":"FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE SET NULL","validated":true},{"tbl":"writing_submissions","name":"writing_submissions_pkey","def":"PRIMARY KEY (id)","validated":true},{"tbl":"writing_submissions","name":"writing_submissions_prompt_id_writing_prompts_id_fk","def":"FOREIGN KEY (prompt_id) REFERENCES writing_prompts(id)","validated":true},{"tbl":"writing_submissions","name":"writing_submissions_user_id_users_id_fk","def":"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE","validated":true}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT c.relname AS tbl,p.conname AS name,pg_get_constraintdef(p.oid) AS def,p.convalidated AS validated FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND p.contype <> 'n' ORDER BY c.relname,p.conname) x WHERE to_jsonb(x)->>'tbl'=wanted->>'tbl' AND to_jsonb(x)->>'name'=wanted->>'name'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'final constraint mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"tbl":"assignment_targets","name":"assignment_targets_pair_idx","def":"CREATE UNIQUE INDEX assignment_targets_pair_idx ON public.assignment_targets USING btree (assignment_id, student_user_id)","valid":true,"ready":true},{"tbl":"assignment_targets","name":"assignment_targets_pkey","def":"CREATE UNIQUE INDEX assignment_targets_pkey ON public.assignment_targets USING btree (id)","valid":true,"ready":true},{"tbl":"assignment_targets","name":"assignment_targets_student_idx","def":"CREATE INDEX assignment_targets_student_idx ON public.assignment_targets USING btree (student_user_id, status)","valid":true,"ready":true},{"tbl":"assignments","name":"assignments_content_idx","def":"CREATE INDEX assignments_content_idx ON public.assignments USING btree (module, content_type, source_ref)","valid":true,"ready":true},{"tbl":"assignments","name":"assignments_pkey","def":"CREATE UNIQUE INDEX assignments_pkey ON public.assignments USING btree (id)","valid":true,"ready":true},{"tbl":"assignments","name":"assignments_version_idx","def":"CREATE INDEX assignments_version_idx ON public.assignments USING btree (content_version_id)","valid":true,"ready":true},{"tbl":"content_imports","name":"content_imports_created_idx","def":"CREATE INDEX content_imports_created_idx ON public.content_imports USING btree (created_at)","valid":true,"ready":true},{"tbl":"content_imports","name":"content_imports_pkey","def":"CREATE UNIQUE INDEX content_imports_pkey ON public.content_imports USING btree (id)","valid":true,"ready":true},{"tbl":"content_imports","name":"content_imports_source_idx","def":"CREATE INDEX content_imports_source_idx ON public.content_imports USING btree (module, content_type, source_ref)","valid":true,"ready":true},{"tbl":"content_versions","name":"content_versions_identity_idx","def":"CREATE UNIQUE INDEX content_versions_identity_idx ON public.content_versions USING btree (module, content_type, source_ref, version_no)","valid":true,"ready":true},{"tbl":"content_versions","name":"content_versions_pkey","def":"CREATE UNIQUE INDEX content_versions_pkey ON public.content_versions USING btree (id)","valid":true,"ready":true},{"tbl":"content_versions","name":"content_versions_ref_idx","def":"CREATE INDEX content_versions_ref_idx ON public.content_versions USING btree (module, content_type, source_ref, status)","valid":true,"ready":true},{"tbl":"content_versions","name":"content_versions_target_idx","def":"CREATE INDEX content_versions_target_idx ON public.content_versions USING btree (target_type, target_id)","valid":true,"ready":true},{"tbl":"dictionary_channels","name":"dictionary_channels_pkey","def":"CREATE UNIQUE INDEX dictionary_channels_pkey ON public.dictionary_channels USING btree (name)","valid":true,"ready":true},{"tbl":"dictionary_drafts","name":"dictionary_drafts_pkey","def":"CREATE UNIQUE INDEX dictionary_drafts_pkey ON public.dictionary_drafts USING btree (id)","valid":true,"ready":true},{"tbl":"dictionary_entries","name":"dictionary_entries_identity_idx","def":"CREATE INDEX dictionary_entries_identity_idx ON public.dictionary_entries USING btree (release_id, lemma_norm, part_of_speech, lexical_type)","valid":true,"ready":true},{"tbl":"dictionary_entries","name":"dictionary_entries_pkey","def":"CREATE UNIQUE INDEX dictionary_entries_pkey ON public.dictionary_entries USING btree (release_id, lexeme_id)","valid":true,"ready":true},{"tbl":"dictionary_entries","name":"dictionary_entries_release_id_lemma_norm_part_of_speech_lex_key","def":"CREATE UNIQUE INDEX dictionary_entries_release_id_lemma_norm_part_of_speech_lex_key ON public.dictionary_entries USING btree (release_id, lemma_norm, part_of_speech, lexical_type, lexeme_id)","valid":true,"ready":true},{"tbl":"dictionary_owner_events","name":"dictionary_owner_events_pkey","def":"CREATE UNIQUE INDEX dictionary_owner_events_pkey ON public.dictionary_owner_events USING btree (id)","valid":true,"ready":true},{"tbl":"dictionary_publish_jobs","name":"dictionary_one_publish_job_idx","def":"CREATE UNIQUE INDEX dictionary_one_publish_job_idx ON public.dictionary_publish_jobs USING btree ((true)) WHERE (phase <> ALL (ARRAY[''complete''::text, ''failed''::text]))","valid":true,"ready":true},{"tbl":"dictionary_publish_jobs","name":"dictionary_publish_jobs_pkey","def":"CREATE UNIQUE INDEX dictionary_publish_jobs_pkey ON public.dictionary_publish_jobs USING btree (id)","valid":true,"ready":true},{"tbl":"dictionary_recent_searches","name":"dictionary_recent_searches_pkey","def":"CREATE UNIQUE INDEX dictionary_recent_searches_pkey ON public.dictionary_recent_searches USING btree (user_id, lexeme_id)","valid":true,"ready":true},{"tbl":"dictionary_recent_searches","name":"dictionary_recent_user_idx","def":"CREATE INDEX dictionary_recent_user_idx ON public.dictionary_recent_searches USING btree (user_id, searched_at DESC)","valid":true,"ready":true},{"tbl":"dictionary_releases","name":"dictionary_releases_pkey","def":"CREATE UNIQUE INDEX dictionary_releases_pkey ON public.dictionary_releases USING btree (id)","valid":true,"ready":true},{"tbl":"dictionary_search_terms","name":"dictionary_search_prefix_idx","def":"CREATE INDEX dictionary_search_prefix_idx ON public.dictionary_search_terms USING btree (release_id, direction, term text_pattern_ops)","valid":true,"ready":true},{"tbl":"dictionary_search_terms","name":"dictionary_search_terms_pkey","def":"CREATE UNIQUE INDEX dictionary_search_terms_pkey ON public.dictionary_search_terms USING btree (release_id, lexeme_id, direction, term)","valid":true,"ready":true},{"tbl":"dictionary_search_terms","name":"dictionary_terms_entry_idx","def":"CREATE INDEX dictionary_terms_entry_idx ON public.dictionary_search_terms USING btree (release_id, lexeme_id)","valid":true,"ready":true},{"tbl":"dictionary_sense_mappings","name":"dictionary_sense_app_identity_idx","def":"CREATE UNIQUE INDEX dictionary_sense_app_identity_idx ON public.dictionary_sense_mappings USING btree (app_sense_id)","valid":true,"ready":true},{"tbl":"dictionary_sense_mappings","name":"dictionary_sense_mappings_pkey","def":"CREATE UNIQUE INDEX dictionary_sense_mappings_pkey ON public.dictionary_sense_mappings USING btree (sense_id)","valid":true,"ready":true},{"tbl":"grammar_attempts","name":"grammar_attempts_pkey","def":"CREATE UNIQUE INDEX grammar_attempts_pkey ON public.grammar_attempts USING btree (id)","valid":true,"ready":true},{"tbl":"grammar_topics","name":"grammar_topics_pkey","def":"CREATE UNIQUE INDEX grammar_topics_pkey ON public.grammar_topics USING btree (id)","valid":true,"ready":true},{"tbl":"grammar_topics","name":"grammar_topics_source_ref_idx","def":"CREATE UNIQUE INDEX grammar_topics_source_ref_idx ON public.grammar_topics USING btree (source_ref) WHERE (source_ref IS NOT NULL)","valid":true,"ready":true},{"tbl":"lesson_block_responses","name":"lesson_block_responses_lesson_idx","def":"CREATE INDEX lesson_block_responses_lesson_idx ON public.lesson_block_responses USING btree (lesson_id, user_id)","valid":true,"ready":true},{"tbl":"lesson_block_responses","name":"lesson_block_responses_pkey","def":"CREATE UNIQUE INDEX lesson_block_responses_pkey ON public.lesson_block_responses USING btree (id)","valid":true,"ready":true},{"tbl":"lesson_block_responses","name":"lesson_block_responses_user_block_idx","def":"CREATE UNIQUE INDEX lesson_block_responses_user_block_idx ON public.lesson_block_responses USING btree (user_id, block_id)","valid":true,"ready":true},{"tbl":"lesson_blocks","name":"lesson_blocks_lesson_idx","def":"CREATE INDEX lesson_blocks_lesson_idx ON public.lesson_blocks USING btree (lesson_id)","valid":true,"ready":true},{"tbl":"lesson_blocks","name":"lesson_blocks_pkey","def":"CREATE UNIQUE INDEX lesson_blocks_pkey ON public.lesson_blocks USING btree (id)","valid":true,"ready":true},{"tbl":"lesson_blocks","name":"lesson_blocks_position_idx","def":"CREATE UNIQUE INDEX lesson_blocks_position_idx ON public.lesson_blocks USING btree (lesson_id, \"position\")","valid":true,"ready":true},{"tbl":"lesson_blocks","name":"lesson_blocks_reference_idx","def":"CREATE INDEX lesson_blocks_reference_idx ON public.lesson_blocks USING btree (ref_module, ref_content_type, ref_source_ref)","valid":true,"ready":true},{"tbl":"lesson_notes","name":"lesson_notes_lesson_idx","def":"CREATE INDEX lesson_notes_lesson_idx ON public.lesson_notes USING btree (lesson_id)","valid":true,"ready":true},{"tbl":"lesson_notes","name":"lesson_notes_pkey","def":"CREATE UNIQUE INDEX lesson_notes_pkey ON public.lesson_notes USING btree (id)","valid":true,"ready":true},{"tbl":"lesson_notes","name":"lesson_notes_user_lesson_uq","def":"CREATE UNIQUE INDEX lesson_notes_user_lesson_uq ON public.lesson_notes USING btree (user_id, lesson_id)","valid":true,"ready":true},{"tbl":"lesson_progress","name":"lesson_progress_pkey","def":"CREATE UNIQUE INDEX lesson_progress_pkey ON public.lesson_progress USING btree (id)","valid":true,"ready":true},{"tbl":"lessons","name":"lessons_learning_area_idx","def":"CREATE INDEX lessons_learning_area_idx ON public.lessons USING btree (learning_area, publication_state, updated_at)","valid":true,"ready":true},{"tbl":"lessons","name":"lessons_pkey","def":"CREATE UNIQUE INDEX lessons_pkey ON public.lessons USING btree (id)","valid":true,"ready":true},{"tbl":"lessons","name":"lessons_source_ref_idx","def":"CREATE UNIQUE INDEX lessons_source_ref_idx ON public.lessons USING btree (source_ref) WHERE (source_ref IS NOT NULL)","valid":true,"ready":true},{"tbl":"lessons","name":"lessons_unit_order_idx","def":"CREATE INDEX lessons_unit_order_idx ON public.lessons USING btree (unit_id, \"order\")","valid":true,"ready":true},{"tbl":"listening_attempts","name":"listening_attempts_pkey","def":"CREATE UNIQUE INDEX listening_attempts_pkey ON public.listening_attempts USING btree (id)","valid":true,"ready":true},{"tbl":"listening_packages","name":"listening_packages_pkey","def":"CREATE UNIQUE INDEX listening_packages_pkey ON public.listening_packages USING btree (test_id)","valid":true,"ready":true},{"tbl":"listening_packages","name":"listening_packages_source_id_key","def":"CREATE UNIQUE INDEX listening_packages_source_id_key ON public.listening_packages USING btree (source_id)","valid":true,"ready":true},{"tbl":"listening_questions","name":"listening_questions_pkey","def":"CREATE UNIQUE INDEX listening_questions_pkey ON public.listening_questions USING btree (id)","valid":true,"ready":true},{"tbl":"listening_questions","name":"listening_questions_type_code_idx","def":"CREATE INDEX listening_questions_type_code_idx ON public.listening_questions USING btree (type_code)","valid":true,"ready":true},{"tbl":"listening_questions","name":"listening_questions_version_set_idx","def":"CREATE INDEX listening_questions_version_set_idx ON public.listening_questions USING btree (test_id, content_version_id)","valid":true,"ready":true},{"tbl":"listening_tests","name":"listening_tests_pkey","def":"CREATE UNIQUE INDEX listening_tests_pkey ON public.listening_tests USING btree (id)","valid":true,"ready":true},{"tbl":"listening_tests","name":"listening_tests_program_idx","def":"CREATE INDEX listening_tests_program_idx ON public.listening_tests USING btree (program_ref) WHERE (program_ref IS NOT NULL)","valid":true,"ready":true},{"tbl":"listening_tests","name":"listening_tests_program_ordinal_idx","def":"CREATE UNIQUE INDEX listening_tests_program_ordinal_idx ON public.listening_tests USING btree (program_ref, program_ordinal) WHERE ((program_ref IS NOT NULL) AND (program_ordinal IS NOT NULL))","valid":true,"ready":true},{"tbl":"listening_tests","name":"listening_tests_source_ref_idx","def":"CREATE UNIQUE INDEX listening_tests_source_ref_idx ON public.listening_tests USING btree (source_ref) WHERE (source_ref IS NOT NULL)","valid":true,"ready":true},{"tbl":"mock_attempts","name":"mock_attempts_pkey","def":"CREATE UNIQUE INDEX mock_attempts_pkey ON public.mock_attempts USING btree (id)","valid":true,"ready":true},{"tbl":"mock_sections","name":"mock_sections_pkey","def":"CREATE UNIQUE INDEX mock_sections_pkey ON public.mock_sections USING btree (id)","valid":true,"ready":true},{"tbl":"mock_sections","name":"mock_sections_position_idx","def":"CREATE UNIQUE INDEX mock_sections_position_idx ON public.mock_sections USING btree (mock_test_id, \"position\")","valid":true,"ready":true},{"tbl":"mock_sections","name":"mock_sections_version_idx","def":"CREATE INDEX mock_sections_version_idx ON public.mock_sections USING btree (content_version_id)","valid":true,"ready":true},{"tbl":"mock_tests","name":"mock_tests_pkey","def":"CREATE UNIQUE INDEX mock_tests_pkey ON public.mock_tests USING btree (id)","valid":true,"ready":true},{"tbl":"reading_assessment_passages","name":"reading_assessment_passages_attempt_id_passage_id_key","def":"CREATE UNIQUE INDEX reading_assessment_passages_attempt_id_passage_id_key ON public.reading_assessment_passages USING btree (attempt_id, passage_id)","valid":true,"ready":true},{"tbl":"reading_assessment_passages","name":"reading_assessment_passages_pkey","def":"CREATE UNIQUE INDEX reading_assessment_passages_pkey ON public.reading_assessment_passages USING btree (attempt_id, passage_no)","valid":true,"ready":true},{"tbl":"reading_assessments","name":"reading_assessments_pkey","def":"CREATE UNIQUE INDEX reading_assessments_pkey ON public.reading_assessments USING btree (attempt_id)","valid":true,"ready":true},{"tbl":"reading_attempts","name":"reading_attempts_pkey","def":"CREATE UNIQUE INDEX reading_attempts_pkey ON public.reading_attempts USING btree (id)","valid":true,"ready":true},{"tbl":"reading_questions","name":"reading_questions_pkey","def":"CREATE UNIQUE INDEX reading_questions_pkey ON public.reading_questions USING btree (id)","valid":true,"ready":true},{"tbl":"speaking_attempts","name":"speaking_attempts_pkey","def":"CREATE UNIQUE INDEX speaking_attempts_pkey ON public.speaking_attempts USING btree (id)","valid":true,"ready":true},{"tbl":"typing_run_texts","name":"typing_run_texts_pkey","def":"CREATE UNIQUE INDEX typing_run_texts_pkey ON public.typing_run_texts USING btree (run_id)","valid":true,"ready":true},{"tbl":"typing_runs","name":"typing_runs_pkey","def":"CREATE UNIQUE INDEX typing_runs_pkey ON public.typing_runs USING btree (id)","valid":true,"ready":true},{"tbl":"typing_runs","name":"typing_runs_run_token_uq","def":"CREATE UNIQUE INDEX typing_runs_run_token_uq ON public.typing_runs USING btree (run_token_id) WHERE (run_token_id IS NOT NULL)","valid":true,"ready":true},{"tbl":"typing_texts","name":"typing_texts_external_id_uq","def":"CREATE UNIQUE INDEX typing_texts_external_id_uq ON public.typing_texts USING btree (external_id)","valid":true,"ready":true},{"tbl":"typing_texts","name":"typing_texts_pkey","def":"CREATE UNIQUE INDEX typing_texts_pkey ON public.typing_texts USING btree (id)","valid":true,"ready":true},{"tbl":"typing_texts","name":"typing_texts_publication_idx","def":"CREATE INDEX typing_texts_publication_idx ON public.typing_texts USING btree (publication_state, language)","valid":true,"ready":true},{"tbl":"video_lessons","name":"video_lessons_lesson_idx","def":"CREATE UNIQUE INDEX video_lessons_lesson_idx ON public.video_lessons USING btree (lesson_id)","valid":true,"ready":true},{"tbl":"video_lessons","name":"video_lessons_media_kind_idx","def":"CREATE INDEX video_lessons_media_kind_idx ON public.video_lessons USING btree (media_kind, publication_state)","valid":true,"ready":true},{"tbl":"video_lessons","name":"video_lessons_pkey","def":"CREATE UNIQUE INDEX video_lessons_pkey ON public.video_lessons USING btree (id)","valid":true,"ready":true},{"tbl":"video_lessons","name":"video_lessons_source_ref_idx","def":"CREATE UNIQUE INDEX video_lessons_source_ref_idx ON public.video_lessons USING btree (source_ref) WHERE (source_ref IS NOT NULL)","valid":true,"ready":true},{"tbl":"video_lessons","name":"video_lessons_video_idx","def":"CREATE UNIQUE INDEX video_lessons_video_idx ON public.video_lessons USING btree (provider, video_id)","valid":true,"ready":true},{"tbl":"vocabulary_topic_pack_words","name":"vocabulary_topic_pack_words_lexeme_idx","def":"CREATE UNIQUE INDEX vocabulary_topic_pack_words_lexeme_idx ON public.vocabulary_topic_pack_words USING btree (pack_id, lexeme_id)","valid":true,"ready":true},{"tbl":"vocabulary_topic_pack_words","name":"vocabulary_topic_pack_words_pkey","def":"CREATE UNIQUE INDEX vocabulary_topic_pack_words_pkey ON public.vocabulary_topic_pack_words USING btree (id)","valid":true,"ready":true},{"tbl":"vocabulary_topic_pack_words","name":"vocabulary_topic_pack_words_position_idx","def":"CREATE UNIQUE INDEX vocabulary_topic_pack_words_position_idx ON public.vocabulary_topic_pack_words USING btree (pack_id, \"position\")","valid":true,"ready":true},{"tbl":"vocabulary_topic_packs","name":"vocabulary_topic_packs_pkey","def":"CREATE UNIQUE INDEX vocabulary_topic_packs_pkey ON public.vocabulary_topic_packs USING btree (id)","valid":true,"ready":true},{"tbl":"vocabulary_topic_packs","name":"vocabulary_topic_packs_slug_idx","def":"CREATE UNIQUE INDEX vocabulary_topic_packs_slug_idx ON public.vocabulary_topic_packs USING btree (slug)","valid":true,"ready":true},{"tbl":"vocabulary_topic_packs","name":"vocabulary_topic_packs_source_ref_idx","def":"CREATE UNIQUE INDEX vocabulary_topic_packs_source_ref_idx ON public.vocabulary_topic_packs USING btree (source_ref)","valid":true,"ready":true},{"tbl":"writing_prompts","name":"writing_prompts_pkey","def":"CREATE UNIQUE INDEX writing_prompts_pkey ON public.writing_prompts USING btree (id)","valid":true,"ready":true},{"tbl":"writing_prompts","name":"writing_prompts_source_ref_idx","def":"CREATE UNIQUE INDEX writing_prompts_source_ref_idx ON public.writing_prompts USING btree (source_ref) WHERE (source_ref IS NOT NULL)","valid":true,"ready":true},{"tbl":"writing_submissions","name":"writing_submissions_pkey","def":"CREATE UNIQUE INDEX writing_submissions_pkey ON public.writing_submissions USING btree (id)","valid":true,"ready":true}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT p.tablename AS tbl,p.indexname AS name,p.indexdef AS def,i.indisvalid AS valid,i.indisready AS ready FROM pg_indexes p JOIN pg_namespace n ON n.nspname=p.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=p.indexname JOIN pg_index i ON i.indexrelid=c.oid WHERE p.schemaname='public' ORDER BY p.tablename,p.indexname) x WHERE to_jsonb(x)->>'tbl'=wanted->>'tbl' AND to_jsonb(x)->>'name'=wanted->>'name'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'final index mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"name":"access_request_status","labels":["pending","approved","rejected"]},{"name":"account_status","labels":["pending","active","rejected","suspended"]},{"name":"assignment_status","labels":["not_started","in_progress","completed","overdue"]},{"name":"attempt_status","labels":["in_progress","completed"]},{"name":"content_block_type","labels":["text","link","file","image","audio"]},{"name":"content_import_status","labels":["validated","created","updated","unchanged","rejected","converted"]},{"name":"content_state","labels":["locked","available","assigned","in_progress","completed"]},{"name":"content_version_status","labels":["draft","published","superseded","archived"]},{"name":"evaluation_type","labels":["writing","speaking","grammar","vocabulary","assignment"]},{"name":"evaluation_verdict","labels":["correct","mostly_correct","needs_correction"]},{"name":"feedback_source","labels":["demo_ai","teacher"]},{"name":"gender","labels":["male","female"]},{"name":"grammar_activity","labels":["correct_it","translate_it","activate_it"]},{"name":"grammar_skill_area","labels":["writing","speaking"]},{"name":"lesson_block_type","labels":["text","image","audio","video","file","link","quiz","content_reference"]},{"name":"listening_question_type","labels":["multiple_choice","short_answer"]},{"name":"live_class_status","labels":["upcoming","live","completed","recorded","cancelled"]},{"name":"live_partner_invite_status","labels":["pending","accepted","declined","cancelled","expired"]},{"name":"live_partner_state","labels":["offline","available","outgoing_invite","incoming_invite","connecting","in_call","reconnecting"]},{"name":"material_type","labels":["video","audio","file","link"]},{"name":"mcq_mastery_stage","labels":["listen","notes","committed","revealed","chosen","reasoned"]},{"name":"provider_type","labels":["internal","external"]},{"name":"publication_state","labels":["draft","scheduled","published","archived"]},{"name":"reading_question_type","labels":["true_false_not_given","yes_no_not_given","multiple_choice","short_answer"]},{"name":"resource_owner_type","labels":["lesson","reading","listening","writing","speaking","grammar","assignment","live_class"]},{"name":"retention_attempt_status","labels":["reading","recall","completed","timed_out"]},{"name":"retention_level","labels":["A2","B1","B2","C1","C2"]},{"name":"role","labels":["student","teacher","admin","owner"]},{"name":"speaking_attempt_status","labels":["recording","submitted","reviewed"]},{"name":"speaking_category","labels":["part1","part2","part3","general","shadowing","top_structures"]},{"name":"speaking_part","labels":["part1","part2","part3","general"]},{"name":"upload_block_kind","labels":["image","audio","file","video"]},{"name":"upload_purpose","labels":["material_primary","material_block","speaking_recording"]},{"name":"upload_status","labels":["pending","finalized","attached","aborted"]},{"name":"video_lesson_stage","labels":["comprehension","gap_fill"]},{"name":"video_lesson_state","labels":["not_started","in_progress","completed"]},{"name":"vocab_state","labels":["new","learning","review","known","mastered","activated"]},{"name":"weakness_status","labels":["open","improving","resolved"]},{"name":"writing_status","labels":["draft","submitted","evaluated"]},{"name":"writing_task_type","labels":["task1","task2"]}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT t.typname AS name,jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname) x WHERE to_jsonb(x)->>'name'=wanted->>'name'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'final enum mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"tbl":"dictionary_entries","name":"dictionary_entries_immutable","enabled":"O","def":"CREATE TRIGGER dictionary_entries_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.dictionary_entries FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release()"},{"tbl":"dictionary_releases","name":"dictionary_registry_immutable","enabled":"O","def":"CREATE TRIGGER dictionary_registry_immutable BEFORE DELETE OR UPDATE ON public.dictionary_releases FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_registry()"},{"tbl":"dictionary_search_terms","name":"dictionary_terms_immutable","enabled":"O","def":"CREATE TRIGGER dictionary_terms_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.dictionary_search_terms FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release()"}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT c.relname AS tbl,t.tgname AS name,t.tgenabled::text AS enabled,pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname) x WHERE to_jsonb(x)->>'tbl'=wanted->>'tbl' AND to_jsonb(x)->>'name'=wanted->>'name'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'final trigger mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $check$ DECLARE wanted jsonb; actual jsonb; BEGIN FOR wanted IN SELECT value FROM jsonb_array_elements('[{"name":"dictionary_immutable_registry","def":"CREATE OR REPLACE FUNCTION public.dictionary_immutable_registry()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n IF OLD.state = ''validated'' AND (TG_OP = ''DELETE'' OR\n   ROW(NEW.id,NEW.base_release_id,NEW.state,NEW.manifest,NEW.manifest_sha,NEW.validated_at)\n   IS DISTINCT FROM ROW(OLD.id,OLD.base_release_id,OLD.state,OLD.manifest,OLD.manifest_sha,OLD.validated_at)) THEN\n  RAISE EXCEPTION ''immutable_dictionary_registry'';\n END IF;\n RETURN CASE WHEN TG_OP = ''DELETE'' THEN OLD ELSE NEW END;\nEND $function$\n"},{"name":"dictionary_immutable_release","def":"CREATE OR REPLACE FUNCTION public.dictionary_immutable_release()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n IF EXISTS (SELECT 1 FROM dictionary_releases WHERE id IN (OLD.release_id, NEW.release_id) AND state = ''validated'') THEN\n  RAISE EXCEPTION ''immutable_dictionary_release'';\n END IF;\n RETURN CASE WHEN TG_OP = ''DELETE'' THEN OLD ELSE NEW END;\nEND $function$\n"}]'::jsonb) LOOP SELECT to_jsonb(x) INTO actual FROM (SELECT p.proname AS name,pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'dictionary_immutable_%' ORDER BY p.proname) x WHERE to_jsonb(x)->>'name'=wanted->>'name'; IF actual IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'final function mismatch: expected %, got %',wanted,actual; END IF; END LOOP; END $check$;
DO $checks$ BEGIN IF (SELECT count(*) FROM public.typing_texts WHERE external_id ~ '^la-typing-b1b2-(0[1-9]|[12][0-9]|30)$')<>30 THEN RAISE EXCEPTION 'typing seed incomplete'; END IF; IF EXISTS(SELECT 1 FROM public.listening_packages WHERE payload->'authoredRuntime' IS NOT NULL AND NOT legacy_runtime) THEN RAISE EXCEPTION 'legacy runtime backfill incomplete'; END IF; IF EXISTS(SELECT 1 FROM qa_recovery_20261012.lesson_progress b WHERE b.notes IS NOT NULL AND btrim(b.notes)<>'' AND NOT EXISTS(SELECT 1 FROM public.lesson_notes n WHERE n.user_id=b.user_id AND n.lesson_id=b.lesson_id AND n.body=b.notes) AND NOT EXISTS(SELECT 1 FROM public.lesson_progress p WHERE p.id=b.id AND p.notes=b.notes)) THEN RAISE EXCEPTION 'historical note lost'; END IF; IF has_schema_privilege('anon','qa_recovery_20261012','USAGE') OR has_schema_privilege('authenticated','qa_recovery_20261012','USAGE') THEN RAISE EXCEPTION 'private recovery schema exposed'; END IF; END $checks$;
DO $rls_guard$ BEGIN IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND ((n.nspname='qa_recovery_20261012') OR (n.nspname='public' AND c.relname=ANY(ARRAY['assignment_targets','content_imports','content_versions','dictionary_channels','dictionary_drafts','dictionary_entries','dictionary_owner_events','dictionary_publish_jobs','dictionary_recent_searches','dictionary_releases','dictionary_search_terms','dictionary_sense_mappings','lesson_block_responses','lesson_blocks','lesson_notes','mock_sections','reading_assessment_passages','reading_assessments','typing_texts','vocabulary_topic_pack_words','vocabulary_topic_packs']))) AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'RLS absent on new or recovery table'; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'client roles can bypass RLS'; END IF; END $rls_guard$;
DO $preserve$ DECLARE t record; extra text[]; n bigint; h text; expected_h text; BEGIN FOR t IN SELECT * FROM qa_recovery_20261012.table_manifest ORDER BY table_name LOOP SELECT coalesce(array_agg(a.attname),ARRAY[]::text[]) INTO extra FROM pg_attribute a WHERE a.attrelid=format('public.%I',t.table_name)::regclass AND a.attnum>0 AND NOT a.attisdropped AND NOT(a.attname=ANY(t.original_columns)); EXECUTE format('SELECT count(*),md5(coalesce(string_agg(md5((to_jsonb(r)-$1)::text),%L ORDER BY md5((to_jsonb(r)-$1)::text)),%L)) FROM public.%I r','','',t.table_name) USING extra INTO n,h; expected_h:=t.rows_md5; IF t.table_name='lesson_progress' THEN EXECUTE 'SELECT md5(coalesce(string_agg(md5(j::text),'''' ORDER BY md5(j::text)),'''')) FROM (SELECT CASE WHEN b.notes IS NOT NULL AND EXISTS(SELECT 1 FROM public.lesson_notes n WHERE n.user_id=b.user_id AND n.lesson_id=b.lesson_id AND n.body=b.notes) THEN to_jsonb(b)||jsonb_build_object(''notes'',NULL) ELSE to_jsonb(b) END j FROM qa_recovery_20261012.lesson_progress b) x' INTO expected_h; END IF; IF n<>t.row_count OR h<>expected_h THEN RAISE EXCEPTION 'STOP: original rows changed unexpectedly for %, count % / %, hash % / %',t.table_name,n,t.row_count,h,expected_h; END IF; END LOOP; END $preserve$;
COMMIT;
SELECT 'qa_schema_reconciled' result,(SELECT count(*) FROM drizzle.__drizzle_migrations) migration_count,(SELECT count(*) FROM public.assignment_targets) assignment_targets,(SELECT count(*) FROM public.typing_texts) typing_texts,(SELECT count(*) FROM public.lesson_notes) lesson_notes;
