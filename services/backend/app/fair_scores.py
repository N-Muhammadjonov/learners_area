"""Read-only first-graded-attempt averages. History and grades are never rewritten."""
from datetime import timedelta
from math import isfinite

# All domains are read in one statement/snapshot. LATERAL picks one evaluation per
# attempt so re-evaluation cannot create another candidate. Canonical IDs never use titles.
CANDIDATES="""
SELECT 'reading'::text module,a.id::text id,
 COALESCE(NULLIF(p.external_id,''),CASE WHEN p.source_ref IS NOT NULL AND p.passage_no IS NOT NULL THEN p.source_ref||':passage:'||p.passage_no::text END,'id:'||a.passage_id::text) content,
 a.submitted_at completed_at,e.overall_estimate::float8 band,a.score::float8 raw,a.total_questions::float8 total
FROM reading_attempts a JOIN reading_passages p ON p.id=a.passage_id
LEFT JOIN LATERAL(SELECT overall_estimate FROM evaluations WHERE user_id=a.user_id AND source_type='reading_attempt' AND source_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON TRUE
WHERE a.user_id=$1 AND a.status='completed' AND a.submitted_at IS NOT NULL AND a.score IS NOT NULL AND a.total_questions>0
UNION ALL
SELECT 'listening',a.id::text,COALESCE(NULLIF(p.source_ref,''),'id:'||a.test_id::text),a.submitted_at,e.overall_estimate::float8,a.score::float8,a.total_questions::float8
FROM listening_attempts a JOIN listening_tests p ON p.id=a.test_id
LEFT JOIN LATERAL(SELECT overall_estimate FROM evaluations WHERE user_id=a.user_id AND source_type='listening_attempt' AND source_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON TRUE
WHERE a.user_id=$1 AND a.status='completed' AND a.submitted_at IS NOT NULL AND a.score IS NOT NULL AND a.total_questions>0
UNION ALL
SELECT 'writing',a.id::text,COALESCE(NULLIF(p.source_ref,''),'id:'||a.prompt_id::text),a.submitted_at,COALESCE(f.overall_band,e.overall_estimate)::float8,NULL::float8,NULL::float8
FROM writing_submissions a JOIN writing_prompts p ON p.id=a.prompt_id
LEFT JOIN LATERAL(SELECT overall_estimate FROM evaluations WHERE user_id=a.user_id AND ((source_type='writing_submission' AND source_id=a.id) OR (source_type='writing_grade' AND source_id IN (SELECT g.id FROM writing_grade_requests g JOIN writing_exam_paper_entries pe ON pe.submission_id=a.id WHERE g.user_id=a.user_id AND g.idempotency_key='exam_'||pe.paper_id::text||'_'||pe.position::text))) ORDER BY created_at DESC,id DESC LIMIT 1)e ON TRUE
LEFT JOIN LATERAL(SELECT overall_band FROM writing_feedback WHERE submission_id=a.id AND source='teacher' AND overall_band IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1)f ON TRUE
WHERE a.user_id=$1 AND a.status<>'draft' AND a.submitted_at IS NOT NULL AND COALESCE(f.overall_band,e.overall_estimate) IS NOT NULL
UNION ALL
SELECT 'writing','grade:'||a.id::text,COALESCE(NULLIF(p.source_ref,''),'id:'||a.prompt_id::text,'question:'||a.task_type::text||':'||md5(lower(regexp_replace(trim(a.question_text),'\\s+',' ','g')))),a.created_at,e.overall_estimate::float8,NULL::float8,NULL::float8
FROM writing_grade_requests a LEFT JOIN LATERAL(SELECT p.* FROM writing_prompts p
 WHERE p.id=a.prompt_id OR (a.prompt_id IS NULL AND p.task_type=a.task_type AND
 lower(regexp_replace(trim(p.prompt),'\\s+',' ','g'))=lower(regexp_replace(trim(a.question_text),'\\s+',' ','g')))
 ORDER BY (p.id=a.prompt_id) DESC NULLS LAST,p.id LIMIT 1)p ON TRUE
JOIN LATERAL(SELECT overall_estimate FROM evaluations WHERE user_id=a.user_id AND source_type='writing_grade' AND source_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON TRUE
WHERE a.user_id=$1 AND a.status='evaluated' AND e.overall_estimate IS NOT NULL AND a.idempotency_key NOT LIKE 'exam_%'
UNION ALL
SELECT 'speaking',a.id::text,COALESCE(NULLIF(to_jsonb(p)->>'source_ref',''),'id:'||a.prompt_id::text),a.submitted_at,e.overall_estimate::float8,NULL::float8,NULL::float8
FROM speaking_attempts a JOIN speaking_prompts p ON p.id=a.prompt_id
JOIN LATERAL(SELECT overall_estimate FROM evaluations WHERE user_id=a.user_id AND source_type='speaking_attempt' AND source_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON TRUE
WHERE a.user_id=$1 AND a.status IN ('submitted','reviewed') AND a.submitted_at IS NOT NULL AND e.overall_estimate IS NOT NULL
UNION ALL
SELECT 'mocks',a.id::text,COALESCE(NULLIF(to_jsonb(t)->>'source_ref',''),'id:'||a.mock_test_id::text,NULLIF(a.mock_snapshot->>'sourceRef','')),a.finished_at,a.estimated_band::float8,NULL::float8,NULL::float8
FROM mock_attempts a LEFT JOIN mock_tests t ON t.id=a.mock_test_id
WHERE a.user_id=$1 AND a.status='submitted' AND a.finished_at IS NOT NULL AND a.estimated_band IS NOT NULL
"""

def valid_score(r):
    def valid(value, high):
        return value is not None and isfinite(float(value)) and 0<=float(value)<=high
    return valid(r.get('band'),9) or (r.get('total') is not None and float(r['total'])>0 and valid(r.get('raw'),float(r['total'])))

def eligible(rows):
    last={};chosen=[]
    for r in sorted([r for r in rows if r.get('completed_at') and r.get('content') and valid_score(r)],key=lambda r:(r['completed_at'],str(r['id']))):
        if not r.get('content') or not r.get('completed_at'):continue
        key=(r['module'],r['content']);prior=last.get(key)
        if prior is None or r['completed_at']-prior>=timedelta(days=30):chosen.append(r);last[key]=r['completed_at']
    return chosen

async def averages(con,uid):
    rows=await con.fetch(CANDIDATES,uid);chosen=eligible(rows);result={}
    for module in ('reading','listening','writing','speaking','mocks'):
        values=[r for r in chosen if r['module']==module]
        bands=[float(r['band']) for r in values if r['band'] is not None and 0<=r['band']<=9]
        graded=[r for r in values if r['total'] and r['raw'] is not None]
        total=sum(r['total'] for r in graded)
        result[module]={'band':round(sum(bands)/len(bands),2) if bands else None,
          'accuracy':round(100*sum(r['raw'] for r in graded)/total,1) if total else None,
          'eligible':len(values),'scored':sum(r['module']==module and valid_score(r) for r in rows)}
    return result
