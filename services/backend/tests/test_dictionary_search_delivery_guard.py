import asyncio
from uuid import UUID
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app import main as core
from app import step17_dictionary_read_port as read
from app import step26_dictionary_owner_read as owner
from app import retention_meaning as retention

class Connection:
    def __init__(self, registry, index=None):
        self.registry, self.index, self.legacy_reads, self.registry_reads = registry, index, 0, 0

    async def fetchrow(self, sql, *args):
        if 'dictionary_search_indexes' in sql:
            return self.index
        if 'dictionary_releases' in sql:
            self.registry_reads += 1
            return self.registry
        raise AssertionError('Unexpected query')

    async def fetch(self, sql, *args):
        assert 'dictionary_search_terms' in sql
        self.legacy_reads += 1
        return []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class Pool:
    def __init__(self, con):
        self.con = con

    def acquire(self):
        return self.con


def client(monkeypatch, con):
    async def user(*args, **kwargs):
        return {'id': UUID('11111111-1111-4111-8111-111111111111')}
    async def pool():
        return Pool(con)
    async def pinned(*args):
        return 'rel-v1-977bce7f8dab7e773955238e'
    monkeypatch.setattr(read.core, 'current_user', user)
    monkeypatch.setattr(read.core, 'pool', pool)
    monkeypatch.setattr(read, 'pinned', pinned)
    monkeypatch.setattr(read, 'counter', lambda *a, **k: 0)
    app = FastAPI()
    app.include_router(read.router)
    return TestClient(app)


@pytest.mark.parametrize('registry', [None,
    {'state': 'validated', 'delivery': 'r2-worker-v1'},
    {'state': 'building', 'delivery': 'r2-worker-v1'},
    {'state': 'retired', 'delivery': 'legacy'}])
@pytest.mark.parametrize('direction', ['EN', 'UZ'])
def test_missing_index_fails_closed_without_reading_legacy(monkeypatch, registry, direction):
    con = Connection(registry)
    response = client(monkeypatch, con).get('/api/dictionary/search', params={'q': 'quality', 'direction': direction})
    assert response.status_code == 503 and response.json() == {'error': 'temporarily_unavailable'}
    assert response.headers['cache-control'] == 'private, no-store'
    assert con.legacy_reads == 0
    with pytest.raises(ValueError, match='dictionary_worker_unavailable'):
        asyncio.run(owner.search(con, 'quality', direction, 'release'))
    assert con.legacy_reads == 0


@pytest.mark.parametrize('direction', ['EN', 'UZ'])
def test_validated_legacy_fallback_remains_compatible(monkeypatch, direction):
    con = Connection({'state': 'validated', 'delivery': 'legacy'})
    assert client(monkeypatch, con).get('/api/dictionary/search', params={'q': 'quality', 'direction': direction}).status_code == 200
    assert asyncio.run(owner.search(con, 'quality', direction, 'release')) == []
    assert con.legacy_reads == 2


@pytest.mark.parametrize('direction', ['EN', 'UZ'])
def test_worker_happy_path_does_not_add_a_database_query(monkeypatch, direction):
    con = Connection(None, {'directory': {'name': 'directory'}})
    async def worker(body):
        return {'release_id': body['release'], 'results': []}
    monkeypatch.setattr(read, 'worker', worker)
    monkeypatch.setattr(owner, 'worker', worker)
    assert client(monkeypatch, con).get('/api/dictionary/search', params={'q': 'quality', 'direction': direction}).status_code == 200
    assert asyncio.run(owner.search(con, 'quality', direction, 'release')) == []
    assert con.registry_reads == con.legacy_reads == 0


def test_worker_release_mismatch_is_not_hidden_by_sql_fallback(monkeypatch):
    con = Connection(None, {'directory': {'name': 'directory'}})
    async def worker(body):
        return {'release_id': 'wrong', 'results': []}
    monkeypatch.setattr(read, 'worker', worker)
    response = client(monkeypatch, con).get('/api/dictionary/search?q=quality')
    assert response.status_code == 503 and con.legacy_reads == 0


class RetentionConnection(Connection):
    async def fetchrow(self, sql, *args):
        if 'retention_attempts' in sql:
            return {'body_text':'fair','retention_text_version_id':'version'}
        return await super().fetchrow(sql,*args)

    async def fetch(self, sql, *args):
        if 'lexical_occurrences' in sql:return []
        return await super().fetch(sql,*args)


def retention_lookup(monkeypatch,con):
    async def active(*args):return {'active_release_id':'release'}
    monkeypatch.setattr(retention,'active_release',active)
    retention._cache.clear()
    return asyncio.run(retention.lookup(con,{'id':'user'},'attempt','fair',0,4))


@pytest.mark.parametrize('registry',[None,
    {'state':'validated','delivery':'r2-worker-v1'},
    {'state':'building','delivery':'legacy'},
    {'state':'retired','delivery':'legacy'}])
def test_retention_missing_worker_index_cannot_read_legacy(monkeypatch,registry):
    con=RetentionConnection(registry)
    with pytest.raises(ValueError,match='dictionary_worker_unavailable'):
        retention_lookup(monkeypatch,con)
    assert con.legacy_reads==0


def test_retention_explicit_validated_legacy_stays_compatible(monkeypatch):
    con=RetentionConnection({'state':'validated','delivery':'legacy'})
    assert retention_lookup(monkeypatch,con)['contextual'] is None
    assert con.legacy_reads==con.registry_reads==1


@pytest.mark.parametrize('directory',[None,{'name':'directory'}])
def test_retention_worker_path_and_absent_route_never_use_legacy(monkeypatch,directory):
    con=RetentionConnection(None,{'directory':directory})
    async def worker(body):return {'release_id':body['release'],'results':[]}
    monkeypatch.setattr(retention,'worker',worker)
    assert retention_lookup(monkeypatch,con)['contextual'] is None
    assert con.legacy_reads==con.registry_reads==0


def test_retention_passes_word_and_existing_candidates_to_context_selection(monkeypatch):
    con=RetentionConnection(None,{'directory':{'name':'directory'}})
    ident='11111111-1111-4111-8111-111111111111'
    sense={'sense_id':'unchanged-sense','definition_en':'An event where goods are sold.',
           'definition_uz':'Yarmarka.','translations':[{'text':'yarmarka'}]}
    original={'lexeme_id':ident,'display_lemma':'fair','part_of_speech':'noun','senses':[sense]}
    async def worker(body):return {'release_id':body['release'],'results':[{'lexeme_id':ident,'match_type':'exact_lemma'}]}
    async def entry(*args):return original
    async def choose(sentence,word,candidates):
        assert sentence=='[[fair]]' and word=='fair'
        assert candidates==[{'entry':original,'sense':sense}]
        return candidates[0]
    monkeypatch.setattr(retention,'worker',worker)
    monkeypatch.setattr(retention,'entry',entry)
    monkeypatch.setattr(retention,'select_sense',choose)
    value=retention_lookup(monkeypatch,con)
    assert value['contextual']['definitionEn']==sense['definition_en']
    assert value['contextual']['translationUz']==sense['definition_uz']
    assert value['contextual']['dictionary']=={'lexemeId':ident,'senseId':'unchanged-sense','releaseId':'release'}
    assert original['senses']==[sense] and con.registry_reads==con.legacy_reads==0
