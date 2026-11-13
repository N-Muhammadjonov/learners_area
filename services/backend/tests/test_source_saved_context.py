"""Source-bound saved-vocabulary hints never guess a sense from a spelling."""
import asyncio
import json
from uuid import UUID
from starlette.requests import Request
from app import step21_meaning_access as route
from app.retention_meaning import with_saved_sense

USER=UUID('11111111-1111-4111-8111-111111111111')
PASSAGE=UUID('22222222-2222-4222-8222-222222222222')
MATCH=UUID('33333333-3333-4333-8333-333333333333')
STALE=UUID('44444444-4444-4444-8444-444444444444')
SENSE=UUID('55555555-5555-4555-8555-555555555555')


class FakeConnection:
    def __init__(self):
        self.arguments=None

    async def fetchval(self,query,*arguments):
        assert 'reading_passages' in query
        assert arguments==(PASSAGE,)
        return '😀offered food'

    async def fetch(self,query,*arguments):
        assert 'JOIN user_vocabulary' in query
        assert arguments==(USER,PASSAGE)
        self.arguments=arguments
        return [
            {'id':MATCH,'start_char':2,'end_char':9,'surface_form':'offered','section_number':None},
            {'id':STALE,'start_char':3,'end_char':10,'surface_form':'offered','section_number':None}
        ]

    async def fetchrow(self,query,*arguments):
        assert 'dictionary_sense_mappings' in query and 'user_vocabulary' in query
        assert arguments==(SENSE,USER)
        return {'id':MATCH,'mastery':'learning'}


class Acquisition:
    def __init__(self,connection):self.connection=connection
    async def __aenter__(self):return self.connection
    async def __aexit__(self,*args):return False


class FakePool:
    def __init__(self,connection):self.connection=connection
    def acquire(self):return Acquisition(self.connection)


def request():
    return Request({'type':'http','method':'GET','path':'/api/vocabulary/source-saved',
        'query_string':('sourceType=reading&sourceId='+str(PASSAGE)).encode(),'headers':[]})


def install(monkeypatch,connection,access='allowed'):
    async def current_user(*args,**kwargs):return {'id':USER,'role':'student'}
    async def pool():return FakePool(connection)
    async def check(*args,**kwargs):return access
    monkeypatch.setattr(route.core,'current_user',current_user)
    monkeypatch.setattr(route.core,'pool',pool)
    monkeypatch.setattr(route,'text_access',check)


def test_saved_occurrences_require_exact_source_offsets(monkeypatch):
    con=FakeConnection()
    install(monkeypatch,con)
    response=asyncio.run(route.source_saved(request()))
    assert response.status_code==200
    data=json.loads(response.body)
    assert data['savedOccurrences']==[{
        'occurrenceId':str(MATCH),'startChar':2,'endChar':9,'section':1
    }]
    assert con.arguments==(USER,PASSAGE)


def test_locked_source_never_leaks_saved_occurrences(monkeypatch):
    con=FakeConnection()
    install(monkeypatch,con,access='locked')
    response=asyncio.run(route.source_saved(request()))
    assert response.status_code==403
    assert 'savedOccurrences' not in json.loads(response.body)
    assert con.arguments is None


def test_saved_sense_is_bound_to_exact_dictionary_sense_not_surface_spelling():
    con=FakeConnection()
    context={'contextual':{'definitionEn':'to make an offer','dictionary':{'senseId':str(SENSE)}},
             'occurrenceId':None}
    saved=asyncio.run(with_saved_sense(con,{'id':USER},context))
    assert saved['known']=={'id':str(MATCH),'mastery':'learning'}
    unknown=asyncio.run(with_saved_sense(con,{'id':USER},{'contextual':None,'known':None}))
    assert unknown['known'] is None
