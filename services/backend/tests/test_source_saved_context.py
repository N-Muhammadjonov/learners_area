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


class ExactMeaningConnection:
    async def fetch(self,query,*arguments):
        assert 'lexical_occurrences' in query and 'o.passage_id' in query
        assert arguments==(PASSAGE,2,9)
        return [{
            'id':MATCH,'lexeme_id':SENSE,'start_char':2,'end_char':9,
            'surface_form':'offered','term':'offer',
            'definition_en':'to present for acceptance',
            'translation_uz':'taklif qilmoq','part_of_speech':'verb',
            'provenance':'dictionary_release','verification_status':'verified'
        }]

    async def fetchrow(self,query,*arguments):
        assert 'user_vocabulary' in query
        assert arguments==(USER,SENSE)
        return {'id':STALE,'mastery':'learning'}


def test_source_meaning_prefers_exact_verified_occurrence_and_owners_saved_status():
    from app.retention_meaning import lookup_source_text
    result=asyncio.run(lookup_source_text(
        ExactMeaningConnection(),{'id':USER},'😀offered food','offered',2,9,
        source_type='reading',source_id=PASSAGE))
    assert result['occurrenceId']==str(MATCH)
    assert result['contextual']['translationUz']=='taklif qilmoq'
    assert result['contextual']['definitionEn']=='to present for acceptance'
    assert result['known']=={'id':str(STALE),'mastery':'learning'}


def test_source_meaning_rejects_spoofed_word_positions_before_lookup():
    from app.retention_meaning import lookup_source_text
    assert asyncio.run(lookup_source_text(
        ExactMeaningConnection(),{'id':USER},'😀offered food','offered',1,8,
        source_type='reading',source_id=PASSAGE)) is None

LISTENING_TEST=UUID('66666666-6666-4666-8666-666666666666')

class ListeningSaveConnection:
    async def fetchrow(self,query,*arguments):
        if 'FROM lexical_occurrences WHERE id=' in query:
            assert arguments==(MATCH,)
            return {
                'id':MATCH,'source_type':'listening','listening_test_id':LISTENING_TEST,
                'section_number':2,'segment_key':'s2','lexeme_id':SENSE,
                'resolution_status':'resolved','start_char':0,'end_char':7,
                'surface_form':'offered','start_ms':None,'end_ms':None
            }
        if 'FROM listening_tests t JOIN listening_packages p' in query:
            assert arguments==(LISTENING_TEST,)
            return {'title':'Listening Test 2',
                    'payload':{'sections':[{'transcript':'other'},
                                             {'transcript':'offered food'},
                                             {'transcript':'other'},
                                             {'transcript':'other'}]}}
        if 'SELECT * FROM lexemes WHERE id=' in query:
            assert arguments==(SENSE,)
            return {'id':SENSE,'term':'offer','definition_en':'to present for acceptance',
                    'translation_uz':'taklif qilmoq','part_of_speech':'verb'}
        raise AssertionError('Unexpected query: '+query[:180])


def test_listening_source_occurrence_can_be_saved_with_canonical_dictionary_lexeme(monkeypatch):
    from app import step21_vocabulary_create as writer
    async def access(con,u,source,source_id):
        assert source=='listening'
        assert source_id==LISTENING_TEST
        return 'allowed'
    monkeypatch.setattr(writer,'text_access',access)
    result=asyncio.run(writer.resolve_occurrence(
        ListeningSaveConnection(),{'id':USER},'listening',str(LISTENING_TEST),str(MATCH)))
    assert result['status']=='resolved'
    assert result['lexeme']['id']==SENSE
    assert result['lexeme']['translation_uz']=='taklif qilmoq'
    assert result['snapshot']['sectionNumber']==2


def test_listening_source_occurrence_rejects_wrong_test(monkeypatch):
    from app import step21_vocabulary_create as writer
    async def access(*args,**kwargs):return 'allowed'
    monkeypatch.setattr(writer,'text_access',access)
    result=asyncio.run(writer.resolve_occurrence(
        ListeningSaveConnection(),{'id':USER},'listening',str(PASSAGE),str(MATCH)))
    assert result['status']=='missing'
