"""Listening products are classified from authored facts, never display titles."""
import json
import math
import re
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, identifier, live, number, safe_resource
from .step17_mcq_port import available_set, sequence, programme_snapshot, staff, live as is_live
from .step17_listening_course_port import runtime_source, SPEC, current_work, course_status
from .listening_order import material_order
from .browser_listening_catalogue import catalogue_facts

PRODUCT_SQL = """CASE WHEN t.program_ref IS NOT NULL THEN 'mcq_programme'
 WHEN p.payload->>'collection'='mcq' THEN 'mcq_programme'
 WHEN p.payload->>'collection'='question_types' THEN 'question_type_practice'
 WHEN p.payload->>'collection'='essential' THEN 'essential_recording'
 WHEN p.payload->>'collection'='academic' THEN 'academic_full_test'
 WHEN p.payload->>'collection'='general' THEN 'general_section'
 WHEN p.test_id IS NOT NULL AND jsonb_array_length(p.payload->'sections')=4 AND jsonb_array_length(p.payload->'questions')=40 THEN 'academic_full_test'
 WHEN p.test_id IS NULL THEN COALESCE((SELECT CASE v.content_type WHEN 'full_test' THEN 'academic_full_test' WHEN 'section' THEN 'general_section' ELSE 'unclassified' END FROM content_versions v WHERE v.module='listening' AND v.target_id=t.id ORDER BY v.version_no DESC LIMIT 1),'unclassified')
 ELSE 'unclassified' END"""
NOT_DELETED = "NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||t.id::text)::uuid AND d.type='CONTENT_DELETED')"
PATHS = {'exam':'1','review':'2','script':'3','keyword1':'3','recall':'4','keyword2':'4','vocab':'5','mcq':'mcq','matching':'matching','completion':'completion','map':'map','retry':'retry'}


def payload(row):
    p = row['payload'] if row and row.get('payload') else {}
    return json.loads(p) if isinstance(p,str) else p


async def content(con, user, id):
    row = await con.fetchrow(f'''SELECT t.*,p.payload,p.source_id,p.audio_object_key,p.image_object_key,
      {PRODUCT_SQL} product FROM listening_tests t LEFT JOIN listening_packages p ON p.test_id=t.id
      WHERE t.id=$1 AND {NOT_DELETED}''',id)
    if not row or not staff(user) and not is_live(row): raise HTTPException(404,'not_found')
    if not await sequence(con,user,row): raise HTTPException(403,'sequence_locked')
    return row, payload(row)


async def mcq_rows(con, uid, id, missing=None):
    ids = await available_set(con,id)
    rows = await con.fetch('''SELECT q.id,q."order",q.question_text,q.type_code,q.type,q.options,s.stage
      FROM listening_questions q LEFT JOIN listening_mcq_sessions s ON s.question_id=q.id AND s.user_id=$1
      WHERE q.test_id=$2 ORDER BY q."order",q.id''',uid,id)
    return [{'id':str(r['id']),'order':r['order'],'questionText':r['question_text'],'stage':r['stage'] or missing}
            for r in rows if str(r['id']) in ids and r['type']=='multiple_choice' and r['options'] and not (r['type_code'] or '').startswith(('matching','map','plan'))]


def day_status(questions):
    completed = sum(q['stage']=='reasoned' for q in questions)
    return {'state':'completed' if questions and completed==len(questions) else 'in_progress' if any(q['stage'] for q in questions) else 'not_started','total':len(questions),'completed':completed}


