"""265-route checkpoint: source inventory, security gates, schema and transactional helpers.
No external Postgres/R2/Worker service is represented as integrated here.
"""
from __future__ import annotations
import json,uuid
from contextlib import asynccontextmanager
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from _parity_fixture import dictionary_entry
from app import main as core
from app import step40_content_drafts as draft
from app import step39_content_import as imported
from app import step39_dictionary_publish as dictpub
from app.step38_content_validation import parse_package, InvalidPackage
from app.step25_content_version import version_hashes

UID=uuid.UUID('11111111-1111-4111-8111-111111111111')
C=TestClient(core.app)
ROOT=Path(__file__).resolve().parents[1]
LAST_FIVE={
 ('POST','/api/admin/content/drafts'),('POST','/api/admin/content/import'),
 ('POST','/api/admin/listening/import'),('POST','/api/admin/listening/tests/{id}/convert'),
 ('POST','/api/owner/dictionary/{action:path}')}

def test_exact_265_manifest_without_unimplemented_http_methods():
    expected=json.loads((ROOT/'PORT_STATUS.json').read_text())
    actual=[(method,route.path) for route in core.app.routes if route.path.startswith('/api/') for method in route.methods]
    assert len(actual)==len(set(actual))==len(expected['endpoints'])==271
    assert {(e['method'],e['path']) for e in expected['endpoints']}==set(actual)
    assert expected['ported_methods']==271 and expected['unported_methods']==0
    for e in expected['endpoints']:
        if (e['method'],e['path']) in LAST_FIVE:assert e['status']=='ported_code_parity_unverified'

def test_original_sql_migration_bytes_are_unchanged():
    import hashlib
    hashes=json.loads((ROOT/'MIGRATION_AUDIT_265.json').read_text())['sql_sha256_by_filename']
    found={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'migrations').glob('*.sql')}
    assert len(found)==71
    assert {name:found[name] for name in hashes}==hashes
    for name in set(found)-set(hashes):
        assert (ROOT/'migrations'/name).read_bytes()==(ROOT.parents[1]/'drizzle'/name).read_bytes()
    assert len(set(found)-set(hashes))==5

@pytest.mark.parametrize('method,url,expect',[
 ('POST','/api/admin/content/drafts',401),('POST','/api/admin/content/import',401),
 ('POST','/api/admin/listening/import',401),('POST','/api/admin/listening/tests/'+str(UID)+'/convert',401),
 ('POST','/api/owner/dictionary/drafts',403),('POST','/api/owner/dictionary/publish',403),
 ('POST','/api/owner/dictionary/publish/'+str(UID)+'/retry',403),('POST','/api/owner/dictionary/rollback',403)])
def test_no_anonymous_access_to_last_five(monkeypatch,method,url,expect):
    async def nobody(*a,**kw):return None
    async def no_db():raise AssertionError('anonymous access reached database')
    monkeypatch.setattr(core,'current_user',nobody);monkeypatch.setattr(core,'pool',no_db)
    res=C.request(method,url,json={})
    assert res.status_code==expect,res.text

@pytest.mark.parametrize('url',[
 '/api/admin/content/drafts','/api/admin/content/import','/api/admin/listening/import',
 '/api/admin/listening/tests/'+str(UID)+'/convert','/api/owner/dictionary/publish'])
def test_student_never_may_import_author_or_publish(monkeypatch,url):
    async def student(*a,**kw):return {'id':UID,'role':'student','account_status':'active'}
    async def no_db():raise AssertionError('student request reached database')
    monkeypatch.setattr(core,'current_user',student);monkeypatch.setattr(core,'pool',no_db)
    res=C.post(url,json={})
    assert res.status_code==(400 if url=='/api/admin/content/import' else 403),res.text

@pytest.mark.parametrize('module,typ',list(draft.REGISTERED))
def test_each_registered_author_payload_must_be_validated(module,typ):
    with pytest.raises(draft.DraftInvalid):draft.validate(module,typ,{})

@pytest.mark.parametrize('sample',[
 {'taskType':'task1','category':'academic','prompt':'a' * 20,'targetWordCount':160},
 {'taskType':'task1','category':'academic','prompt':'a' * 20,'targetWordCount':49},
 {'taskType':'task2','category':'academic','prompt':'a' * 20,'targetWordCount':160},
])
def test_writing_task_type_and_word_count_are_checked(sample):
    if sample['taskType']=='task1' and sample['targetWordCount']==160:
        assert draft.validate('writing','task1',sample)['targetWordCount']==160
    else:
        with pytest.raises(draft.DraftInvalid):draft.validate('writing','task1',sample)

def test_speaking_cannot_use_retired_shadowing_or_unsafe_upload_keys():
    base={'title':'A practice resource','category':'general','primaryType':'link','primaryUrl':'https://example.com/x'}
    assert draft.validate('speaking','material',base)['category']=='general'
    for invalid in ({**base,'category':'shadowing'},{**base,'primaryObjectKey':'student-private'},
                     {**base,'primaryType':'file'},{**base,'primaryUrl':None}):
        with pytest.raises(draft.DraftInvalid):draft.validate('speaking','material',invalid)

