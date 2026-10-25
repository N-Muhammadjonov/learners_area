"""Owner-dictionary edit boundary, validation, and advisory transaction tests."""
from contextlib import asynccontextmanager
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from app.step27_dictionary_edit import draft_schema, apply_validation

UID='11111111-1111-4111-8111-111111111111'


def test_strict_schema_cases():
    assert draft_schema({'operation':'add_lexeme','lemma':'write','partOfSpeech':'v','lexicalType':'word',
          'definitionEn':'compose text','translationUz':'yozmoq','definitionUz':'matn tuzish'})['examples']==[]
    assert draft_schema({'operation':'edit_sense','lexemeId':UID,'senseId':UID,'translationUz':'olma'})
    assert draft_schema({'operation':'edit_sense','lexemeId':UID,'senseId':UID,'translationUz':'яблоко'}) is None
    assert draft_schema({'operation':'edit_sense','lexemeId':UID,'senseId':UID,'unexpected':1}) is None
    assert draft_schema({'operation':'add_sense','lexemeId':UID,'definitionEn':'x','translationUz':'x','definitionUz':'x','examples':[{'textUz':'x'}]}) is None


def test_apply_conflicts():
    import pytest
    with pytest.raises(ValueError,match='duplicate_lexeme'):
        apply_validation([{'display_lemma':'Test','part_of_speech':'noun','lexical_type':'word'}],
                         {'operation':'add_lexeme','lemma':'test','partOfSpeech':'n','lexicalType':'word'})
    with pytest.raises(ValueError,match='entry_not_found'):
        apply_validation([],{ 'operation':'add_sense','lexemeId':UID,'definitionEn':'test'})


def test_access_and_validation_before_db(monkeypatch):
    called=[]
    async def none(*a,**k):return None
    async def owner(*a,**k):return {'id':UUID(UID),'role':'owner','account_status':'active'}
    async def pool():called.append(1);raise AssertionError('must not reach DB')
    monkeypatch.setattr(core,'pool',pool)
    client=TestClient(core.app)
    monkeypatch.setattr(core,'current_user',none)
    assert client.patch('/api/owner/dictionary/drafts/'+UID,json={'operation':'x'}).status_code==403
    monkeypatch.setattr(core,'current_user',owner)
    assert client.patch('/api/owner/dictionary/random').status_code==404
    assert client.patch('/api/owner/dictionary/drafts/'+UID,json={}).status_code==400
    assert called==[]
