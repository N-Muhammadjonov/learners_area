"""Release-pinned Dictionary entry and exact-sense save, never spelling-based mapping."""
from __future__ import annotations
import json,re
from fastapi import APIRouter,Request
from . import main as core
from .step17_dictionary_read_port import pinned,entry,error_response,PRIVATE,normalize_search
from .step21_vocab_batch import add_batch
router=APIRouter()

# The uploaded backend contains source code but not the large precomputed editorial
# presentation shards. When deployed beside those shards, use a verified manifest;
# without them only explicitly included entry examples/collocations are returned.
def present(e):
    lemma=e.get('display_lemma','')
    terms=[lemma]+[form.get('surface_form','') for form in e.get('forms',[])]
    words={normalize_search(w) for w in terms if w}
    def used(text):
        norm=normalize_search(text)
        return any(re.search(r'(?<!\w)'+re.escape(w)+r'(?!\w)',norm) for w in words)
    senses=e.get('senses',[])
    result={}
    for sense in senses:
        sid=sense['sense_id']
        synonyms=([{'text':r['display_lemma'],'lexemeId':r['target_lexeme_id'],
                    'senseId':r.get('target_sense_id')} for r in e.get('relations',[]) if r.get('relation_type')=='synonym'] if len(senses)==1 else [])
        coll=[{'text':c['text']} for c in e.get('collocations',[]) if c.get('sense_id')==sid or (c.get('sense_id') is None and len(senses)==1)]
        result[sid]={'synonyms':synonyms,'collocations':coll,
                    'examples':[ex for ex in sense.get('examples',[]) if used(ex.get('text_en',''))]}
    return {'senses':result}

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
                maprow=await con.fetchrow('SELECT app_sense_id FROM dictionary_sense_mappings WHERE sense_id=$1',core.uuid_value(body['senseId']))
                presentation=present(value)['senses'][body['senseId']]
                example=presentation['examples'][0]['text_en'] if presentation['examples'] else None
                coll=' · '.join(r['text'] for r in presentation['collocations']) or None
                if maprow:
                    appid=maprow['app_sense_id']
                    current=await con.fetchrow('SELECT id,example_sentence,collocations FROM lexemes WHERE id=$1',appid)
                    if not current:raise RuntimeError('dictionary_mapping_missing')
                    if not current['example_sentence'] or current['example_sentence'] not in [x['text_en'] for x in presentation['examples']]:
                        await con.execute('UPDATE lexemes SET example_sentence=$2 WHERE id=$1',appid,example)
                    if not (current['collocations'] or '').strip() and coll:
                        await con.execute('UPDATE lexemes SET collocations=$2 WHERE id=$1',appid,coll)
                else:
                    pos={'n':'noun','v':'verb','a':'adjective','r':'adverb'}.get(value['part_of_speech'],value['part_of_speech'])
                    typ=value['lexical_type'] if value['lexical_type'] in ('word','noun_phrase','verb_phrase','collocation','phrasal_verb','idiom','fixed_expression','compound','technical_term','phrase') else ('phrase' if ' ' in value['display_lemma'] else 'word')
                    unit=await con.fetchval('''INSERT INTO lexical_units(id,lemma,lemma_norm,part_of_speech,lexical_type,provenance)
                        VALUES($1,$2,$3,$4,$5,'dictionary_release') ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type)
                        DO UPDATE SET lemma=lexical_units.lemma RETURNING id''',core.uuid_value(body['lexemeId']),value['display_lemma'],normalize_search(value['display_lemma']),pos,typ)
                    appid=core.uuid_value(body['senseId'])
                    await con.execute('''INSERT INTO lexemes(id,term,part_of_speech,definition_en,translation_uz,example_sentence,
                       collocations,sense_key,provenance,verification_status,lexical_unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'dictionary_release',$9,$10)''',
                      appid,value['display_lemma'],pos,sense['definition_en'],sense['translations'][0]['text'],example,coll,
                      'dictionary:'+body['senseId'],'unverified' if sense.get('editorial') and sense['editorial']['translation_status']!='human_reviewed' else 'verified',unit)
                    await con.execute('''INSERT INTO dictionary_sense_mappings(sense_id,app_sense_id,app_unit_id,mapping_method)
                       VALUES($1,$2,$3,'new_canonical')''',appid,appid,unit)
                lex=await con.fetchrow('SELECT * FROM lexemes WHERE id=$1',appid)
                item={'term':lex['term'],'partOfSpeech':lex['part_of_speech'],'definitionEn':lex['definition_en'],
                      'translationUz':lex['translation_uz'],'canonicalLexemeId':lex['id']}
                result=await add_batch(con,user['id'],[item],source_type='dictionary',folder_id=body.get('folderId'))
        return core.j(result,200 if result.get('ok') else 404,PRIVATE)
    except Exception as ex:return error_response(ex)

def install():core.app.include_router(router)
