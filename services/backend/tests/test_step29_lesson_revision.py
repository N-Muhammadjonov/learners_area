"""Revision route tests. DB fixture is transaction-shaped, not production Postgres."""
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from app.step29_lesson_revision import payload_block,validate_blocks,load
from app.step29_lesson_revision_blocks import signature,rowvals

ID='11111111-1111-4111-8111-111111111111'

def test_block_roundtrip_and_authored_contract():
    assert payload_block({'type':'text','text':'Original','objectKey':'ignored'})=={'type':'text','text':'Original'}
    assert payload_block({'type':'quiz','quiz':{'questionType':'mcq_single','prompt':'Which?', 'options':['A','B'],'answer':'A'}})['quiz']['answer']=='A'
    assert not validate_blocks([{'type':'text','text':'Original'}])
    problems=validate_blocks([{'type':'text','text':''},{'type':'link','url':'javascript:alert(1)'},
        {'type':'image','objectKey':None},{'type':'quiz','quiz':{'questionType':'missing','prompt':'here'}}])
    assert {x['code'] for x in problems}=={'missing_text','insecure_url','missing_object_key','unknown_question_type'}

def test_quiz_validation_matches_canonical_question_type_registry():
    def q(kind,key,options):return [{'type':'quiz','quiz':{'questionType':kind,'prompt':'Question?', 'answer':key,'options':options}}]
    assert not validate_blocks(q('mcq_single','A',['A','B']))
    assert any(x['code']=='option_count' for x in validate_blocks(q('mcq_single','A',['A'])))
    assert any(x['code']=='invalid_key' for x in validate_blocks(q('true_false_not_given','Maybe',[])))
    assert any(x['code']=='key_over_word_limit' for x in validate_blocks(q('short_answer','a b c d e f g',[])))

def test_reconcile_signature_excludes_position_and_metadata():
    row=rowvals({'type':'text','text':'Same'},1)
    assert signature(row)==signature(rowvals({'type':'text','text':'Same'},5))
    assert signature(row)!=signature(rowvals({'type':'text','text':'Changed'},1))

def test_revision_permissions_and_uuid_before_database(monkeypatch):
    async def no_user(*args,**kwargs):return None
    async def staff(*args,**kwargs):return {'role':'teacher','id':UUID(ID)}
    async def student(*args,**kwargs):return {'role':'student','id':UUID(ID)}
    async def no_db():raise AssertionError('DB must not be used for these checks')
    monkeypatch.setattr(core,'pool',no_db)
    client=TestClient(core.app)
    monkeypatch.setattr(core,'current_user',no_user)
    assert client.post(f'/api/admin/content/lessons/{ID}/revision').status_code==401
    monkeypatch.setattr(core,'current_user',student)
    assert client.post(f'/api/admin/content/lessons/{ID}/revision').status_code==403
    monkeypatch.setattr(core,'current_user',staff)
    assert client.post('/api/admin/content/lessons/no-id/revision').status_code==404

class FakeTx:
    def __init__(self, con):self.con=con
    async def __aenter__(self):return self.con
    async def __aexit__(self,*args):return False
class FakeDB:
    def __init__(self,con):self.con=con
    def acquire(self):return FakeTx(self.con)
class MissingCon:
    def transaction(self):return FakeTx(self)
    async def fetchrow(self,*args):return None


def test_missing_lesson_returns_issue_shape(monkeypatch):
    async def staff(*args,**kwargs):return {'role':'owner','id':UUID(ID)}
    async def db():return FakeDB(MissingCon())
    monkeypatch.setattr(core,'current_user',staff)
    monkeypatch.setattr(core,'pool',db)
    r=TestClient(core.app).post(f'/api/admin/content/lessons/{ID}/revision')
    assert r.status_code==404
    assert r.json()=={'ok':False,'issues':[{'code':'lesson_not_found','message':'That lesson does not exist.'}]}
