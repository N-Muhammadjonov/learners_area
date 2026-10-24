"""Canonical publication and EXACT built-in compatibility fallback for learner packs."""
from fastapi.testclient import TestClient
from app import main as core
from app.vocabulary_packs_port import built_in_summaries
from test_migration_phase2 import FakePool

client = TestClient(core.app)

class Conn:
    def __init__(self,rows=None): self.rows=rows or [];self.calls=[]
    async def __aenter__(self):return self
    async def __aexit__(self,*exc):return False
    async def fetch(self,sql,*args):self.calls.append((sql,args));return self.rows


def setup(monkeypatch,db,authenticated=True):
    async def user(req,active=False):return {'id':'aaa', 'role':'student'} if authenticated else None
    async def pool():return FakePool(db)
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',pool)


def test_vocab_packs_rejects_anonymous_before_db(monkeypatch):
    db=Conn();setup(monkeypatch,db,False)
    r=client.get('/api/vocabulary/packs')
    assert r.status_code==401 and r.json()=={'error':'unauthenticated'} and db.calls==[]


def test_vocab_packs_query_published_pack_summaries_only(monkeypatch):
    db=Conn([{'slug':'new-pack','labelEn':'Renewable Energy','labelUz':'Qayta tiklanuvchi', 'wordCount':12},
             {'slug':'some','labelEn':'No Uzbek','labelUz':None,'wordCount':1}])
    setup(monkeypatch,db)
    r=client.get('/api/vocabulary/packs')
    assert r.status_code==200
    assert r.json()=={'ok':True,'packs':[
        {'id':'new-pack','label':{'en':'Renewable Energy','uz':'Qayta tiklanuvchi'},'wordCount':12},
        {'id':'some','label':{'en':'No Uzbek','uz':'No Uzbek'},'wordCount':1}]}
    sql,args=db.calls[0]
    assert "publication_state='published'" in sql and 'ORDER BY position' in sql
    assert 'INNER JOIN lexemes' in sql and 'SELECT count(*)' in sql
    assert args==()


def test_vocab_packs_fallback_matches_embedded_source_data(monkeypatch):
    db=Conn();setup(monkeypatch,db)
    result=client.get('/api/vocabulary/packs')
    assert result.status_code==200
    expected=[{'id':p['id'],'label':{'en':p['label'],'uz':p['labelUz']},
               'wordCount':p['wordCount']} for p in built_in_summaries()]
    assert result.json()=={'ok':True,'packs':expected}
    assert sum(p['wordCount'] for p in result.json()['packs']) > 0