async def programme_progress(con, uid):
    # Use the same published-version -> legacy -> all fallback as available_set.
    # Aggregate the full published programme before applying catalogue pagination.
    row = await con.fetchrow(f'''WITH day_progress AS (
      SELECT t.id,count(q.id)::int total,count(q.id) FILTER (WHERE s.stage='reasoned')::int completed
      FROM listening_tests t
      LEFT JOIN LATERAL (SELECT v.id FROM content_versions v WHERE v.target_type='listening_test'
        AND v.target_id=t.id AND v.status='published' ORDER BY v.version_no DESC LIMIT 1) v ON true
      LEFT JOIN listening_questions q ON q.test_id=t.id AND q.type='multiple_choice'
        AND q.options IS NOT NULL AND q.options<>'[]'::jsonb
        AND coalesce(q.type_code,'') NOT LIKE 'matching%'
        AND coalesce(q.type_code,'') NOT LIKE 'map%'
        AND coalesce(q.type_code,'') NOT LIKE 'plan%'
        AND CASE WHEN EXISTS(SELECT 1 FROM listening_questions x WHERE x.test_id=t.id AND x.content_version_id=v.id)
          THEN q.content_version_id=v.id
          WHEN EXISTS(SELECT 1 FROM listening_questions x WHERE x.test_id=t.id AND x.content_version_id IS NULL)
          THEN q.content_version_id IS NULL ELSE true END
      LEFT JOIN listening_mcq_sessions s ON s.question_id=q.id AND s.user_id=$1
      WHERE t.program_ref='listening-mcq-program' AND t.program_ordinal IS NOT NULL
        AND {NOT_DELETED} AND {live('t')} GROUP BY t.id)
      SELECT count(*)::int published,count(*) FILTER (WHERE total>0 AND completed=total)::int finished,
        coalesce(sum(total),0)::int questions,coalesce(sum(completed),0)::int completed FROM day_progress''',uid)
    return {'daysPublished':row['published'],'daysCompleted':row['finished'],
            'questionsPublished':row['questions'],'questionsCompleted':row['completed']}


async def days(con, user, q, ordinal=None):
    condition = "t.program_ref='listening-mcq-program' AND t.program_ordinal IS NOT NULL AND "+NOT_DELETED
    if not staff(user): condition += ' AND '+live('t')
    if ordinal is not None:
        rows = await con.fetch(f'SELECT t.* FROM listening_tests t WHERE {condition} AND program_ordinal=$1',ordinal)
        if not rows: raise HTTPException(404,'not_found')
        t = rows[0]
        if not await sequence(con,user,t): raise HTTPException(403,'sequence_locked')
        questions = await mcq_rows(con,user['id'],t['id'])
        return {'day':ordinal,'testId':str(t['id']),'title':t['title'],'audioUrl':t['audio_url'],'draft':not is_live(t),'questions':questions,'status':day_status(questions)}
    snapshot = await programme_snapshot(con,user,include_drafts=staff(user))
    cards=[];previous_complete=True
    for row in snapshot:
        status=row['status'];draft=not is_live(row)
        cards.append({'day':row['program_ordinal'],'testId':str(row['id']),'title':row['title'],
          'questionCount':status['total'],'status':status,'draft':draft,'locked':not staff(user) and not previous_complete})
        if not draft:previous_complete=previous_complete and status['state']=='completed'
    progress={'daysPublished':sum(not c['draft'] for c in cards),'daysCompleted':sum(not c['draft'] and c['status']['state']=='completed' for c in cards),
      'questionsPublished':sum(c['questionCount'] for c in cards if not c['draft']),'questionsCompleted':sum(c['status']['completed'] for c in cards if not c['draft'])}
    page=number(q.get('page'),maximum=10000);page_size=24;visible_days=len(cards)
    start=(page-1)*page_size
    return {'days':cards[start:start+page_size],'progress':progress,'page':page,'pageSize':page_size,
            'hasNextPage':start+page_size<visible_days,'visibleDays':visible_days}


async def facts(con, uid, id, p, *, prefetched=None):
    if prefetched is None:
        exam = await con.fetchrow("SELECT id,score,total_questions FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='completed' ORDER BY submitted_at DESC NULLS LAST LIMIT 1",uid,id)
        runs = await con.fetch('SELECT activity,answers,completed,score,total FROM listening_activity_runs WHERE user_id=$1 AND test_id=$2 ORDER BY created_at DESC',uid,id)
        missed = await con.fetchval('SELECT count(*)::int FROM listening_answers WHERE attempt_id=$1 AND is_correct=false',exam['id']) if exam else 0
    else:
        exam=prefetched['exams'].get(id);runs=prefetched['runs'].get(id,[]);missed=exam['missed'] if exam else 0
    spec = p.get('studyPack') or {}; qs = p.get('questions') or []
    script = any(s.get('transcript','').strip() and s.get('gaps') for s in spec.get('scriptParts',[]))
    authored = spec.get('activities')
    supported = {'exam':True,'review':bool(exam),'script':script,'keyword1':bool(p.get('keyword1')) and not script,
      'recall':bool(spec.get('recall')),'keyword2':bool(p.get('keyword2')) and not spec.get('recall'),'vocab':bool(p.get('vocabulary')),
      'mcq':any(q.get('kind')=='mcq' for q in qs),**{k:k in (authored or []) for k in ('matching','completion','map')},'retry':'retry' in (authored or []) and bool(missed)}
    order = authored if authored is not None else PATHS.keys()
    activities = []
    for key in order:
        if not supported.get(key): continue
        path = PATHS[key]
        relevant = [r for r in runs if str(r['activity'])==path and not (r['answers'] or {}).get('_practice')] if path.isdigit() else [r for r in runs if (r['answers'] or {}).get('_practice')==key]
        if key=='exam': done = bool(exam)
        elif key=='mcq':
            questions = await mcq_rows(con,uid,id) if prefetched is None else prefetched['mcq'].get(id,[])
            done = bool(questions) and all(q['stage']=='reasoned' for q in questions)
        else: done = any(r['completed'] for r in relevant)
        latest = {'score':relevant[0]['score'],'total':relevant[0]['total']} if relevant else None
        if key=='exam' and exam: latest = {'score':exam['score'],'total':exam['total_questions']}
        activities.append({'id':key,'path':path,'practice':key if key in ('matching','completion','map','retry') else None,'complete':done,'latest':latest})
    return activities, exam


