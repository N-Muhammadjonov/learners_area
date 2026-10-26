"""Native Writing read models. Mutations continue through the existing APIs."""
import base64
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, identifier, live
from .step31_coach import decoded


async def evaluation(con, uid, source, id, external=False):
    row = await con.fetchrow('SELECT * FROM evaluations WHERE user_id=$1 AND source_type=$2 AND source_id=$3', uid, source, id)
    return evaluation_result(row, external)


def evaluation_result(row, external=False):
    if not row or external and (row['provider_type'] != 'external' or row['fallback_used']):
        return None
    keys = ('id','evaluation_type','overall_estimate','confidence','verdict','criteria','strengths','weaknesses','issues','next_actions','recommended_exercises','created_at')
    result = camel({k: row[k] for k in keys})
    for k in ('criteria','strengths','weaknesses','issues','nextActions','recommendedExercises'):
        result[k] = decoded(result[k])
    return {**result, 'checkedByName': 'RIWI'}


async def packs(con):
    rows = await con.fetch("SELECT id,slug,label_en,label_uz FROM vocabulary_topic_packs WHERE publication_state='published' ORDER BY position,label_en")
    if not rows:
        return json.loads(Path(__file__).with_name('vocabulary_builtin_packs.json').read_text())
    result = []
    for p in rows:
        words = [camel(r) for r in await con.fetch('''SELECT l.term,l.part_of_speech,l.definition_en,l.translation_uz,l.example_sentence AS example,l.collocations
          FROM vocabulary_topic_pack_words w JOIN lexemes l ON l.id=w.lexeme_id WHERE w.pack_id=$1 ORDER BY w.position''', p['id'])]
        result.append({'id': p['slug'], 'label': {'en': p['label_en'], 'uz': p['label_uz'] or p['label_en']}, 'words': words})
    return result


def slug(s):
    return re.sub('[^a-z0-9]+', '_', s.strip().lower()).strip('_')


async def patterns(con, uid, q, library=False):
    args = [uid]
    conds = [live('p')]
    saved = q.get('bank') in ('1','saved')
    for key, col in (('task','task_type'),('fn','function'),('band','target_band')):
        if q.get(key):
            value = q[key]
            if key == 'band':
                try: value = int(value)
                except ValueError: raise HTTPException(400, 'invalid_filter')
            args.append(value)
            conds.append(f'p.{col}=${len(args)}')
    if library and q.get('topic'):
        args.append(q['topic'].lower())
        conds.append(f'lower(p.topic)=${len(args)}')
    if library and saved:
        conds.append('EXISTS (SELECT 1 FROM writing_pattern_bank b WHERE b.pattern_id=p.id AND b.user_id=$1)')
    where = ' AND '.join(conds)
    # $1 is the verified user even when it is used only by the saved-state subquery.
    total = await con.fetchval(f'SELECT count(*)::int FROM writing_language_patterns p WHERE {where} AND $1::uuid IS NOT NULL', *args)
    fingerprint = json.dumps(sorted({'task':q.get('task') or None,'fn':q.get('fn') or None,'topic':q.get('topic','').lower() or None,'band':int(q['band']) if q.get('band') else None,'saved':True if saved else None,'userId':str(uid) if saved else None}.items()), separators=(',',':'),ensure_ascii=False)
    if library and 'cursor' in q:
        raw = q['cursor']
        try:
            if not re.fullmatch('[A-Za-z0-9_-]{1,4096}', raw): raise ValueError()
            cursor = json.loads(base64.urlsafe_b64decode(raw+'='*(-len(raw)%4)))
            if len(cursor)!=5 or cursor[:2]!=[1,fingerprint] or any(not isinstance(v,str) or len(v)>400 for v in cursor[2:4]) or not core.uuid_value(cursor[4]): raise ValueError()
        except (ValueError, TypeError, json.JSONDecodeError):
            raise HTTPException(400, 'invalid_cursor')
        start = len(args)+1
        args.extend(cursor[2:])
        where += f' AND (p.function,p.pattern,p.id)>(${start},${start+1},${start+2}::uuid)'
    rows = [camel(r) for r in await con.fetch(f'''SELECT p.id,p.pattern,p.function AS fn,p.task_type,p.topic,p.target_band,p.example,p.usage_note,
      EXISTS(SELECT 1 FROM writing_pattern_bank b WHERE b.pattern_id=p.id AND b.user_id=$1) saved
      FROM writing_language_patterns p WHERE {where} ORDER BY p.function,p.pattern,p.id''' + (' LIMIT 301' if library else ''), *args)]
    if not library:
        return rows
    has_more = len(rows)>300
    rows = rows[:300]
    last = rows[-1] if rows else None
    encoded = base64.urlsafe_b64encode(json.dumps([1,fingerprint,last['fn'],last['pattern'],last['id']],separators=(',',':'),ensure_ascii=False).encode()).decode().rstrip('=') if has_more and last else None
    topics = await con.fetch(f'SELECT DISTINCT topic FROM writing_language_patterns p WHERE {live("p")} AND topic IS NOT NULL ORDER BY topic')
    bands = await con.fetch(f'SELECT DISTINCT target_band FROM writing_language_patterns p WHERE {live("p")} AND target_band IS NOT NULL ORDER BY target_band')
    return {'patterns':rows,'hasMore':has_more,'nextCursor':encoded,'matching':total,'pageSize':300,'topics':[r['topic'] for r in topics],'bands':[r['target_band'] for r in bands],'savedCount':await con.fetchval('SELECT count(*)::int FROM writing_pattern_bank WHERE user_id=$1',uid)}


