"""Speaking source saves: owned destinations, complete folders and safe re-saves."""
import asyncio
import json
from pathlib import Path
from uuid import UUID
from unittest.mock import AsyncMock
import pytest
from starlette.requests import Request
from app import main as core
from app import step21_sourced_vocab as source
from app import step21_vocab_batch as batch
from test_migration_phase2 import FakePool
from test_video_vocabulary_folders import Connection, USER, FOLDER, ENTRY

PROMPT = UUID(int=60)
WORDS = [dict(term='bustling', definitionEn='full of busy activity', translationUz='gavjum'),
         dict(term='historic', definitionEn='important in history', translationUz='tarixiy')]


class SpeakingDB:
    def __init__(self, part='part1', owned=True, support=None, published=True):
        self.part, self.owned, self.published = part, owned, published
        self.support = {'vocabulary': WORDS} if support is None else support
        self.calls = []
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False
    def transaction(self): return self
    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        if 'FROM speaking_prompts' in sql:
            assert 'CONTENT_DELETED' in sql
            return dict(id=PROMPT, part=self.part, publication_state='published' if self.published else 'draft',
                        publish_at=None, available_in=['practice_alone'], prompt_text='An original question?',
                        study_support=self.support)
        if 'FROM vocab_folders' in sql:
            assert args == (FOLDER, USER)
            return dict(id=FOLDER, name='My words') if self.owned else None
        if 'INSERT INTO vocab_folders' in sql:
            return dict(id=FOLDER, name=args[1])
        if 'FROM users' in sql: return dict(id=USER)
        raise AssertionError(sql)


def save(monkeypatch, db, body):
    monkeypatch.setattr(core, 'pool', AsyncMock(return_value=FakePool(db)))
    monkeypatch.setattr(core, 'current_user', AsyncMock(return_value={'id': USER}))
    monkeypatch.setattr(core, 'payload', AsyncMock(return_value={'promptId': str(PROMPT), **body}))
    add = AsyncMock(return_value=dict(ok=True, added=2, duplicates=0, ids=[str(ENTRY)], moved=0))
    monkeypatch.setattr(source, 'add_batch', add)
    response = asyncio.run(source.prompt_vocabulary(Request({'type': 'http', 'method': 'POST', 'path': '/', 'headers': []})))
    return response, add


@pytest.mark.parametrize('part', ['part1', 'part2', 'part3'])
@pytest.mark.parametrize('indices', [[0], [0, 1]])
def test_single_and_all_saves_use_owned_folder_and_exact_source_words(monkeypatch, part, indices):
    db = SpeakingDB(part)
    response, add = save(monkeypatch, db, dict(indices=indices, folderId=str(FOLDER)))
    assert response.status_code == 200
    assert json.loads(response.body)['folder'] == dict(id=str(FOLDER), userId=str(USER), name='My words')
    assert 'no-store' in response.headers['cache-control']
    assert add.call_args.args[2] == [dict(WORDS[i], authored=True) for i in indices]
    assert add.call_args.kwargs == dict(folder_id=FOLDER, source_type='speaking', source_id=PROMPT, move_existing=True)
    assert not any('INSERT INTO vocab_folders' in sql for sql, _ in db.calls)


def test_new_folder_is_trimmed_and_reused_by_owned_name(monkeypatch):
    db = SpeakingDB()
    response, add = save(monkeypatch, db, dict(indices=[0, 1], folderName='  Speaking practice  '))
    assert response.status_code == 200
    sql, args = next(c for c in db.calls if 'INSERT INTO vocab_folders' in c[0])
    assert 'ON CONFLICT(user_id,name)' in sql and args == (USER, 'Speaking practice')
    assert add.call_args.kwargs['move_existing'] is True


def test_default_folder_still_saves_the_complete_selection(monkeypatch):
    db = SpeakingDB()
    response, add = save(monkeypatch, db, dict(indices=[0, 1]))
    assert response.status_code == 200
    assert json.loads(response.body)['folder']['name'] == 'An original question?'
    assert len(add.call_args.args[2]) == 2


def test_foreign_folder_is_refused_before_any_word_write(monkeypatch):
    db = SpeakingDB(owned=False)
    response, add = save(monkeypatch, db, dict(indices=[0], folderId=str(FOLDER)))
    assert response.status_code == 404 and json.loads(response.body)['error'] == 'folder_not_found'
    add.assert_not_awaited()
    assert not any('INSERT' in sql for sql, _ in db.calls)


@pytest.mark.parametrize('destination', [dict(folderId='bad'), dict(folderName=' '),
    dict(folderName='x' * 81), dict(folderName=[]), dict(folderId=str(FOLDER), folderName='Both')])
def test_invalid_destinations_do_not_touch_the_database(monkeypatch, destination):
    db = SpeakingDB()
    response, add = save(monkeypatch, db, dict(indices=[0], **destination))
    assert response.status_code == 400 and not db.calls
    add.assert_not_awaited()


@pytest.mark.parametrize('support', [{}, {'vocabulary': [{'term': None, 'definitionEn': 'meaning'}]},
    {'vocabulary': [{'term': 'word', 'definitionEn': 'meaning', 'translationUz': None}]}])
def test_bad_stored_support_is_a_controlled_error_without_empty_folder(monkeypatch, support):
    db = SpeakingDB(support=support)
    response, add = save(monkeypatch, db, dict(indices=[0]))
    assert response.status_code == 409
    add.assert_not_awaited()
    assert not any('INSERT' in sql for sql, _ in db.calls)


def test_unpublished_source_cannot_create_a_folder(monkeypatch):
    db = SpeakingDB(published=False)
    response, add = save(monkeypatch, db, dict(indices=[0]))
    assert response.status_code == 404
    add.assert_not_awaited()


def test_resaving_moves_an_owned_existing_word_without_resetting_learning_progress():
    db = Connection()
    response = asyncio.run(batch.add_batch(db, USER, [WORDS[0]], source_type='speaking',
                                         source_id=PROMPT, folder_id=FOLDER, move_existing=True))
    assert response['added'] == 0 and response['duplicates'] == 1 and response['moved'] == 1
    assert response['ids'] == [str(ENTRY)]
    writes = [(sql, args) for sql, args in db.calls if 'UPDATE user_vocabulary' in sql]
    assert len(writes) == 1 and writes[0][1] == (USER, str(ENTRY), FOLDER)
    sql = writes[0][0]
    assert 'user_id=$1' in sql and 'folder_id IS DISTINCT FROM $3' in sql
    assert all(x not in sql for x in ['srs_stage=', 'mastery=', 'next_review_at=', 'lexeme_id='])


def test_imported_part1_has_all_source_support_and_priority_topics_without_labels():
    rows = json.loads((Path(__file__).resolve().parents[1] / 'assets/speaking/part1_206.json').read_text())
    topics = sorted({r['topic'] for r in rows})
    assert len(rows) == len({r['externalId'] for r in rows}) == 831 and len(topics) == 206
    priority = {r['topic'] for r in rows if r['studySupport']['sourceNew']}
    assert len(priority) == 37 and set(topics[:37]) == priority
    assert sum(len(r['studySupport']['vocabulary']) for r in rows) == 8310
    assert all(r['part'] == 'part1' and r['availableIn'] == ['practice_alone'] for r in rows)
    assert all('[NEW]' not in r['topic'] and '[NEW]' not in r['promptText'] for r in rows)
    assert all(r['studySupport']['ideasHtml'] and r['studySupport']['modelAnswerHtml']
               and len(r['studySupport']['vocabulary']) == 10 for r in rows)
