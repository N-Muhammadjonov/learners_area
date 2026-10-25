"""Unit-scale HTTP checks for new routes. PostgreSQL E2E/Next.js diff is still required."""
from datetime import datetime,timezone,timedelta
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step16_units_prompts_port import cursor_encode,cursor_decode
from app.step16_leaderboard_port import streak_from_days

ID='11111111-1111-4111-8111-111111111111'
SOURCE='22222222-2222-4222-8222-222222222222'
client=TestClient(core.app)

class Conn:
 def __init__(self):self.calls=[];self.rows=[];self.one=None;self.value=None;self.bad=False
 async def __aenter__(self):return self
 async def __aexit__(self,*a):return False
 def transaction(self):return self
 async def fetch(self,sql,*args):
  self.calls.append(('fetch',sql,args))
  if self.bad:raise RuntimeError('db closed')
  return self.rows
 async def fetchrow(self,sql,*args):
  self.calls.append(('fetchrow',sql,args))
  if self.bad:raise RuntimeError('db closed')
  return self.one
 async def fetchval(self,sql,*args):
  self.calls.append(('fetchval',sql,args))
  if self.bad:raise RuntimeError('db closed')
  return self.value
 async def execute(self,sql,*args):
  self.calls.append(('execute',sql,args))
  return 'OK'
class Pool:
 def __init__(self,con):self.con=con
 def acquire(self):return self.con

@pytest.fixture
def fixture(monkeypatch):
 db=Conn()
 async def pool():return Pool(db)
 async def user(req,active=False):return {'id':UUID(ID),'role':'admin','account_status':'active'}
 monkeypatch.setattr(core,'pool',pool)
 monkeypatch.setattr(core,'current_user',user)
 return db

def test_unit_unauthenticated_without_database(fixture,monkeypatch):
 async def learner(req,active=False):return {'id':UUID(ID),'role':'student'}
 monkeypatch.setattr(core,'current_user',learner)
 response=client.get('/api/lessons/units')
 assert response.status_code==401 and not fixture.calls

def test_unit_bad_cursor_refused_before_sql(fixture):
 response=client.get('/api/lessons/units?cursor=not-valid')
 assert response.status_code==400 and response.json()=={'error':'invalid_cursor'}
 assert not fixture.calls

def test_unit_cursor_search_binding_and_shape():
 row={'id':ID,'course':'English','module_order':1,'unit_order':15}
 cursor=cursor_encode(row,'gram')
 assert cursor_decode(cursor,'gram')==['English',1,15,ID]
 with pytest.raises(ValueError):cursor_decode(cursor,'other')
 with pytest.raises(ValueError):cursor_decode('a'*1025,'gram')


def test_unit_typeahead_empty(fixture):
 r=client.get('/api/lessons/units?q=grammar')
 assert r.status_code==200 and r.json()=={'options':[],'hasMore':False,'nextCursor':None,'matching':0,'pageSize':500}
 assert len(fixture.calls)==2
 assert 'ILIKE $1' in fixture.calls[0][1]


def test_unit_exact_id_resolution(fixture):
 fixture.rows=[{'id':UUID(ID),'course':'IELTS','module':'Reading','unit':'Inference','unit_order':3}]
 r=client.get(f'/api/lessons/units?ids=invalid,{ID},{ID}')
 assert r.status_code==200 and r.json()['options']==[{'id':ID,'course':'IELTS','label':'IELTS › Reading › 3. Inference'}]
 assert fixture.calls[0][2]==([ID],)


def test_unit_keyset_db_query(fixture):
 value=cursor_encode({'id':ID,'course':'IELTS','module_order':5,'unit_order':3},'lesson')
 r=client.get('/api/lessons/units',params={'q':'lesson','cursor':value})
 assert r.status_code==200
 assert '::uuid)' in fixture.calls[0][1]
 assert len(fixture.calls[0][2])==5
 assert len(fixture.calls[1][2])==1