async def catalogue(con, user, product, q):
    where = f'{live("t")} AND {NOT_DELETED} AND ({PRODUCT_SQL})=$1'
    total = await con.fetchval(f'SELECT count(*)::int FROM listening_tests t LEFT JOIN listening_packages p ON p.test_id=t.id WHERE {where}',product)
    access_cache = {}
    rows = await con.fetch(f'''SELECT t.*,p.payload,p.source_id,p.audio_object_key,p.image_object_key FROM listening_tests t
      LEFT JOIN listening_packages p ON p.test_id=t.id WHERE {where} ORDER BY t.source_ref,t.id''',product)
    # One user-scoped batch supplies draft answer counts, without returning answers or keys.
    progress_rows=await con.fetch("""WITH latest AS (
      SELECT DISTINCT ON (test_id) id,test_id,status,total_questions FROM listening_attempts
      WHERE user_id=$1 AND test_id=ANY($2::uuid[]) ORDER BY test_id,started_at DESC,id DESC)
      SELECT a.test_id,a.status,a.total_questions,
      CASE WHEN a.status='in_progress' AND d.attempt_id IS NOT NULL THEN
        (SELECT count(*)::int FROM jsonb_each_text(CASE WHEN jsonb_typeof(d.answers)='object' THEN d.answers ELSE '{}'::jsonb END) x WHERE btrim(x.value)<>'')
      ELSE (SELECT count(DISTINCT x.question_id)::int FROM listening_answers x WHERE x.attempt_id=a.id AND btrim(coalesce(x.user_answer,''))<>'') END answered_count
      FROM latest a LEFT JOIN listening_drafts d ON d.attempt_id=a.id""",user['id'],[r['id'] for r in rows])
    answer_progress={r['test_id']:r for r in progress_rows}
    batch=await catalogue_facts(con,user['id'],[r['id'] for r in rows],sections=product=='general_section')
    cards = []
    for t in sorted(rows,key=material_order):
        p = payload(t); id = t['id']
        exam = batch['exams'].get(id)
        started = id in answer_progress
        if product=='general_section':
            count = batch['questions'].get(id,0)
            section_no = (p.get('sections') or [{}])[0].get('number')
            if section_no is None:
                raw = batch['sections'].get(id)
                section_no = int(raw) if raw and raw.isdigit() and 1<=int(raw)<=4 else None
            cards.append({'testId':str(id),'title':t['title'],'questionCount':count,'sectionNo':section_no,'durationSec':p.get('audio',{}).get('durationSec'),'started':started,'completed':bool(exam),'lastScore':exam['score'] if exam else None,'lastTotal':exam['total_questions'] if exam else None})
        else:
            saved=answer_progress.get(id)
            question_total=(saved['total_questions'] if saved else 0) or len(p.get('questions',[])) or batch['questions'].get(id,0)
            answer_state={'state':saved['status'] if saved else 'not_started','answeredCount':min(question_total,saved['answered_count']) if saved else 0,'totalQuestions':question_total}
            activities, exam = await facts(con,user['id'],id,p,prefetched=batch)
            completed, count = sum(a['complete'] for a in activities),len(activities)
            if runtime_source(str(id),t['source_id']) and t['source_id'] in SPEC:
                values = batch['checkpoints'].get(id) or {}
                if isinstance(values,str): values=json.loads(values)
                status = course_status(SPEC[t['source_id']],await current_work(con,user['id'],str(id),t['source_id'],values,completed_attempts=batch['work_exams']))
                completed,count = status['completed'],status['total']
                started = started or bool(values)
            # An exited/graded exam is not completion of the whole Listening course.
            # Visiting or saving a draft can only enter the in-progress state.
            answer_state['state'] = ('completed' if count > 0 and completed == count else
                'in_progress' if started or completed or saved else 'not_started')
            cards.append({'testId':str(id),'title':t['title'],'parts':len(p.get('sections',[])),'questions':len(p.get('questions',[])) or batch['questions'].get(id,0),'minutes':math.floor(p['audio']['durationSec']/60+.5) if p.get('audio',{}).get('durationSec') else None,'completed':completed,'activityCount':count,'answerProgress':answer_state,'started':started,'locked':not await sequence(con,user,t,access_cache),'exam':{'score':exam['score'],'total':exam['total_questions']} if exam else None})
    return {'cards':cards,'total':total,'page':1,'pageSize':max(1,len(cards)),'hasMore':False}


