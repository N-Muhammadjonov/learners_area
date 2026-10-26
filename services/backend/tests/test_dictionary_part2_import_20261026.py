"""Safety and content checks for the approved, bounded Part 2 import."""
import copy
import asyncio
import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from app import main as core
from app.step39_dictionary_publish import apply_draft, content_hash
from app.step40_dictionary_storage import decode_shard, encode_shard

MODULE = Path(__file__).parents[1] / 'app' / 'dictionary_part2_import_20261026.py'
spec = importlib.util.spec_from_file_location('app.dictionary_part2_import_20261026', MODULE)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


def source():
    _, additions, retained = subject.load_plan()
    return additions, retained


@pytest.mark.parametrize('env,expected', [
    ({'APP_ENV': 'production', 'PUBLIC_BASE_URL': 'https://learnersarea.uz'}, True),
    ({'NODE_ENV': 'production', 'PUBLIC_BASE_URL': 'https://learnersarea.uz/'}, True),
    ({'APP_ENV': 'preview', 'NODE_ENV': 'production', 'PUBLIC_BASE_URL': 'https://learnersarea.uz'}, False),
    ({'APP_ENV': 'development', 'PUBLIC_BASE_URL': 'https://learnersarea.uz'}, False),
    ({'APP_ENV': 'production', 'PUBLIC_BASE_URL': 'https://preview.example.com'}, False),
    ({'APP_ENV': 'production', 'PUBLIC_BASE_URL': 'http://learnersarea.uz'}, False),
    ({'APP_ENV': 'production', 'PUBLIC_BASE_URL': 'https://user@learnersarea.uz'}, False),
    ({'APP_ENV': 'production', 'PUBLIC_BASE_URL': 'https://learnersarea.uz/another'}, False),
    ({'APP_ENV': 'production', 'PUBLIC_BASE_URL': 'https://learnersarea.uz?redirect=1'}, False),
    ({}, False),
])
def test_only_the_approved_production_origin_can_start(env, expected):
    assert subject.production_target(env) is expected


def test_source_rejects_modified_file(tmp_path):
    changed = tmp_path / 'changed.json'
    changed.write_bytes(subject.SOURCE.read_bytes() + b' ')
    with pytest.raises(ValueError, match='approved_source_checksum_mismatch'):
        subject.load_plan(changed)


def test_all_118_additions_have_complete_bilingual_payloads_and_stable_ids():
    additions, retained = source()
    release = subject.candidate_id(additions)
    first = subject.prepare_additions(additions, release)
    second = subject.prepare_additions(additions, release)
    assert first == second and len(first) == 118 and len(retained) == 5
    assert len({e['normalized_search_form'] for e in first.values()}) == 118
    for e in first.values():
        sense = e['senses'][0]
        assert sense['definition_en'] and sense['definition_uz']
        assert sense['translations'][0]['text']
        assert sense['examples'][0]['text_en'] and sense['examples'][0]['text_uz']
        assert sense['editorial']['translation_status'] == 'ai_draft'
    by_lemma = {e['display_lemma']: e for e in first.values()}
    assert by_lemma['noise-cancelling']['part_of_speech'] == 'adjective'
    assert by_lemma['powerbank']['forms'][0]['surface_form'] == 'power bank'


def test_rewriting_a_shard_preserves_existing_content_and_identity():
    additions, _ = source()
    release = subject.candidate_id(additions)
    old = apply_draft([], {
        'operation': 'add_lexeme', 'lemma': 'existing example', 'partOfSpeech': 'noun',
        'lexicalType': 'noun_phrase', 'definitionEn': 'an earlier example',
        'translationUz': 'avvalgi misol', 'definitionUz': 'Oldin keltirilgan misol.',
        'examples': [{'textEn': 'This is an earlier example.', 'textUz': 'Bu avvalgi misol.'}],
    }, subject.BASE)
    before = copy.deepcopy(old)
    selected = next(iter(subject.prepare_additions(additions, release).values()))
    # The native encoder requires a shard to contain one prefix.
    old['lexeme_id'] = selected['lexeme_id'][:2] + old['lexeme_id'][2:]
    before = copy.deepcopy(old)
    merged = subject.merge_shard([old], [selected], release)
    assert old == before
    assert content_hash(merged[0]) == content_hash(before)
    assert merged[0]['senses'] == before['senses']
    body, descriptor, _ = encode_shard(release, merged, packed=True)
    restored = decode_shard(release, descriptor, body)
    assert {e['lexeme_id'] for e in restored} == {old['lexeme_id'], selected['lexeme_id']}
    with pytest.raises(ValueError, match='approved_identity_collision'):
        subject.merge_shard([selected], [selected], release)


