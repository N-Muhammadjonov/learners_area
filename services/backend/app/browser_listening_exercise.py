"""Listening exercises, with pinned question sets and exam dictionary isolation."""
import json
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, material_blocks, safe_resource
from .browser_listening import content, mcq_rows
from .step17_listening_start_port import begin
from .step22_listening_submit import assigned_questions
from .step17_listening_work_port import exam_results, speed_allowed
from .listening_draft import listening_draft_hash
from .listening_revision import revision_package


def public(q):
    return {k:q[k] for k in ('number','section','text','instruction','options')}


def map_sections(p):
    return sorted({q['section'] for q in p.get('questions',[]) if q.get('kind')=='map'}) or [2]


async def spans(con, id):
    rows = await con.fetch('SELECT id,section_number,segment_key,start_char,end_char,surface_form FROM lexical_occurrences WHERE listening_test_id=$1',id)
    sections, segments = {}, {}
    for r in rows:
        value = camel({k:r[k] for k in ('id','start_char','end_char','surface_form')})
        if r['segment_key'] is not None:
            segments.setdefault(r['segment_key'],[]).append(value)
        if r['section_number'] is not None and (r['segment_key'] is None or r['segment_key']==f'p{r["section_number"]}'):
            sections.setdefault(str(r['section_number']),[]).append(value)
    return sections,segments


def media(test):
    raw = test['audio_url']
    return {'audioUrl':raw,'audioType':test['audio_type'],'audioClassification':'private' if raw and raw.startswith('/api/resources/') else 'external' if raw else None}


async def report(con, user, row, test, section=False):
    from .listening_review_access import exam_gate
    required,_=await exam_gate(con,user,test['id'])
    if row['status']!='completed' or required:raise HTTPException(409,'exam_in_progress')
    questions = await assigned_questions(con,row)
    return {'attempt':camel({k:row[k] for k in ('id','status','score','total_questions')}),
      'test':{'id':str(test['id']),'title':test['title'],'transcript':test['transcript']},'section':section,
      'questions':[camel(q) for q in questions],
      'answers':[camel(a) for a in await con.fetch('SELECT question_id,user_answer,is_correct FROM listening_answers WHERE attempt_id=$1',row['id'])],
      'materialBlocks':await material_blocks(con,'listening',test['id'])}


async def section_view(con, user, test, p, row=None):
    if row is None:
        row = await con.fetchrow('SELECT * FROM listening_attempts WHERE user_id=$1 AND test_id=$2 ORDER BY started_at DESC LIMIT 1',user['id'],test['id'])
    if row is None:
        id = await begin(con,user,str(test['id']))
        row = await con.fetchrow('SELECT * FROM listening_attempts WHERE id=$1 AND user_id=$2',id,user['id'])
    if not row: raise HTTPException(404,'not_found')
    if row['status']=='completed':
        value = await report(con,user,row,test,True)
        return {'kind':'section','section':{'kind':'result','attemptId':str(row['id']),'testId':str(test['id']),'title':test['title'],'score':row['score'],'total':row['total_questions'],'questions':value['questions'],'answers':value['answers']}}
    exam = await exam_payload(con,user,row,test,p,True)
    return {'kind':'section','section':{**exam,'kind':'exercise','lexicalAssistance':True}}


async def exam_payload(con, user, row, test, p, section=False):
    questions = await assigned_questions(con,row)
    p=await revision_package(con,row,p)
    draft = await con.fetchrow('SELECT answers,audio_position,audio_started_at FROM listening_drafts WHERE attempt_id=$1',row['id'])
    package_questions = {q['number']:q for q in p.get('questions',[])}
    section_no = (p.get('sections') or [{}])[0].get('number',1)
    public_questions = []
    for q in questions:
        source = package_questions.get(q['order'])
        if source and not section:
            value = public(source)
            code=q['type_code'] or ''
            value['input']='multi' if code in ('mcq_multi','multiple_choice_choose_two','multiple_choice_choose_three') and not source.get('pair') else 'select' if source.get('options') else 'text'
        else:
            code = q['type_code'] or ''
            value = {'number':q['order'],'section':section_no,'text':q['question_text'],'instruction':'Answer the question.','options':q['options'] or [],'input':'multi' if code in ('mcq_multi','multiple_choice_choose_two','multiple_choice_choose_three') else 'select' if q['options'] else 'text'}
        public_questions.append({'id':str(q['id']),**value})
    diagram=p.get('mapDiagram')
    if not diagram and not test.get('image_object_key'):
        from .listening_exam_visuals import source_map
        diagram=source_map(test.get('source_id'))
    from .listening_exam_visuals import exam_parts
    cd_exam=exam_parts(test.get('source_id'),public_questions) if not section else None
    return {'attemptId':str(row['id']),'testId':str(test['id']),'title':test['title'],'audioUrl':test['audio_url'],
      'imageUrl':safe_resource(test.get('image_object_key')),'mapDiagram':diagram,'mapSections':map_sections(p),
      'duration':p.get('audio',{}).get('durationSec'),'questions':public_questions,**({'cdExam':cd_exam} if cd_exam else {}),'initial':draft['answers'] if draft else {},
      'draftHash':listening_draft_hash((json.loads(draft['answers']) if isinstance(draft['answers'],str) else draft['answers']) if draft else {},draft['audio_position'] if draft else 0),
      'audioPosition':draft['audio_position'] if draft else 0,'audioStartedAt':camel(draft)['audioStartedAt'] if draft else None,'sectionMode':section}


