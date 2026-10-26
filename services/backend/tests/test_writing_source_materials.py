"""Source fidelity, publication selection, owned exam writes and private graph transport."""
import asyncio
import hashlib
import json
from uuid import UUID,uuid4
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app import writing_source_materials as source
from app import step20_media_port as media
from test_migration_phase2 import FakePool

C=TestClient(core.app)
UID=UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
PAPER=UUID('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')

def source_rows():
    return [{'id':UUID(p['id']),'task_type':p['taskType'],'prompt':p['prompt'],'source_ref':p['sourceRef']}
      for p in source.DATA['prompts'] if p['publicationState']=='published']

def test_inventory_source_fidelity_and_all_graph_bytes():
    d=source.DATA
    assert len(d['prompts'])==110 and len(d['translations'])==57 and len(d['fullTests'])==55
    assert [p['archiveCode'] for p in d['prompts'] if p['publicationState']=='draft']==['A07','A12','A17','A26','A27','A34']
    assert len(source.GRAPHS)==49
    for p in d['prompts']:
        if 'image' not in p:continue
        data=source.graph_bytes(p['image']['objectKey'])
        assert data.startswith(b'\x89PNG\r\n\x1a\n')
        assert len(data)==p['image']['size'] and hashlib.sha256(data).hexdigest()==p['image']['sha256']
    assert source.graph_bytes(next(p['image']['objectKey'] for p in d['prompts'] if p['inventoryCode']=='TASK1-A01'))!=source.graph_bytes(next(p['image']['objectKey'] for p in d['prompts'] if p['inventoryCode']=='TASK1-A40'))
    assert source.graph_bytes('../../etc/passwd') is None
    for t in d['fullTests']:
        pair=[source.PROMPTS[id] for id in t['promptIds']]
        assert [p['taskType'] for p in pair]==['task1','task2']
        assert all(p['fullTestCode']==t['code'] for p in pair)
        if t['code'].startswith('D'):
            assert [p['archiveCode'] for p in pair]==['B'+t['code'][1:],'C'+t['code'][1:]]
    for t in d['translations']:
        assert t['modelEnglish'] in next(p['prompt'] for p in d['prompts'] if p['taskType']=='task2' and p['archiveCode']==t['topic'])
        assert t['targetBand']==8 and 'not a certified' in t['targetBandProvenance']

def test_live_catalogue_uses_published_exact_source_identity_and_deletion_guard():
    class Conn:
        async def fetch(self,sql,*args):
            assert 'CONTENT_DELETED' in sql and 'publication_state' in sql and 'p.is_active' in sql
            assert len(args[0])==110
            return source_rows()
    inventory=asyncio.run(source.live_inventory(Conn()))
    cat=source.catalogue(inventory)
    assert [len(cat[k]) for k in ('fullTests','task1','task2')]==[49,49,55]
    changed=source_rows()[0];changed['prompt']='Owner revised this question.'
    assert source.metadata_for_prompt(changed) is None
    assert source.metadata_for_prompt(source_rows()[0])['title'].startswith('VISUAL DRILL')
    inventory.pop(cat['fullTests'][0]['promptIds'][0])
    assert len(source.catalogue(inventory)['fullTests'])==48

class ExamConn:
    def __init__(self):self.calls=[];self.open=None;self.rows=source_rows();self.entries=[]
    async def __aenter__(self):return self
    async def __aexit__(self,*args):return False
    def transaction(self):return self
    async def fetch(self,sql,*args):
        self.calls.append((sql,args))
        return self.entries if 'writing_exam_paper_entries' in sql else self.rows
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        if 'SELECT id,mode FROM writing_exam_papers' in sql:return self.open
        if 'UPDATE writing_exam_papers' in sql:return None
        raise AssertionError(sql)
    async def fetchval(self,sql,*args):
        self.calls.append((sql,args))
        if 'INSERT INTO writing_exam_papers' in sql:return PAPER
        if 'INSERT INTO writing_submissions' in sql:return uuid4()
        if 'FROM writing_exam_papers' in sql:return PAPER if self.open else None
        if 'FROM writing_prompts' in sql:return None
        raise AssertionError(sql)
    async def execute(self,sql,*args):self.calls.append((sql,args))

def setup(monkeypatch,conn,uid=UID):
    async def current(req,active=False):return {'id':uid,'role':'student','account_status':'active'} if uid else None
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'current_user',current);monkeypatch.setattr(core,'pool',pool)

