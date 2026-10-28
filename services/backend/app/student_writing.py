"""Read-only staff access to existing persisted Writing work, never local drafts."""
import math
from fastapi import HTTPException
from .browser_common import camel,number
from .study_time import subject

WORK="""
SELECT 'submission'::text kind,s.id,s.created_at,s.updated_at,s.submitted_at completed_at,s.status::text status,
 p.category||' · '||p.task_type::text title,p.prompt AS prompt,s.content AS body,
 jsonb_build_object('promptId',s.prompt_id,'taskType',p.task_type,'examEntries',
   (SELECT jsonb_agg(to_jsonb(pe)) FROM writing_exam_paper_entries pe WHERE pe.submission_id=s.id)) AS detail
 FROM writing_submissions s JOIN writing_prompts p ON p.id=s.prompt_id WHERE s.user_id=$1
UNION ALL SELECT 'grade',g.id,g.created_at,COALESCE(g.evaluated_at,g.created_at),g.created_at,g.status,
 'Grade My Work · '||g.task_type::text,g.question_text,g.essay_text,jsonb_build_object('analysis',g.analysis,'promptId',g.prompt_id,'taskType',g.task_type)
 FROM writing_grade_requests g WHERE g.user_id=$1 AND g.idempotency_key NOT LIKE 'exam_%'
UNION ALL SELECT 'translation',a.id,a.started_at,COALESCE((SELECT max(created_at) FROM writing_translation_answers WHERE attempt_id=a.id),a.completed_at,a.started_at),a.completed_at,a.status,
 t.title,t.prompt_text,COALESCE((SELECT string_agg(x.answer_text,E'\\n' ORDER BY q.position) FROM writing_translation_answers x JOIN writing_translation_sentences q ON q.id=x.sentence_id WHERE x.attempt_id=a.id),''),
 jsonb_build_object('answers',(SELECT jsonb_agg(jsonb_build_object('position',q.position,'source',q.uzbek_source,'answer',x.answer_text,'feedback',x.feedback,'tries',x.tries,'verdict',x.verdict) ORDER BY q.position)
   FROM writing_translation_answers x JOIN writing_translation_sentences q ON q.id=x.sentence_id WHERE x.attempt_id=a.id),'overallEstimate',a.overall_estimate)
 FROM writing_translation_attempts a JOIN writing_translation_sets t ON t.id=a.set_id WHERE a.user_id=$1
UNION ALL SELECT 'stealing',s.id,s.created_at,s.updated_at,s.completed_at,CASE WHEN s.completed_at IS NULL THEN 'saved' ELSE 'completed' END,
 m.title,NULL::text,concat_ws(E'\\n\\n',s.brainstorm,s.draft,s.comparison,s.rewrite),
 jsonb_build_object('step',s.step,'brainstorm',s.brainstorm,'draft',s.draft,'comparison',s.comparison,'rewrite',s.rewrite)
 FROM writing_stealing_sessions s JOIN writing_model_texts m ON m.id=s.model_text_id WHERE s.user_id=$1
UNION ALL SELECT 'activation',e.id,e.created_at,e.created_at,e.created_at,'saved',COALESCE(e.payload->>'term','Activation Lab'),NULL::text,e.payload->>'answer',e.payload
 FROM activity_events e WHERE e.user_id=$1 AND e.type='WRITING_ACTIVATION_CHECK'
UNION ALL SELECT 'study',e.id,e.created_at,e.created_at,NULL::timestamptz,'saved','Language Stealing · notes',NULL::text,e.payload::text,e.payload
 FROM activity_events e WHERE e.user_id=$1 AND e.type IN ('WRITING_STEALING_STUDY','WRITING_PERSONAL_PATTERN')
UNION ALL SELECT 'lesson-note',n.id,n.updated_at,n.updated_at,NULL::timestamptz,'saved',l.title,NULL::text,n.body,'{}'::jsonb
 FROM lesson_notes n JOIN lessons l ON l.id=n.lesson_id WHERE n.user_id=$1 AND l.learning_area::text='writing'
UNION ALL SELECT 'lesson',l.id,p.completed_at,p.completed_at,p.completed_at,'completed',l.title,NULL::text,''::text,jsonb_build_object('noTextStored',true)
 FROM writing_lesson_progress p JOIN writing_lessons l ON l.id=p.lesson_id WHERE p.user_id=$1
UNION ALL SELECT 'typing',r.id,r.created_at,COALESCE(r.finished_at,r.created_at),r.finished_at,'completed','Typing',NULL::text,''::text,
 jsonb_build_object('wpm',r.wpm,'accuracy',r.accuracy,'durationMs',r.duration_ms,'rawTextStored',false)
 FROM typing_runs r WHERE r.user_id=$1
"""
KINDS=('submission','grade','translation','stealing','activation','study','lesson-note','lesson','typing')

