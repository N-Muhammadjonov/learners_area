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
    # Apply folder, progress and source filters BEFORE pagination.
    folder=req.query_params.get('folderId','all')
    mastery=req.query_params.get('mastery','all')
    source=req.query_params.get('source','all')
    study_filter=req.query_params.get('filter','all')
    if ((folder not in ('all','none') and not core.uuid_value(folder))
        or mastery not in ('all','new','learning','known','active','mastered')
        or source not in ('all','manual','speaking','writing','reading','listening','video','retention','dictionary','assignment','topic')
        or study_filter not in ('all','due','weak')):
        return core.j({'error':'invalid_input'},400,PRIVATE)
    conditions=['uv.user_id=$1']
    args=[user['id']]
    if folder=='none':conditions.append('uv.folder_id IS NULL')
    elif folder!='all':
        args.append(core.uuid_value(folder));conditions.append(f'uv.folder_id=${len(args)}')
    if mastery!='all':
        args.append(mastery);conditions.append(f'uv.mastery=${len(args)}')
    if source!='all':
        if source=='manual':conditions.append("(uv.source_type IS NULL OR uv.source_type='manual')")
        else:
            args.append(source);conditions.append(f'uv.source_type=${len(args)}')
    if study_filter=='due':conditions.append('uv.next_review_at <= NOW()')
    elif study_filter=='weak':conditions.append('(uv.correct_count+uv.incorrect_count>0 AND uv.incorrect_count>=uv.correct_count)')
    where=' AND '.join(conditions)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            rows=await con.fetch(f'''SELECT uv.id,l.term,l.accepted_translations AS "acceptedTranslations",
             l.part_of_speech AS "partOfSpeech",l.definition_en AS "definitionEn",
             l.translation_uz AS "translationUz", l.example_sentence AS "exampleSentence",
             l.collocations,uv.mastery,uv.srs_stage AS "srsStage",
             uv.interval_days AS "intervalDays",uv.next_review_at AS "nextReviewAt",
             uv.correct_count AS "correctCount",uv.incorrect_count AS "incorrectCount",
             uv.active_use_count AS "activeUseCount",uv.folder_id AS "folderId",
             uv.topic_pack AS "topicPack",uv.source_type AS "sourceType",
             uv.source_snapshot AS "sourceSnapshot",uv.created_at AS "createdAt"
             FROM user_vocabulary uv JOIN lexemes l ON l.id=uv.lexeme_id
             WHERE {where} ORDER BY uv.next_review_at ASC,l.term ASC,uv.id ASC
             LIMIT ${len(args)+1} OFFSET ${len(args)+2}''',*args,limit+1,offset)
        has_more=len(rows)>limit
        words=[{**row_to_dict(r), 'acceptedTranslations':r['acceptedTranslations'] or []} for r in rows[:limit]]
        return core.j({'ok':True,'words':words,'hasMore':has_more,
           'nextOffset':offset+limit if has_more else None,'offset':offset,'limit':limit},headers=PRIVATE)
    except Exception:
        return core.j({'ok':False,'error':'temporarily_unavailable'},503,PRIVATE)


def install():core.app.include_router(router)
