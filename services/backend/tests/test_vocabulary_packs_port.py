"""Canonical publication and EXACT built-in compatibility fallback for learner packs."""
from fastapi.testclient import TestClient
from app import main as core
from app.vocabulary_packs_port import built_in_summaries
from test_migration_phase2 import FakePool

client = TestClient(core.app)

class Conn:
    def __init__(self,rows=None,owned=None): self.rows=rows or [];self.owned=owned or [];self.calls=[]
    async def __aenter__(self):return self
    async def __aexit__(self,*exc):return False
    async def fetch(self,sql,*args):
        self.calls.append((sql,args));return self.owned if 'FROM user_vocabulary' in sql else self.rows


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
    db=Conn([{'slug':'new-pack','labelEn':'Renewable Energy','labelUz':'Qayta tiklanuvchi', 'wordCount':12,'added':False},
             {'slug':'some','labelEn':'No Uzbek','labelUz':None,'wordCount':1}])
    setup(monkeypatch,db)
    r=client.get('/api/vocabulary/packs')
    assert r.status_code==200
    assert r.json()=={'ok':True,'packs':[
        {'id':'new-pack','label':{'en':'Renewable Energy','uz':'Qayta tiklanuvchi'},'wordCount':12,'added':False},
        {'id':'some','label':{'en':'No Uzbek','uz':'No Uzbek'},'wordCount':1,'added':False},
        {'id':'art','label':{'en':'Art','uz':'San’at'},'wordCount':175,'added':False}]}
    sql,args=db.calls[0]
    assert "publication_state='published'" in sql and 'ORDER BY position' in sql
    assert 'INNER JOIN lexemes' in sql and 'SELECT count(*)' in sql
    assert args==()


def test_vocab_packs_fallback_matches_embedded_source_data(monkeypatch):
    db=Conn();setup(monkeypatch,db)
    result=client.get('/api/vocabulary/packs')
    assert result.status_code==200
    expected=[{'id':p['id'],'label':{'en':p['label'],'uz':p['labelUz']},
               'wordCount':p['wordCount'],'added':False} for p in built_in_summaries()]
    assert result.json()=={'ok':True,'packs':expected}
    assert sum(p['wordCount'] for p in result.json()['packs']) > 0


def test_imported_status_is_private_and_survives_folder_renaming(monkeypatch):
    db=Conn(owned=[{'topic_pack':'food','count':144}]);setup(monkeypatch,db)
    r=client.get('/api/vocabulary/packs')
    assert r.status_code==200 and r.headers['cache-control']=='private, no-store'
    assert next(p for p in r.json()['packs'] if p['id']=='food')['added'] is True
    assert next(p for p in r.json()['packs'] if p['id']=='health')['added'] is False
    sql,args=db.calls[-1]
    assert args==('aaa',) and 'user_id=$1' in sql and 'folder_id IS NOT NULL' in sql
    assert 'name=' not in sql


def test_remove_pack_deletes_only_its_words_and_empty_owned_folders(monkeypatch):
    class RemoveConn(Conn):
        def transaction(self):return self
        async def fetchrow(self,sql,*args):
            self.calls.append((sql,args));assert args==('aaa',) and 'FOR UPDATE' in sql
        async def fetch(self,sql,*args):
            self.calls.append((sql,args));assert args==('aaa','food') and 'user_id=$1' in sql
            return [{'folder_id':'owned-folder'}]
        async def execute(self,sql,*args):self.calls.append((sql,args));return 'DELETE 144'
    db=RemoveConn();setup(monkeypatch,db)
    r=client.delete('/api/vocabulary/packs/food')
    assert r.status_code==200 and r.json()=={'ok':True,'deletedWords':144}
    writes=[(sql,args) for sql,args in db.calls if sql.startswith(('UPDATE','DELETE'))]
    assert len(writes)==2
    assert writes[0][1]==('aaa','food') and 'DELETE FROM user_vocabulary' in writes[0][0] and 'topic_pack=$2' in writes[0][0]
    assert writes[1][1]==('owned-folder','aaa') and 'NOT EXISTS' in writes[1][0] and 'f.user_id=$2' in writes[1][0]
    assert all('SET folder_id=NULL' not in sql and 'DELETE FROM lexemes' not in sql for sql,_ in writes)


def test_anonymous_remove_pack_never_accesses_the_database(monkeypatch):
    db=Conn();setup(monkeypatch,db,False)
    r=client.delete('/api/vocabulary/packs/food')
    assert r.status_code==401 and db.calls==[]

def test_published_art_overrides_builtin_fallback(monkeypatch):
    db=Conn([{'slug':'art','labelEn':'Curated Art','labelUz':'Tasdiqlangan san’at','wordCount':7}])
    setup(monkeypatch,db)
    r=client.get('/api/vocabulary/packs')
    packs=r.json()['packs']
    assert len(packs)==1
    assert packs[0]['id']=='art'
    assert packs[0]['wordCount']==7
    assert packs[0]['label']['uz']=='Tasdiqlangan san’at'
