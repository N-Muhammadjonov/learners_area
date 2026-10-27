"""Dictionary search/history and release pinning from the original data store.

Uses the same release channel and optional HMAC-signed Dictionary Worker gateway.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import os
import re
import time
import unicodedata
from urllib.parse import urlparse
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .rate_limit import counter,RULES
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
CASEFOLD=json.loads(Path(__file__).with_name('dictionary_frozen_casefold.json').read_text())
# The original Node.js 22 backend uses Unicode 16.0 (Python 3.13 uses 15.1).
# These small, frozen deltas were derived by comparing *every Unicode scalar*
# under Node 22's NFKC and per-codepoint toLowerCase. No Node runtime needed.
UNICODE16=json.loads(Path(__file__).with_name('dictionary_unicode16_overrides.json').read_text())
LOWER16=UNICODE16['lower']; NFKC16=UNICODE16['nfkc']
# ECMAScript's \s and trim() do not include Python's U+001C..1F/U+0085,
# but they do include U+FEFF. The same set is used by both JS operations.
JS_SPACE=' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
JS_SPACES=re.compile('['+JS_SPACE+']+')
RULES.setdefault('vocabulary_search',(300,60))
ERRORS={'dictionary_unavailable','dictionary_capacity_exceeded','release_mismatch','sense_not_found','entry_not_found','duplicate_lexeme',
'duplicate_sense','example_not_found','publish_already_running','no_drafts','stale_draft','draft_batch_limit','candidate_already_exists','job_not_found',
'previous_release_unavailable','manifest_validation_failed','index_validation_failed','release_validation_failed','draft_set_changed'}

def normalize_search(value):
    # NFKC compatibility mappings added in Unicode 16 before the bundled
    # Python unicodedata release; then normalize the entire string at once.
    s=unicodedata.normalize('NFKC',''.join(NFKC16.get(c,c) for c in value))
    s=''.join({"\u02bb":"'","\u02bc":"'","\u2018":"'","\u2019":"'",'`':"'",'\u00b4':"'"}.get(c,c) for c in s)
    s=''.join('-' if c in '‐‑‒–—−' else c for c in s)
    folded=''.join(CASEFOLD[c] if c in CASEFOLD else LOWER16.get(c,c.lower()) for c in s)
    return JS_SPACES.sub(' ',folded).strip(JS_SPACE)

async def active_release(con):
    v=await con.fetchrow("SELECT active_release_id,previous_release_id FROM dictionary_channels WHERE name='stable'")
    if not v:raise ValueError('dictionary_unavailable')
    return v

async def pinned(con,requested=None):
    channel=await active_release(con)
    if requested and requested!=channel['active_release_id']:raise ValueError('release_mismatch')
    return channel['active_release_id']

def error_response(exc):
    code=str(exc)
    return core.j({'error':code if code in ERRORS else 'temporarily_unavailable'},409 if code in ERRORS else 503,PRIVATE)

async def worker(input):
    import httpx
    target=os.environ.get('DICTIONARY_WORKER_URL','').strip()
    secret=os.environ.get('DICTIONARY_SIGNING_SECRET','')
    parsed=urlparse(target)
    if (not target or len(secret)<32 or parsed.username or parsed.password or parsed.query or parsed.fragment or
        parsed.path not in ('','/') or not (parsed.scheme=='https' or (os.environ.get('NODE_ENV')!='production' and parsed.scheme=='http' and parsed.hostname=='127.0.0.1'))):
        raise ValueError('dictionary_worker_unavailable')
    content=json.dumps(input,separators=(',',':'),ensure_ascii=False)
    now=int(time.time())
    message='learners-area:dictionary-gateway:v1\n'+str(now)+'\n'+content
    digest=hmac.new(secret.encode(),message.encode(),hashlib.sha256).digest()
    sig=base64.urlsafe_b64encode(digest).decode().rstrip('=')
    async with httpx.AsyncClient(timeout=10,follow_redirects=False) as client:
        resp=await client.post(target.rstrip('/')+'/v1/dictionary',content=content.encode(),headers={'Content-Type':'application/json','X-LA-Dictionary-Proof':f'{now}:{sig}'})
    if resp.status_code!=200 or len(resp.content)>2*1024*1024:raise ValueError('dictionary_worker_unavailable')
    return resp.json()

async def entry(con,lexeme_id,release):
    row=await con.fetchrow('''SELECT e.lexeme_id,e.payload,e.storage_shard,e.storage_release,e.content_sha,
      i.release_id worker_release,s.descriptor shard_descriptor,e.storage_offset,e.storage_length,e.storage_raw_bytes,
      t.state target_state
      FROM dictionary_entries e JOIN dictionary_releases t ON t.id=e.release_id
      LEFT JOIN dictionary_search_indexes i ON i.release_id=e.storage_release
      LEFT JOIN dictionary_r2_shards s ON s.release_id=e.storage_release AND s.shard=e.storage_shard
      WHERE e.release_id=$1 AND e.lexeme_id=$2''',release,lexeme_id)
    if not row:return None
    if row['payload'] is not None:return json.loads(row['payload']) if isinstance(row['payload'],str) else row['payload']
    if row['worker_release']:
        source=row['storage_release']
        if not source or not row['shard_descriptor'] or (row['target_state']=='validated' and source!=release):raise ValueError('manifest_validation_failed')
        q={'action':'entry','release':source,'lexemeId':str(row['lexeme_id']),'shard':row['shard_descriptor']}
        if row['storage_offset'] is not None:q.update({'range':{'offset':row['storage_offset'],'length':row['storage_length'],'raw_bytes':row['storage_raw_bytes']},'contentSha':row['content_sha']})
        ret=await worker(q)
        got=ret.get('entry') if isinstance(ret,dict) else None
        if not got or got.get('lexeme_id')!=str(row['lexeme_id']):raise ValueError('dictionary_entry_checksum_mismatch')
        from .dictionary_canonical import stable
        content_sha=hashlib.sha256(stable({k:v for k,v in got.items() if k!='release_id'}).encode()).hexdigest()
        if content_sha!=row['content_sha']:raise ValueError('dictionary_entry_checksum_mismatch')
        if source!=release:got={**got,'release_id':release}
        return got
    if row['storage_shard'] and row['storage_release']:
        # R2-backed pre-worker releases and under-construction candidates can be
        # hydrated from their immutable, checksum-verified shard. Candidate
        # releases may still point to the base shard until they are offloaded.
        from .step40_dictionary_storage import read_shard
        if row['target_state']=='validated' and row['storage_release']!=release:
            raise ValueError('manifest_validation_failed')
        descriptor=row['shard_descriptor']
        if isinstance(descriptor,str):descriptor=json.loads(descriptor)
        if descriptor is None:
            item=await con.fetchval('SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 AND shard=$2',row['storage_release'],row['storage_shard'])
            descriptor=json.loads(item) if isinstance(item,str) else item
        if not descriptor:raise ValueError('manifest_validation_failed')
        records=await read_shard(row['storage_release'],descriptor)
        got=next((e for e in records if e['lexeme_id']==str(row['lexeme_id'])),None)
        if got is None:raise ValueError('dictionary_entry_checksum_mismatch')
        from .step39_dictionary_publish import content_hash
        if content_hash(got)!=row['content_sha']:raise ValueError('dictionary_entry_checksum_mismatch')
        return got if row['storage_release']==release else {**got,'release_id':release}
    raise ValueError('dictionary_storage_unavailable')

@router.get('/api/dictionary/recent')
async def get_recent(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            rel=await active_release(con)
            records=await con.fetch('''SELECT r.query_display,r.query_norm,r.direction,r.lexeme_id
              FROM dictionary_recent_searches r JOIN dictionary_entries e
              ON e.release_id=$2 AND e.lexeme_id=r.lexeme_id WHERE r.user_id=$1
              ORDER BY r.searched_at DESC,r.lexeme_id LIMIT 5''',u['id'],rel['active_release_id'])
            recent=[]
            for r in records:
                e=await entry(con,r['lexeme_id'],rel['active_release_id'])
                if not e:continue
                senses=e['senses']
                matched=None
                if r['direction']=='UZ':
                    matched=next((s for s in senses if any(normalize_search(t['text'])==r['query_norm'] for t in s['translations'])),None)
                    if matched is None:matched=next((s for s in senses if any(normalize_search(t['text']).startswith(r['query_norm']) for t in s['translations'])),None)
                from .dictionary_reader_metadata import details
                view=details(e)
                s=matched or next(s for s in senses if s['sense_id']==view['primarySenseId'])
                recent.append({'query_display':r['query_display'],'direction':r['direction'],'lexeme_id':str(r['lexeme_id']),
                    'display_lemma':e['display_lemma'],'part_of_speech':e['part_of_speech'],
                    'translation_uz':', '.join(t['text'] for t in s['translations']) if matched else view['primaryTranslation'], 'cefr':s.get('cefr') if s else None})
        return core.j({'recent':recent},headers=PRIVATE)
    except Exception as exc:return error_response(exc)

@router.get('/api/dictionary/search')
async def dictionary_search(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401,PRIVATE)
    key='dictionary:'+str(u['id'])
    delay=counter('vocabulary_search',key,consume=True)
    if delay:return core.j({'error':'rate_limited'},429,{**PRIVATE,'Retry-After':str(delay)})
    q=req.query_params.get('q','');direction=req.query_params.get('direction','EN')
    if len(q)>80 or direction not in ('EN','UZ'):return core.j({'error':'invalid_input'},400,PRIVATE)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            release=await pinned(con,req.query_params.get('release_id'))
            norm=normalize_search(q)
            results=[]
            if 0<len(norm)<=80:
                initial=direction+':'+norm[0]
                rec=await con.fetchrow('''SELECT coalesce(descriptor->'routes'->$2,descriptor->'routes'->$3,
                   CASE WHEN descriptor->'routes' IS NULL THEN descriptor->'directory' END) AS directory
                   FROM dictionary_search_indexes WHERE release_id=$1''',release,initial,direction+':*')
                if rec:
                    if rec['directory']:
                        response=await worker({'action':'search','release':release,'directory':rec['directory'],'query':q,'direction':direction})
                        if response.get('release_id')!=release:raise ValueError('dictionary_worker_unavailable')
                        results=response['results']
                else:
                    registry=await con.fetchrow('SELECT state,delivery FROM dictionary_releases WHERE id=$1',release)
                    if not registry or registry['state']!='validated' or registry['delivery']!='legacy':
                        raise ValueError('dictionary_worker_unavailable')
                    prefix=re.sub(r'([\\%_])',r'\\\1',norm)+'%'
                    rows=await con.fetch('''WITH hits AS (
                      SELECT lexeme_id,min(CASE WHEN term=$3 THEN rank ELSE 3 END) AS score
                      FROM dictionary_search_terms WHERE release_id=$1 AND direction=$2 AND term LIKE $4 ESCAPE '\\'
                      GROUP BY lexeme_id), picked AS (
                      SELECT e.lexeme_id,e.payload,e.search_preview,e.part_of_speech,h.score FROM hits h
                      JOIN dictionary_entries e ON e.release_id=$1 AND e.lexeme_id=h.lexeme_id
                      ORDER BY h.score,e.lemma_norm,e.lexeme_id LIMIT 20)
                      SELECT lexeme_id,coalesce(search_preview->>'display_lemma',payload->>'display_lemma') display_lemma,
                      part_of_speech,coalesce(CASE WHEN $2='UZ' THEN (SELECT t->>'text'
                       FROM jsonb_array_elements(search_preview->'uz_terms') t
                       WHERE t->>'norm' LIKE $4 ESCAPE '\\' OR t->>'norm'=$3
                       ORDER BY CASE WHEN t->>'norm'=$3 THEN 0 ELSE 1 END,t->>'norm' LIMIT 1) END,
                       search_preview->>'translation_uz',payload#>>'{senses,0,translations,0,text}') translation_uz,
                       CASE score WHEN 0 THEN 'exact_lemma' WHEN 1 THEN 'canonical_normalized'
                        WHEN 2 THEN 'form' ELSE 'prefix' END match_type FROM picked''',release,direction,norm,prefix)
                    results=[row_to_dict(r) for r in rows]
                from .dictionary_reader_metadata import enrich_search
                results=await enrich_search(con,release,results,direction)
        return core.j({'release_id':release,'results':results},headers=PRIVATE)
    except Exception as exc:return error_response(exc)

@router.post('/api/dictionary/entries/{lexemeId}')
async def remember(req:Request,lexemeId:str):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    b=await core.payload(req)
    if (not core.uuid_value(lexemeId) or not isinstance(b,dict) or not isinstance(b.get('query'),str)
      or len(b['query'])>80 or b.get('direction') not in ('EN','UZ') or not isinstance(b.get('releaseId'),str)):
        return core.j({'error':'invalid_input'},400)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            release=await pinned(con,b['releaseId'])
            if not await entry(con,lexemeId,release):return core.j({'error':'entry_not_found'},404)
            norm=normalize_search(b['query'])
            if norm and len(norm)<=80:
                async with con.transaction():
                    await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',u['id'])
                    await con.execute('''INSERT INTO dictionary_recent_searches(user_id,direction,query_norm,query_display,lexeme_id)
                       VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,lexeme_id) DO UPDATE SET
                       direction=excluded.direction,query_norm=excluded.query_norm,query_display=excluded.query_display,searched_at=now()''',
                       u['id'],b['direction'],norm,b['query'][:80],lexemeId)
                    await con.execute('''DELETE FROM dictionary_recent_searches WHERE user_id=$1 AND lexeme_id NOT IN
                       (SELECT lexeme_id FROM dictionary_recent_searches WHERE user_id=$1 ORDER BY searched_at DESC,lexeme_id LIMIT 5)''',u['id'])
        return core.j({'ok':True},headers=PRIVATE)
    except Exception as exc:return error_response(exc)

def install():core.app.include_router(router)
