"""Exercise RIWI canonical readers against all current migrations, without TCP.

All rows below are authored test fixtures; no production data or cloud call is used.
"""
import asyncio
import json
import os
from uuid import uuid4
from fastapi.testclient import TestClient
from riwi_postgres_probe import Connection
from app import main as core
from app.riwi_capabilities import RiwiActor
from app.riwi_role_surface import RiwiTargetScopeError,list_riwi_target_page
from app.riwi_tools_domain import (lookup_canonical_dictionary,lookup_canonical_grammar,
    read_learner_progress_and_retention,read_course_lesson_excerpt,
    generate_deterministic_report,explain_objective_question)
from app.security import SESSION_COOKIE,issue_token

con=Connection()
async def pool():return con
core.pool=pool
os.environ.update(AUTH_SECRET='isolated-riwi-domain-signing-secret',RIWI_ENABLED='true')
ids={name:str(uuid4()) for name in ['student','other','teacher','admin','owner','passage','question','version','attempt','lexeme','sense','occurrence','course','module','unit','lesson','grammar','ungraded']}
actors={role:RiwiActor(id=ids[role],role=role,account_status='active',locale='en') for role in ['student','teacher','admin','owner']}
checks=0
def check(condition):
    global checks
    assert condition
    checks+=1


async def run():
    for role in ['student','other','teacher','admin','owner']:
        await con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,last_active_at) VALUES($1,$2,$3,'fixture',$4,'active',now())",
            ids[role],role,role+'@riwi-probe.invalid','student' if role=='other' else role)
    await con.execute("INSERT INTO teacher_student_links(teacher_user_id,student_user_id,created_at) VALUES($1,$2,now()-interval '1 day')",ids['teacher'],ids['student'])
    await con.execute("INSERT INTO reading_passages(id,title,body_text) VALUES($1,'Authored fixture','Trees cool cities.')",ids['passage'])
    await con.execute('''INSERT INTO reading_questions(id,passage_id,"order",type,question_text,correct_answer,explanation)
        VALUES($1,$2,1,'true_false_not_given','Do trees cool cities?','TRUE','Authored evidence.')''',ids['question'],ids['passage'])
    snapshot={'canonicalPassageIds':[ids['passage']],'passages':[{'questions':[{'correctAnswer':'TRUE','explanation':'Trees cool cities in this recorded revision.'}]}]}
    await con.execute('''INSERT INTO content_versions(id,module,content_type,source_ref,version_no,title,content_hash,semantic_hash,answer_key_hash,content_snapshot)
        VALUES($1,'reading','passage','riwi-probe',1,'Fixture',$2,$2,$2,$3::jsonb)''',ids['version'],'a'*64,json.dumps(snapshot))
    await con.execute("INSERT INTO reading_attempts(id,user_id,passage_id,status,content_version_id) VALUES($1,$2,$3,'completed',$4)",ids['attempt'],ids['student'],ids['passage'],ids['version'])
    await con.execute("INSERT INTO reading_answers(attempt_id,question_id,user_answer,is_correct) VALUES($1,$2,'FALSE',false)",ids['attempt'],ids['question'])
    request={'module':'reading','attemptId':ids['attempt'],'questionId':ids['question'],'locale':'en'}
    answer=await explain_objective_question(con,actors['student'],request)
    check(answer['officialAnswer']=='TRUE' and answer['sourceRevisionId']==ids['version'] and answer['isCorrect'] is False)
    await con.execute("UPDATE reading_questions SET correct_answer='FALSE',explanation='Changed current row' WHERE id=$1",ids['question'])
    answer=await explain_objective_question(con,actors['student'],request)
    check(answer['officialAnswer']=='TRUE' and 'recorded revision' in answer['explanation'])
    await con.execute('UPDATE reading_attempts SET content_version_id=NULL WHERE id=$1',ids['attempt'])
    answer=await explain_objective_question(con,actors['student'],request)
    check(answer['officialAnswer']=='' and not answer['explanationAvailable'] and 'unavailable' in answer['explanation'])
    await con.execute('UPDATE reading_attempts SET content_version_id=$2 WHERE id=$1',ids['attempt'],ids['version'])
    await con.execute('UPDATE reading_answers SET is_correct=NULL WHERE attempt_id=$1',ids['attempt'])
    answer=await explain_objective_question(con,actors['student'],request)
    check(answer['isCorrect'] is None and 'Not assessed' in answer['explanation'])
    await con.execute('UPDATE reading_answers SET is_correct=false WHERE attempt_id=$1',ids['attempt'])
    for actor in [actors['admin'],RiwiActor(id=ids['other'],role='student')]:
        try:await explain_objective_question(con,actor,request)
        except PermissionError:check(True)
        else:raise AssertionError('academic scope escaped')

    listening={name:str(uuid4()) for name in ['test','question','attempt','version']}
    await con.execute("INSERT INTO listening_tests(id,created_by_user_id,title,audio_type) VALUES($1,$2,'Authored listening fixture','audio')",listening['test'],ids['owner'])
    await con.execute('''INSERT INTO content_versions(id,module,content_type,source_ref,version_no,title,content_hash,semantic_hash,answer_key_hash,content_snapshot)
        VALUES($1,'listening','section','riwi-listening-probe',1,'Fixture',$2,$2,$2,$3::jsonb)''',listening['version'],'d'*64,
        json.dumps({'questions':[{'correctAnswer':'trees','explanation':'The recorded speaker says trees.'}]}))
    await con.execute('''INSERT INTO listening_questions(id,test_id,content_version_id,"order",type,question_text,correct_answer,explanation)
        VALUES($1,$2,$3,1,'short_answer','What cools the city?','trees','Recorded clue')''',listening['question'],listening['test'],listening['version'])
    await con.execute("INSERT INTO listening_attempts(id,user_id,test_id,status,content_version_id) VALUES($1,$2,$3,'completed',$4)",listening['attempt'],ids['student'],listening['test'],listening['version'])
    await con.execute("INSERT INTO listening_answers(attempt_id,question_id,user_answer,is_correct) VALUES($1,$2,'trees',true)",listening['attempt'],listening['question'])
    listening_request={'module':'listening','attemptId':listening['attempt'],'questionId':listening['question']}
    answer=await explain_objective_question(con,actors['student'],listening_request)
    check(answer['officialAnswer']=='trees' and answer['explanationAvailable'])
    await con.execute("UPDATE listening_questions SET correct_answer='changed' WHERE id=$1",listening['question'])
    check((await explain_objective_question(con,actors['student'],listening_request))['officialAnswer']=='trees')
    await con.execute('UPDATE listening_questions SET content_version_id=NULL WHERE id=$1',listening['question'])
    check(not (await explain_objective_question(con,actors['student'],listening_request))['explanationAvailable'])

    release='rel-v1-'+'a'*24
    await con.execute("INSERT INTO dictionary_releases(id,state) VALUES($1,'building')",release)
    await con.execute("INSERT INTO dictionary_channels(name,active_release_id) VALUES('stable',$1)",release)
    payload={'lexeme_id':ids['lexeme'],'display_lemma':'cool','part_of_speech':'verb',
        'senses':[{'sense_id':str(uuid4()),'definition_en':'A different sense.','translations':[],'examples':[]},
                  {'sense_id':ids['sense'],'definition_en':'To lower temperature.','translations':[{'text':'sovitmoq'}],'examples':[{'text_en':'Trees cool cities.'}]}]}
    await con.execute("INSERT INTO dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,content_sha) VALUES($1,$2,'cool','verb','word',$3::jsonb,$4)",release,ids['lexeme'],json.dumps(payload),'c'*64)
    app_sense=str(uuid4())
    await con.execute("INSERT INTO lexemes(id,term,definition_en) VALUES($1,'cool','Temperature sense')",app_sense)
    await con.execute("INSERT INTO dictionary_sense_mappings(sense_id,app_sense_id,mapping_method) VALUES($1,$2,'canonical_id')",ids['sense'],app_sense)
    await con.execute("INSERT INTO lexical_occurrences(id,lexeme_id,passage_id,surface_form,start_char,end_char) VALUES($1,$2,$3,'cool',6,10)",ids['occurrence'],app_sense,ids['passage'])
    next_release='rel-v1-'+'b'*24
    await con.execute("INSERT INTO dictionary_releases(id,state) VALUES($1,'building')",next_release)
    await con.execute('''INSERT INTO dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,content_sha,sense_ids)
        SELECT $1,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,content_sha,$2::uuid[] FROM dictionary_entries WHERE release_id=$3''',next_release,[ids['sense']],release)
    await con.execute("UPDATE dictionary_releases SET state='validated',manifest='{}',manifest_sha=$1,validated_at=now()",'b'*64)
    found=await lookup_canonical_dictionary(con,actors['student'],{'term':'cool','locale':'en'})
    check(found['releaseId']==release and found['entryId']==ids['lexeme'])
    found=await lookup_canonical_dictionary(con,actors['student'],{'occurrenceId':ids['occurrence'],'locale':'en'})
    check(found['senseId']==ids['sense'] and found['definitionEn']=='To lower temperature.')
    await con.execute("UPDATE dictionary_channels SET active_release_id=$1 WHERE name='stable'",next_release)
    found=await lookup_canonical_dictionary(con,actors['student'],{'occurrenceId':ids['occurrence'],'locale':'en'})
    check(found['senseId']==ids['sense'])
    await con.execute("UPDATE reading_attempts SET status='in_progress' WHERE id=$1",ids['attempt'])
    try:await lookup_canonical_dictionary(con,actors['student'],{'term':'cool'})
    except PermissionError:check(True)
    else:raise AssertionError('active exam dictionary enabled')
    try:await explain_objective_question(con,actors['student'],request)
    except PermissionError:check(True)
    else:raise AssertionError('active exam key exposed')
    await con.execute("UPDATE reading_attempts SET status='completed' WHERE id=$1",ids['attempt'])

    await con.execute('''INSERT INTO grammar_topics(id,title,explanation,"order",publication_state)
        VALUES($1,'Subject verb agreement','Plural subjects require plural verbs.',1,'draft')''',ids['grammar'])
    check(not (await lookup_canonical_grammar(con,actors['student'],{'topicId':ids['grammar']}))['resolved'])
    await con.execute("UPDATE grammar_topics SET publication_state='published' WHERE id=$1",ids['grammar'])
    check((await lookup_canonical_grammar(con,actors['student'],{'topicId':ids['grammar']}))['resolved'])
    await con.execute("INSERT INTO coach_weaknesses(user_id,category,occurrence_count) VALUES($1,'agreement',3)",ids['student'])
    progress=await read_learner_progress_and_retention(con,actors['teacher'],{'targetUserId':ids['student'],'locale':'en'})
    check(progress['completedAttempts']==0 and progress['topWeaknesses']==['agreement (3x)'])
    try:await read_learner_progress_and_retention(con,actors['teacher'],{'targetUserId':ids['other']})
    except RiwiTargetScopeError:check(True)
    else:raise AssertionError('unassigned learner data exposed')
    targets=await list_riwi_target_page(con,actors['teacher'])
    check([v['id'] for v in targets['items']]==[ids['student']])

    await con.execute("INSERT INTO courses(id,slug,title) VALUES($1,'riwi-probe','Fixture')",ids['course'])
    await con.execute('INSERT INTO course_modules(id,course_id,slug,title,"order") VALUES($1,$2,\'riwi\',\'Fixture\',1)',ids['module'],ids['course'])
    await con.execute('INSERT INTO units(id,module_id,slug,title,"order") VALUES($1,$2,\'riwi\',\'Fixture\',1)',ids['unit'],ids['module'])
    await con.execute('INSERT INTO lessons(id,unit_id,slug,title,summary,"order",publication_state) VALUES($1,$2,\'riwi\',\'Fixture\',$3,1,\'published\')',ids['lesson'],ids['unit'],'E'*900)
    check(not (await read_course_lesson_excerpt(con,actors['student'],{'lessonId':ids['lesson']}))['resolved'])
    await con.execute('INSERT INTO enrollments(user_id,course_id) VALUES($1,$2)',ids['student'],ids['course'])
    lesson=await read_course_lesson_excerpt(con,actors['student'],{'lessonId':ids['lesson']})
    check(lesson['resolved'] and len(lesson['excerpt'])==600)
    await con.execute('''INSERT INTO evaluations(user_id,evaluation_type,source_type,source_id,provider_id,provider_display_name,provider_type,
        provider_version,prompt_version,rubric_version,checked_by_name,overall_estimate,created_at)
        VALUES($1,'writing','fixture',$2,'fixture','Fixture','internal','1','1','1','Fixture',6.5,now()-$3::int*interval '1 day')''',ids['student'],ids['attempt'],0)
    # Before assignment and outside the requested time window: neither belongs in this teacher's report.
    await con.execute('''INSERT INTO evaluations(user_id,evaluation_type,source_type,source_id,provider_id,provider_display_name,provider_type,
        provider_version,prompt_version,rubric_version,checked_by_name,overall_estimate,created_at)
        SELECT user_id,evaluation_type,source_type,gen_random_uuid(),provider_id,provider_display_name,provider_type,provider_version,prompt_version,rubric_version,checked_by_name,9,now()-interval '40 days' FROM evaluations''')
    report=await generate_deterministic_report(con,actors['teacher'],{'targetUserId':ids['student'],'windowDays':7})
    check(report['reportSnapshot']['metrics']['evaluationsCount']==1 and report['reportSnapshot']['metrics']['averageWritingBand']==6.5)
    report=await generate_deterministic_report(con,actors['teacher'],{'windowDays':7})
    check(report['reportSnapshot']['metrics']['evaluationsCount']==1)
    report=await generate_deterministic_report(con,actors['admin'],{'windowDays':7})
    check(report['reportSnapshot']['metrics']=={'activeLearnersCount':2})
    try:await generate_deterministic_report(con,actors['admin'],{'targetUserId':ids['student']})
    except RiwiTargetScopeError:check(True)
    else:raise AssertionError('admin academic access')
    report=await generate_deterministic_report(con,actors['owner'],{'windowDays':7})
    check(report['reportSnapshot']['metrics']['evaluationsCount']==1)

    from app.riwi_learning_signals import create_learning_signal,LearningServiceError
    signal=await create_learning_signal(con,actor=actors['teacher'],signal_type='teacher_correction',
        source_id=ids['attempt'],target_user_id=ids['student'],scope='user',
        candidate_claim='Check subject verb agreement.',evidence_summary='Authored fixture for an assigned learner.')
    check(signal['state']=='candidate')
    try:await create_learning_signal(con,actor=actors['teacher'],signal_type='teacher_correction',
        source_id=ids['attempt'],target_user_id=ids['other'],scope='user',
        candidate_claim='Check agreement.',evidence_summary='Out of scope fixture.')
    except LearningServiceError as exc:check(str(exc)=='forbidden')
    else:raise AssertionError('correction for unassigned learner')
    from app.riwi_knowledge import create_knowledge_candidate,approve_knowledge_candidate,promote_knowledge_candidate,retrieve_active_knowledge_for_actor,RIWI_GOLDEN_FIXTURES
    source=await create_knowledge_candidate(con,actor=actors['owner'],source_type='owner_instruction',
        title='Authored coherence fixture',provenance='Isolated authored QA material',rights_class='owner_authored',
        scope={'kind':'global'},content='A coherent argument states a position and supports it with a specific reason.')
    check(source['state']=='candidate')
    check((await approve_knowledge_candidate(con,actor=actors['owner'],source_id=source['id']))['state']=='approved')
    fixture=RIWI_GOLDEN_FIXTURES[0]['id']
    promoted=await promote_knowledge_candidate(con,actor=actors['owner'],source_id=source['id'],regression_fixture_id=fixture)
    check(promoted['state']=='active')
    retrieved=await retrieve_active_knowledge_for_actor(con,actors['student'],'coherent argument')
    check(bool(retrieved))

