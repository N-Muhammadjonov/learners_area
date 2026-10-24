"""POST /api/vocabulary: verified source-bound and catalogue-first word saving.

The original has no installed external enrichment adapters; only editorial
lexemes in the database can enrich missing definitions.
"""
from __future__ import annotations
import json,re
from fastapi import APIRouter,Request
from . import main as core
from .step21_meaning_access import text_access
from .step21_vocab_batch import add_batch,normalize_term
from .step17_listening_start_port import test_detail

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
SOURCED={'listening','reading','retention'}

def cleaned(body):
    if not isinstance(body,dict) or not isinstance(body.get('items'),list) or not 1<=len(body['items'])<=100:return None
    for attr in ('folderId','sourceId','occurrenceId','sessionSenseId'):
        if body.get(attr) is not None and not core.uuid_value(body[attr]):return None
    if body.get('sourceType') is not None and (not isinstance(body['sourceType'],str) or len(body['sourceType'])>40):return None
    if body.get('topicPack') is not None and (not isinstance(body['topicPack'],str) or len(body['topicPack'])>60):return None
    items=[]
    for row in body['items']:
        if not isinstance(row,dict) or not isinstance(row.get('term'),str) or not 1<=len(row['term'].strip())<=120:return None
        entry={'term':row['term'].strip()}
        for key,maxlen in (('definitionEn',500),('translationUz',500),('exampleSentence',500),('partOfSpeech',30)):
            value=row.get(key)
            if value is not None and (not isinstance(value,str) or len(value.strip())>maxlen or (key=='definitionEn' and not value.strip())):return None
            if value is not None:entry[key]=value.strip()
        if 'acceptedTranslations' in row:
            trans=row['acceptedTranslations']
            if not isinstance(trans,list) or len(trans)>4 or any(not isinstance(v,str) or not 1<=len(v.strip())<=120 for v in trans):return None
            entry['acceptedTranslations']=[v.strip() for v in trans]
        items.append(entry)
    return items

async def lookup_catalogue(con, term):
    # Source code excludes learner-provided senses and refuses ambiguity.
    rows=await con.fetch('''SELECT * FROM lexemes WHERE lower(translate(term,$2,$3))=$1
               AND (provenance IS NULL OR provenance<>'user_provided') ORDER BY term LIMIT 2''',normalize_term(term),"‘’ʼʻ","''''")
    return dict(rows[0]) if len(rows)==1 else None

async def resolve_occurrence(con,u,source,source_id,oid):
    # Do not trust an occurrence id alone: authorize the study source first.
    access=await text_access(con,u,source,core.uuid_value(source_id))
    if access!='allowed':return {'status':'locked' if access=='locked' else 'missing'}
    row=await con.fetchrow('SELECT * FROM lexical_occurrences WHERE id=$1',core.uuid_value(oid))
    if not row:return {'status':'missing'}
    r=dict(row)
    if source=='listening' and str(r.get('listening_test_id'))!=source_id:return {'status':'missing'}
    if source=='reading':
        owned=await con.fetchrow('SELECT passage_id FROM reading_attempts WHERE id=$1 AND user_id=$2',core.uuid_value(source_id),u['id'])
        passages=[owned['passage_id']] if owned else [core.uuid_value(source_id)]
        if owned:
            extra=await con.fetch('SELECT passage_id FROM reading_assessment_passages WHERE attempt_id=$1',core.uuid_value(source_id))
            passages.extend(x['passage_id'] for x in extra)
        if r.get('passage_id') not in passages:return {'status':'missing'}
        passage=await con.fetchrow('SELECT body_text,title FROM reading_passages WHERE id=$1',r['passage_id'])
        content=passage['body_text'] if passage else ''
        start=r.get('start_char') or 0;end=r.get('end_char') or 0
        if not isinstance(content,str) or start<0 or end<=start or content[start:end].lower()!=str(r.get('surface_form','')).lower():return {'status':'missing'}
        sentence=r.get('sentence_text')
        if not sentence or sentence not in content or len(sentence)>600:sentence=content[max(0,start-160):end+160]
        snapshot={'occurrenceId':str(r['id']),'lexemeId':str(r['lexeme_id']) if r.get('lexeme_id') else None,
            'sourceTitle':passage['title'][:240],'surfaceForm':r['surface_form'],'sentenceText':sentence,
            'sourceType':'reading','attemptId':source_id if owned else None,'passageId':str(r['passage_id'])}
    elif source=='listening':
        if r.get('section_number') is None:return {'status':'missing'}
        pkg=await con.fetchrow('SELECT t.title,p.payload FROM listening_tests t JOIN listening_packages p ON p.test_id=t.id WHERE t.id=$1',core.uuid_value(source_id))
        if not pkg:return {'status':'missing'}
        # Avoid revealing a sense if transcript offsets cannot be independently validated.
        payload=pkg['payload'];payload=json.loads(payload) if isinstance(payload,str) else payload
        section=r['section_number']; key=r.get('segment_key') or 's'+str(section)
        study=payload.get('study',{}) if isinstance(payload,dict) else {}
        segments=study.get('segments',[]) if isinstance(study,dict) else []
        segment=next((x for x in segments if isinstance(x,dict) and x.get('key')==key and x.get('section')==section),None)
        if not segment:return {'status':'missing'}
        text=segment.get('text','');start=r.get('start_char') or 0;end=r.get('end_char') or 0
        if not isinstance(text,str) or start<0 or end<=start or text[start:end].lower()!=str(r.get('surface_form','')).lower():return {'status':'missing'}
        sentence=text[max(0,start-160):end+160]
        snapshot={'occurrenceId':str(r['id']),'lexemeId':str(r['lexeme_id']) if r.get('lexeme_id') else None,
           'sourceTitle':pkg['title'][:240],'surfaceForm':r['surface_form'],'sentenceText':sentence,
           'sourceType':'listening','listeningTestId':source_id,'sectionNumber':section,
           'startMs':r.get('start_ms'),'endMs':r.get('end_ms')}
    else:
        attempt=await con.fetchrow('SELECT retention_text_version_id FROM retention_attempts WHERE id=$1 AND user_id=$2',core.uuid_value(source_id),u['id'])
        if not attempt or r.get('retention_text_version_id')!=attempt['retention_text_version_id']:return {'status':'missing'}
        snapshot={'occurrenceId':str(r['id']),'lexemeId':str(r['lexeme_id']) if r.get('lexeme_id') else None,
          'sourceTitle':'Retention','surfaceForm':r['surface_form'],'sentenceText':r.get('sentence_text') or '',
          'sourceType':'retention','retentionAttemptId':source_id}
    if not r.get('lexeme_id') or r.get('resolution_status')!='resolved':return {'status':'unresolved','snapshot':snapshot}
    lex=await con.fetchrow('SELECT * FROM lexemes WHERE id=$1',r['lexeme_id'])
    return {'status':'resolved','snapshot':snapshot,'lexeme':dict(lex)} if lex else {'status':'unresolved','snapshot':snapshot}