def test_draft_listening_section_question_cap_preserved():
    q={'type':'mcq','questionText':'Choose the answer','correctAnswer':'A','explanation':'A is correct'}
    assert draft.validate('listening','section',{'questions':[q]})['sectionNo']==1
    with pytest.raises(draft.DraftInvalid):draft.validate('listening','section',{'questions':[q]*13})

def test_reading_requires_actual_canonical_question_type_and_group():
    reading={'passages':[{'title':'A sample passage','bodyText':'English literature '*8,
                 'questions':[{'typeCode':'not_a_question_type','questionText':'What happened?','correctAnswer':'An answer'}]}]}
    with pytest.raises(draft.DraftInvalid):draft.validate('reading','passage',reading)
    reading['passages'][0]['questions'][0]['typeCode']='short_answer'
    reading['passages'][0]['questions'][0]['groupKey']='not-found'
    with pytest.raises(draft.DraftInvalid):draft.validate('reading','passage',reading)

def test_draft_version_hash_same_payload_is_stable():
    p={'prompt':'Examine the chart.','taskType':'task1','wordMinimum':150,'category':'charts'}
    assert version_hashes('writing','task1',p)==version_hashes('writing','task1',dict(reversed(list(p.items()))))
    assert version_hashes('writing','task1',p)!=version_hashes('writing','task1',{**p,'prompt':'Changed'})

def test_generic_import_size_limit_is_the_original_2_megabytes():
    assert imported.MAX_BYTES==2*1024*1024

@pytest.mark.parametrize('payload,status,error',[(None,400,'Required'),({'module':'writing'},400,'Required'),
    ({'module':'writing','contentType':'task1','sourceRef':'up-X','title':'A good title','payload':{}},403,'forbidden')])
def test_authoring_request_validation_before_postgres(monkeypatch,payload,status,error):
    async def staff(*a,**kw):return {'id':UID,'role':'teacher','account_status':'active'}
    async def no_db():raise AssertionError('invalid input entered database')
    monkeypatch.setattr(core,'current_user',staff);monkeypatch.setattr(core,'pool',no_db)
    res=C.post('/api/admin/content/drafts',json=payload)
    assert res.status_code==status,res.text
    assert error in res.text

@pytest.mark.parametrize('path',[
 '/api/owner/dictionary/not-a-route','/api/owner/dictionary/publish/bad',
 '/api/owner/dictionary/publish/'+str(UID)+'/bad',
])
def test_dictionary_owner_unknown_actions_are_404_before_db(monkeypatch,path):
    async def owner(*a,**kw):return {'id':UID,'role':'owner','account_status':'active'}
    async def no_db():raise AssertionError('invalid action entered database')
    monkeypatch.setattr(core,'current_user',owner);monkeypatch.setattr(core,'pool',no_db)
    r=C.post(path,json={})
    assert r.status_code==404 and r.json()=={'error':'not_found'}

class Conn:
    def __init__(self):self.statements=[]
    async def fetchrow(self,sql,*args):
        self.statements.append((sql,args))
        if 'UPDATE dictionary_publish_jobs' in sql:return {'phase':'worker_index','id':UID}
        return None
    async def fetchval(self,sql,*args):self.statements.append((sql,args));return None
    async def execute(self,sql,*args):self.statements.append((sql,args));return 'OK'
    @asynccontextmanager
    async def transaction(self):yield self

@pytest.mark.asyncio
async def test_dictionary_retry_must_not_restart_a_nonfailed_job(monkeypatch):
    async def active(*a):return {'active_release_id':'rel-a'}
    monkeypatch.setattr(dictpub,'active_release',active)
    con=Conn()
    with pytest.raises(ValueError,match='job_not_found'):
        await dictpub.retry_worker_index(con,UID,UID)
    assert any('phase=\'failed\'' in x[0] for x in con.statements)
    assert not any('UPDATE dictionary_publish_jobs' in x[0] for x in con.statements)

@pytest.mark.asyncio
async def test_dictionary_retry_is_atomic_and_checks_release_and_active_jobs(monkeypatch):
    class RetryConn(Conn):
        async def fetchrow(self,sql,*args):
            self.statements.append((sql,args))
            if 'SELECT j.*' in sql:return {'base_release_id':'rel-a'}
            if 'UPDATE dictionary_publish_jobs' in sql:return {'phase':'worker_index','id':UID}
            return None
    async def active(*a):return {'active_release_id':'rel-a'}
    monkeypatch.setattr(dictpub,'active_release',active)
    con=RetryConn();result=await dictpub.retry_worker_index(con,UID,UID)
    assert result['phase']=='worker_index'
    assert any('worker_lease_token=NULL' in sql for sql,_ in con.statements)

@pytest.mark.asyncio
async def test_legacy_runtime_import_does_not_write_programme_day():
    con=Conn();result=await imported.legacy_runtime_import(con,{'id':UID},
                    {'testId':'sample','programme':{'ref':'day','day':1}},UID,None)
    assert result['status']==400 and 'MCQ programme' in result['detail']
    assert con.statements==[]

