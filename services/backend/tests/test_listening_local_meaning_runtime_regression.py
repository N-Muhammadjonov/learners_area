"""Regression: test-local word definitions must not replace Listening runtime config."""
import asyncio
import json
from uuid import UUID

from starlette.requests import Request
from app import step21_listening_authored_reads as route
from app import listening_review_access, listening_runtime


TEST_ID = UUID('e44e3d4b-3af6-41a9-b465-7d4bc21e1019')
USER_ID = UUID('11111111-1111-4111-8111-111111111111')


class FakeAcquire:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *args):
        return False


class FakePool:
    def acquire(self):
        return FakeAcquire()


def request():
    return Request({
        'type': 'http',
        'method': 'GET',
        'path': f'/api/listening/full/{TEST_ID}/authored',
        'query_string': b'',
        'headers': [],
    })


def install(monkeypatch, meanings):
    async def current_user(*args, **kwargs):
        return {'id': USER_ID, 'role': 'owner'}

    async def pool():
        return FakePool()

    async def get_context(*args, **kwargs):
        return ({
            'source_id': 'listening-test-32',
            'audio_object_key': 'listening/academic/test-32/full.mp3',
            'image_object_key': None,
            'payload': {
                'title': 'Listening Test 32',
                'sections': [
                    {'transcript': 'offered food'},
                    {'transcript': ''},
                    {'transcript': ''},
                    {'transcript': ''},
                ],
                'contextualMeanings': meanings,
                'audio': {'path': 'audio/full.mp3'},
            },
        }, None)

    async def exam_gate(*args, **kwargs):
        return False, None

    monkeypatch.setattr(route.core, 'current_user', current_user)
    monkeypatch.setattr(route.core, 'pool', pool)
    monkeypatch.setattr(route, 'get_context', get_context)
    monkeypatch.setattr(listening_review_access, 'exam_gate', exam_gate)
    monkeypatch.setattr(listening_runtime, 'runtime', lambda number: {'fixture': number})
    monkeypatch.setitem(route.CATALOGUE, 'listening-test-32', {
        'number': 32,
        'storageKey': 'la_listening_test_32_v2',
        'media': [
            {'path': 'audio/full.mp3',
             'objectKey': 'listening/academic/test-32/full.mp3',
             'contentType': 'audio/mpeg'},
        ],
    })


def test_listening_authored_loads_with_embedded_word_meaning(monkeypatch):
    install(monkeypatch, [{
        'part': 1,
        'start': 0,
        'end': 7,
        'surface': 'offered',
        'occurrenceId': '22222222-2222-4222-8222-222222222222',
        'definitionEn': 'to present something for someone to accept',
        'translationUz': 'taklif qilmoq',
        'partOfSpeech': 'verb',
    }])
    response = asyncio.run(route.authored(request(), str(TEST_ID)))
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body['storageKey'] == 'la_listening_test_32_v2'
    assert body['audioPath'] == 'audio/full.mp3'
    assert body['runtime'] == {'fixture': 32}
    assert body['contextualOccurrences'] == [{
        'part': 1,
        'start': 0,
        'end': 7,
        'surface': 'offered',
        'occurrenceId': '22222222-2222-4222-8222-222222222222',
        'definitionEn': 'to present something for someone to accept',
        'translationUz': 'taklif qilmoq',
        'partOfSpeech': 'verb',
    }]


def test_listening_authored_loads_without_optional_meanings(monkeypatch):
    install(monkeypatch, [])
    response = asyncio.run(route.authored(request(), str(TEST_ID)))
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body['storageKey'] == 'la_listening_test_32_v2'
    assert body['audioPath'] == 'audio/full.mp3'
    assert body['contextualOccurrences'] == []
