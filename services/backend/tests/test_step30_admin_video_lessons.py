"""Video authoring permissions, input schema, provider security, lexical forms.
Full persistence integration requires PostgreSQL and video worker credentials.
"""
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from app.step30_admin_video_lessons import parse_provider,schema,Bad
from app.step30_video_lexical import forms_of,spans,example_matches,is_function
import pytest

ID='11111111-1111-4111-8111-111111111111'

def test_provider_accepts_only_authorised_ids_and_origins():
    assert parse_provider('abcdefghijk')==(('youtube','abcdefghijk'),None)
    assert parse_provider('https://youtu.be/abcdefghijk?t=18')==(('youtube','abcdefghijk'),None)
    assert parse_provider('https://www.youtube.com/watch?v=abcdefghijk')==(('youtube','abcdefghijk'),None)
    assert parse_provider('https://www.youtube.com/shorts/abcdefghijk')==(('youtube','abcdefghijk'),None)
    assert parse_provider('https://example.com/watch?v=abcdefghijk')==(None,'unsupported_host')
    assert parse_provider('https://www.youtube.com/watch?v=short')==(None,'invalid_id')
    assert parse_provider('some-html<script>')==(None,'invalid_id')
    assert parse_provider('https://media.example.com/media/mine.mp4','https://media.example.com')==(('direct','mine.mp4'),None)
    assert parse_provider('https://media.example.com/media/mine.mp4#bad','https://media.example.com')==(None,'invalid_id')

def test_authored_fields_bounded_and_transcript_provenance():
    row=schema({'title':'  TED  ','videoUrl':'abcdefghijk','vocabulary':[{'word':' sense ','pos':'noun','def':' Idea ','uz':'goya'}]})
    assert row['title']=='TED' and row['vocabulary'][0]['word']=='sense' and row['vocabulary'][0]['ex']==''
    with pytest.raises(Bad):schema({'title':'x','videoUrl':'abcdefghijk'})
    with pytest.raises(Bad):schema({'title':'Some TED','videoUrl':'abcdefghijk','durationSeconds':43201})
    with pytest.raises(Bad):schema({'title':'Some TED','videoUrl':'abcdefghijk','questions':[{'stage':'comprehension','prompt':'text','acceptedAnswers':[]} ]})

def test_auth_gate_avoids_database(monkeypatch):
    async def none(*args,**kwargs):return None
    async def student(*args,**kwargs):return {'role':'student','id':UUID(ID)}
    async def teacher(*args,**kwargs):return {'role':'teacher','id':UUID(ID)}
    async def forbidden_db():raise AssertionError('Database read unexpectedly occurred')
    monkeypatch.setattr(core,'pool',forbidden_db)
    client=TestClient(core.app)
    monkeypatch.setattr(core,'current_user',none)
    assert client.post('/api/admin/video-lessons',json={}).status_code==403
    monkeypatch.setattr(core,'current_user',student)
    assert client.post('/api/admin/video-lessons',json={}).status_code==403
    monkeypatch.setattr(core,'current_user',teacher)
    r=client.post('/api/admin/video-lessons',json={'title':'Some TED','videoUrl':'abcdefghijk','transcriptText':'hello'})
    assert r.status_code==400 and r.json()=={'error':'invalid_input','detail':'transcript_source_required'}
    r=client.post('/api/admin/video-lessons',json={'title':'Some TED','videoUrl':'abcdefghijk','transcriptText':'a','transcript':[{'startSeconds':0,'text':'word'}],'transcriptSource':'authored'})
    assert r.status_code==400 and r.json()['detail']=='transcript_ambiguous'

def test_inflections_and_ambiguous_unit_spans():
    verb=forms_of('run','v')
    assert {'run','runs','running','ran'}<=set(f[0] for f in verb)
    assert 'runned' not in [f[0] for f in verb]
    forms=[x[0] for x in forms_of('take into account','verb')]
    assert 'took into account' in forms
    assert is_function('the') and not is_function('take into account')
    found=spans('The runner ran for a while.',['bad']) if False else spans('The runner ran for a while.',[{'key':'k','forms':['ran','run']}])
    assert [(x['surface'],x['start']) for x in found]==[('ran',11)]
    assert example_matches('She ran for a while.','She ran for a while.')
    assert not example_matches('river bank','He visited the bank to withdraw cash.')
