"""Publication transitions, schema and staff gate: no external services used."""
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from app.step27_publication import valid_date,TRANSITIONS,key_options

UID='11111111-1111-4111-8111-111111111111'

def test_publication_iso_and_transitions():
    assert valid_date('2026-10-23T12:30:00Z')[0]
    assert valid_date('2026-10-23T12:30:00+05:00')[0]
    assert not valid_date('2026-10-23T12:30:00')[0]
    assert not valid_date('bad')[0]
    assert 'scheduled' not in TRANSITIONS['archived']
    assert TRANSITIONS['published']=={'draft','scheduled','archived'}

def test_mcq_key_selection():
    options=['A. in the city','B. in a village','C. on a boat']
    assert key_options('A',options,False)==[options[0]]
    assert key_options('A, C',options,True)==[options[0],options[2]]
    assert key_options('A, A',options,True) is None
    assert key_options('D',options,False) is None

def test_unauthorized_and_bad_uuid_do_not_touch_database(monkeypatch):
    async def none(*args,**kwargs):return None
    async def student(*args,**kwargs):return {'id':UUID(UID),'role':'student'}
    async def admin(*args,**kwargs):return {'id':UUID(UID),'role':'admin'}
    async def no_pool():raise AssertionError('authorization and path validation are before DB')
    monkeypatch.setattr(core,'pool',no_pool)
    client=TestClient(core.app)
    monkeypatch.setattr(core,'current_user',none)
    assert client.post(f'/api/admin/content/reading/{UID}/publication',json={'state':'published'}).status_code==403
    monkeypatch.setattr(core,'current_user',student)
    assert client.post(f'/api/admin/content/reading/{UID}/publication',json={'state':'published'}).status_code==403
    monkeypatch.setattr(core,'current_user',admin)
    assert client.post('/api/admin/content/reading/not-a-uuid/publication',json={'state':'published'}).status_code==404
    assert client.post(f'/api/admin/content/not-content/{UID}/publication',json={'state':'published'}).status_code==404