async def read(con,user,q):
    # Deliberately disallow Admin, including on the detail endpoint.
    if user['role'] not in ('teacher','owner'):raise HTTPException(403,'forbidden')
    sid=await subject(con,user,q.get('student'))
    kind=q.get('type','');key=q.get('work');args=[sid];where='TRUE'
    if kind:
        if kind not in KINDS:raise HTTPException(400,'invalid_type')
        args.append(kind);where+=' AND kind=$2'
    if key:
        if not kind:raise HTTPException(400,'invalid_type')
        from . import main as core
        ident=core.uuid_value(key)
        if not ident:raise HTTPException(404,'not_found')
        args.append(ident);where+=f' AND id=${len(args)}'
    total=await con.fetchval(f'WITH work AS ({WORK}) SELECT count(*)::int FROM work WHERE {where}',*args)
    page=min(number(q.get('page'),maximum=100000),max(1,math.ceil(total/20)))
    if key and not total:raise HTTPException(404,'not_found')
    # List only previews; full persisted text and revision/feedback payloads load on selection.
    projection='*' if key else "kind,id,created_at,updated_at,completed_at,status,title,left(prompt,300) prompt,left(body,240) body,'{}'::jsonb detail"
    rows=await con.fetch(f'WITH work AS ({WORK}) SELECT {projection} FROM work WHERE {where} ORDER BY updated_at DESC,id DESC,kind LIMIT 20 OFFSET {(page-1)*20}',*args)
    items=[camel(r) for r in rows]
    if key:
        for item in items:
            source={'submission':'writing_submission','grade':'writing_grade'}.get(item['kind'])
            item['evaluations']=[camel(r) for r in await con.fetch('SELECT id,overall_estimate,confidence,verdict,criteria,strengths,weaknesses,issues,next_actions,provider_display_name,created_at FROM evaluations WHERE user_id=$1 AND source_type=$2 AND source_id=$3 ORDER BY created_at DESC,id DESC',sid,source,item['id'])] if source else []
            item['feedback']=[camel(r) for r in await con.fetch('SELECT source,overall_band,comment,strengths,weaknesses,suggestions,created_at FROM writing_feedback WHERE submission_id=$1 ORDER BY created_at DESC,id DESC',item['id'])] if item['kind']=='submission' else []
            if item['kind']=='submission':
                linked=await con.fetch("""SELECT g.id,g.status,g.created_at,g.evaluated_at,g.analysis,e.overall_estimate,e.criteria,e.strengths,e.weaknesses
                  FROM writing_exam_paper_entries pe JOIN writing_grade_requests g ON g.user_id=$1 AND g.idempotency_key='exam_'||pe.paper_id::text||'_'||pe.position::text
                  LEFT JOIN evaluations e ON e.user_id=g.user_id AND e.source_type='writing_grade' AND e.source_id=g.id WHERE pe.submission_id=$2""",sid,item['id'])
                item['examGrading']=[camel(r) for r in linked]
    return {'studentId':str(sid),'items':items,'page':page,'pages':max(1,math.ceil(total/20)),'total':total,'type':kind,'detail':bool(key)}