@pytest.mark.parametrize('code',[t['code'] for t in source.DATA['fullTests'] if t['ready']])
def test_each_selected_pair_creates_only_its_exact_owned_prompts(monkeypatch,code):
    conn=ExamConn();setup(monkeypatch,conn)
    r=C.post('/api/writing/exam',json={'mode':'full','fullTest':code})
    assert r.status_code==200,r.text
    expected=source.FULL_TESTS[code]['promptIds']
    writes=[args for sql,args in conn.calls if 'INSERT INTO writing_submissions' in sql]
    assert [str(args[1]) for args in writes]==expected and all(args[0]==UID for args in writes)
    assert next(args for sql,args in conn.calls if 'INSERT INTO writing_exam_papers' in sql)==(UID,'full',3600)

def test_default_full_uses_one_source_pair_and_other_student_owns_writes(monkeypatch):
    conn=ExamConn();uid=uuid4();setup(monkeypatch,conn,uid)
    r=C.post('/api/writing/exam',json={'mode':'full'});assert r.status_code==200
    writes=[args for sql,args in conn.calls if 'INSERT INTO writing_submissions' in sql]
    assert [str(args[1]) for args in writes] in [t['promptIds'] for t in source.DATA['fullTests'] if t['ready']]
    assert all(args[0]==uid for args in writes)

@pytest.mark.parametrize('body',[{'mode':'full','fullTest':'A07'},{'mode':'full','fullTest':'unknown'},{'mode':'task1','fullTest':'A01'},{'mode':[]},{'mode':'full','fullTest':[]}])
def test_hold_unknown_and_cross_mode_are_rejected(monkeypatch,body):
    conn=ExamConn();setup(monkeypatch,conn)
    assert C.post('/api/writing/exam',json=body).status_code==400
    assert not conn.calls

def test_unpublished_pair_and_mismatched_open_paper(monkeypatch):
    conn=ExamConn();setup(monkeypatch,conn);conn.rows=conn.rows[1:]
    assert C.post('/api/writing/exam',json={'mode':'full','fullTest':'A01'}).status_code==404
    conn.open={'id':PAPER,'mode':'full'}
    conn.entries=[{'prompt_id':UUID(id)} for id in source.FULL_TESTS['D15']['promptIds']]
    assert C.post('/api/writing/exam',json={'mode':'full','fullTest':'A01'}).status_code==409
    assert C.post('/api/writing/exam',json={'mode':'full','fullTest':'D15'}).json()['resumed'] is True
    setup(monkeypatch,conn,None)
    assert C.post('/api/writing/exam',json={'mode':'full','fullTest':'A01'}).status_code==401

def test_private_graph_transport_keeps_auth_owner_lookup_ranges_and_r2(monkeypatch):
    conn=ExamConn();setup(monkeypatch,conn)
    key=next(iter(source.GRAPHS));data=source.graph_bytes(key);checks=[]
    async def authority(req):return {'user':{'id':UID,'role':'student','account_status':'active'},'expiresAt':2100000000}
    async def allow(c,user,k):checks.append((user['id'],k));return 'allowed'
    monkeypatch.setattr(core,'current_authority',authority);monkeypatch.setattr(media,'allow_resource',allow)
    monkeypatch.setattr(media,'media_conf',lambda: (_ for _ in ()).throw(AssertionError('Graph must not use the worker')))
    path='/api/resources/'+key
    r=C.get(path);assert r.status_code==200 and r.content==data and r.headers['cache-control']=='private, no-store'
    assert r.headers['content-type']=='image/png' and checks[-1]==(UID,key)
    r=C.head(path);assert r.status_code==200 and not r.content and int(r.headers['content-length'])==len(data)
    r=C.get(path,headers={'Range':'bytes=3-11'});assert r.status_code==206 and r.content==data[3:12]
    assert C.get(path,headers={'Range':'bytes=9999999-'}).status_code==416
    r=C.get(path+'?capability=1');assert r.status_code==200 and r.json()['url'].endswith('?stream=1')
    async def denied(*args):return 'forbidden'
    monkeypatch.setattr(media,'allow_resource',denied);assert C.get(path).status_code==403
    async def missing(*args):return 'not_found'
    monkeypatch.setattr(media,'allow_resource',missing);assert C.get(path).status_code==404
    monkeypatch.setattr(media,'allow_resource',allow);monkeypatch.setattr(media,'media_conf',lambda:None)
    async def head(k):return {'size':5,'contentType':'image/png'}
    async def read(k,*args):return b'other'
    monkeypatch.setattr(media,'head_object',head);monkeypatch.setattr(media,'read_object',read)
    assert C.get('/api/resources/another/original.png').content==b'other'
    async def no_authority(req):return None
    monkeypatch.setattr(core,'current_authority',no_authority)
    checks.clear();assert C.get(path).status_code==401 and not checks
