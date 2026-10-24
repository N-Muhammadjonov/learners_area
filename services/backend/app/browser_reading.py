"""Reading catalogue, owned attempts and explicit learning-check hydration."""
import math
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, identifier, live, number
from .frontend import activate_reading_schedules
from .step21_reading_port import TYPE_IDS, correct
from .step21_academic_start_port import OMISSIONS, eligible
from .step17_mcq_port import staff

SECRET = {'correctAnswer','acceptedAnswers','evidenceQuote','explanation','answerKey'}


def academic_question_count():
    # The existing start endpoint omits exactly one reviewed item in four
    # 41-question sources. Keep those valid assessments visible in the library.
    cases = ' '.join("WHEN '"+source+"' THEN (p.external_id='"+external+"' AND q.question_no="+str(number)+")"
                     for source,(external,number) in OMISSIONS.items())
    total = '(SELECT count(*) FROM reading_questions q JOIN general_reading_passages g ON g.passage_id=q.passage_id WHERE g.set_id=s.id)'
    return f'''({total}=40 OR ({total}=41 AND (SELECT count(*) FROM reading_questions q
      JOIN general_reading_passages g ON g.passage_id=q.passage_id
      JOIN reading_passages p ON p.id=q.passage_id WHERE g.set_id=s.id
      AND NOT coalesce(CASE s.source_ref {cases} ELSE false END,false))=40))'''


async def academic_locked(con,user,row):
    if staff(user): return False
    return await con.fetchval('''SELECT EXISTS(SELECT 1 FROM general_reading_sets s
      WHERE (s.publication_state='published' OR (s.publication_state='scheduled' AND s.publish_at<=now()))
      AND (s.created_at,s.id)<($1,$2) AND NOT EXISTS(SELECT 1 FROM reading_assessments a
        JOIN reading_attempts r ON r.id=a.attempt_id WHERE a.set_id=s.id AND r.user_id=$3 AND r.status='completed'))''',
      row['created_at'],row['id'],user['id'])


def public_question(row, reveal=False):
    r = camel(row)
    return r if reveal else {k:v for k,v in r.items() if k not in SECRET}


async def section(con, passage_id, reveal=False):
    passage = await con.fetchrow('SELECT * FROM reading_passages WHERE id=$1',passage_id)
    if not passage: raise HTTPException(404,'not_found')
    questions = await con.fetch('SELECT * FROM reading_questions WHERE passage_id=$1 ORDER BY "order",id',passage_id)
    groups = await con.fetch('SELECT * FROM reading_question_groups WHERE passage_id=$1 ORDER BY position,id',passage_id)
    paragraphs = await con.fetch('SELECT * FROM reading_passage_paragraphs WHERE passage_id=$1 ORDER BY position,id',passage_id)
    occurrences = await con.fetch('SELECT id,start_char,end_char,surface_form FROM lexical_occurrences WHERE passage_id=$1',passage_id)
    return {'passage':camel(passage),'questions':[public_question(r,reveal) for r in questions],'groups':[camel(r) for r in groups],'paragraphs':[camel(r) for r in paragraphs],'occurrences':[camel(r) for r in occurrences]}


