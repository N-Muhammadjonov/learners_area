"""GET /api/vocabulary — paginated user-owned library.

Page membership, canonical lexeme joins, ordering and response shape mirror the
Next.js vocabulary engine's listLibrary() for its GET endpoint.
"""
from __future__ import annotations
import math
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}


def js_number(raw,default):
    if raw is None:return default
    try:
        if raw.strip()=='':return 0.0
        return float(raw)
    except (ValueError,OverflowError):return float('nan')


@router.get('/api/vocabulary')
async def vocabulary_library(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    raw_offset=js_number(req.query_params.get('offset'),0)
    raw_limit=js_number(req.query_params.get('limit'),50)
    offset=max(0,math.floor(raw_offset)) if math.isfinite(raw_offset) else 0
    limit=max(1,min(100,math.floor(raw_limit))) if math.isfinite(raw_limit) else 50
    try:
        db=await core.pool()
        async with db.acquire() as con:
            folder=req.query_params.get('folderId')
            args=[user['id'],limit+1,offset];scope=''
            if folder=='none':scope=' AND NOT EXISTS(SELECT 1 FROM vocab_folder_entries m WHERE m.entry_id=uv.id AND m.user_id=uv.user_id)'
            elif folder:
                fid=core.uuid_value(folder)
                if not fid or not await con.fetchval('SELECT id FROM vocab_folders WHERE id=$1 AND user_id=$2',fid,user['id']):return core.j({'error':'not_found'},404,PRIVATE)
                args.append(fid);scope=' AND EXISTS(SELECT 1 FROM vocab_folder_entries m WHERE m.entry_id=uv.id AND m.user_id=uv.user_id AND m.folder_id=$4)'
            rows=await con.fetch('''SELECT uv.id,l.term,l.accepted_translations AS "acceptedTranslations",
             l.part_of_speech AS "partOfSpeech",l.definition_en AS "definitionEn",
             l.translation_uz AS "translationUz", l.example_sentence AS "exampleSentence",
             l.collocations,uv.mastery,uv.srs_stage AS "srsStage",
             uv.interval_days AS "intervalDays",uv.next_review_at AS "nextReviewAt",
             uv.correct_count AS "correctCount",uv.incorrect_count AS "incorrectCount",
             uv.active_use_count AS "activeUseCount",uv.folder_id AS "folderId",
             COALESCE((SELECT array_agg(m.folder_id ORDER BY m.folder_id) FROM vocab_folder_entries m WHERE m.entry_id=uv.id AND m.user_id=uv.user_id),'{}'::uuid[]) AS "folderIds",
             uv.topic_pack AS "topicPack",uv.source_type AS "sourceType",
             uv.source_snapshot AS "sourceSnapshot",uv.created_at AS "createdAt"
             FROM user_vocabulary uv JOIN lexemes l ON l.id=uv.lexeme_id
             WHERE uv.user_id=$1'''+scope+''' ORDER BY uv.next_review_at ASC,l.term ASC,uv.id ASC
             LIMIT $2 OFFSET $3''',*args)
        has_more=len(rows)>limit
        words=[{**row_to_dict(r), 'acceptedTranslations':r['acceptedTranslations'] or []} for r in rows[:limit]]
        return core.j({'ok':True,'words':words,'hasMore':has_more,
           'nextOffset':offset+limit if has_more else None,'offset':offset,'limit':limit},headers=PRIVATE)
    except Exception:
        return core.j({'ok':False,'error':'temporarily_unavailable'},503,PRIVATE)


def install():core.app.include_router(router)