class Preflight:
    """Only models preflight state; a failed stage must not reach activation."""
    def __init__(self, capacity=100_000_000):
        additions, _ = source()
        self.owner = uuid.UUID('11111111-1111-4111-8111-111111111111')
        self.drafts = [
            {'id': uuid.uuid4(), 'changes': r['changes'], 'base_release_id': subject.BASE}
            for r in additions[:100]
        ]
        self.capacity = capacity
        self.commands = []

    async def fetchval(self, sql, *args):
        if 'SELECT metadata' in sql:
            return None
        if 'SELECT active_release_id' in sql:
            return subject.BASE
        if 'FROM users' in sql:
            return 1
        if 'dictionary_publish_jobs' in sql:
            return None
        if 'lemma_norm=ANY' in sql:
            return None
        if 'dictionary_entries WHERE release_id' in sql:
            return 1
        raise AssertionError(sql)

    async def fetch(self, sql, *args):
        if 'DISTINCT d.owner_user_id' in sql:
            return [{'owner_user_id': self.owner}]
        if 'SELECT d.id,d.changes' in sql:
            return self.drafts
        if 'dictionary_r2_shards' in sql:
            if 'SELECT shard,descriptor' in sql:
                return []
            return [{'descriptor': {'shard': 'aa', 'entries': 1}}]
        if 'GROUP BY left(lexeme_id' in sql:
            return []
        raise AssertionError(sql)

    async def fetchrow(self, sql, *args):
        if 'pg_database_size' in sql:
            return {'bytes': self.capacity, 'entry_bytes': 1000, 'total_rows': 1,
                    'base_rows': 1, 'candidate_rows': 0}
        if 'SELECT base_release_id,state' in sql:
            return {'base_release_id': subject.BASE, 'state': 'building',
                    'delivery': 'r2-worker-v1', 'created_by': self.owner}
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        self.commands.append(sql)
        return 'INSERT 0 1'


@pytest.mark.asyncio
async def test_capacity_failure_does_not_create_candidate_or_activate():
    con = Preflight(499_999_999)
    with pytest.raises(ValueError, match='dictionary_capacity_exceeded'):
        await subject.publish_approved(con)
    assert not any('INSERT INTO dictionary_releases' in q for q in con.commands)
    assert not any('UPDATE dictionary_channels' in q for q in con.commands)


@pytest.mark.asyncio
async def test_r2_failure_keeps_stable_channel_and_drafts_unchanged(monkeypatch):
    con = Preflight()

    async def fail_read(*args):
        raise ValueError('dictionary_shard_checksum_mismatch')

    async def write_ok(*args):
        return {}

    async def claim_ok(*args):
        return None

    monkeypatch.setattr(subject, 'read_shard', fail_read)
    monkeypatch.setattr(subject, 'write_shard', write_ok)
    monkeypatch.setattr(subject, 'claim_job', claim_ok)
    with pytest.raises(ValueError, match='dictionary_shard_checksum_mismatch'):
        await subject.publish_approved(con)
    assert not any('UPDATE dictionary_channels' in q for q in con.commands)
    assert not any("SET state='published'" in q for q in con.commands)


@pytest.mark.asyncio
async def test_changed_draft_is_rejected_before_any_candidate_write():
    con = Preflight()
    con.drafts[0]['changes'] = {**con.drafts[0]['changes'], 'lemma': 'unapproved change'}
    with pytest.raises(ValueError, match='approved_draft_set_changed'):
        await subject.publish_approved(con)
    assert con.commands == []


@pytest.mark.asyncio
async def test_worker_validation_rejects_missing_entry(monkeypatch):
    async def wrong(*args):
        return {'release_id': 'rel-v1-' + 'a' * 24, 'results': []}

    monkeypatch.setattr(subject, 'worker', wrong)
    with pytest.raises(ValueError, match='approved_import_search_validation_failed'):
        await subject.verify_worker('rel-v1-' + 'a' * 24, {'routes': {'EN:p': {'name': 'directory'}}},
                                    [('powerbank', 'missing')])


@pytest.mark.asyncio
async def test_expired_lease_is_rejected_even_for_the_active_owner():
    token = subject.LEASE.set((subject.JOB_ID, uuid.uuid4()))
    try:
        with pytest.raises(ValueError, match='approved_import_lease_lost'):
            await subject.authority(Preflight(), Preflight().owner)
    finally:
        subject.LEASE.reset(token)


@pytest.mark.asyncio
async def test_worker_checks_all_123_candidates_with_bounded_concurrency(monkeypatch):
    targets = [('powerbank ' + str(i), str(uuid.uuid4())) for i in range(123)]
    expected = dict(targets)
    active = 0
    peak = 0

    async def found(request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return {'release_id': request['release'],
                'results': [{'lexeme_id': expected[request['query']]}]}

    monkeypatch.setattr(subject, 'worker', found)
    assert await subject.verify_worker('rel-v1-' + 'a' * 24,
                                      {'routes': {'EN:p': {'name': 'directory'}}}, targets) == 123
    assert peak == 4


@pytest.mark.asyncio
async def test_new_server_takes_over_after_the_previous_import_lease(monkeypatch):
    class ConnectionContext:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *args):
            return False

    class Pool:
        def acquire(self):
            return ConnectionContext()

    calls = 0
    waits = []

    async def fake_pool():
        return Pool()

    async def publish(con):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise subject.ImportRunning()
        return {'added': 118}

    async def pause(seconds):
        waits.append(seconds)

    monkeypatch.setattr(subject, 'pool', fake_pool)
    monkeypatch.setattr(subject, 'publish_approved', publish)
    monkeypatch.setattr(subject.asyncio, 'sleep', pause)
    await subject.run_approved_import()
    assert calls == 2 and waits == [10]