async def attempt_view(con, user, id, revision=False):
    row = await con.fetchrow('SELECT * FROM listening_attempts WHERE id=$1 AND user_id=$2',id,user['id'])
    if not row: raise HTTPException(404,'not_found')
    test,p = await content(con,user,row['test_id'])
    is_section = test['product']=='general_section'
    if is_section:
        return await section_view(con,user,test,p,row)
    if p and not revision:
        if row['status']=='completed': return {'kind':'redirect','href':f'/app/listening/tests/{test["id"]}/2'}
        return {'kind':'exam','exam':await exam_payload(con,user,row,test,p)}
    if row['status']=='in_progress':
        if revision: raise HTTPException(404,'not_found')
        questions = await assigned_questions(con,row)
        return {'kind':'legacy-exam','exam':{'attemptId':str(id),'testTitle':test['title'],**media(test),
          'questions':[camel({k:q[k] for k in ('id','order','type','question_text','options')}) for q in questions],'materialBlocks':await material_blocks(con,'listening',test['id'])}}
    result = await report(con,user,row,test)
    if not revision: return {'kind':'review','review':result}
    mistakes = await con.fetch('''SELECT q.type,count(*)::int total,count(*) FILTER (WHERE a.is_correct)::int correct FROM listening_answers a
      JOIN listening_attempts t ON t.id=a.attempt_id JOIN listening_questions q ON q.id=a.question_id WHERE t.user_id=$1 GROUP BY q.type''',user['id'])
    types = [{**dict(r),'accuracy':r['correct']/r['total'] if r['total'] else 0} for r in mistakes]
    types.sort(key=lambda r:r['accuracy'])
    recent = [camel(r) for r in await con.fetch('''SELECT q.id question_id,q.question_text,a.user_answer,q.correct_answer,q.explanation
      FROM listening_answers a JOIN listening_attempts t ON t.id=a.attempt_id JOIN listening_questions q ON q.id=a.question_id
      WHERE t.user_id=$1 AND a.is_correct=false AND NOT EXISTS(
        SELECT 1 FROM listening_attempts active WHERE active.user_id=t.user_id
          AND active.test_id=t.test_id AND active.status='in_progress')
      ORDER BY t.submitted_at DESC LIMIT 10''',user['id'])]
    keywords = [{'id':q['id'],'order':q['order'],'questionText':q['questionText'],'keywords':q.get('keywords') or [],'paraphrases':q.get('paraphrases') or []} for q in result['questions']]
    vocabulary = [camel(r) for r in await con.fetch('''SELECT DISTINCT l.id,l.term,l.translation_uz FROM lexical_occurrences o
      JOIN lexemes l ON l.id=o.lexeme_id WHERE o.listening_test_id=$1 AND o.resolution_status='resolved' ''',test['id'])]
    ratio = row['score']/row['total_questions'] if row['score'] is not None and row['total_questions'] else 0
    return {'kind':'revision','revision':{**result,'test':{**result['test'],**media(test)},'mistakeMap':{'byType':types,'weakest':types[0] if types else None,'recent':recent},'keywords':keywords,'vocabulary':vocabulary,'speed':{'unlocked':await speed_allowed(con,user,str(test['id']),1.25),'notAttemptedYet':False,'percent':ratio*100,'thresholdPercent':80},'mcq':await mcq_rows(con,user['id'],test['id'],'listen')}}


