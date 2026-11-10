-- QA-only preparation. No live source rows or credentials are returned.
-- Source tables remain unchanged. Only the private recovery schema is created.
DO $guard$
BEGIN
  IF to_regnamespace('riwi_qa_recovery_20261102') IS NOT NULL THEN
    RAISE EXCEPTION 'Recovery schema already exists; inspect before reuse';
  END IF;
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 66 OR
     (SELECT max(created_at) FROM drizzle.__drizzle_migrations) <> 1792460000000 THEN
    RAISE EXCEPTION 'QA journal baseline changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.writing_language_patterns) OR
     EXISTS (SELECT 1 FROM public.live_classes) OR
     EXISTS (SELECT 1 FROM public.live_class_attendance) THEN
    RAISE EXCEPTION 'Data-changing migration targets are populated; separate review required';
  END IF;
END
$guard$;

CREATE SCHEMA riwi_qa_recovery_20261102;
REVOKE ALL ON SCHEMA riwi_qa_recovery_20261102 FROM PUBLIC;
CREATE TABLE riwi_qa_recovery_20261102.manifest (
  source_schema text NOT NULL,
  source_table text NOT NULL,
  recovery_table text NOT NULL,
  row_count bigint NOT NULL,
  row_digest text NOT NULL,
  schema_definition jsonb NOT NULL,
  restored_verified boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_schema,source_table)
);
ALTER TABLE riwi_qa_recovery_20261102.manifest ENABLE ROW LEVEL SECURITY;

DO $snapshot$
DECLARE
  item record;
  fk record;
  source_count bigint;
  source_digest text;
  copy_count bigint;
  copy_digest text;
  definitions jsonb;
  sources text;
  role_name text;
BEGIN
  -- Snapshot only pre-existing tables touched by the pending migration set.
  -- users is excluded: migrations do not rewrite its data, and no credential
  -- hash is queried, copied or exported by this preparation.
  SELECT string_agg(format('%I.%I',n.nspname,c.relname),',' ORDER BY n.nspname,c.relname)
  INTO sources
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND ((n.nspname='public' AND c.relname=ANY(ARRAY[
    'api_rate_buckets','evaluations','live_class_attendance','live_classes',
    'mock_attempts','speaking_attempts','video_lesson_progress',
    'writing_grade_requests','writing_language_patterns','writing_prompts']))
    OR (n.nspname='drizzle' AND c.relname='__drizzle_migrations'));
  EXECUTE 'LOCK TABLE '||sources||' IN SHARE MODE NOWAIT';

  FOR item IN
    SELECT c.oid,n.nspname AS source_schema,c.relname AS source_table,
      CASE WHEN n.nspname='drizzle' THEN 'drizzle_journal' ELSE c.relname END AS recovery_table,
      c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND ((n.nspname='public' AND c.relname=ANY(ARRAY[
      'api_rate_buckets','evaluations','live_class_attendance','live_classes',
      'mock_attempts','speaking_attempts','video_lesson_progress',
      'writing_grade_requests','writing_language_patterns','writing_prompts']))
      OR (n.nspname='drizzle' AND c.relname='__drizzle_migrations'))
    ORDER BY n.nspname,c.relname
  LOOP
    SELECT jsonb_build_object(
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=item.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid,true),
        'validated',convalidated)) FROM pg_constraint WHERE conrelid=item.oid),
      'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid)) FROM pg_index WHERE indrelid=item.oid),
      'triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(oid,true),
        'function',pg_get_functiondef(tgfoid))) FROM pg_trigger WHERE tgrelid=item.oid AND NOT tgisinternal),
      'row_security',item.relrowsecurity,'force_row_security',item.relforcerowsecurity)
    INTO definitions;

    EXECUTE format('SELECT count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),%L ORDER BY md5(to_jsonb(t)::text)),%L)) FROM %I.%I t',
      '','',item.source_schema,item.source_table) INTO source_count,source_digest;
    EXECUTE format('CREATE TABLE riwi_qa_recovery_20261102.%I (LIKE %I.%I INCLUDING ALL)',
      item.recovery_table,item.source_schema,item.source_table);
    EXECUTE format('INSERT INTO riwi_qa_recovery_20261102.%I SELECT * FROM %I.%I',
      item.recovery_table,item.source_schema,item.source_table);
    EXECUTE format('ALTER TABLE riwi_qa_recovery_20261102.%I ENABLE ROW LEVEL SECURITY',item.recovery_table);

    -- A short-lived probe in the private schema can validate references to live
    -- parent keys. PostgreSQL temporary tables cannot reference persistent keys.
    -- The probe is removed before commit; live source tables remain unchanged.
    EXECUTE format('CREATE TABLE riwi_qa_recovery_20261102.la_riwi_restore_probe (LIKE riwi_qa_recovery_20261102.%I INCLUDING ALL)',item.recovery_table);
    EXECUTE format('INSERT INTO riwi_qa_recovery_20261102.la_riwi_restore_probe SELECT * FROM riwi_qa_recovery_20261102.%I',item.recovery_table);
    FOR fk IN SELECT conname,pg_get_constraintdef(oid,true) AS definition
      FROM pg_constraint WHERE conrelid=item.oid AND contype='f'
    LOOP
      EXECUTE format('ALTER TABLE riwi_qa_recovery_20261102.la_riwi_restore_probe ADD CONSTRAINT %I %s',fk.conname,fk.definition);
    END LOOP;
    SELECT count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))
    INTO copy_count,copy_digest FROM riwi_qa_recovery_20261102.la_riwi_restore_probe t;
    IF source_count<>copy_count OR source_digest<>copy_digest THEN
      RAISE EXCEPTION 'Recovery verification failed for %.%',item.source_schema,item.source_table;
    END IF;
    DROP TABLE riwi_qa_recovery_20261102.la_riwi_restore_probe;
    INSERT INTO riwi_qa_recovery_20261102.manifest
      (source_schema,source_table,recovery_table,row_count,row_digest,schema_definition,restored_verified)
      VALUES(item.source_schema,item.source_table,item.recovery_table,source_count,source_digest,definitions,true);
  END LOOP;
  REVOKE ALL ON ALL TABLES IN SCHEMA riwi_qa_recovery_20261102 FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA riwi_qa_recovery_20261102 FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA riwi_qa_recovery_20261102 FROM %I',role_name);
    END IF;
  END LOOP;
END
$snapshot$;
