"""Bounded administrative learning statistics, aggregated in PostgreSQL."""
import math
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, identifier, number
from .browser_staff_people import student

MODULES = ('reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks')
# Explicit, record-based definitions: no profile band or acoustic score is used.
# The same relation feeds summaries, student rankings, calendar and history.
RELATION = """
 SELECT a.id,a.user_id,'reading'::text module,'attempt'::text activity,a.started_at AS at,a.status='completed' completed,
   a.score::float8 score,a.total_questions::float8 maximum,'questions'::text unit,p.title::text title FROM reading_attempts a LEFT JOIN reading_passages p ON p.id=a.passage_id
 UNION ALL SELECT a.id,a.user_id,'listening','attempt',a.started_at,a.status='completed',a.score::float8,a.total_questions::float8,'questions',p.title FROM listening_attempts a LEFT JOIN listening_tests p ON p.id=a.test_id
 UNION ALL SELECT a.id,a.user_id,'writing','submission',COALESCE(a.submitted_at,a.updated_at),a.status<>'draft',e.overall_estimate::float8,9::float8,'band',left(p.prompt,300) FROM writing_submissions a LEFT JOIN writing_prompts p ON p.id=a.prompt_id LEFT JOIN evaluations e ON e.source_type='writing_submission' AND e.source_id=a.id AND e.user_id=a.user_id
 UNION ALL SELECT a.id,a.user_id,'speaking','attempt',a.started_at,a.status<>'recording',e.overall_estimate::float8,9::float8,'band',left(p.prompt_text,300) FROM speaking_attempts a LEFT JOIN speaking_prompts p ON p.id=a.prompt_id LEFT JOIN evaluations e ON e.source_type='speaking_attempt' AND e.source_id=a.id AND e.user_id=a.user_id
 UNION ALL SELECT a.id,a.user_id,'retention','recall',a.created_at,a.status IN ('completed','timed_out'),a.score::float8,100::float8,'points',a.retention_label_snapshot FROM retention_attempts a
 UNION ALL SELECT a.id,a.user_id,'vocabulary','word',a.created_at,a.mastered_at IS NOT NULL,NULL::float8,NULL::float8,'',l.term FROM user_vocabulary a LEFT JOIN lexemes l ON l.id=a.lexeme_id
 UNION ALL SELECT a.id,a.user_id,'grammar',a.activity::text,a.attempted_at,TRUE,CASE WHEN a.is_correct THEN 1 ELSE 0 END::float8,1::float8,'questions',t.title FROM grammar_attempts a LEFT JOIN grammar_exercises e ON e.id=a.exercise_id LEFT JOIN grammar_topics t ON t.id=e.topic_id
 UNION ALL SELECT a.id,a.user_id,'video','lesson',a.updated_at,a.state='completed',NULL::float8,NULL::float8,'',v.title FROM video_lesson_progress a LEFT JOIN video_lessons v ON v.id=a.video_lesson_id
 UNION ALL SELECT a.id,a.user_id,'lessons','lesson',a.updated_at,a.state='completed',NULL::float8,NULL::float8,'',l.title FROM lesson_progress a LEFT JOIN lessons l ON l.id=a.lesson_id
 UNION ALL SELECT a.id,a.user_id,'mocks','mock',a.started_at,a.finished_at IS NOT NULL,a.estimated_band::float8,9::float8,'band',COALESCE(t.title,a.mock_snapshot->>'title') FROM mock_attempts a LEFT JOIN mock_tests t ON t.id=a.mock_test_id
"""


async def summary(con, uid=None):
    where = 'WHERE user_id=$1' if uid else ''
    rows = await con.fetch(f'''WITH r AS ({RELATION}) SELECT module,count(*)::int started,
      count(*) FILTER(WHERE completed)::int completed,count(DISTINCT user_id)::int learners,
      100.0*sum(score) FILTER(WHERE completed AND unit<>'band')/NULLIF(sum(maximum) FILTER(WHERE completed AND unit<>'band'),0) accuracy,
      avg(score) FILTER(WHERE completed AND unit='band') band,max(at) latest FROM r {where} GROUP BY module''',*([uid] if uid else []))
    by = {r['module']:camel(r) for r in rows}
    return [by.get(module,{'module':module,'started':0,'completed':0,'learners':0,'accuracy':None,'band':None,'latest':None}) for module in MODULES]


async def read(req, user, kind, q):
    selected = q.get('module') if q.get('module') in MODULES else None
    db = await core.pool()
    async with db.acquire() as con:
        if kind=='student-learning':
            uid = identifier(q.get('id'));await student(con,user,uid)
            args = [uid];where = 'user_id=$1'
            if selected: args.append(selected);where += ' AND module=$2'
            total = await con.fetchval(f'WITH r AS ({RELATION}) SELECT count(*)::int FROM r WHERE {where}',*args)
            pages = max(1,math.ceil(total/25));page = min(pages,number(q.get('page')))
            rows = await con.fetch(f'WITH r AS ({RELATION}) SELECT id,module,activity,at,completed,CASE WHEN completed THEN score END score,maximum,unit,title FROM r WHERE {where} ORDER BY at DESC,id DESC,module LIMIT 25 OFFSET {(page-1)*25}',*args)
            return {'summary':await summary(con,uid),'history':{'module':selected,'total':total,'pages':pages,'page':page,'rows':[camel(r) for r in rows]}}
        if kind!='centre-statistics': raise HTTPException(404,'not_found')
        args = [selected] if selected else []
        where = 'AND r.module=$1' if selected else ''
        rows = await con.fetch(f'''WITH r AS ({RELATION}) SELECT u.id,u.name,count(*)::int started,
          count(*) FILTER(WHERE r.completed)::int completed,
          100.0*sum(r.score) FILTER(WHERE r.completed AND unit<>'band')/NULLIF(sum(maximum) FILTER(WHERE r.completed AND unit<>'band'),0) accuracy,
          avg(score) FILTER(WHERE r.completed AND unit='band') band FROM r JOIN users u ON u.id=r.user_id
          WHERE u.role='student' {where} GROUP BY u.id,u.name ORDER BY started DESC,u.id LIMIT 100''',*args)
        daily = await con.fetch(f'''WITH r AS ({RELATION}),days AS (SELECT generate_series(
          (now() AT TIME ZONE 'Asia/Tashkent')::date-13,(now() AT TIME ZONE 'Asia/Tashkent')::date,interval '1 day') d)
          SELECT to_char(d.d,'YYYY-MM-DD') day_key,count(r.id)::int count FROM days d
          LEFT JOIN r ON (r.at AT TIME ZONE 'Asia/Tashkent')::date=d.d::date {where}
          GROUP BY d.d ORDER BY d.d''',*args)
        levels = await con.fetch("SELECT level,count(*)::int rounds,avg(score)::float8 average FROM retention_attempts WHERE status IN ('completed','timed_out') GROUP BY level ORDER BY level")
        return {'summary':await summary(con),'selected':selected,'students':[camel(r) for r in rows],'daily':[{'day':r['day_key'],'count':r['count']} for r in daily],'levels':[dict(r) for r in levels]}
