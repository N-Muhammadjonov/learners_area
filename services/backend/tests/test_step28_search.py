"""Source-shaped global-search regression without a live database/Dictionary Worker."""
import pytest
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from app import step28_search as s

UID=UUID('11111111-1111-4111-8111-111111111111')


def test_bilingual_navigation_and_stable_rank():
    en=s.navigation_search('grammar','en')
    uz=s.navigation_search('grammar','uz')
    assert any(x['title']=='Grammar' and x['href']=='/app/grammar' for x in en)
    assert any(x['title']=='Grammatika' and x['href']=='/app/grammar' for x in uz)
    assert s.navigation_search('x','uz')==[]
    assert s.norm("o‘qish  \nDARS")=="o'qish dars"
    h=s.hit('lesson','Grade',None,'/a')
    assert s.rank_search([s.hit('lesson','Graded',None,'/b'),h,h],'grade')==[h,s.hit('lesson','Graded',None,'/b')]


def test_staff_hidden_data_query_prevention():
    for kind in (0,1,2,4,5,6,7,8,9):
        assert 'deleted_content' in s.pub('p')
    assert 'answer_key' not in s.category.__code__.co_consts
    assert len(s.OMISSIONS)==4


def test_auth_and_too_short(monkeypatch):
    async def absent(*a,**kw):return None
    monkeypatch.setattr(core,'current_user',absent)
    r=TestClient(core.app).get('/api/search?q=grammar')
    assert r.status_code==401 and r.json()=={'error':'unauthenticated'}
    async def active(*a,**kw):return {'id':UID,'role':'student'}
    monkeypatch.setattr(core,'current_user',active)
    monkeypatch.setattr(s,'counter',lambda *a,**kw: None)
    r=TestClient(core.app).get('/api/search?q=x')
    assert r.status_code==200 and r.json()=={'query':'x','results':[],'tooShort':True}
    assert r.headers['cache-control']=='private, no-store'


def test_rate_limit_before_content(monkeypatch):
    async def active(*a,**kw):return {'id':UID,'role':'student'}
    monkeypatch.setattr(core,'current_user',active)
    monkeypatch.setattr(s,'counter',lambda *a,**kw: 42)
    r=TestClient(core.app).get('/api/search?q=grammar')
    assert r.status_code==429 and r.json()=={'error':'rate_limited'} and r.headers['retry-after']=='42'


def test_partial_failures_preserve_navigation(monkeypatch):
    async def active(*a,**kw):return {'id':UID,'role':'student'}
    async def failed(*a,**kw):return {'results':[],'failedCategories':2}
    async def dictionary(*a,**kw):raise ConnectionError('worker unavailable')
    monkeypatch.setattr(core,'current_user',active)
    monkeypatch.setattr(s,'content_search',failed)
    monkeypatch.setattr(s,'dictionary_search_hits',dictionary)
    monkeypatch.setattr(s,'counter',lambda *a,**kw: None)
    r=TestClient(core.app).get('/api/search?q=grammar')
    assert r.status_code==200 and r.json()['partial'] is True
    assert any(h['href']=='/app/grammar' for h in r.json()['results'])
    r=TestClient(core.app).get('/api/search?q=unlikely-nonsense-1022')
    assert r.status_code==503 and r.json()=={'error':'search_unavailable'}
