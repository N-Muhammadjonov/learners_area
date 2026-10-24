"""Additional bounded learner and staff API routes ported from Next.js.
No writes or reads to any live database at import or application startup.
"""
from __future__ import annotations

import math
import re
import unicodedata
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict
from .admin_authoring_port import uuid_val

router=APIRouter()
PRIV={'Cache-Control':'private, no-store'}


@router.get('/api/admin/content/items/{module}/{contentType}/{sourceRef}')
async def content_item_versions(req:Request,module:str,contentType:str,sourceRef:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('owner','admin','teacher'):
        return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as conn:
        rows=await conn.fetch('''SELECT id, version_no AS "versionNo", status,
            publication_state AS "publicationState", title, track,
            answer_key_hash AS "answerKeyHash",target_type AS "targetType",
            target_id AS "targetId" FROM content_versions v
            WHERE module=$1 AND content_type=$2 AND source_ref=$3
            AND NOT EXISTS (SELECT 1 FROM activity_events deleted_content
                WHERE deleted_content.id=md5('deleted-content:' || v.id::text)::uuid
                AND deleted_content.type='CONTENT_DELETED')
            ORDER BY version_no DESC''',module,contentType,sourceRef)
    if not rows:return core.j({'error':'not_found'},404)
    return core.j({'module':module,'contentType':contentType,'sourceRef':sourceRef,
                   'versions':[row_to_dict(r) for r in rows]})


@router.patch('/api/support/reports/{id}')
async def resolve_problem_report(req:Request,id:str):
    ident=uuid_val(id)
    if not ident:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('owner','admin','teacher'):
        return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as conn:
        updated=await conn.fetchrow('''UPDATE problem_reports SET status='resolved',
          resolved_by_user_id=$2,resolved_at=now() WHERE id=$1 AND resolved_at IS NULL
          RETURNING status''',ident,user['id'])
        if not updated:
            found=await conn.fetchval('SELECT id FROM problem_reports WHERE id=$1 LIMIT 1',ident)
            if not found:return core.j({'error':'not_found'},404)
            return core.j({'error':'already_resolved'},409)
    return core.j({'ok':True,'status':updated['status']})


# Reproduce activation-rules.ts tokenisation and matching for the own-list feature.
def _activation_tokens(value:str)->list[str]:
    value=unicodedata.normalize('NFKC',value.lower())
    for ch in '\u2018\u2019\u02bc`':value=value.replace(ch,"'")
    for ch in '\u2010\u2011\u2012\u2013\u2014\u2015\u2212-':value=value.replace(ch,' ')
    return re.findall(r"[^\W_']+(?:'[^\W_']+)*|'+",value,flags=re.UNICODE)


def _activation_key(value):
    return ' '.join(t for t in _activation_tokens(value) if t not in ('a','an','the'))


def _clean_custom(raw):
    s=' '.join(raw.strip().split())
    if not 2 <= len(s) <= 80 or not s or not s[0].isalpha():return None
    for ch in s:
        if ch.isalpha() or ch.isnumeric() or ch in "'\u2019 ,.\u2010\u2011\u2012\u2013\u2014\u2015-":continue
        return None
    return s


_ITEM_QUERY='''SELECT v.id AS "entryId",l.term AS term,
   l.definition_en AS "definitionEn",l.translation_uz AS "translationUz"
   FROM user_vocabulary v INNER JOIN lexemes l ON l.id=v.lexeme_id
   WHERE v.user_id=$1'''


@router.get('/api/writing/activation/items')
async def activation_random(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    raw=req.query_params.get('count','10')
    try:
        count=float(raw.strip()) if raw.strip() else 0.0
        if not math.isfinite(count):count=10
    except (ValueError,OverflowError):count=10
    limit=min(30,max(1,int(count)))
    db=await core.pool()
    async with db.acquire() as conn:
        rows=await conn.fetch(_ITEM_QUERY+''' ORDER BY CASE WHEN v.active_use_count=0 THEN 0
          WHEN v.next_review_at <= now() THEN 1 WHEN v.created_at > now()-interval '14 days'
          THEN 2 ELSE 3 END,random() LIMIT $2''',user['id'],limit)
    return core.j({'ok':True,'items':[row_to_dict(r) for r in rows]},headers={'Cache-Control':'no-store'})


@router.post('/api/writing/activation/items')
async def activation_resolve(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    b=await core.payload(req)
    terms=b.get('terms') if isinstance(b,dict) and set(b)=={'terms'} else None
    if not isinstance(terms,list) or not 1<=len(terms)<=30 or any(not isinstance(t,str) or len(t)>120 for t in terms):
        return core.j({'error':{'code':'invalid_input','message':'Add at least one word.','field':'terms'}},400)
    cleaned=list(dict.fromkeys(s for t in terms if (s:=_clean_custom(t)) is not None))[:30]
    if not cleaned:return core.j({'ok':True,'items':[]},headers={'Cache-Control':'no-store'})
    db=await core.pool()
    async with db.acquire() as conn:
        rows=await conn.fetch(_ITEM_QUERY+' ORDER BY v.created_at DESC',user['id'])
    saved={}
    for row in rows:
        item=row_to_dict(row)
        key=_activation_key(item['term'])
        if key not in saved:saved[key]=item
    items=[saved.get(_activation_key(term),{'entryId':None,'term':term,'definitionEn':None,'translationUz':None}) for term in cleaned]
    return core.j({'ok':True,'items':items},headers={'Cache-Control':'no-store'})


def install():
    core.app.include_router(router)