async def read(req, user, path, q):
    db = await core.pool()
    async with db.acquire() as con:
        if path == '/app/listening/history':
            rows = await con.fetch('SELECT a.id,a.status,a.score,a.total_questions,t.title FROM listening_attempts a JOIN listening_tests t ON t.id=a.test_id WHERE a.user_id=$1 ORDER BY a.started_at DESC',user['id'])
            return {'rows':[{'attempt':{'id':str(r['id']),'status':r['status'],'score':r['score'] if r['status']=='completed' else None,'totalQuestions':r['total_questions'] if r['status']=='completed' else None},'test':{'title':r['title']}} for r in rows]}
        if path in ('/app/listening/academic','/app/listening/tests','/app/listening/general'):
            return await catalogue(con,user,'general_section' if path.endswith('/general') else 'academic_full_test',q)
        if path == '/app/listening/mcq': return await days(con,user,q)
        if re.fullmatch('/app/listening/mcq/day/[0-9]+',path): return {'day':await days(con,user,q,int(path.rsplit('/',1)[1]))}
        if path.startswith('/app/listening/attempts/'):
            from .browser_listening_exercise import attempt_view
            parts = path.split('/')
            return await attempt_view(con,user,identifier(parts[4]),len(parts)>5 and parts[5]=='revision')
        if re.fullmatch(r'/app/listening/(tests|academic|general)/[^/]+(?:/[^/]+)?',path):
            parts = path.split('/'); id = identifier(parts[4]); segment = parts[5] if len(parts)>5 else None
            t,p = await content(con,user,id)
            from .browser_listening_exercise import exercise, section_view
            if parts[3]=='general':
                if t['product']!='general_section': raise HTTPException(404,'not_found')
                return await section_view(con,user,t,p)
            original = runtime_source(str(id),t['source_id']) or p.get('authoredRuntime')
            if original: return {'kind':'original','testId':str(id)} if parts[3]=='academic' else {'kind':'authored'}
            if segment: return await exercise(con,user,t,p,segment)
            activities,exam = await facts(con,user['id'],id,p)
            minutes = math.floor(p['audio']['durationSec']/60+.5) if p.get('audio',{}).get('durationSec') else None
            if parts[3]=='academic':
                if t['product']!='academic_full_test': raise HTTPException(404,'not_found')
                return {'kind':'academic','test':{'testId':str(id),'title':t['title'],'parts':len(p.get('sections',[])),'questions':len(p.get('questions',[])),'minutes':minutes,'draft':not is_live(t),'transcriptAvailable':any(s.get('transcript','').strip() for s in p.get('sections',[])),'activities':activities,'progress':{'completed':sum(a['complete'] for a in activities),'total':len(activities),'exam':{'score':exam['score'],'total':exam['total_questions']} if exam else None}}}
            return {'kind':'hub','test':{'title':t['title'],'publicationState':'published' if is_live(t) else 'draft'},'meta':{'parts':len(p.get('sections',[])),'questions':len(p.get('questions',[])),'min':minutes or 0},'cards':[{'path':a['path'],'activity':int(a['path']) if a['path'].isdigit() else None,'name':a['id'],'tag':a['practice'] or 'study','complete':a['complete'],'latest':a['latest']} for a in activities]}
        if path == '/app/listening': return {}
    raise HTTPException(404,'not_found')
