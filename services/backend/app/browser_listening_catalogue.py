"""User-scoped facts for the existing Listening catalogue, in bounded batches."""


async def catalogue_facts(con,uid,ids,*,sections=False):
    result={'exams':{},'work_exams':{},'runs':{},'questions':{},'mcq':{},'checkpoints':{},'sections':{}}
    if not ids:return result
    # facts() historically uses NULLS LAST, while the legacy course-work reader
    # uses PostgreSQL's default NULLS FIRST. Preserve both selections exactly.
    exams=await con.fetch("""WITH ranked AS (
      SELECT id,test_id,score,total_questions,
       row_number() OVER(PARTITION BY test_id ORDER BY submitted_at DESC NULLS LAST) fact_rank,
       row_number() OVER(PARTITION BY test_id ORDER BY submitted_at DESC) work_rank
      FROM listening_attempts WHERE user_id=$1 AND test_id=ANY($2::uuid[]) AND status='completed')
      SELECT r.*,(SELECT count(*)::int FROM listening_answers a WHERE a.attempt_id=r.id) answer_count,
       (SELECT count(*)::int FROM listening_answers a WHERE a.attempt_id=r.id AND a.is_correct=false) missed
      FROM ranked r WHERE fact_rank=1 OR work_rank=1""",uid,ids)
    for row in exams:
        if row['fact_rank']==1:result['exams'][row['test_id']]=row
        if row['work_rank']==1:result['work_exams'][row['test_id']]=row
    runs=await con.fetch("""SELECT test_id,activity,answers->'_practice' AS practice,completed,score,total
      FROM listening_activity_runs WHERE user_id=$1 AND test_id=ANY($2::uuid[]) ORDER BY created_at DESC""",uid,ids)
    for row in runs:
        result['runs'].setdefault(row['test_id'],[]).append({**dict(row),'answers':{'_practice':row['practice']}})
    # Same published-version -> unversioned -> all fallback as available_set().
    questions=await con.fetch("""WITH latest AS (
      SELECT DISTINCT ON(target_id) target_id,id FROM content_versions
      WHERE target_type='listening_test' AND target_id=ANY($2::uuid[]) AND status='published'
      ORDER BY target_id,version_no DESC)
      SELECT q.test_id,q.id,q.type,q.type_code,q.options,s.stage FROM listening_questions q
      LEFT JOIN latest v ON v.target_id=q.test_id
      LEFT JOIN listening_mcq_sessions s ON s.question_id=q.id AND s.user_id=$1
      WHERE q.test_id=ANY($2::uuid[]) AND CASE
       WHEN EXISTS(SELECT 1 FROM listening_questions x WHERE x.test_id=q.test_id AND x.content_version_id=v.id) THEN q.content_version_id=v.id
       WHEN EXISTS(SELECT 1 FROM listening_questions x WHERE x.test_id=q.test_id AND x.content_version_id IS NULL) THEN q.content_version_id IS NULL
       ELSE true END""",uid,ids)
    for row in questions:
        ident=row['test_id'];result['questions'][ident]=result['questions'].get(ident,0)+1
        if row['type']=='multiple_choice' and row['options'] and not (row['type_code'] or '').startswith(('matching','map','plan')):
            result['mcq'].setdefault(ident,[]).append({'stage':row['stage']})
    checkpoints=await con.fetch('SELECT test_id,values FROM listening_authored_checkpoints WHERE user_id=$1 AND test_id=ANY($2::uuid[])',uid,ids)
    result['checkpoints']={row['test_id']:row['values'] for row in checkpoints}
    if sections:
        rows=await con.fetch("""SELECT DISTINCT ON(target_id) target_id,content_snapshot->>'sectionNo' AS section_no
          FROM content_versions WHERE module='listening' AND target_id=ANY($1::uuid[]) ORDER BY target_id,version_no DESC""",ids)
        result['sections']={row['target_id']:row['section_no'] for row in rows}
    return result
