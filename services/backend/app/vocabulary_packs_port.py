"""Published Vocabulary pack summaries; exact built-in fallback data copied from source.

Published DB rows remain canonical. The new built-in Art pack is also exposed
when it has not yet been authored in the DB, so a content deployment can launch
it without changing existing published packs.
"""
from __future__ import annotations
import json
from pathlib import Path
from fastapi import APIRouter, Request
from . import main as core

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
    if rows and not any(p['id'] == 'art' for p in packs):
        art = next(p for p in built_in_summaries() if p['id'] == 'art')
        packs.append(art)
    return core.j({'ok': True, 'packs': [
        {'id': p['id'], 'label': {'en': p['label'], 'uz': p['labelUz'] or p['label']},
         'wordCount': p['wordCount'], 'added':added.get(p['id'],0)>0} for p in packs]}, headers={'Cache-Control':'private, no-store'})


def install():
    core.app.include_router(router)