async def attempt(con, uid, id):
    row = await con.fetchrow('SELECT * FROM reading_attempts WHERE id=$1 AND user_id=$2',id,uid)
    if not row: raise HTTPException(404,'not_found')
    metadata = await con.fetchrow('SELECT title,duration_minutes FROM reading_assessments WHERE attempt_id=$1',id)
    slots = await con.fetch('SELECT passage_id FROM reading_assessment_passages WHERE attempt_id=$1 ORDER BY passage_no',id)
    if slots and len(slots)!=3: raise HTTPException(409,'invalid_assessment_membership')
    ids = [r['passage_id'] for r in slots] or [row['passage_id']]
    sections = [await section(con,p,row['status']=='completed') for p in ids]
    selected = await con.fetch('SELECT question_id FROM reading_assessment_questions WHERE attempt_id=$1 ORDER BY position',id)
    if selected:
        if len(selected)!=40: raise HTTPException(409,'invalid_assessment_membership')
        allowed = {str(r['question_id']) for r in selected}
        for s in sections: s['questions'] = [q for q in s['questions'] if q['id'] in allowed]
        if sum(len(s['questions']) for s in sections)!=40: raise HTTPException(409,'invalid_assessment_membership')
    offset = 0
    for s in sections:
        numbers = {q.get('questionNo') or q['order']:offset+i+1 for i,q in enumerate(s['questions'])}
        for i,q in enumerate(s['questions']):
            q['sourceQuestionNo'] = q.get('questionNo')
            q['order'] = offset+i+1
            if metadata: q['questionNo'] = offset+i+1
        if metadata:
            for g in s['groups']:
                for key in ('fromQuestionNo','toQuestionNo'): g[key] = numbers.get(g.get(key),g.get(key))
        offset += len(s['questions'])
    first = sections[0]
    passage = dict(first['passage'])
    if metadata:
        passage.update(title=metadata['title'],suggestedMinutes=metadata['duration_minutes'])
        if row['status']!='in_progress': passage['bodyText'] = '\n\n'.join(s['passage']['title']+'\n\n'+s['passage']['bodyText'] for s in sections)
    occurrences = first['occurrences']
    if metadata:
        occurrences = []
        prefix = 0
        for s in sections:
            start = prefix+len(s['passage']['title'])+2
            occurrences.extend({**o,'startChar':o['startChar']+start,'endChar':o['endChar']+start} for o in s['occurrences'])
            prefix += len(s['passage']['title'])+2+len(s['passage']['bodyText'])+2
    answers = [camel(r) for r in await con.fetch('SELECT id,question_id,user_answer,is_correct FROM reading_answers WHERE attempt_id=$1',id)]
    return {'kind':'attempt','detail':{'attempt':camel(row),'sections':sections,'passage':passage,'questions':[q for s in sections for q in s['questions']],'groups':[g for s in sections for g in s['groups']],'paragraphs':first['paragraphs'],'occurrences':occurrences,'answers':answers}}


def canonical_sql():
    # Registry constants only; request values are always parameters.
    return 'CASE lower(COALESCE(q.type_code,q.type::text)) ' + ' '.join("WHEN '"+key.replace("'","''")+"' THEN '"+value+"'" for key,value in TYPE_IDS.items()) + ' ELSE NULL END'