@router.post('/api/vocabulary')
async def create_vocabulary(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    body=await core.payload(req);items=cleaned(body)
    if items is None:return core.j({'error':'invalid_input'},400)
    source=body.get('sourceType') or 'manual';sid=body.get('sourceId')
    occurrence=body.get('occurrenceId');sense=body.get('sessionSenseId')
    if sense and (source!='listening' or not sid) or occurrence and (source not in SOURCED or not sid or len(items)!=1):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        if source in SOURCED:
            if not sid:return core.j({'error':'invalid_input'},400,PRIVATE)
            access=await text_access(con,user,source,core.uuid_value(sid))
            if access!='allowed':return core.j({'error':'lexical_assistance_locked' if access=='locked' else 'source_not_found'},403 if access=='locked' else 404,PRIVATE)
        if sense:
            # The requested sense must be a MEMBER of this test's authored session,
            # never merely an existing dictionary UUID.
            pkg=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1',core.uuid_value(sid))
            content=pkg['payload'] if pkg else {};content=json.loads(content) if isinstance(content,str) else content
            vocab=content.get('vocabulary',[]) if isinstance(content,dict) else []
            exact=next((x for x in vocab if isinstance(x,dict) and x.get('senseId')==sense),None)
            if exact is None:return core.j({'error':'source_not_found'},404)
            lex=await con.fetchrow('SELECT * FROM lexemes WHERE id=$1',core.uuid_value(sense))
            if not lex:return core.j({'error':'source_not_found'},404)
            items=[{**dict(lex),'term':lex['term'],'definitionEn':lex['definition_en'],'canonicalLexemeId':lex['id']}]
        if occurrence:
            resolved=await resolve_occurrence(con,user,source,sid,occurrence)
            if resolved['status']=='missing':return core.j({'error':'source_not_found'},404)
            if resolved['status']=='locked':return core.j({'error':'lexical_assistance_locked'},403)
            if resolved['status']=='unresolved':return core.j({'ok':False,'error':'needs_definition','needsDefinition':[resolved['snapshot']['surfaceForm']]},422)
            lex=resolved['lexeme'];items=[{'term':lex['term'],'definitionEn':lex['definition_en'],'translationUz':lex.get('translation_uz'),
                'partOfSpeech':lex.get('part_of_speech'),'canonicalLexemeId':lex['id'],'sourceSnapshot':resolved['snapshot']}]
        if source in SOURCED and any(not x.get('definitionEn') for x in items):
            return core.j({'ok':False,'error':'needs_definition','needsDefinition':[x['term'] for x in items if not x.get('definitionEn')]},422)
        unresolved=[]
        for item in items:
            if item.get('definitionEn'):continue
            lex=await lookup_catalogue(con,item['term'])
            if lex is None:unresolved.append(item['term']);continue
            item['canonicalLexemeId']=lex['id'];item['definitionEn']=lex['definition_en']
            for k,db_k in [('translationUz','translation_uz'),('exampleSentence','example_sentence'),('partOfSpeech','part_of_speech')]:
                if item.get(k) is None:item[k]=lex[db_k]
        storable=[x for x in items if x.get('definitionEn')]
        if not storable:return core.j({'ok':False,'error':'needs_definition','needsDefinition':unresolved},422)
        async with con.transaction():
            result=await add_batch(con,user['id'],storable,folder_id=core.uuid_value(body.get('folderId')),
                   topic_pack=body.get('topicPack'),source_type=source,source_id=core.uuid_value(sid))
        if not result.get('ok'):return core.j({'error':result.get('error')},404) if not (sense or occurrence) else core.j(result,404)
    if sense or occurrence:return core.j(result,200)
    return core.j({**result,'needsDefinition':unresolved},200)

def install():core.app.include_router(router)