def test_leaderboard_unauthenticated(fixture,monkeypatch):
 async def no(req,active=False):return None
 monkeypatch.setattr(core,'current_user',no)
 r=client.get('/api/vocabulary/leaderboard')
 assert r.status_code==401 and r.headers['cache-control']=='private, no-store'
 assert not fixture.calls


def test_leaderboard_awards_view(fixture):
 fixture.rows=[{'id':UUID(SOURCE),'kind':'revision','points':1,'createdAt':datetime(2026,10,22,tzinfo=timezone.utc)}]
 r=client.get('/api/vocabulary/leaderboard?view=awards')
 assert r.status_code==200 and r.json()['awards'][0]['points']==1
 assert 'effective_points' in fixture.calls[0][1]
 assert 'row_number() OVER' in fixture.calls[0][1]


def test_leaderboard_errors_are_non_disclosing(fixture):
 fixture.bad=True
 for view,code in [('standing','vocabulary_standing_unavailable'),('awards','vocabulary_awards_unavailable')]:
  r=client.get('/api/vocabulary/leaderboard',params={'view':view})
  assert r.status_code==503 and r.json()['code']==code
  assert 'db closed' not in r.text


def test_leaderboard_streak_tashkent_days():
 now=datetime(2026,10,23,1,0,tzinfo=timezone.utc)
 first=datetime(2026,10,21,21,0,tzinfo=timezone.utc)
 second=datetime(2026,10,22,22,0,tzinfo=timezone.utc)
 assert streak_from_days([first,second],now)==2
 assert streak_from_days([],now)==0
 assert streak_from_days([first],now)==1
 assert streak_from_days([first-timedelta(days=2)],now)==0


def test_stealing_session_validation_no_database(fixture):
 r=client.post('/api/writing/stealing/sessions',json={'modelTextId':'no'})
 assert r.status_code==400 and not fixture.calls


def test_new_routes_are_unique():
 entries=set()
 for route in core.app.routes:
  if not route.path.startswith('/api/'):continue
  for method in route.methods or ():
   if method in {'GET','POST','PUT','PATCH','DELETE'}:
    key=(method,route.path)
    assert key not in entries, key
    entries.add(key)

def test_vocab_page_reads_only_owner_rows(fixture):
 now=datetime(2026,10,22,12,tzinfo=timezone.utc)
 fixture.rows=[{'id':UUID(SOURCE),'term':'abate','acceptedTranslations':None,
   'partOfSpeech':'verb','definitionEn':'become less severe','translationUz':'kamaymoq',
   'exampleSentence':None,'collocations':None,'mastery':'new','srsStage':-1,'intervalDays':0,
   'nextReviewAt':now,'correctCount':0,'incorrectCount':0,'activeUseCount':0,
   'folderId':None,'topicPack':None,'sourceType':'manual','sourceSnapshot':None,'createdAt':now}]
 r=client.get('/api/vocabulary?offset=3&limit=1')
 assert r.status_code==200,r.text
 payload=r.json()
 assert payload['ok'] and payload['words'][0]['acceptedTranslations']==[]
 assert payload['offset']==3 and payload['limit']==1 and not payload['hasMore']
 assert fixture.calls[0][2]==(UUID(ID),2,3)
 assert 'WHERE uv.user_id=$1' in fixture.calls[0][1]


def test_vocab_page_fallback_and_db_error(fixture):
 r=client.get('/api/vocabulary?limit=nan&offset=not-a-number')
 assert r.status_code==200
 assert r.json()['limit']==50 and r.json()['offset']==0
 fixture.bad=True
 r=client.get('/api/vocabulary')
 assert r.status_code==503
 assert r.json()=={'ok':False,'error':'temporarily_unavailable'}


def test_vocab_page_auth_guard(fixture,monkeypatch):
 async def no(req,active=False):return None
 monkeypatch.setattr(core,'current_user',no)
 r=client.get('/api/vocabulary')
 assert r.status_code==401
 assert not fixture.calls