async def library(con, uid, q):
    args = [uid]
    conds = [live('p'),live('s')]
    status = q.get('status','')
    if status in ('passage1','passage2','passage3'):
        args.append(int(status[-1]));conds.append(f'g.passage_no=${len(args)}')
    if q.get('q','').strip():
        escaped = re_escape_like(q['q'].strip())
        args.append('%'+escaped+'%');conds.append(f'p.title ILIKE ${len(args)}')
    if q.get('topic','').strip():
        args.append(q['topic'].strip());conds.append(f'p.topic_code=${len(args)}')
    if q.get('type','').strip():
        value = q['type'].strip()
        canonical = TYPE_IDS.get(value.lower())
        args.append(canonical or value)
        conds.append(f'EXISTS(SELECT 1 FROM reading_questions q WHERE q.passage_id=p.id AND '+(canonical_sql() if canonical else 'q.type_code')+f'=${len(args)})')
    if status == 'completed': conds.append('r.checked_at IS NOT NULL')
    if status == 'in_progress': conds.append('r.passage_id IS NOT NULL AND r.checked_at IS NULL')
    if status == 'not_started': conds.append('r.passage_id IS NULL')
    source = ' FROM general_reading_passages g JOIN general_reading_sets s ON s.id=g.set_id JOIN reading_passages p ON p.id=g.passage_id LEFT JOIN general_reading_progress r ON r.passage_id=p.id AND r.user_id=$1 WHERE '+' AND '.join(conds)
    total = await con.fetchval('SELECT count(*)::int'+source,*args)
    pages = max(1,math.ceil(total/24)); page = min(pages,number(q.get('page')))
    rows = await con.fetch('''SELECT p.id,p.title,p.test_no,g.passage_no,p.topic_code,p.suggested_minutes,g.set_id,
      (SELECT count(*)::int FROM reading_questions q WHERE q.passage_id=p.id) question_count,
      CASE WHEN r.checked_at IS NOT NULL THEN 'completed' WHEN r.passage_id IS NOT NULL THEN 'in_progress' ELSE 'not_started' END status,
      CASE WHEN r.checked_at IS NOT NULL THEN r.score END last_score,NULL::uuid last_attempt_id'''+source+f' ORDER BY s.created_at,g.passage_no,p.id LIMIT 24 OFFSET {(page-1)*24}',*args)
    topics = await con.fetch(f'SELECT p.topic_code code,count(*)::int count FROM reading_passages p WHERE {live("p")} AND p.topic_code IS NOT NULL GROUP BY p.topic_code ORDER BY p.topic_code')
    types = await con.fetch(f'SELECT {canonical_sql()} code,count(DISTINCT p.id)::int count FROM reading_passages p JOIN reading_questions q ON q.passage_id=p.id WHERE {live("p")} GROUP BY code')
    return {'filter':{'query':q.get('q',''),'topic':q.get('topic',''),'type':q.get('type',''),'status':status},'facets':{'topics':[dict(r) for r in topics],'types':[dict(r) for r in types if r['code']]},'library':{'items':[camel(r) for r in rows],'total':total,'page':page,'pageCount':pages},'facetsUnavailable':False,'libraryUnavailable':False}


def re_escape_like(s):
    return ''.join('\\'+c if c in '%_\\' else c for c in s)