async def exercise(con, user, test, p, segment):
    id, uid = test['id'], user['id']
    if segment=='1': return {'kind':'exam-start','title':test['title']}
    running = await con.fetchval("SELECT 1 FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='in_progress' LIMIT 1",uid,id)
    if running: return {'kind':'exam-locked'}
    from .listening_review_access import exam_gate
    required,_=await exam_gate(con,user,id)
    if required:return {'kind':'exam-start','title':test['title']}
    if segment=='mcq':
        return {'kind':'mcq','mcq':{'id':str(id),'title':test['title'],'audioUrl':test['audio_url'],'questions':await mcq_rows(con,uid,id,'listen')}}
    if segment=='study':
        occurrences,segments = await spans(con,id)
        return {'kind':'study','study':{'id':str(id),'title':test['title'],'audioUrl':test['audio_url'],'imageUrl':safe_resource(test['image_object_key']),'lexicalAssistance':True,'questions':[public(q) for q in p.get('questions',[])],'sections':p.get('sections',[]),'mapDiagram':p.get('mapDiagram'),'mapSections':map_sections(p),'occurrences':occurrences,'segmentOccurrences':segments}}
    if segment in ('matching','completion','map','retry'):
        if segment not in (p.get('studyPack') or {}).get('activities',[]): raise HTTPException(404,'not_found')
        qs = [q for q in p.get('questions',[]) if q.get('kind')==segment]
        if segment=='retry':
            missed = await exam_results(con,user,str(id)) or set()
            qs = [q for q in p.get('questions',[]) if q['number'] in missed]
        if not qs: raise HTTPException(404,'not_found')
        saved = await con.fetchval("SELECT answers FROM listening_activity_runs WHERE user_id=$1 AND test_id=$2 AND answers->>'_practice'=$3 ORDER BY created_at DESC LIMIT 1",uid,id,segment) or {}
        return {'kind':'practice','practice':{'id':str(id),'title':test['title'],'kind':segment,'audioUrl':test['audio_url'],'mapDiagram':p.get('mapDiagram') if segment=='map' else None,'initial':{k:v for k,v in saved.items() if k!='_practice'},'questions':[{**{k:q[k] for k in ('number','text','instruction','options')},'at':q['evidence']['at'],'end':q['evidence'].get('end')} for q in qs]}}
    try: activity = int(segment)
    except ValueError: raise HTTPException(404,'not_found')
    if activity not in (2,3,4,5): raise HTTPException(404,'not_found')
    saved = await con.fetchval('SELECT answers FROM listening_activity_runs WHERE user_id=$1 AND test_id=$2 AND activity=$3 ORDER BY created_at DESC LIMIT 1',uid,id,activity) or {}
    saved = {k:v for k,v in saved.items() if k.isdigit()}
    if activity==5:
        from .step21_listening_authored_reads import vocabulary_session
        vocab = await vocabulary_session(con,id,p.get('vocabulary',[]))
        for v in vocab:
            v.setdefault('also',[]);v.setdefault('example','');v.setdefault('ipa',None)
        data = {'vocabulary':vocab}
    elif activity in (3,4):
        data = {'keyword1' if activity==3 else 'keyword2':p.get('keyword1' if activity==3 else 'keyword2',[]),'studyPack':p.get('studyPack')}
        if activity==3: data['questionSections'] = {str(q['number']):q['section'] for q in p.get('questions',[])}
    else:
        exam = await con.fetchrow("SELECT * FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='completed' ORDER BY submitted_at DESC LIMIT 1",uid,id)
        result = await report(con,user,exam,test) if exam else None
        speeds = [s for s in (1,1.25,1.5,1.75,2) if await speed_allowed(con,user,str(id),s)]
        mcq = await mcq_rows(con,uid,id,'listen')
        data = {'studyPack':p.get('studyPack'),'questions':p.get('questions',[]),'sections':p.get('sections',[]),'mapDiagram':p.get('mapDiagram'),'speeds':speeds,'mcq':[r for r in mcq if 21<=r['order']<=24],
          'report':{'score':exam['score'],'total':exam['total_questions'],'answers':[{'number':q['order'],**next((a for a in result['answers'] if a['questionId']==q['id']),{})} for q in result['questions']]} if exam else None}
    occurrences,segments = await spans(con,id)
    return {'kind':'activity','activity':{'id':str(id),'activity':activity,'title':test['title'],'data':data,'audioUrl':None if activity==5 else test['audio_url'],'imageUrl':safe_resource(test['image_object_key']) if activity==2 else None,'mapSections':map_sections(p),'initial':saved,'lexicalAssistance':True,'occurrences':occurrences if activity in (2,3) else {},'segmentOccurrences':segments}}
