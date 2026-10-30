"""Request-contract checks for five source-equivalent Speaking catalogue read routes."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from app import main as core
from app.speaking_catalog_port import (_b64, parse_prompt_cursor, parse_topic_cursor,
                                       _study_support, utf16_slice)
from test_migration_phase2 import FakePool

client = TestClient(core.app)
UID = UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
PROMPT = UUID('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
DATE = '2026-10-22T12:12:12.670005Z'


def prompt_row(i=0, *, full=False):
    row = dict(id=PROMPT, part='part1', topic='Family', promptText=f'Question {i}',
               cueCard='Intro', prepSeconds=30, answerSeconds=90,
               externalId=f'P1-{i:04}', createdAtText=DATE)
    if full:
        row.update(category='part1', followUps=[], studySupport={}, sourceClass=None,
                   availableIn=['practice_alone'], isActive=False, publicationState='published',
                   publishAt=None, createdAt=datetime(2026, 10, 22, tzinfo=timezone.utc))
    return row


class SpeakingDB:
    def __init__(self):
        self.calls = []
        self.page = []
        self.parts = []
        self.topics = []
        self.total = 0
        self.matching = 0
        self.support = None
        self.full = []

    async def __aenter__(self): return self
    async def __aexit__(self, *exc): return False

    async def fetch(self, sql, *args):
        self.calls.append(('fetch', sql, args))
        if 'GROUP BY p.part' in sql: return self.parts
        if 'GROUP BY CASE' in sql: return self.topics
        if 'study_support AS "studySupport"' in sql and 'ORDER BY p.part ASC, p.created_at' in sql: return self.full
        return self.page

    async def fetchrow(self, sql, *args):
        self.calls.append(('fetchrow', sql, args))
        return self.support

    async def fetchval(self, sql, *args):
        self.calls.append(('fetchval', sql, args))
        return self.total if 'count(DISTINCT' in sql else self.matching


def setup(monkeypatch, db, signed=True):
    async def user(req, active=False):
        return {'id': UID, 'role': 'student', 'account_status': 'active'} if signed else None
    async def pool(): return FakePool(db)
    monkeypatch.setattr(core, 'current_user', user)
    monkeypatch.setattr(core, 'pool', pool)


def test_speaking_all_prompts_source_shape_and_filter(monkeypatch):
    db = SpeakingDB()
    db.full = [prompt_row(0, full=True), dict(prompt_row(1, full=True), part='part2')]
    setup(monkeypatch, db)
    result = client.get('/api/speaking/prompts?part=part2')
    assert result.status_code == 200
    assert len(result.json()['prompts']) == 1
    assert result.json()['prompts'][0]['part'] == 'part2'
    assert result.json()['prompts'][0]['isActive'] is False  # not a visibility predicate
    query = db.calls[0][1]
    assert "p.publication_state='published'" in query
    assert "p.publish_at <= $1" in query and "CONTENT_DELETED" in query
    assert 'p.study_support AS "studySupport"' in query
    assert result.json()['prompts'][0]['createdAt'] == '2026-10-22T00:00:00.000Z'


def test_unauthenticated_catalogue_never_reads_database(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db, signed=False)
    for url in ('/api/speaking/prompts', '/api/speaking/practice/questions',
                '/api/speaking/practice/facets', '/api/speaking/live-partner/questions',
                f'/api/speaking/prompts/{PROMPT}/support'):
        result = client.get(url)
        assert result.status_code == 401 and result.json() == {'error': 'unauthenticated'}
    assert db.calls == []


def test_channel_is_refused_on_practice_not_silently_coerced(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    for route in ('questions', 'facets'):
        result = client.get(f'/api/speaking/practice/{route}?channel=live_partner')
        assert result.status_code == 400 and result.json() == {'error': 'invalid_channel'}
    assert db.calls == []


def test_paged_questions_has_total_order_and_no_heavy_study_support(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    db.page = [prompt_row(i) for i in range(101)]
    db.matching = 257
    result = client.get('/api/speaking/practice/questions?channel=ai&part=part1&topic=family&q=  work  ')
    assert result.status_code == 200
    data = result.json()
    assert len(data['prompts']) == 100 and data['hasMore'] is True
    assert data['pageSize'] == 100 and data['matching'] == 257
    assert 'studySupport' not in data['prompts'][0]
    cursor = parse_prompt_cursor(data['nextCursor'])
    assert cursor[0] == 'part1' and cursor[3] == DATE and cursor[2] == 'P1-0099'
    sql, args = db.calls[0][1:]
    assert 'LIMIT 101' in sql and 'ORDER BY p.part' in sql
    assert "'[\"ai\"]'::jsonb" in sql and "'practice_alone'" not in sql
    assert '%work%' in args and 'family' in args
    count_sql, count_args = db.calls[1][1:]
    assert 'count(*)::int' in count_sql and 'LIMIT' not in count_sql
    assert count_args == args


def test_keyset_cursor_includes_postgres_microseconds(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    cursor = _b64(['part1', False, 'P1-0040', DATE, str(PROMPT)])
    response = client.get('/api/speaking/practice/questions', params={'cursor': cursor})
    assert response.status_code == 200
    q, args = db.calls[0][1:]
    assert '::timestamptz' in q and 'p.id) >' in q
    assert args[-5:] == ('part1', False, 'P1-0040', DATE, str(PROMPT)) or args[-5:] == ['part1', False, 'P1-0040', DATE, str(PROMPT)]
    assert response.json()['hasMore'] is False and response.json()['nextCursor'] is None
    count_args = db.calls[1][2]
    assert len(count_args) == 1  # cursor never changes the total matching count


def test_invalid_cursor_refused_not_silent_restart(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    for text in ('!', 'a', '', _b64(['part1', False]), _b64(['invalid', False, '', DATE, str(PROMPT)]),
                 _b64(['part1', False, '', 'wrong date', str(PROMPT)])):
        r = client.get('/api/speaking/practice/questions', params={'cursor': text})
        assert r.status_code == 400 and r.json() == {'error': 'invalid_cursor'}
    assert db.calls == []


def test_live_partner_can_page_500_rows_and_uses_shared_channel(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    db.page = [prompt_row(i) for i in range(501)]
    db.matching = 888
    response = client.get('/api/speaking/live-partner/questions?q=  family ')
    data = response.json()
    assert data['pageSize'] == 500 and len(data['questions']) == 500
    assert data['hasMore'] and data['matching'] == 888
    assert set(data['questions'][0]) == {'id', 'part', 'topic', 'promptText', 'cueCard'}
    q, args = db.calls[0][1:]
    assert 'LIMIT 501' in q and 'p.available_in' in q
    assert '"live_partner"' in q and '"practice_alone"' in q
    assert '%family%' in args


def test_facets_empty_part_does_not_fetch_topics(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    db.parts = [{'part': 'part1', 'count': 7}, {'part': 'part2', 'count': 3}]
    data = client.get('/api/speaking/practice/facets').json()
    assert data == {'parts': db.parts, 'topics': [], 'topicCount': 0,
                    'hasMoreTopics': False, 'nextTopicCursor': None, 'matching': 10}
    assert len(db.calls) == 1


def test_facets_deterministic_topics_and_unpaginated_count(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    db.parts = [{'part': 'part1', 'count': 1000}]
    db.topics = [{'key': f'key-{i:03d}', 'title': f'Topic {i}', 'count': 2}
                 for i in range(501)]
    db.total = 565
    data = client.get('/api/speaking/practice/facets?part=part1').json()
    assert len(data['topics']) == 500 and data['topicCount'] == 565
    assert data['hasMoreTopics'] is True and parse_topic_cursor(data['nextTopicCursor']) == 'key-499'
    q, args = db.calls[1][1:]
    assert 'GROUP BY CASE' in q and "min(nullif(btrim(p.topic), ''))" in q
    assert args[-1] == 'part1'
    assert 'count(DISTINCT' in db.calls[2][1]


def test_facets_invalid_cursor_refused_after_parts_query(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    r = client.get('/api/speaking/practice/facets', params={'part':'part1','topicCursor':'invalid'})
    assert r.status_code == 400 and r.json() == {'error': 'invalid_cursor'}
    assert len(db.calls) == 1


def test_facets_topic_cursor_does_not_shrink_total_count(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    db.total = 920
    r = client.get('/api/speaking/practice/facets', params={'part':'part2', 'topicCursor':_b64({'k':'lesson'})})
    assert r.status_code == 200 and r.json()['topicCount'] == 920
    assert ' > $3' in db.calls[1][1]
    assert len(db.calls[2][2]) == 2  # part scoping, NOT topic cursor


def test_prompt_support_valid_defaults_and_channel(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    db.support = {'id': PROMPT, 'studySupport': {'vocabulary': [{'term': '  reflect ', 'definitionEn': ' Think '}]}}
    r = client.get(f'/api/speaking/prompts/{PROMPT}/support?channel=ai')
    assert r.status_code == 200
    assert r.json()['promptId'] == str(PROMPT)
    assert r.json()['support'] == {'vocabularyHtml':'', 'modelAnswerHtml':'', 'ideasHtml':'', 'vocabulary': [
        {'term':'reflect','definitionEn':'Think','translationUz':'','partOfSpeech':'','exampleSentence':''}]}
    assert '"ai"' in db.calls[0][1]
    assert r.headers['cache-control'] == 'no-store'


def test_missing_and_bad_prompt_support_not_misreported(monkeypatch):
    db = SpeakingDB(); setup(monkeypatch, db)
    route = f'/api/speaking/prompts/{PROMPT}/support'
    assert client.get(route).status_code == 404
    for invalid in ({'studySupport': {'vocabulary': [{'term': '', 'definitionEn':'ok'}]}, 'id': PROMPT},
                    {'studySupport': {'modelAnswerHtml': None}, 'id': PROMPT},
                    {'studySupport': {'vocabulary': ['not an object']}, 'id': PROMPT}):
        db.support = invalid
        r = client.get(route)
        assert r.status_code == 502 and r.json() == {'error': 'invalid_study_support'}


def test_utf16_query_slice_and_study_support_zod_limit():
    assert utf16_slice(' abc ', 2) == 'ab'
    assert utf16_slice('🙌'*61, 120) == '🙌'*60
    assert _study_support({'vocabulary':[],'unknown':'ignore'}) == {
        'vocabularyHtml':'','modelAnswerHtml':'','ideasHtml':'','vocabulary':[]}
    assert _study_support({'ideasHtml':'x'*100001}) is None
