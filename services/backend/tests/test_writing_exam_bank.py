import asyncio
import hashlib
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from app import writing_exam_bank as bank
from test_exam_lifecycle_port import Conn,setup

C=TestClient(core.app)

def test_bank_has_exact_source_inventory_and_only_complete_published_visuals():
    assert len(bank.DATA['prompts'])==145
    assert len(bank.PROMPTS)==145
    assert sum(p['taskType']=='task1' for p in bank.PROMPTS.values())==67
    assert sum(p['taskType']=='task2' for p in bank.PROMPTS.values())==78
    for p in bank.PROMPTS.values():
        assert p['category'] in {t['id'] for t in bank.DATA['types'][p['taskType']]}
        if p['taskType']=='task1' and p['publicationState']=='published':
            image=p['image'];assert image is not None
            raw=bank.graph_bytes(image['objectKey'])
            assert raw.startswith(b'\x89PNG\r\n\x1a\n')
            assert hashlib.sha256(raw).hexdigest()==image['sha256']
    assert bank.graph_bytes('unrelated/object.png') is None

def test_catalogue_uses_only_database_rows_and_preserves_date_uncertainty():
    p=next(p for p in bank.PROMPTS.values() if p.get('sourceDate'))
    row={'id':p['id'],'task_type':p['taskType'],'category':p['category'],'prompt':p['prompt'],'source_ref':p['sourceRef']}
    assert bank.catalogue([])['questions']==[]
    question=bank.catalogue([row])['questions'][0]
    assert question['sourceDate']==p['sourceDate']
    assert 'not independently verified' in question['sourceDate']
    assert question['isNew']

def test_selected_prompt_rejects_wrong_task_unpublished_and_invalid_id(monkeypatch):
    co=Conn();setup(monkeypatch,co)
    assert C.post('/api/writing/exam',json={'mode':'task2','promptId':'bad'}).status_code==400
    assert C.post('/api/writing/exam',json={'mode':'full','promptId':str(next(iter(bank.PROMPTS)))}).status_code==400
    id=next(iter(bank.PROMPTS))
    assert C.post('/api/writing/exam',json={'mode':'task2','promptId':id}).status_code==404
    query,args=next((q,args) for op,q,args in reversed(co.calls) if 'FROM writing_prompts' in q)
    assert args==(UUID(id),'task2')
    assert 'p.is_active' in query and 'p.publication_state' in query and 'CONTENT_DELETED' in query

def test_selected_prompt_inserts_exact_question_with_server_deadline(monkeypatch):
    selected=UUID(next(p['id'] for p in bank.PROMPTS.values() if p['taskType']=='task2'))
    paper=UUID('99999999-9999-4999-8999-999999999999')
    class SelectedConn(Conn):
        async def fetchval(self,q,*args):
            self.calls.append(('fetchval',q,args))
            if 'FROM writing_prompts' in q:return selected
            if 'INSERT INTO writing_exam_papers' in q:return paper
            if 'INSERT INTO writing_submissions' in q:return UUID('88888888-8888-4888-8888-888888888888')
            raise AssertionError(q)
    co=SelectedConn();setup(monkeypatch,co)
    r=C.post('/api/writing/exam',json={'mode':'task2','promptId':str(selected)})
    assert r.status_code==200 and r.json()['id']==str(paper)
    assert any(args[1]==selected for op,q,args in co.calls if 'INSERT INTO writing_submissions' in q)
    assert any('NOW()+make_interval' in q and args[-1]==2400 for op,q,args in co.calls if 'INSERT INTO writing_exam_papers' in q)
