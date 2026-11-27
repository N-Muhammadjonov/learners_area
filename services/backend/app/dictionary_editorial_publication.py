"""Publish the pinned editorial batches using the normal immutable dictionary release."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from . import step40_dictionary_index as index_tools
from .db import pool
from .dictionary_canonical import stable
from .dictionary_editorial_apply import apply_entry
from .request_lifecycle import WorkBusy
from .step17_dictionary_read_port import normalize_search, worker
from .step39_dictionary_publish import LOCK, content_hash, make_manifest
from .step40_dictionary_storage import (
    SHARD_LIMIT, checksum, index_key, manifest_key, put_immutable, read_immutable,
    read_shard, validate_entry, write_shard,
)

LOG = logging.getLogger("uvicorn.error")
BASE = "rel-v1-1fa06d8d41d8ff701632573e"
PLAN = (('2026-11-27-batch-01.json', '40e9af84932faed70308a930c4e6abf9768cec68f4bea1bd2efa533a2e2f3844'), ('2026-11-27-batch-02.json', '794273825aaf429f46d8a298c5563a9c683daafcb54e5777f1c7410cbb250c52'))
LEASE_SECONDS = 120
MAX_INDEX_UPLOADS = 3


def production_target(env):
    mode = env.get("APP_ENV") or env.get("VERCEL_ENV") or env.get("NODE_ENV")
    if mode != "production":
        return False
    origin = urlsplit(env.get("PUBLIC_BASE_URL", "").strip())
    return (origin.scheme == "https" and origin.netloc in {"learnersarea.uz", "learnersarea.uz:443"}
            and origin.path in ("", "/") and not origin.query and not origin.fragment)


def load_plan():
    changes = {}
    for filename, expected in PLAN:
        path = Path(__file__).with_name("data") / filename
        body = path.read_bytes()
        if checksum(body) != expected:
            raise ValueError("editorial_plan_checksum_mismatch")
        batch = json.loads(body)
        if batch["schema_version"] != 1 or batch["base_release_id"] != BASE:
            raise ValueError("editorial_plan_base_mismatch")
        for change in batch["entries"]:
            ident = change["lexeme_id"]
            if str(uuid.UUID(ident)) != ident or ident in changes:
                raise ValueError("editorial_plan_duplicate_target")
            changes[ident] = change
    if not changes:
        raise ValueError("editorial_plan_empty")
    digest = checksum(stable({"base": BASE, "batches": [value for _, value in PLAN]}).encode())
    return "rel-v1-" + digest[:24], changes


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


async def retry_work(operation, *args):
    for attempt in range(6):
        try:
            return await operation(*args)
        except WorkBusy as error:
            if str(error) == "worker_draining" or attempt == 5:
                raise
            await asyncio.sleep(0.25 * (attempt + 1))


class IndexWriter:
    def __init__(self):
        self.pending = set()
        self.semaphore = asyncio.Semaphore(MAX_INDEX_UPLOADS)

    async def __aenter__(self):
        return self

    async def __aexit__(self, error_type, error, traceback):
        if error is not None:
            for task in self.pending:
                task.cancel()
            await asyncio.gather(*self.pending, return_exceptions=True)
        else:
            await self.drain()

    async def write(self, release, name, payload):
        _, descriptor = index_tools.encode(name, payload)

        async def upload():
            async with self.semaphore:
                actual = await retry_work(index_tools.write_index_object, release, name, payload)
                descriptor.clear()
                descriptor.update(actual)

        self.pending.add(asyncio.create_task(upload()))
        if len(self.pending) >= MAX_INDEX_UPLOADS * 2:
            finished, self.pending = await asyncio.wait(self.pending, return_when=asyncio.FIRST_COMPLETED)
            results = await asyncio.gather(*finished, return_exceptions=True)
            for result in results:
                if isinstance(result, BaseException):
                    raise result
        return descriptor

    async def drain(self):
        if self.pending:
            pending = set(self.pending)
            results = await asyncio.gather(*pending, return_exceptions=True)
            self.pending.difference_update(pending)
            for result in results:
                if isinstance(result, BaseException):
                    raise result


async def shard_reader(release, descriptions):
    for start in range(0, len(descriptions), 2):
        batch = descriptions[start:start + 2]
        records = await asyncio.gather(*(retry_work(read_shard, release, desc) for desc in batch))
        for desc, entries in zip(batch, records):
            yield desc, entries


class LeaseUnavailable(Exception):
    pass


async def claim(con, release, job, token):
    async with con.transaction():
        await con.execute(LOCK)
        active = await con.fetchval("SELECT active_release_id FROM dictionary_channels WHERE name='stable'")
        if active == release:
            return None
        if active != BASE:
            raise ValueError("editorial_base_release_changed")
        owners = await con.fetch("SELECT id FROM users WHERE role='owner' AND account_status='active' LIMIT 2")
        if len(owners) != 1:
            raise ValueError("editorial_owner_unavailable")
        owner = owners[0]["id"]
        if await con.fetchval(
            "SELECT 1 FROM dictionary_drafts WHERE base_release_id=$1 AND state='draft' LIMIT 1", BASE
        ):
            raise ValueError("editorial_pending_owner_drafts")
        if await con.fetchval(
            "SELECT 1 FROM dictionary_publish_jobs WHERE id<>$1 AND phase NOT IN ('complete','failed') LIMIT 1", job
        ):
            raise ValueError("editorial_other_publish_running")
        sizes = await con.fetchrow(
            """SELECT pg_database_size(current_database()) AS bytes,
            pg_total_relation_size('dictionary_entries') AS entry_bytes,
            (SELECT count(*) FROM dictionary_entries) AS total_rows,
            (SELECT count(*) FROM dictionary_entries WHERE release_id=$1) AS base_rows,
            (SELECT count(*) FROM dictionary_entries WHERE release_id=$2) AS candidate_rows""",
            BASE, release, timeout=60,
        )
        quota = float(os.getenv("DICTIONARY_DATABASE_LIMIT_BYTES") or "500000000")
        estimated = sizes["bytes"] + 25_000_000 + math.ceil(
            sizes["entry_bytes"] / max(sizes["total_rows"], 1)
            * max(sizes["base_rows"] - sizes["candidate_rows"], 0)
        )
        if not 0 < sizes["base_rows"] <= 100_000 or not math.isfinite(quota) or estimated > quota:
            raise ValueError("dictionary_capacity_exceeded")
        await con.execute(
            """INSERT INTO dictionary_releases(id,base_release_id,state,created_by,delivery)
            VALUES($1,$2,'building',$3,'r2-worker-v1') ON CONFLICT(id) DO NOTHING""", release, BASE, owner
        )
        candidate = await con.fetchrow(
            "SELECT base_release_id,state,delivery,created_by FROM dictionary_releases WHERE id=$1", release
        )
        if (candidate["base_release_id"] != BASE or candidate["state"] != "building"
                or candidate["delivery"] != "r2-worker-v1" or candidate["created_by"] != owner):
            raise ValueError("editorial_candidate_conflict")
        acquired = await con.fetchval(
            """INSERT INTO dictionary_publish_jobs(id,owner_user_id,base_release_id,candidate_release_id,
            draft_ids,phase,worker_lease_token,worker_lease_until)
            VALUES($1,$2,$3,$4,ARRAY[]::uuid[],'worker_index',$5,NOW()+make_interval(secs=>$6::float8))
            ON CONFLICT(id) DO UPDATE SET phase='worker_index',error=NULL,updated_at=NOW(),
            worker_lease_token=EXCLUDED.worker_lease_token,worker_lease_until=EXCLUDED.worker_lease_until
            WHERE dictionary_publish_jobs.owner_user_id=EXCLUDED.owner_user_id
            AND dictionary_publish_jobs.base_release_id=EXCLUDED.base_release_id
            AND dictionary_publish_jobs.candidate_release_id=EXCLUDED.candidate_release_id
            AND dictionary_publish_jobs.phase IN ('worker_index','failed')
            AND (dictionary_publish_jobs.worker_lease_until IS NULL OR dictionary_publish_jobs.worker_lease_until<NOW())
            RETURNING id""", job, owner, BASE, release, token, float(LEASE_SECONDS)
        )
        if not acquired:
            raise LeaseUnavailable()
        await con.execute(
            """INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,
            candidate_release_id,validation_result) VALUES($1,'publish_started',$2,$3,$4,$5::jsonb)""",
            owner, str(job), BASE, release, json.dumps({"pass": True, "editorialBatches": len(PLAN)})
        )
    return owner, sizes["base_rows"]


async def heartbeat(con, job, token):
    valid = await con.fetchval(
        """UPDATE dictionary_publish_jobs j SET
        worker_lease_until=NOW()+make_interval(secs=>$3::float8),updated_at=NOW()
        FROM users u, dictionary_channels c
        WHERE j.id=$1 AND j.worker_lease_token=$2 AND j.worker_lease_until>NOW()
        AND j.phase='worker_index' AND u.id=j.owner_user_id AND u.role='owner'
        AND u.account_status='active' AND c.name='stable' AND c.active_release_id=j.base_release_id
        RETURNING j.id""", job, token, float(LEASE_SECONDS)
    )
    if not valid:
        raise ValueError("editorial_publish_authority_changed")


async def build_shards(con, release, targets, base_count, pulse):
    descriptions = [decoded(row["descriptor"]) for row in await con.fetch(
        "SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 ORDER BY shard", BASE
    )]
    if len(descriptions) != 256 or sum(desc["entries"] for desc in descriptions) != base_count:
        raise ValueError("editorial_base_inventory_mismatch")
    checkpoints = {row["shard"]: decoded(row["descriptor"]) for row in await con.fetch(
        "SELECT shard,descriptor FROM dictionary_r2_shards WHERE release_id=$1", release
    )}
    edited_prefixes = {ident[:2] for ident in targets}
    # The same content-addressed candidate resumes its committed shards. The
    # catalogue comparison and full R2 verification still cover every shard.
    remaining = [desc for desc in descriptions if desc["shard"] not in checkpoints or desc["shard"] in edited_prefixes]
    targets_found = {}
    async for desc, entries in shard_reader(BASE, remaining):
        pref = desc["shard"]
        existing = checkpoints.get(pref)
        for entry in entries:
            ident = entry["lexeme_id"]
            if ident in targets:
                apply_entry(entry, targets[ident])
                validate_entry(entry)
                targets_found[ident] = entry
            entry["release_id"] = release
        if existing:
            checkpoint = await retry_work(read_shard, release, existing)
            if checkpoint != entries:
                raise ValueError("editorial_checkpoint_content_mismatch")
        else:
            async with con.transaction():
                await retry_work(write_shard, con, entries, False)
        await pulse()
        if int(pref, 16) % 16 == 15:
            LOG.info("Dictionary editorial shards: %d/256", int(pref, 16) + 1)

    if targets_found.keys() != targets.keys():
        raise ValueError("editorial_targets_missing")
    return targets_found


async def verify_catalogue(con, release, base_count, edited):
    ids = [uuid.UUID(key) for key in edited]
    unchanged_faults = await con.fetchval(
        """SELECT count(*) FROM dictionary_entries b
        LEFT JOIN dictionary_entries n ON n.release_id=$2 AND n.lexeme_id=b.lexeme_id
        WHERE b.release_id=$1 AND (n.lexeme_id IS NULL
        OR n.storage_release IS DISTINCT FROM $2 OR n.storage_shard IS NULL OR n.payload IS NOT NULL
        OR n.lemma_norm IS DISTINCT FROM b.lemma_norm OR n.part_of_speech IS DISTINCT FROM b.part_of_speech
        OR n.lexical_type IS DISTINCT FROM b.lexical_type OR
        (b.lexeme_id<>ALL($3::uuid[]) AND
          (n.content_sha IS DISTINCT FROM b.content_sha OR n.sense_ids IS DISTINCT FROM b.sense_ids
           OR n.example_ids IS DISTINCT FROM b.example_ids)))""", BASE, release, ids, timeout=60
    )
    sizes = await con.fetchrow(
        """SELECT count(*) AS entries, sum(cardinality(sense_ids)) AS senses,
        sum(cardinality(example_ids)) AS examples FROM dictionary_entries WHERE release_id=$1""", release
    )
    if unchanged_faults or sizes["entries"] != base_count:
        raise ValueError("editorial_candidate_inventory_changed")
    rows = await con.fetch(
        """SELECT lexeme_id,content_sha,sense_ids,example_ids FROM dictionary_entries
        WHERE release_id=$1 AND lexeme_id=ANY($2::uuid[])""", release, ids
    )
    if len(rows) != len(edited):
        raise ValueError("editorial_targets_missing")
    for row in rows:
        entry = edited[str(row["lexeme_id"])]
        if (row["content_sha"] != content_hash(entry)
                or [str(v) for v in row["sense_ids"]] != [s["sense_id"] for s in entry["senses"]]
                or [str(v) for v in row["example_ids"]] != [
                    e["example_id"] for s in entry["senses"] for e in s["examples"]]):
            raise ValueError("editorial_candidate_target_mismatch")
    return dict(sizes)


async def verify_objects(release, manifest, pulse):
    async def check(desc):
        raw = await retry_work(read_immutable, index_key(release, desc["name"]), desc["compressed_bytes"])
        if len(raw) != desc["compressed_bytes"] or checksum(raw) != desc["sha256"]:
            raise ValueError("editorial_index_checksum_mismatch")

    async for _, _entries in shard_reader(release, manifest["storage"]["shards"]):
        await pulse()
    descriptors = manifest["storage"]["search"]["objects"]
    for start in range(0, len(descriptors), MAX_INDEX_UPLOADS):
        await asyncio.gather(*(check(desc) for desc in descriptors[start:start + MAX_INDEX_UPLOADS]))
        await pulse()
    body = await retry_work(read_immutable, manifest_key(release), SHARD_LIMIT)
    if body != stable(manifest).encode():
        raise ValueError("editorial_manifest_checksum_mismatch")


async def verify_search_and_entries(con, release, index, edited, pulse):
    async def check(query, direction, ident):
        norm = normalize_search(query)
        route = index["routes"].get(direction + ":" + norm[0], index["directory"])
        result = await worker({
            "action": "search", "release": release, "directory": route,
            "query": query, "direction": direction,
        })
        if result.get("release_id") != release or not any(
            item.get("lexeme_id") == ident for item in result.get("results", [])
        ):
            raise ValueError("editorial_worker_search_failed")

    examples = []
    shards = {}
    for ident, entry in edited.items():
        examples.append((entry["display_lemma"], "EN", ident))
        if entry["normalized_search_form"] == "degree":
            examples.append(("oliy ta’lim darajasi", "UZ", ident))
        prefix = ident[:2]
        if prefix not in shards:
            shards[prefix] = decoded(await con.fetchval(
                "SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 AND shard=$2", release, prefix
            ))
        row = await con.fetchrow(
            """SELECT storage_offset, storage_length, storage_raw_bytes, content_sha
            FROM dictionary_entries WHERE release_id=$1 AND lexeme_id=$2""", release, uuid.UUID(ident)
        )
        response = await worker({
            "action": "entry", "release": release, "lexemeId": ident, "shard": shards[prefix],
            "range": {"offset": row["storage_offset"], "length": row["storage_length"],
                      "raw_bytes": row["storage_raw_bytes"]},
            "contentSha": row["content_sha"],
        })
        if response.get("entry") != entry:
            raise ValueError("editorial_worker_entry_failed")
        await pulse()
    for start in range(0, len(examples), 4):
        await asyncio.gather(*(check(*args) for args in examples[start:start + 4]))
        await pulse()


async def activate(con, release, job, token, owner, manifest, edited, changes, sizes):
    translated_senses = {
        edit["sense_id"] for change in changes.values() for edit in change["edits"]
        if "translations_uz" in edit
    }
    translations = [
        {"sense_id": sense["sense_id"], "translation": sense["translations"][0]["text"]}
        for entry in edited.values() for sense in entry["senses"]
        if sense["sense_id"] in translated_senses
    ]
    async with con.transaction():
        await con.execute(LOCK)
        await heartbeat(con, job, token)
        if await con.fetchval(
            "SELECT 1 FROM dictionary_drafts WHERE base_release_id=$1 AND state='draft' LIMIT 1", BASE
        ):
            raise ValueError("editorial_pending_owner_drafts")
        result = await con.execute(
            """UPDATE dictionary_releases SET state='validated',manifest=$2::jsonb,manifest_sha=$3,
            validated_at=NOW() WHERE id=$1 AND state='building'""",
            release, stable(manifest), checksum(stable(manifest).encode())
        )
        if result != "UPDATE 1":
            raise ValueError("editorial_candidate_not_building")
        result = await con.execute(
            """UPDATE dictionary_channels SET active_release_id=$1,previous_release_id=$2,updated_at=NOW()
            WHERE name='stable' AND active_release_id=$2""", release, BASE
        )
        if result != "UPDATE 1":
            raise ValueError("editorial_base_release_changed")
        await con.execute(
            """UPDATE lexemes l SET translation_uz=x.translation
            FROM jsonb_to_recordset($1::jsonb) x(sense_id uuid,translation text)
            JOIN dictionary_sense_mappings m ON m.sense_id=x.sense_id
            WHERE l.id=m.app_sense_id AND l.translation_uz IS DISTINCT FROM x.translation""",
            json.dumps(translations, ensure_ascii=False)
        )
        await con.execute(
            """INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,
            candidate_release_id,result_release_id,validation_result)
            VALUES($1,'publish',$2,$3,$4,$4,$5::jsonb)""",
            owner, str(job), BASE, release,
            json.dumps({"pass": True, **sizes, "editorialEntries": len(edited), "batches": len(PLAN)})
        )
        await con.execute(
            """UPDATE dictionary_publish_jobs SET phase='complete',worker_lease_token=NULL,
            worker_lease_until=NULL,error=NULL,updated_at=NOW() WHERE id=$1 AND worker_lease_token=$2""",
            job, token
        )


async def run():
    """Resume the same candidate after interruption, with activation after delivery checks."""
    try:
        release, changes = load_plan()
        job = uuid.uuid5(uuid.NAMESPACE_URL, "learners-area:dictionary-editorial:" + release)
        db = await pool()
        token = uuid.uuid4()
        async with asyncio.timeout(2100):
            while True:
                try:
                    async with db.acquire() as con:
                        claim_result = await claim(con, release, job, token)
                    break
                except LeaseUnavailable:
                    await asyncio.sleep(15)
            if claim_result is None:
                return
            owner, base_count = claim_result
            LOG.info("Dictionary editorial release building: %s", release)
            async with db.acquire() as con:
                last_pulse = 0.0

                async def pulse():
                    nonlocal last_pulse
                    if time.monotonic() - last_pulse >= 8:
                        await heartbeat(con, job, token)
                        last_pulse = time.monotonic()

                await pulse()
                edited = await build_shards(con, release, changes, base_count, pulse)
                sizes = await verify_catalogue(con, release, base_count, edited)
                LOG.info("Dictionary editorial search index building")
                ordered = await con.fetch(
                    "SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1 ORDER BY lemma_norm,lexeme_id", release
                )
                descriptions = [decoded(row["descriptor"]) for row in await con.fetch(
                    "SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 ORDER BY shard", release
                )]
                async with IndexWriter() as writer:
                    index = await index_tools.build_index(
                        release, descriptions, {str(row["lexeme_id"]): i for i, row in enumerate(ordered)},
                        pulse, writer=writer, shard_reader=shard_reader
                    )
                await con.execute(
                    """INSERT INTO dictionary_search_indexes(release_id,descriptor) VALUES($1,$2::jsonb)
                    ON CONFLICT(release_id) DO UPDATE SET descriptor=EXCLUDED.descriptor""",
                    release, stable(index)
                )
                manifest = await make_manifest(con, release)
                if any(manifest[key] != sizes[key] for key in ("senses", "examples")):
                    raise ValueError("editorial_candidate_manifest_mismatch")
                await retry_work(put_immutable, manifest_key(release), stable(manifest).encode())
                LOG.info("Dictionary editorial release verifying delivery")
                await verify_objects(release, manifest, pulse)
                await verify_search_and_entries(con, release, index, edited, pulse)
                await activate(con, release, job, token, owner, manifest, edited, changes, sizes)
                LOG.info("Dictionary editorial release active: %s", release)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        detail = str(exc)
        reason = detail if detail.startswith(("editorial_", "dictionary_")) and detail.isascii() and detail.replace("_", "").isalnum() else type(exc).__name__
        LOG.error("Dictionary editorial publication stopped (%s)", reason)
        if "token" in locals():
            try:
                async with db.acquire() as con:
                    await con.execute(
                        """UPDATE dictionary_publish_jobs SET phase='failed',error=$3,worker_lease_token=NULL,
                        worker_lease_until=NULL,updated_at=NOW()
                        WHERE id=$1 AND worker_lease_token=$2 AND phase='worker_index'""",
                        job, token, reason
                    )
            except Exception:
                LOG.error("Dictionary editorial publication could not record job failure")
