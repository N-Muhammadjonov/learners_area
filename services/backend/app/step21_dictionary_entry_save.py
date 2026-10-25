"""Release-pinned Dictionary entry and exact-sense save, never spelling-based mapping."""
from __future__ import annotations
import json,re
from fastapi import APIRouter,Request
from . import main as core
from .step17_dictionary_read_port import pinned,entry,error_response,PRIVATE,normalize_search
from .step21_vocab_batch import add_batch
router=APIRouter()

from .dictionary_presentation import present

@router.get('/api/dictionary/entries/{lexemeId}')
async def dictionary_entry(req:Request,lexemeId:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    if not core.uuid_value(lexemeId):return core.j({'error':'invalid_input'},400)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            release=await pinned(con,req.query_params.get('release_id'))
            value=await entry(con,core.uuid_value(lexemeId),release)
            if not value:return core.j({'error':'entry_not_found'},404,PRIVATE)
            senses=[core.uuid_value(s['sense_id']) for s in value['senses']]
            saved=[]
            if senses:
                rows=await con.fetch('''SELECT m.sense_id FROM dictionary_sense_mappings m
                  JOIN user_vocabulary v ON v.lexeme_id=m.app_sense_id
                  WHERE v.user_id=$1 AND m.sense_id=ANY($2::uuid[])''',user['id'],senses)
                saved=[str(row['sense_id']) for row in rows]
        return core.j({'entry':value,'presentation':present(value),'saved':saved},headers=PRIVATE)
    except Exception as ex:return error_response(ex)

@router.post('/api/dictionary/save')
async def save_sense(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    body=await core.payload(req)
    if (not isinstance(body,dict) or set(body)!={'lexemeId','senseId','releaseId','folderId'} and
        set(body)!={'lexemeId','senseId','releaseId'} or
        not core.uuid_value(body.get('lexemeId')) or not core.uuid_value(body.get('senseId')) or
        not isinstance(body.get('releaseId'),str) or not re.fullmatch(r'rel-v1-[a-f0-9]{24}',body['releaseId']) or
        (body.get('folderId') is not None and not core.uuid_value(body['folderId']))):
        return core.j({'error':'invalid_input'},400)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            async with con.transaction():
                await con.execute('SELECT pg_advisory_xact_lock(387384)')
                release=await pinned(con,body['releaseId'])
                value=await entry(con,core.uuid_value(body['lexemeId']),release)
                if not value:raise ValueError('sense_not_found')
                sense=next((s for s in value['senses'] if s['sense_id']==body['senseId']),None)
                if not sense:raise ValueError('sense_not_found')
                from .dictionary_materialize import materialize
                appid=await materialize(con,value,body['senseId'])
                lex=await con.fetchrow('SELECT * FROM lexemes WHERE id=$1',appid)
                item={'term':lex['term'],'partOfSpeech':lex['part_of_speech'],'definitionEn':lex['definition_en'],
                      'translationUz':lex['translation_uz'],'canonicalLexemeId':lex['id']}
                result=await add_batch(con,user['id'],[item],source_type='dictionary',folder_id=body.get('folderId'))
        return core.j(result,200 if result.get('ok') else 404,PRIVATE)
    except Exception as ex:return error_response(ex)

def install():core.app.include_router(router)