@pytest.mark.parametrize('kind,stated,expected,storage',[
 ('completion','note_completion','note_completion','short_answer'),
 ('completion','FORM','form_completion','short_answer'),
 ('matching','matching','matching','short_answer'),
 ('map','map_labeling','map_labeling','short_answer'),
 ('map','', 'map_labeling','short_answer'),
 ('mcq','mcq','mcq_single','multiple_choice'),
 ('mcq','MCQ_MULTI','mcq_multi','multiple_choice'),
 ('mcq','mcq_single','mcq_single','multiple_choice'),
 ('mcq','nonsense','mcq_single','multiple_choice'),
])
@pytest.mark.asyncio
async def test_listening_conversion_preserves_precise_question_identity(kind,stated,expected,storage):
    from app.step39_listening_conversion import reconcile
    class IdentityConn(Conn):
        async def fetch(self,sql,*args):
            self.statements.append((sql,args));return []
    c=IdentityConn()
    row={'number':7,'kind':kind,'typeCode':stated,'text':'Question 7',
         'options':['A alpha','B beta'],'key':'A','evidence':{'why':'because'}}
    await reconcile(c,UID,{'questions':[row]})
    inserts=[(s,args) for s,args in c.statements if 'INSERT INTO listening_questions(' in s]
    assert len(inserts)==1
    _,params=inserts[0]
    assert params[2]==storage and params[3]==expected
    assert params[4]=='Question 7'

@pytest.mark.asyncio
async def test_listening_conversion_keeps_existing_answer_row_identity():
    from app.step39_listening_conversion import reconcile
    class ExistingConn(Conn):
        async def fetch(self,sql,*args):
            self.statements.append((sql,args))
            return [{'id':UID,'order':2},{'id':uuid.uuid4(),'order':5}]
        async def fetchval(self,sql,*args):
            self.statements.append((sql,args))
            return 1
    c=ExistingConn()
    row={'number':2,'kind':'mcq','typeCode':'mcq_single','text':'Question 2',
         'options':['A alpha','B beta'],'key':'A','evidence':{'why':'because'}}
    await reconcile(c,UID,{'questions':[row]})
    assert any('UPDATE listening_questions SET' in s for s,args in c.statements)
    assert not any('DELETE FROM listening_questions' in s for s,args in c.statements)
    assert not any('INSERT INTO listening_questions(' in s for s,args in c.statements)

@pytest.mark.parametrize('alias,expected,storage',[
 ('MCQ','mcq_single','multiple_choice'),('mcq_multi','mcq_multi','multiple_choice'),
 ('matching','matching','multiple_choice'),('MAP','map_labeling','multiple_choice'),
 ('short_answer','short_answer','short_answer'),('note','note_completion','short_answer'),
])
def test_listening_draft_projection_canonical_question_types(alias,expected,storage):
    question={'type':alias,'questionText':'A simple valid question','correctAnswer':'A','explanation':'Explanation of answer'}
    p=draft.validate('listening','section',{'questions':[question]})
    descriptor=draft.resolve_listening_type(alias)
    assert descriptor['id']==expected
    assert descriptor['storageType']==storage
    assert p['questions'][0]['type']==alias

def test_unrecognized_listening_type_rejected_before_canonical_write():
    question={'type':'fake_listening_question','questionText':'A simple valid question',
              'correctAnswer':'A','explanation':'Explanation'}
    with pytest.raises(draft.DraftInvalid,match='Unknown Listening question type'):
        draft.validate('listening','full_test',{'questions':[question]})

def test_dictionary_immutable_shard_roundtrip_and_tamper_rejection():
    from app import step40_dictionary_storage as storage
    rel='rel-v1-'+'a'*24
    item=dictionary_entry(rel,str(UID),'genuine')
    for packed in (False,True):
        data,descriptor,ranges=storage.encode_shard(rel,[item],packed=packed)
        assert storage.decode_shard(rel,descriptor,data)==[item]
        assert len(data)<=storage.SHARD_LIMIT
        if packed:
            assert ranges[item['lexeme_id']]['offset']==0
            assert ranges[item['lexeme_id']]['length']==len(data)
        with pytest.raises(ValueError,match='checksum'):
            storage.decode_shard(rel,descriptor,data[:-1]+bytes([data[-1]^1]))

def test_dictionary_object_keys_must_be_release_scoped_and_immutable():
    from app import step40_dictionary_storage as storage
    rel='rel-v1-'+'a'*24
    assert storage.shard_key(rel,'11').endswith('/shards/11.json.gz')
    assert storage.index_key(rel,'directory').endswith('/search/directory.json.gz')
    assert storage.manifest_key(rel).endswith('/manifest.json')
    for wrong in ('../../secret','dictionary/releases/evil/manifest.json',
                  'dictionary/releases/rel-v1-'+('a'*24)+'/shards/../11.json.gz'):
        with pytest.raises(ValueError,match='invalid_dictionary_key'):storage.ensure_key(wrong)