async def read(req, user, path, q):
    uid = user['id']
    if path == '/app/reading/retention':
        session = await existing(req,'/api/retention/attempts')
        summary = await existing(req,'/api/retention/summary')
        history = await existing(req,'/api/retention/history')
        return {'initial':session['active'],'sessionFailed':False,'summary':summary,'history':history}
    if path.startswith('/app/reading/retention/results/'):
        id = identifier(path.rsplit('/',1)[1])
        data = await existing(req,f'/api/retention/attempts/{id}')
        return {'kind':'result','payload':data} if data['phase'] in ('completed','timed_out') else {'kind':'live'}
    db = await core.pool()
    async with db.acquire() as con:
        await activate_reading_schedules(con)
        if path == '/app/reading/history':
            rows = await con.fetch('SELECT a.id,a.status,a.score,a.total_questions,a.started_at,a.submitted_at,p.title FROM reading_attempts a JOIN reading_passages p ON p.id=a.passage_id WHERE a.user_id=$1 ORDER BY a.started_at DESC',uid)
            return {'rows':[{'attempt':camel({k:r[k] for k in ('id','status','score','total_questions','started_at','submitted_at')}),'passage':{'title':r['title']}} for r in rows]}
        if path.startswith('/app/reading/attempts/'):
            return await attempt(con,uid,identifier(path.rsplit('/',1)[1]))
        if path == '/app/reading/general':
            return await library(con,uid,q)
        if path == '/app/reading/academic':
            rows = await con.fetch(f'''SELECT s.id,s.title,s.created_at FROM general_reading_sets s WHERE {live('s')}
              AND (SELECT count(*) FROM general_reading_passages g WHERE g.set_id=s.id)=3
              AND NOT EXISTS(SELECT 1 FROM general_reading_passages g JOIN reading_passages p ON p.id=g.passage_id WHERE g.set_id=s.id AND (g.passage_no NOT IN (1,2,3) OR NOT {live('p')} OR NOT EXISTS(SELECT 1 FROM reading_questions q WHERE q.passage_id=p.id)))
              AND {academic_question_count()}
              AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||s.id::text)::uuid AND d.type='CONTENT_DELETED')
              ORDER BY s.created_at,s.id LIMIT 25 OFFSET $1''',(number(q.get('page'))-1)*24)
            sets = []
            for row in rows:
                slots = [camel(r) for r in await con.fetch('SELECT g.passage_no,p.title FROM general_reading_passages g JOIN reading_passages p ON p.id=g.passage_id WHERE g.set_id=$1 ORDER BY g.passage_no',row['id'])]
                state = await con.fetchrow('SELECT r.id,r.status FROM reading_assessments a JOIN reading_attempts r ON r.id=a.attempt_id WHERE a.set_id=$1 AND r.user_id=$2 ORDER BY r.started_at DESC,r.id DESC LIMIT 1',row['id'],uid)
                sets.append({'id':str(row['id']),'title':row['title'],'locked':bool(await academic_locked(con,user,row)),
                  'assessmentStatus':state['status'] if state else 'not_started','attemptId':str(state['id']) if state else None,'passages':slots})
            return {'sets':sets}
        if path.startswith(('/app/reading/general/','/app/reading/academic/')):
            id = identifier(path.rsplit('/',1)[1]); academic = '/academic/' in path
            row = await con.fetchrow(f'''SELECT id,title,description,source_ref,created_at FROM general_reading_sets WHERE id=$1 AND {live()}
              AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||general_reading_sets.id::text)::uuid AND d.type='CONTENT_DELETED')''',id)
            if not row: raise HTTPException(404,'not_found')
            slots = await con.fetch(f'SELECT g.passage_id,g.passage_no FROM general_reading_passages g JOIN reading_passages p ON p.id=g.passage_id WHERE g.set_id=$1 AND {live("p")} ORDER BY g.passage_no',id)
            if len(slots)!=await con.fetchval('SELECT count(*)::int FROM general_reading_passages WHERE set_id=$1',id): raise HTTPException(404,'not_found')
            if academic:
                if not await eligible(con,row): raise HTTPException(404,'not_found')
                if await academic_locked(con,user,row): raise HTTPException(403,'sequence_locked')
                return {'set':camel({k:row[k] for k in ('id','title','description')}),'passages':[{'passageNo':s['passage_no'],'title':await con.fetchval('SELECT title FROM reading_passages WHERE id=$1',s['passage_id'])} for s in slots]}
            passages, progress = [], {}
            for slot in slots:
                s = await section(con,slot['passage_id'])
                p = s['passage']; pid = p['id']
                saved = await con.fetchrow('SELECT * FROM general_reading_progress WHERE user_id=$1 AND passage_id=$2',uid,pid)
                if saved:
                    result = None
                    if saved['checked_at']:
                        qs = await con.fetch('SELECT * FROM reading_questions WHERE passage_id=$1 ORDER BY "order"',pid)
                        group_map = {g['id']:g for g in s['groups']}
                        result = [{'questionId':str(question['id']),'isCorrect':correct(question,(saved['answers'] or {}).get(str(question['id']),''),(group_map.get(str(question['group_id'])) or {}).get('sharedChoices')),'correctAnswer':question['correct_answer'],'acceptedAnswers':question['accepted_answers'] or [],'evidenceQuote':question['evidence_quote'],'explanation':question['explanation']} for question in qs]
                        if saved['total']!=len(qs) or sum(r['isCorrect'] for r in result)!=saved['score']:
                            result = None
                    progress[pid] = {'answers':saved['answers'],'score':saved['score'],'total':saved['total'],'checked':bool(saved['checked_at']),'result':result}
                passages.append({'passageNo':slot['passage_no'],'passageId':pid,'title':p['title'],'body':p['bodyText'],'paragraphs':s['paragraphs'],'questions':s['questions'],'groups':s['groups'],'occurrences':s['occurrences']})
            return {'set':camel({k:row[k] for k in ('id','title','description')}),'passages':passages,'initialProgress':progress}
        if path == '/app/reading': return {}
    raise HTTPException(404,'not_found')
