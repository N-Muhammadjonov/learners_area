BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT now(), version(), pg_database_size(current_database()) AS database_bytes;
SELECT relname,pg_relation_size(relid) AS heap_bytes,pg_indexes_size(relid) AS index_bytes,
 pg_total_relation_size(relid) AS total_bytes,n_live_tup,n_dead_tup,last_autoanalyze
FROM pg_stat_user_tables WHERE schemaname='public' AND relname LIKE 'dictionary%';
SELECT * FROM public.dictionary_channels;
SELECT id,base_release_id,state,delivery,manifest_sha,validated_at,
 manifest->>'lexemes' AS lexemes,manifest->>'search_terms' AS search_terms
FROM public.dictionary_releases;
SELECT id,base_release_id,candidate_release_id,phase,error,updated_at,worker_lease_until
FROM public.dictionary_publish_jobs;
SELECT release_id,direction,count(*) FROM public.dictionary_search_terms
GROUP BY release_id,direction ORDER BY release_id,direction;
SELECT release_id,storage_release,count(*) FROM public.dictionary_entries
GROUP BY release_id,storage_release;
SELECT indexrelname,pg_relation_size(indexrelid) AS bytes,idx_scan,idx_tup_read,idx_tup_fetch
FROM pg_stat_user_indexes WHERE schemaname='public' AND relname='dictionary_search_terms';
SELECT conname,conrelid::regclass,confrelid::regclass,contype,pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid='public.dictionary_search_terms'::regclass
 OR confrelid='public.dictionary_search_terms'::regclass;
SELECT tgname,tgenabled,pg_get_triggerdef(t.oid),pg_get_functiondef(p.oid)
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND tgrelid='public.dictionary_search_terms'::regclass;
SELECT d.deptype,pg_describe_object(d.classid,d.objid,d.objsubid)
FROM pg_depend d WHERE d.refclassid='pg_class'::regclass
 AND d.refobjid='public.dictionary_search_terms'::regclass;
SELECT n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND n.nspname NOT IN ('pg_catalog','information_schema')
 AND p.prosrc LIKE '%dictionary_search_terms%';
SELECT c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'dictionary%';
SELECT stats_reset FROM pg_stat_database WHERE datname=current_database();
SELECT calls,rows,mean_exec_time,left(query,2000) AS normalized_query
FROM pg_stat_statements WHERE query ILIKE '%dictionary_search_terms%'
 AND query NOT ILIKE '%pg_stat_%' ORDER BY calls DESC LIMIT 12;
ROLLBACK;
