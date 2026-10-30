"""Owner Dictionary draft revision, matching mutateDraft(discard=false) and applyDraft.

The active-release check, editor validation, row update and audit form one
advisory-serialized SQL transaction, not separate requests.
"""
from __future__ import annotations
import json
import re
import uuid
from fastapi import APIRouter, Request
from . import main as core
from .dictionary_gate import dictionary_write_slot,DictionaryBusy,busy_response
from .step17_dictionary_read_port import active_release, entry, error_response, normalize_search

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
POS={'n','v','a','r','noun','verb','adjective','adverb','preposition','pronoun','determiner','conjunction','interjection','numeral'}
TYPES={'word','noun_phrase','verb_phrase','phrasal_verb','idiom','collocation','fixed_expression','compound','technical_term','phrase'}
CYR=re.compile('[\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f]')

def _text(v, *, maximum=6000, uz=False):
    return isinstance(v,str) and bool(v.strip()) and len(v.strip())<=maximum and (not uz or not CYR.search(v.strip()))

def _valid_examples(v, edit=False):
    if not isinstance(v,list) or len(v)>100:return False
    for e in v:
        if not isinstance(e,dict) or set(e)!=({'exampleId','textUz'} if edit else {'textEn','textUz'}):return False
        if edit and not core.uuid_value(e['exampleId']):return False
        if not _text(e['textUz'],uz=True) or (not edit and not _text(e['textEn'])):return False
    return True

def draft_schema(b):
    if not isinstance(b,dict):return None
    op=b.get('operation')
    if op=='edit_sense':
        if not {'operation','lexemeId','senseId'}<=set(b) or set(b)-{'operation','lexemeId','senseId','translationUz','definitionUz','examples'}:return None
        if not core.uuid_value(b['lexemeId']) or not core.uuid_value(b['senseId']):return None
        for k in ('translationUz','definitionUz'):
            if k in b and not _text(b[k],uz=True):return None
        if 'examples' in b and not _valid_examples(b['examples'],True):return None
        return dict(b)
    if op=='add_sense':
        if set(b)-{'operation','lexemeId','definitionEn','translationUz','definitionUz','examples'} or not {'operation','lexemeId','definitionEn','translationUz','definitionUz'}<=set(b):return None
        if not core.uuid_value(b['lexemeId']) or not _text(b['definitionEn']) or not _text(b['translationUz'],uz=True) or not _text(b['definitionUz'],uz=True):return None
        if not _valid_examples(b.get('examples',[])):return None
        return {**b,'examples':b.get('examples',[]),'definitionEn':b['definitionEn'].strip(),'translationUz':b['translationUz'].strip(),'definitionUz':b['definitionUz'].strip()}
    if op=='add_lexeme':
        if set(b)-{'operation','lemma','partOfSpeech','lexicalType','definitionEn','translationUz','definitionUz','examples'} or not {'operation','lemma','partOfSpeech','lexicalType','definitionEn','translationUz','definitionUz'}<=set(b):return None
        if not _text(b['lemma'],maximum=120) or b['partOfSpeech'] not in POS or b['lexicalType'] not in TYPES:return None
        if not _text(b['definitionEn']) or not _text(b['translationUz'],uz=True) or not _text(b['definitionUz'],uz=True) or not _valid_examples(b.get('examples',[])):return None
        return {**b,'examples':b.get('examples',[]),'lemma':b['lemma'].strip(),'definitionEn':b['definitionEn'].strip(),'translationUz':b['translationUz'].strip(),'definitionUz':b['definitionUz'].strip()}
    return None

def apply_validation(original,changes):
    op=changes['operation']
    if op=='add_lexeme':
        aliases={'n':'noun','v':'verb','a':'adjective','r':'adverb'}
        pos=lambda x:aliases.get(x,x)
        if any(normalize_search(x['display_lemma'])==normalize_search(changes['lemma'])
          and pos(x['part_of_speech'])==pos(changes['partOfSpeech']) and x['lexical_type']==changes['lexicalType'] for x in original):raise ValueError('duplicate_lexeme')
        return
    if not original:raise ValueError('entry_not_found')
    target=next((x for x in original if x.get('lexeme_id')==changes['lexemeId']),None)
    if target is None:raise ValueError('entry_not_found')
    senses=target.get('senses',[])
    if op=='add_sense' and any(normalize_search(x['definition_en'])==normalize_search(changes['definitionEn']) for x in senses):raise ValueError('duplicate_sense')
    if op=='edit_sense':
        sense=next((x for x in senses if x['sense_id']==changes['senseId']),None)
        if sense is None:raise ValueError('sense_not_found')
        ids={e['example_id'] for e in sense['examples']}
        if any(e['exampleId'] not in ids for e in changes.get('examples',[])):raise ValueError('example_not_found')

@router.patch('/api/owner/dictionary/{action:path}')
async def edit_dictionary_draft(req:Request,action:str):
    owner=await core.current_user(req,active=True)
    if not owner or owner['role']!='owner':return core.j({'error':'forbidden'},403)
    bits=action.split('/')
    if len(bits)!=2 or bits[0]!='drafts' or not core.uuid_value(bits[1]):return core.j({'error':'not_found'},404)
    changes=draft_schema(await core.payload(req))
    if changes is None:return core.j({'error':'invalid_input'},400)
    try:
        db=await core.pool()
        async with dictionary_write_slot(), db.acquire() as con:
            async with con.transaction():
                await con.execute('SELECT pg_advisory_xact_lock(387384)')
                old=await con.fetchrow('''SELECT changes,base_release_id FROM dictionary_drafts
                    WHERE id=$1 AND owner_user_id=$2 AND state='draft' FOR UPDATE''',core.uuid_value(bits[1]),owner['id'])
                if not old:raise ValueError('entry_not_found')
                busy=await con.fetchrow('''SELECT id FROM dictionary_publish_jobs
                    WHERE phase NOT IN ('complete','failed') AND $1=ANY(draft_ids)''',core.uuid_value(bits[1]))
                if busy:raise ValueError('publish_already_running')
                active=await active_release(con)
                if active['active_release_id']!=old['base_release_id']:raise ValueError('stale_draft')
                release=active['active_release_id']
                if changes['operation']=='add_lexeme':
                    ids=await con.fetch('''SELECT lexeme_id FROM dictionary_entries
                      WHERE release_id=$1 AND lemma_norm=$2''',release,normalize_search(changes['lemma']))
                    original=[v for idrow in ids if (v:=await entry(con,idrow['lexeme_id'],release))]
                else:
                    got=await entry(con,core.uuid_value(changes['lexemeId']),release)
                    original=[got] if got else []
                apply_validation(original,changes)
                before=old['changes']
                if isinstance(before,str):before=json.loads(before)
                await con.execute('''UPDATE dictionary_drafts SET changes=$2::jsonb,updated_at=now() WHERE id=$1''',
                                  core.uuid_value(bits[1]),json.dumps(changes,ensure_ascii=False))
                await con.execute('''INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,
                      base_release_id,before_state,after_state,validation_result)
                      VALUES($1,'edit_draft',$2,$3,$4::jsonb,$5::jsonb,'{"pass":true}'::jsonb)''',
                      owner['id'],bits[1],release,json.dumps(before),json.dumps(changes,ensure_ascii=False))
        return core.j({'ok':True},headers=PRIVATE)
    except DictionaryBusy:return busy_response()
    except Exception as exc:return error_response(exc)

def install():core.app.include_router(router)