async def prompt_materials(con, prompt_ids):
    if not prompt_ids:
        return {}
    rows = await con.fetch("""SELECT id,owner_id,type,position,text_content,link_url,object_key,original_name,mime_type,size
        FROM resource_blocks WHERE owner_type='writing' AND owner_id=ANY($1::uuid[]) ORDER BY position,id""",
        [identifier(str(id)) for id in prompt_ids])
    result = {}
    for row in rows:
        item = camel(row)
        result.setdefault(item.pop('ownerId'), []).append(item)
    return result


async def read(req, user, path, q, region):
    uid = user['id']
    # Reuse existing guarded lifecycle reads without nesting pool acquisitions.
    if re.fullmatch(r'/app/writing/translation/[^/]+', path):
        id = identifier(path.rsplit('/',1)[1])
        return await existing(req, f'/api/writing/translation/{id}')
    if re.fullmatch(r'/app/writing/exam/[^/]+', path):
        id = identifier(path.rsplit('/',1)[1])
        paper = await existing(req, f'/api/writing/exam/{id}')
        db = await core.pool()
        async with db.acquire() as con:
            grades = {}
            prompt_blocks = await prompt_materials(con, [e['promptId'] for e in paper['paper']['entries']])
            materials = {}
            for entry in paper['paper']['entries']:
                materials[str(entry['position'])] = prompt_blocks.get(entry['promptId'], [])
                row = await con.fetchrow('SELECT id,status FROM writing_grade_requests WHERE user_id=$1 AND idempotency_key=$2', uid, f'exam_{id}_{entry["position"]}')
                if row:
                    ev = await evaluation(con,uid,'writing_grade',row['id'],True)
                    grades[str(entry['position'])] = {'requestId':str(row['id']),'status':row['status'],'overall':ev['overallEstimate'] if ev else None}
        return {**paper,'grades':grades,'materials':materials,'aiReady':await ai_ready()}
    grade_ready = await ai_ready() if path.rstrip('/') == '/app/writing' and q.get('tab') == 'grade' else None
    db = await core.pool()
    async with db.acquire() as con:
        parts = path.split('/')
        kind = parts[3] if len(parts)>3 else None
        id = identifier(parts[4]) if len(parts)>4 else None
        if kind == 'lessons' and id:
            row = await con.fetchrow(f'SELECT * FROM writing_lessons WHERE id=$1 AND {live()}',id)
            if not row: raise HTTPException(404,'not_found')
            done = await con.fetchval('SELECT completed_at FROM writing_lesson_progress WHERE lesson_id=$1 AND user_id=$2',id,uid)
            return {'detail':{'lesson':camel(row),'completedAt':done}}
        if kind == 'grade' and id:
            row = await con.fetchrow('SELECT * FROM writing_grade_requests WHERE id=$1 AND user_id=$2',id,uid)
            if not row: raise HTTPException(404,'not_found')
            return {'view':{'request':camel(row),'evaluation':await evaluation(con,uid,'writing_grade',id,True) if row['status']=='evaluated' else None,'analysis':row['analysis']}}
        if kind in ('stealing','language-stealing') and id:
            from .step17_stealing_workflow_port import session_view
            row = await con.fetchrow('SELECT * FROM writing_stealing_sessions WHERE id=$1 AND user_id=$2',id,uid)
            if not row: raise HTTPException(404,'not_found')
            return {'view':await session_view(con,row,datetime.now(timezone.utc))}
        if kind == 'prompts' and id:
            row = await con.fetchrow(f'SELECT id,task_type,category,prompt,target_word_count FROM writing_prompts WHERE id=$1 AND {live()}',id)
            if not row: raise HTTPException(404,'not_found')
            return {'prompt':camel(row)}
        if kind == 'submissions' and id:
            row = await con.fetchrow('SELECT * FROM writing_submissions WHERE id=$1 AND user_id=$2',id,uid)
            if not row: raise HTTPException(404,'not_found')
            prompt = await con.fetchrow('SELECT id,task_type,category,prompt,target_word_count FROM writing_prompts WHERE id=$1',row['prompt_id'])
            feedback = await con.fetchrow('SELECT * FROM writing_feedback WHERE submission_id=$1 ORDER BY created_at DESC LIMIT 1',id)
            return {'submission':camel(row),'prompt':camel(prompt),'feedback':camel(feedback),'evaluation':await evaluation(con,uid,'writing_submission',id)}
        if kind == 'history':
            rows = await con.fetch('SELECT s.id,s.prompt_id,s.status,s.word_count,s.submitted_at,p.task_type,p.category FROM writing_submissions s JOIN writing_prompts p ON p.id=s.prompt_id WHERE s.user_id=$1 ORDER BY s.updated_at DESC',uid)
            return {'rows':[{'submission':camel({k:r[k] for k in ('id','status','word_count','submitted_at')}),'prompt':camel({k:r[k] for k in ('task_type','category')}),'evaluation':await evaluation(con,uid,'writing_submission',r['id'])} for r in rows]}
        if kind is not None: raise HTTPException(404,'not_found')
        tab = q.get('tab','lessons')
        if tab == 'lessons':
            return {'lessons':[camel(r) for r in await con.fetch(f'''SELECT l.id,l.title,l.category,l.summary,l.duration_minutes,p.completed_at FROM writing_lessons l
              LEFT JOIN writing_lesson_progress p ON p.lesson_id=l.id AND p.user_id=$1 WHERE {live('l')} ORDER BY l.position,l.created_at''',uid)]}
        if tab == 'translation':
            return {'sets':[camel(r) for r in await con.fetch(f'SELECT s.id,s.title,s.topic,s.question_type,s.target_band,(SELECT count(*)::int FROM writing_translation_sentences ts WHERE ts.set_id=s.id) sentences FROM writing_translation_sets s WHERE {live()} ORDER BY title')]}
        if tab == 'grade':
            rows = await con.fetch('SELECT id,task_type,left(question_text,160) question_text,word_count,status,created_at FROM writing_grade_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',uid)
            essays = []
            for r in rows:
                ev = await evaluation(con,uid,'writing_grade',r['id'],True) if r['status']=='evaluated' else None
                essays.append({**camel(r),'overall':ev['overallEstimate'] if ev else None})
            prompts = [camel(r) for r in await con.fetch(f"SELECT id,category,prompt FROM writing_prompts WHERE task_type='task1' AND {live()} ORDER BY created_at DESC")]
            blocks = await prompt_materials(con, [p['id'] for p in prompts])
            return {'aiReady':grade_ready,'essays':essays,'task1Prompts':[{**p, 'materials':blocks.get(p['id'], [])} for p in prompts]}
        if tab == 'exam':
            counts = {r['task_type']:r['n'] for r in await con.fetch(f'SELECT task_type,count(*)::int n FROM writing_prompts WHERE {live()} GROUP BY task_type')}
            papers = [camel(r) for r in await con.fetch('SELECT id,mode,started_at,expires_at,finalized_at,finalize_reason FROM writing_exam_papers WHERE user_id=$1 ORDER BY started_at DESC LIMIT 20',uid)]
            opened = next((p for p in papers if not p['finalizedAt'] and datetime.fromisoformat(p['expiresAt'].replace('Z','+00:00'))>=datetime.now(timezone.utc)),None)
            if opened:
                opened = {**opened, 'remainingSeconds': max(0, int((datetime.fromisoformat(opened['expiresAt'].replace('Z','+00:00')) - datetime.now(timezone.utc)).total_seconds()))}
            return {'exam':{'availability':{'task1':counts.get('task1',0),'task2':counts.get('task2',0)},'open':opened,'recent':papers}}
        if tab == 'topic-vocabulary':
            canonical = await packs(con)
            rows = await patterns(con,uid,q)
            topics = {p['id']:{'id':p['id'],'label':p['label']} for p in canonical}
            for p in rows:
                if p['topic']: topics.setdefault(slug(p['topic']),{'id':slug(p['topic']),'label':{'en':p['topic'],'uz':p['topic']}})
            if q.get('topic'): rows = [r for r in rows if not r['topic'] or slug(r['topic'])==q['topic']]
            saved = {r['term'] for r in await con.fetch('SELECT lower(l.term) term FROM user_vocabulary u JOIN lexemes l ON l.id=u.lexeme_id WHERE u.user_id=$1',uid)}
            words = [{**w,'example':w.get('example',w.get('exampleSentence','')),'packId':p['id'],'saved':w['term'].lower() in saved} for p in canonical if not q.get('topic') or p['id']==q['topic'] for w in p['words']] if q.get('fn') in (None,'','collocation') else []
            return {'topics':list(topics.values()),'words':words,'patterns':rows}
        if tab == 'language-stealing':
            sources = [camel(r) for r in await con.fetch(f'''SELECT t.id,t.title,t.task_type,t.topic,t.target_band,
              (SELECT count(*)::int FROM writing_language_patterns p WHERE p.source_ref=t.id::text AND {live('p')}) pattern_count
              FROM writing_model_texts t WHERE {live('t')} ORDER BY t.title''')]
            sessions = [camel(r) for r in await con.fetch('SELECT id,model_text_id,step,completed_at,rewrite_available_at FROM writing_stealing_sessions WHERE user_id=$1 ORDER BY updated_at DESC',uid)]
            result = {'library':await patterns(con,uid,q,True),'sources':[r for r in sources if r['patternCount']>0],'sessions':sessions}
        elif tab == 'activation':
            from .step23_activation_check import stats
            rows = await con.fetch("SELECT payload,created_at FROM activity_events WHERE user_id=$1 AND type='WRITING_ACTIVATION_CHECK' ORDER BY created_at DESC LIMIT 2000",uid)
            events = [decoded(r['payload']) for r in rows]
            activated = {e['entryId'] for e in events if e.get('entryId') and e.get('usageRecorded')}
            days = {r['created_at'].date() for r in rows}
            day = datetime.now(timezone.utc).date()
            if day not in days: day -= timedelta(days=1)
            count = 0
            while day in days:
                count += 1; day -= timedelta(days=1)
            last = events[0] if events else None
            result = {'vocabularyCount':await con.fetchval('SELECT count(*)::int FROM user_vocabulary WHERE user_id=$1',uid),'overview':{'wordsActivated':len(activated),'averageActivation':stats(events)['averageActivation'],'dayStreak':count,'lastSession':{'at':rows[0]['created_at'],'stats':stats([e for e in events if e.get('sessionId')==last.get('sessionId')])} if last else None}}
        else:
            raise HTTPException(400,'invalid_tab')
    return {**result,'aiReady':await ai_ready()}


async def ai_ready():
    from .owner_ai_control_port import status
    s = (await status())['effective']
    return bool(s['ready'] and s['externalEnabled'] and s['providerIsExternal'])
