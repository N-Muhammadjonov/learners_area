"""Published Vocabulary pack summaries; exact built-in fallback data copied from source.

Published DB rows remain canonical. Built-in Art and Environment packs are
exposed when absent from the DB, so a content release needs no migration.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from fastapi import APIRouter, Request
from . import main as core
from .step21_vocab_batch import normalize_term, sense_key
from .step25_content_version import pin

router = APIRouter()


def built_in_summaries():
    packs = json.loads(Path(__file__).with_name('vocabulary_builtin_packs.json').read_text(encoding='utf-8'))
    return [{'id': p['id'], 'slug': p['id'], 'label': p['label']['en'],
             'labelUz': p['label']['uz'], 'wordCount': len(p['words'])} for p in packs]


@router.get('/api/vocabulary/packs')
async def list_vocabulary_packs(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.auth_error()
    db = await core.pool()
    async with db.acquire() as conn:
        rows = await conn.fetch('''SELECT slug, label_en AS "labelEn", label_uz AS "labelUz",
            (SELECT count(*)::int FROM vocabulary_topic_pack_words w
              INNER JOIN lexemes l ON l.id=w.lexeme_id
              WHERE w.pack_id=vocabulary_topic_packs.id) AS "wordCount"
            FROM vocabulary_topic_packs WHERE publication_state='published'
            ORDER BY position ASC, label_en ASC''')
        owned = await conn.fetch('''SELECT topic_pack,count(*)::int AS count
            FROM user_vocabulary WHERE user_id=$1 AND topic_pack IS NOT NULL AND folder_id IS NOT NULL
            GROUP BY topic_pack''',user['id'])
    added={r['topic_pack']:int(r['count']) for r in owned}
    packs = ([{'id': r['slug'], 'slug': r['slug'], 'label': r['labelEn'],
               'labelUz': r['labelUz'], 'wordCount': int(r['wordCount'])} for r in rows]
             if rows else built_in_summaries())
    if rows:
        published_slugs = {p['id'] for p in packs}
        for fallback in built_in_summaries():
            if fallback['id'] in ('art', 'environment') and fallback['id'] not in published_slugs:
                packs.append(fallback)
    return core.j({'ok': True, 'packs': [
        {'id': p['id'], 'label': {'en': p['label'], 'uz': p['labelUz'] or p['label']},
         'wordCount': p['wordCount'], 'added':added.get(p['id'],0)>0} for p in packs]}, headers={'Cache-Control':'private, no-store'})


def validate_public_pack(body: object) -> dict | None:
    """Reject missing translations, duplicate senses and malformed publications."""
    if not isinstance(body, dict) or set(body) != {"slug", "labelEn", "labelUz", "words"}:
        return None
    slug = body["slug"]
    if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,59}", slug):
        return None
    labels = {}
    for key in ("labelEn", "labelUz"):
        value = body[key]
        if not isinstance(value, str) or not 2 <= len(value.strip()) <= 120:
            return None
        labels[key] = value.strip()
    words = body["words"]
    if not isinstance(words, list) or not 5 <= len(words) <= 300:
        return None
    sanitized = []
    keys = set()
    for item in words:
        if not isinstance(item, dict) or set(item) - {
            "term", "partOfSpeech", "definitionEn", "translationUz",
            "example", "collocations"
        }:
            return None
        clean = {}
        for key, maximum, required in (
            ("term", 120, True),
            ("partOfSpeech", 30, False),
            ("definitionEn", 500, True),
            ("translationUz", 500, True),
            ("example", 500, True),
            ("collocations", 500, False),
        ):
            value = item.get(key, "")
            if not isinstance(value, str) or len(value.strip()) > maximum:
                return None
            if required and not value.strip():
                return None
            clean[key] = value.strip()
        identity = sense_key(clean)
        if identity in keys:
            return None
        keys.add(identity)
        sanitized.append(clean)
    return {"slug": slug, **labels, "words": sanitized}


async def _public_pack_payload(req: Request) -> dict | None:
    if not req.headers.get("content-type", "").startswith("application/json"):
        return None
    raw = bytearray()
    async for chunk in req.stream():
        if len(raw) + len(chunk) > 256_000:
            return None
        raw.extend(chunk)
    try:
        return validate_public_pack(json.loads(raw))
    except (ValueError, UnicodeDecodeError):
        return None


@router.post('/api/vocabulary/packs/public')
async def publish_public_pack(req: Request):
    """Owner-only publication; existing content and learner libraries are immutable."""
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    if user["role"] != "owner":
        return core.j({"error": "forbidden"}, 403, core.PRIVATE)
    body = await _public_pack_payload(req)
    if body is None:
        return core.j({"error": "invalid_pack"}, 400, core.PRIVATE)
    slug = body["slug"]
    if slug in {item["id"] for item in built_in_summaries()}:
        return core.j({"error": "pack_already_exists"}, 409, core.PRIVATE)

    pool = await core.pool()
    try:
        async with pool.acquire() as con, con.transaction():
            # Publish is serialized so the position and slug remain deterministic.
            await con.execute("SELECT pg_advisory_xact_lock(hashtext('public-vocabulary-pack'))")
            duplicate = await con.fetchval(
                "SELECT id FROM vocabulary_topic_packs WHERE slug=$1", slug)
            if duplicate:
                return core.j({"error": "pack_already_exists"}, 409, core.PRIVATE)
            position = await con.fetchval(
                "SELECT COALESCE(MAX(position),0)+1 FROM vocabulary_topic_packs")
            pack_id = await con.fetchval("""INSERT INTO vocabulary_topic_packs
                (source_ref,slug,label_en,label_uz,position,publication_state,
                 publish_at,created_by_user_id)
                VALUES($1,$2,$3,$4,$5,'published',NOW(),$6) RETURNING id""",
                "owner-" + slug, slug, body["labelEn"], body["labelUz"],
                position, user["id"])
            for index, word in enumerate(body["words"], 1):
                lexeme_id = await con.fetchval("""INSERT INTO lexemes
                    (term,part_of_speech,definition_en,translation_uz,
                     example_sentence,collocations,sense_key,provenance,
                     verification_status)
                    VALUES($1,$2,$3,$4,$5,$6,$7,'topic_pack','verified')
                    ON CONFLICT(sense_key) DO UPDATE
                    SET sense_key=EXCLUDED.sense_key RETURNING id""",
                    normalize_term(word["term"]), word["partOfSpeech"],
                    word["definitionEn"], word["translationUz"],
                    word["example"], word["collocations"], sense_key(word))
                await con.execute("""INSERT INTO vocabulary_topic_pack_words
                    (pack_id,lexeme_id,position) VALUES($1,$2,$3)""",
                    pack_id, lexeme_id, index)
            version_content = {
                "labelEn": body["labelEn"], "labelUz": body["labelUz"],
                "topicCode": None, "level": None,
                "words": [
                    {"term": word["term"], "partOfSpeech": word["partOfSpeech"],
                     "definitionEn": word["definitionEn"]}
                    for word in body["words"]
                ]
            }
            await pin(
                con, "vocabulary", "topic_pack", "owner-" + slug,
                body["labelEn"], version_content, user["id"],
                pub="published", target_type="vocabulary_topic_pack",
                target_id=pack_id,
                provenance={"origin": "authored", "words": len(body["words"])},
            )
    except Exception as exc:
        if getattr(exc, "sqlstate", None) == "23505":
            return core.j({"error": "pack_already_exists"}, 409, core.PRIVATE)
        raise
    return core.j({
        "ok": True, "pack": {"id": slug,
                            "label": {"en": body["labelEn"],
                                      "uz": body["labelUz"]},
                            "wordCount": len(body["words"])}
    }, 201, core.PRIVATE)


def install():
    core.app.include_router(router)
