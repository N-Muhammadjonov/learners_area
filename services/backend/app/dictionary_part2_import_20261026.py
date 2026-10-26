"""One approved Part 2 dictionary append, using the existing immutable R2 pipeline.

No route, credential, Worker or bucket is created. This maintenance task is
limited to the reviewed source checksum and base release. It checkpoints work,
keeps the stable channel unchanged until all checks pass, and is safe to retry.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import time
import uuid
from contextvars import ContextVar
from pathlib import Path

from .db import pool
from .dictionary_canonical import stable
from .step17_dictionary_read_port import normalize_search, worker
from .step27_dictionary_edit import draft_schema
from .step39_dictionary_publish import apply_draft, content_hash, make_manifest
from .step40_dictionary_index import build_index
from .step40_dictionary_storage import (
    manifest_key, put_immutable, read_shard, validate_entry,
    verify_release_objects, write_shard,
)

LOG = logging.getLogger(__name__)
SOURCE_ID = 'libfile_c67d5096ccb48191b38c6677e7e694ab'
BASE = 'rel-v1-cfadf47e87701f627f3270ce'
SOURCE_SHA = 'fa88431ed60cf7b14cd2a41d2a9f3d969d2e927bc61217c9ec704a8bd1c4bbae'
SOURCE = Path(__file__).with_name('dictionary_part2_candidates_20261026.json')
EVENT_ID = uuid.uuid5(uuid.NAMESPACE_URL, 'learners-area:dictionary-import:' + SOURCE_ID)
JOB_ID = uuid.uuid5(uuid.NAMESPACE_URL, 'learners-area:dictionary-import-job:' + SOURCE_ID)
LOCK_ID = 387384
LEASE = ContextVar('approved_dictionary_lease', default=None)
PULSE = ContextVar('approved_dictionary_pulse', default=None)
ALIASES = {
    'penalty shootout': ['penalty shoot-out'],
    'powerbank': ['power bank'],
    'box ticking': ['box-ticking'],
}


def load_plan(path=SOURCE):
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != SOURCE_SHA:
        raise ValueError('approved_source_checksum_mismatch')
    plan = json.loads(body)
    if (plan['source']['libraryFileId'] != SOURCE_ID
            or plan['production']['baseRelease'] != BASE
            or len(plan['records']) != 123):
        raise ValueError('approved_source_identity_mismatch')
    additions = [r for r in plan['records'] if r['decision'] == 'add_lexeme']
    retained = [r for r in plan['records'] if r['decision'] == 'retain_existing']
    if len(additions) != 118 or len(retained) != 5:
        raise ValueError('approved_source_count_mismatch')
    keys = set()
    for record in additions:
        c = draft_schema(record['changes'])
        if c is None or c['operation'] != 'add_lexeme':
            raise ValueError('approved_source_schema_invalid')
        key = normalize_search(c['lemma'])
        if key in keys:
            raise ValueError('approved_source_duplicate')
        keys.add(key)
        if len(c['examples']) != 1 or not c['examples'][0]['textUz']:
            raise ValueError('approved_example_missing')
    return plan, additions, retained


def prepare_additions(additions, release):
    result = {}
    for record in additions:
        value = apply_draft([], record['changes'], release)
        value['forms'] = [
            {'surface_form': text, 'form_type': 'spelling_variant'}
            for text in ALIASES.get(value['display_lemma'], [])
        ]
        value['senses'][0]['editorial'] = {
            'status': 'owner_supplied',
            'translation_status': 'ai_draft',
            'reference_urls': [record['referenceUrl']] if record.get('referenceUrl') else [],
            'provenance': 'part2-candidates-20261026',
        }
        validate_entry(value)
        if value['lexeme_id'] in result:
            raise ValueError('approved_identity_collision')
        result[value['lexeme_id']] = value
    return result


def merge_shard(original, additions, release):
    """Preserve every existing identity and English/Uzbek meaning."""
    result = {}
    for entry in original:
        value = {**entry, 'release_id': release}
        if value['lexeme_id'] in result:
            raise ValueError('base_shard_duplicate')
        result[value['lexeme_id']] = value
    for value in additions:
        if value['lexeme_id'] in result:
            raise ValueError('approved_identity_collision')
        result[value['lexeme_id']] = value
    return list(result.values())


def candidate_id(additions):
    content = {'base': BASE, 'source': SOURCE_ID, 'sourceSha': SOURCE_SHA,
               'transform': 'part2-approved-v1',
               'changes': [r['changes'] for r in additions]}
    return 'rel-v1-' + hashlib.sha256(stable(content).encode()).hexdigest()[:24]


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


class ImportRunning(Exception):
    pass


async def pulse_lease(owner, token, stopped):
    """Transaction-pooler-safe authority lease, shared with the existing publisher."""
    db = await pool()
    while not stopped.is_set():
        try:
            async with db.acquire() as con:
                result = await con.execute(
                    """UPDATE dictionary_publish_jobs j SET worker_lease_until=NOW()+interval '90 seconds',
                    updated_at=NOW() FROM users u,dictionary_channels c
                    WHERE j.id=$1 AND j.worker_lease_token=$2 AND j.phase='worker_index'
                    AND u.id=j.owner_user_id AND u.id=$3 AND u.role='owner' AND u.account_status='active'
                    AND c.name='stable' AND c.active_release_id=j.base_release_id""",
                    JOB_ID, token, owner)
            if result != 'UPDATE 1':
                return
        except Exception:
            return
        try:
            await asyncio.wait_for(stopped.wait(), timeout=10)
        except TimeoutError:
            pass


async def claim_job(con, owner, candidate, drafts):
    token = uuid.uuid4()
    async with con.transaction():
        await con.execute('SELECT pg_advisory_xact_lock($1)', LOCK_ID)
        await authority(con, owner)
        other = await con.fetchval(
            """SELECT 1 FROM dictionary_publish_jobs WHERE id<>$1
            AND phase NOT IN ('complete','failed') LIMIT 1""", JOB_ID)
        if other:
            raise ValueError('publish_already_running')
        await con.execute(
            """INSERT INTO dictionary_releases(id,base_release_id,state,created_by,delivery)
            VALUES($1,$2,'building',$3,'r2-worker-v1') ON CONFLICT(id) DO NOTHING""",
            candidate, BASE, owner)
        claimed = await con.fetchval(
            """INSERT INTO dictionary_publish_jobs(id,owner_user_id,base_release_id,
            candidate_release_id,draft_ids,phase,worker_lease_token,worker_lease_until)
            VALUES($1,$2,$3,$4,$5::uuid[],'worker_index',$6,NOW()+interval '90 seconds')
            ON CONFLICT(id) DO UPDATE SET phase='worker_index',error=NULL,
            worker_lease_token=EXCLUDED.worker_lease_token,
            worker_lease_until=EXCLUDED.worker_lease_until,updated_at=NOW()
            WHERE dictionary_publish_jobs.owner_user_id=EXCLUDED.owner_user_id
            AND dictionary_publish_jobs.base_release_id=EXCLUDED.base_release_id
            AND dictionary_publish_jobs.candidate_release_id=EXCLUDED.candidate_release_id
            AND dictionary_publish_jobs.phase IN ('worker_index','failed')
            AND (dictionary_publish_jobs.worker_lease_until IS NULL
                 OR dictionary_publish_jobs.worker_lease_until<NOW())
            RETURNING id""",
            JOB_ID, owner, BASE, candidate, [d['id'] for d in drafts], token)
        if not claimed:
            raise ImportRunning()
    LEASE.set((JOB_ID, token))
    stopped = asyncio.Event()
    PULSE.set((asyncio.create_task(pulse_lease(owner, token, stopped)), stopped))


async def progress(con, owner, candidate, status, **extra):
    metadata = {
        'sourceLibraryFileId': SOURCE_ID, 'sourceSha256': SOURCE_SHA,
        'baseRelease': BASE, 'candidateRelease': candidate, 'status': status,
        **extra,
    }
    await con.execute(
        """INSERT INTO audit_log(id,actor_user_id,action,target_type,target_id,metadata)
        VALUES($1,$2,'DICTIONARY_PART2_IMPORT','dictionary_release',$3,$4::jsonb)
        ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata""",
        EVENT_ID, owner, candidate, json.dumps(metadata, ensure_ascii=False))


async def authority(con, owner):
    active = await con.fetchval(
        "SELECT active_release_id FROM dictionary_channels WHERE name='stable'")
    valid = await con.fetchval(
        "SELECT 1 FROM users WHERE id=$1 AND role='owner' AND account_status='active'", owner)
    if active != BASE or not valid:
        raise ValueError('approved_import_authority_changed')
    lease = LEASE.get()
    if lease and not await con.fetchval(
            """SELECT 1 FROM dictionary_publish_jobs WHERE id=$1
            AND worker_lease_token=$2 AND worker_lease_until>NOW() AND phase='worker_index'""", *lease):
        raise ValueError('approved_import_lease_lost')


async def verify_worker(candidate, descriptor, targets):
    """Check all 123 exact English searches and all 118 appended payloads."""
    semaphore = asyncio.Semaphore(4)

    async def check(lemma, ident):
        async with semaphore:
            initial = 'EN:' + normalize_search(lemma)[0]
            directory = descriptor['routes'].get(initial) or descriptor['routes'].get('EN:*')
            if not directory:
                raise ValueError('approved_import_route_missing')
            response = await worker({
                'action': 'search', 'release': candidate, 'directory': directory,
                'query': lemma, 'direction': 'EN'})
            if (response.get('release_id') != candidate
                    or not any(r.get('lexeme_id') == ident for r in response.get('results', []))):
                raise ValueError('approved_import_search_validation_failed')

    await asyncio.gather(*(check(lemma, ident) for lemma, ident in targets))
    return len(targets)


async def publish_approved(con):
    done = decoded(await con.fetchval('SELECT metadata FROM audit_log WHERE id=$1', EVENT_ID))
    if done and done.get('status') == 'complete':
        return done
    plan, additions, retained = load_plan()
    candidate = candidate_id(additions)
    owners = await con.fetch(
        """SELECT DISTINCT d.owner_user_id FROM dictionary_drafts d
        JOIN dictionary_owner_events e ON e.entity_id=d.id::text
        JOIN users u ON u.id=d.owner_user_id
        WHERE e.validation_result->'import'->>'libraryFileId'=$1
        AND d.state='draft' AND u.role='owner' AND u.account_status='active'""", SOURCE_ID)
    if len(owners) != 1:
        raise ValueError('approved_draft_owner_unavailable')
    owner = owners[0]['owner_user_id']
    await authority(con, owner)
    if await con.fetchval(
            """SELECT 1 FROM dictionary_publish_jobs WHERE id<>$1
            AND phase NOT IN ('complete','failed') LIMIT 1""", JOB_ID):
        raise ValueError('publish_already_running')
    drafts = await con.fetch(
        """SELECT d.id,d.changes,d.base_release_id FROM dictionary_drafts d
        JOIN dictionary_owner_events e ON e.entity_id=d.id::text
        WHERE e.validation_result->'import'->>'libraryFileId'=$1
        AND d.owner_user_id=$2 AND d.state='draft' ORDER BY d.created_at,d.id""",
        SOURCE_ID, owner)
    approved = {stable(r['changes']) for r in additions}
    if (len(drafts) != 100 or len({d['id'] for d in drafts}) != 100
            or any(d['base_release_id'] != BASE or stable(decoded(d['changes'])) not in approved for d in drafts)):
        raise ValueError('approved_draft_set_changed')
    if await con.fetchval(
            """SELECT 1 FROM dictionary_entries WHERE release_id=$1 AND lemma_norm=ANY($2::text[])
            LIMIT 1""", BASE, [normalize_search(r['changes']['lemma']) for r in additions]):
        raise ValueError('approved_lexeme_now_exists')
    for record in retained:
        for old in record['existing']:
            if not await con.fetchval(
                    "SELECT 1 FROM dictionary_entries WHERE release_id=$1 AND lexeme_id=$2 AND lemma_norm=$3",
                    BASE, uuid.UUID(old['id']), normalize_search(record['changes']['lemma'])):
                raise ValueError('retained_lexeme_changed')

    before = await con.fetchrow(
        """SELECT pg_database_size(current_database()) bytes,
        pg_total_relation_size('dictionary_entries') entry_bytes,
        (SELECT count(*) FROM dictionary_entries) total_rows,
        (SELECT count(*) FROM dictionary_entries WHERE release_id=$1) base_rows,
        (SELECT count(*) FROM dictionary_entries WHERE release_id=$2) candidate_rows""", BASE, candidate)
    if not 0 < before['base_rows'] <= 100000:
        raise ValueError('dictionary_index_identity_budget')
    quota = float(os.getenv('DICTIONARY_DATABASE_LIMIT_BYTES') or '500000000')
    remaining = max(0, before['base_rows'] + 118 - before['candidate_rows'])
    projected = before['bytes'] + math.ceil(
        before['entry_bytes'] / max(1, before['total_rows']) * remaining) + 25000000
    if not math.isfinite(quota) or projected > quota:
        await progress(con, owner, candidate, 'capacity_blocked', projectedBytes=projected)
        raise ValueError('dictionary_capacity_exceeded')

    await claim_job(con, owner, candidate, drafts)
    target = await con.fetchrow(
        "SELECT base_release_id,state,delivery,created_by FROM dictionary_releases WHERE id=$1", candidate)
    if (target['base_release_id'] != BASE or target['state'] != 'building'
            or target['delivery'] != 'r2-worker-v1' or target['created_by'] != owner):
        raise ValueError('approved_candidate_conflict')
    new = prepare_additions(additions, candidate)
    descriptors = [decoded(r['descriptor']) for r in await con.fetch(
        "SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 ORDER BY shard", BASE)]
    by_prefix = {d['shard']: d for d in descriptors}
    if sum(d['entries'] for d in descriptors) != before['base_rows']:
        raise ValueError('base_shard_inventory_mismatch')
    prefixes = sorted(set(by_prefix) | {ident[:2] for ident in new})
    await progress(con, owner, candidate, 'shards', completed=0, total=len(prefixes))

    for i, prefix in enumerate(prefixes):
        await authority(con, owner)
        old = await read_shard(BASE, by_prefix[prefix]) if prefix in by_prefix else []
        merged = merge_shard(old, [e for ident, e in new.items() if ident[:2] == prefix], candidate)
        await write_shard(con, merged, False)
        if (i + 1) % 8 == 0 or i + 1 == len(prefixes):
            await progress(con, owner, candidate, 'shards', completed=i + 1, total=len(prefixes))

    bad = await con.fetchval(
        """SELECT count(*) FROM dictionary_entries b
        LEFT JOIN dictionary_entries n ON n.release_id=$2 AND n.lexeme_id=b.lexeme_id
        WHERE b.release_id=$1 AND (n.lexeme_id IS NULL
          OR n.content_sha IS DISTINCT FROM b.content_sha OR n.lemma_norm IS DISTINCT FROM b.lemma_norm
          OR n.part_of_speech IS DISTINCT FROM b.part_of_speech OR n.lexical_type IS DISTINCT FROM b.lexical_type
          OR n.sense_ids IS DISTINCT FROM b.sense_ids OR n.example_ids IS DISTINCT FROM b.example_ids)""",
        BASE, candidate)
    count = await con.fetchval('SELECT count(*) FROM dictionary_entries WHERE release_id=$1', candidate)
    if bad or count != before['base_rows'] + 118:
        raise ValueError('existing_dictionary_content_changed')
    offloaded = await con.fetchval(
        """SELECT count(*) FROM dictionary_entries WHERE release_id=$1
        AND (payload IS NOT NULL OR storage_release IS DISTINCT FROM $1 OR storage_shard IS NULL)""",
        candidate)
    if offloaded:
        raise ValueError('candidate_not_fully_offloaded')
    rows = await con.fetch(
        'SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1 ORDER BY lemma_norm,lexeme_id', candidate)
    order = {str(r['lexeme_id']): i for i, r in enumerate(rows)}
    candidate_shards = [decoded(r['descriptor']) for r in await con.fetch(
        'SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 ORDER BY shard', candidate)]
    last_beat = 0

    async def heartbeat():
        nonlocal last_beat
        await authority(con, owner)
        if time.monotonic() - last_beat >= 5:
            await progress(con, owner, candidate, 'index', entries=count)
            last_beat = time.monotonic()

    await heartbeat()
    index = await build_index(candidate, candidate_shards, order, heartbeat)
    await con.execute(
        """INSERT INTO dictionary_search_indexes(release_id,descriptor) VALUES($1,$2::jsonb)
        ON CONFLICT(release_id) DO UPDATE SET descriptor=EXCLUDED.descriptor""",
        candidate, json.dumps(index, ensure_ascii=False))
    manifest = await make_manifest(con, candidate)
    await put_immutable(manifest_key(candidate), stable(manifest).encode())
    await progress(con, owner, candidate, 'verification', entries=count)
    await verify_release_objects(candidate, manifest)

    targets = [(r['changes']['lemma'], apply_draft([], r['changes'], candidate)['lexeme_id'])
               for r in additions]
    targets.extend((r['changes']['lemma'], old['id']) for r in retained for old in r['existing'])
    checked = await verify_worker(candidate, index, targets)
    # R2 checksum verification and the metadata hashes establish exact payload identity.
    for ident, value in new.items():
        row = await con.fetchrow(
            "SELECT content_sha,sense_ids,example_ids FROM dictionary_entries WHERE release_id=$1 AND lexeme_id=$2",
            candidate, uuid.UUID(ident))
        if (not row or row['content_sha'] != content_hash(value)
                or [str(v) for v in row['sense_ids']] != [s['sense_id'] for s in value['senses']]
                or [str(v) for v in row['example_ids']] !=
                [e['example_id'] for s in value['senses'] for e in s['examples']]):
            raise ValueError('new_dictionary_content_changed')

    async with con.transaction():
        await authority(con, owner)
        lease = LEASE.get()
        if not lease or not await con.fetchval(
                """SELECT 1 FROM dictionary_publish_jobs WHERE id=$1 AND worker_lease_token=$2
                AND phase='worker_index' AND worker_lease_until>NOW() FOR UPDATE""", *lease):
            raise ValueError('approved_import_lease_lost')
        await con.execute(
            """UPDATE dictionary_releases SET state='validated',manifest=$2::jsonb,
            manifest_sha=$3,validated_at=NOW() WHERE id=$1 AND state='building'""",
            candidate, json.dumps(manifest, ensure_ascii=False),
            hashlib.sha256(stable(manifest).encode()).hexdigest())
        changed = await con.execute(
            """UPDATE dictionary_channels SET previous_release_id=active_release_id,
            active_release_id=$1,updated_at=NOW() WHERE name='stable' AND active_release_id=$2""",
            candidate, BASE)
        if changed != 'UPDATE 1':
            raise ValueError('release_mismatch')
        await con.execute(
            """UPDATE dictionary_drafts SET state='published',result_release_id=$1,updated_at=NOW()
            WHERE id=ANY($2::uuid[]) AND state='draft'""", candidate, [d['id'] for d in drafts])
        draft_values = {stable(decoded(d['changes'])) for d in drafts}
        # The second bounded group is recorded as published only inside activation.
        for record in additions:
            if stable(record['changes']) in draft_values:
                continue
            draft_id = await con.fetchval(
                """INSERT INTO dictionary_drafts(owner_user_id,base_release_id,changes,state,result_release_id)
                VALUES($1,$2,$3::jsonb,'published',$4) RETURNING id""",
                owner, BASE, json.dumps(record['changes'], ensure_ascii=False), candidate)
            await con.execute(
                """INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,
                result_release_id,after_state,validation_result)
                VALUES($1,'add_lexeme',$2,$3,$4,$5::jsonb,$6::jsonb)""",
                owner, str(draft_id), BASE, candidate,
                json.dumps(record['changes'], ensure_ascii=False),
                json.dumps({'pass': True, 'import': {
                    'libraryFileId': SOURCE_ID, 'sourceNumber': record['sourceNumber'], 'batch': 2}}))
        await con.execute(
            """INSERT INTO dictionary_owner_events(owner_user_id,operation,base_release_id,
            candidate_release_id,result_release_id,validation_result)
            VALUES($1,'activate_release',$2,$3,$3,$4::jsonb)""",
            owner, BASE, candidate, json.dumps({
                'pass': True, 'sourceLibraryFileId': SOURCE_ID, 'added': 118, 'retained': 5,
                'exactSearchChecks': checked, 'preservedExisting': before['base_rows']}))
        await progress(con, owner, candidate, 'complete', added=118, retained=5,
                       entries=count, exactSearchChecks=checked,
                       preservedExisting=before['base_rows'])
        await con.execute(
            """UPDATE dictionary_publish_jobs SET phase='complete',error=NULL,
            worker_lease_token=NULL,worker_lease_until=NULL,updated_at=NOW()
            WHERE id=$1 AND worker_lease_token=$2""", *lease)
    LOG.info('Approved Part 2 dictionary import complete: added=118 retained=5 release=%s', candidate)
    return {'candidate': candidate, 'added': 118, 'retained': 5}


async def run_approved_import():
    """Temporary deployment hook; no public endpoint and no credentials in source."""
    try:
        db = await pool()
        async with db.acquire() as con:
            async with asyncio.timeout(2700):
                await publish_approved(con)
    except ImportRunning:
        LOG.info('Approved dictionary import is already running')
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # Do not print exception text: provider errors can include connection data.
        LOG.error('Approved dictionary import stopped (%s)', type(exc).__name__)
        message = str(exc)
        error_code = message if (len(message) <= 100 and message.replace('_', '').isascii()
                                and message.replace('_', '').isalpha()) else type(exc).__name__
        try:
            db = await pool()
            async with db.acquire() as con:
                lease = LEASE.get()
                if lease:
                    await con.execute(
                        """UPDATE dictionary_publish_jobs SET phase='failed',error=$3,
                        worker_lease_token=NULL,worker_lease_until=NULL,updated_at=NOW()
                        WHERE id=$1 AND worker_lease_token=$2""", *lease, error_code)
                row = decoded(await con.fetchval('SELECT metadata FROM audit_log WHERE id=$1', EVENT_ID))
                if row and lease and row.get('status') != 'complete':
                    row.update(status='failed', errorType=type(exc).__name__, errorCode=error_code)
                    await con.execute('UPDATE audit_log SET metadata=$2::jsonb WHERE id=$1',
                                      EVENT_ID, json.dumps(row))
        except Exception:
            LOG.error('Approved dictionary import could not save its status')
    finally:
        pulse = PULSE.get()
        if pulse:
            task, stopped = pulse
            stopped.set()
            await task
        PULSE.set(None)
        LEASE.set(None)
