"""Exact source occurrence lookup. An unresolved sense must never be guessed.
Source: src/app/api/vocabulary/lookup/route.ts and lib/services/lexical/context.ts.
"""
from __future__ import annotations
from fastapi import APIRouter, Request
from . import main as core
from .step21_vocabulary_create import resolve_occurrence

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}

async def lexical_detail(con,lex):
    if not lex.get('lexical_unit_id'):return {'lexicalType':None,'ipa':None}
    row=await con.fetchrow('SELECT lexical_type FROM lexical_units WHERE id=$1',lex['lexical_unit_id'])
    pron=await con.fetchval('SELECT ipa FROM lexical_unit_pronunciations WHERE lexical_unit_id=$1 LIMIT 1',lex['lexical_unit_id'])
    return {'lexicalType':row['lexical_type'] if row else None,'ipa':pron}

@router.get('/api/vocabulary/lookup')
async def lookup(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    source=req.query_params.get('sourceType','reading');sid=req.query_params.get('sourceId','');oid=req.query_params.get('occurrenceId','')
    if source not in ('reading','listening','retention') or not core.uuid_value(sid) or not core.uuid_value(oid):
        return core.j({'error':'invalid_input'},400,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        resolved=await resolve_occurrence(con,user,source,sid,oid)
        if resolved['status']=='missing':return core.j({'error':'source_not_found'},404,PRIVATE)
        if resolved['status']=='locked':return core.j({'error':'lexical_assistance_locked'},403,PRIVATE)
        if resolved['status']=='unresolved':
            return core.j({'status':'unresolved','occurrenceId':oid,'surfaceForm':resolved['snapshot']['surfaceForm'],'contextual':None,'known':None},headers=PRIVATE)
        lex=resolved['lexeme']
        known=await con.fetchrow('''SELECT id,mastery FROM user_vocabulary WHERE user_id=$1 AND lexeme_id=$2 LIMIT 1''',user['id'],lex['id'])
        extra=await lexical_detail(con,lex)
        # Dictionary catalogue study content is OPTIONAL.  An external dictionary failure
        # cannot suppress the authored sense, and can never substitute another sense.
        return core.j({'status':'resolved','occurrenceId':oid,'senseId':str(lex['id']),
          'contextual':{'term':lex['term'],'definitionEn':lex['definition_en'],'translationUz':lex['translation_uz'],
          'partOfSpeech':lex['part_of_speech'],'provenance':lex['provenance'],'verificationStatus':lex['verification_status'],
          **extra},'known':{'id':str(known['id']),'mastery':known['mastery']} if known else None},headers=PRIVATE)

def install():core.app.include_router(router)