asyncio.run(run())
store_checks=checks
client=TestClient(core.app)
def headers(role):
    token=issue_token({'id':ids[role],'name':role,'role':role,'locale':'en'})
    return {'Cookie':f'{SESSION_COOKIE}={token}'}
response=client.post('/api/riwi/chat',headers=headers('student'),json={'message':'What does cool mean?'})
assert response.status_code==200,response.text
check(response.json()['provenance']=='canonical_dictionary')
request={'module':'reading','attemptId':ids['attempt'],'questionId':ids['question'],'locale':'en'}
response=client.post('/api/riwi/objective-explanation',headers=headers('student'),json=request)
assert response.status_code==200,response.text
check(response.json()['officialAnswer']=='TRUE')
check(client.post('/api/riwi/objective-explanation',headers=headers('admin'),json=request).status_code==403)
response=client.get('/api/riwi/targets',headers=headers('teacher'))
assert response.status_code==200,response.text
check([v['id'] for v in response.json()['items']]==[ids['student']])
from unittest.mock import AsyncMock,patch
provider_request=AsyncMock(return_value={'status':'completed','output':[{'content':[{'type':'output_text',
    'text':json.dumps({'answer':'State your position, then support it with a reason.','uncertainty':None,'citations':[]})}]}]})
with patch.dict(os.environ,{'RIWI_PRIMARY_PROVIDER':'openai','RIWI_EXTERNAL_AI_ENABLED':'true','AI_EXTERNAL_ENABLED':'true','OPENAI_API_KEY':'isolated-fixture'}),patch('app.riwi_provider_transport.request_json',provider_request):
    response=client.post('/api/riwi/chat',headers=headers('student'),json={'message':'Help me plan a clear argument for public transport.'})
assert response.status_code==200,response.text
check(response.json()['provenance']=='external_provider')
check(provider_request.await_args.args[0]==ids['student'])
check(ids['student'] not in json.dumps(provider_request.await_args.kwargs['payload']))
print(json.dumps({'event':'done','probeKind':'riwi_domain','checks':checks,'storeChecks':store_checks,'httpChecks':checks-store_checks,'measurements':{'httpRequests':5,'providerNetworkCalls':0}}),flush=True)
