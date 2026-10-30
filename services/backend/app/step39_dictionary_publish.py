"""Owner dictionary draft-save and staged SQL release publishing.

Port of dictionary/{model,store,publish}.ts (PostgreSQL release path). Draft
changes, release copies, search index and manifest are durable across requests.
"""
from __future__ import annotations
import copy,hashlib,json,os,uuid,math
from fastapi import APIRouter,Request,BackgroundTasks
from . import main as core
from .dictionary_gate import dictionary_write_slot,DictionaryBusy,busy_response
from .step17_dictionary_read_port import active_release,entry,error_response,normalize_search
from .step27_dictionary_edit import draft_schema,apply_validation

router=APIRouter();PRIVATE={'Cache-Control':'private, no-store'}
LOCK='SELECT pg_advisory_xact_lock(387384)'

from .dictionary_canonical import stable
def sha(v):return hashlib.sha256(v.encode('utf-8')).hexdigest()
def proj(kind,key):
    data=bytearray(hashlib.sha256(f'learners-area-dictionary-v1:{kind}:{key}'.encode()).digest()[:16]);data[6]=(data[6]&15)|80;data[8]=(data[8]&63)|128
    return str(uuid.UUID(bytes=bytes(data)))
def pos(x):return {'n':'noun','v':'verb','a':'adjective','r':'adverb'}.get(x,x)
def content_hash(e):return sha(stable({k:v for k,v in e.items() if k!='release_id'}))
def entry_terms(e):
    d={}
    def add(lang,text,rank):
        norm=normalize_search(text)
        if norm and len(norm)<=6000:
            k=(lang,norm);d[k]=min(rank,d.get(k,rank))
    add('EN',e['display_lemma'],0);add('EN',e['normalized_search_form'],1)
    for f in e['forms']:add('EN',f['surface_form'],2)
    for s in e['senses']:
        for t in s['translations']:
            add('UZ',t['text'],0)
            for part in normalize_search(t['text']).split(' '):add('UZ',part,1)
        add('UZ',s['definition_uz'],2)
        for part in normalize_search(s['definition_uz']).split(' '):add('UZ',part,2)
    return [{'direction':lang,'term':term,'rank':rank} for (lang,term),rank in d.items()]

def apply_draft(entries,change,release):
    op=change['operation'];apply_validation(entries,change)
    if op=='add_lexeme':
        key='|'.join([normalize_search(change['lemma']),pos(change['partOfSpeech']),change['lexicalType']])
        e={'schema_version':'1.0.0','release_id':release,'lexeme_id':proj('lexeme',key),
           'display_lemma':change['lemma'],'normalized_search_form':normalize_search(change['lemma']),
           'part_of_speech':change['partOfSpeech'],'lexical_type':change['lexicalType'],
           'homograph_group':None,'is_satellite':False,'pronunciations':[],'forms':[],
           'senses':[],'relations':[],'collocations':[],'attribution':[{'source_name':'Learners Area',
            'snapshot_id':'learners_area_custom','creator':'Learners Area','source_url':'',
            'license_reference':'Learners Area owned','license_url':'','attribution_text':'Learners Area custom entry'}]}
    else:e=copy.deepcopy(next(x for x in entries if str(x['lexeme_id'])==change['lexemeId']))
    e['release_id']=release
    if op=='edit_sense':
        s=next(x for x in e['senses'] if str(x['sense_id'])==change['senseId'])
        if 'translationUz' in change:s['translations'][0]['text']=change['translationUz']
        if 'definitionUz' in change:s['definition_uz']=change['definitionUz']
        for edit in change.get('examples',[]):
            target=next(x for x in s['examples'] if str(x['example_id'])==edit['exampleId'])
            target['text_uz']=edit['textUz']
    else:
        sense_id=proj('sense',str(e['lexeme_id'])+'|'+normalize_search(change['definitionEn']))
        e['senses'].append({'sense_id':sense_id,'definition_en':change['definitionEn'],
          'definition_uz':change['definitionUz'], 'translations':[{'translation_id':proj('translation',sense_id),
            'text':change['translationUz'],'order':0}], 'examples':[{'example_id':proj('example',sense_id+'|'+str(i)+'|'+x['textEn']),
            'text_en':x['textEn'],'text_uz':x['textUz']} for i,x in enumerate(change['examples'])]})
    return e

async def get_entries(con,release,ids):
    result=[]
    for id in ids:
        got=await entry(con,uuid.UUID(str(id)),release)
        if got:result.append(got)
    return result

async def put_entry(con,e):
    # Denormalized search-preview used by the owner's worker and SQL readers.
    senses=e['senses'];preview={'display_lemma':e['display_lemma'],
       'translation_uz':', '.join(t['text'] for t in senses[0]['translations']),
       'uz_terms':[{'text':t['text'],'norm':normalize_search(t['text'])} for s in senses for t in s['translations']],
       'custom':any(a['source_name']=='Learners Area' for a in e['attribution'])}
    await con.execute('''INSERT INTO dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,
      payload,content_sha,is_custom,search_preview,sense_ids,example_ids)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::uuid[],$11::uuid[])
      ON CONFLICT(release_id,lexeme_id) DO UPDATE SET payload=EXCLUDED.payload,
      content_sha=EXCLUDED.content_sha,is_custom=EXCLUDED.is_custom,
      lemma_norm=EXCLUDED.lemma_norm,part_of_speech=EXCLUDED.part_of_speech,
      lexical_type=EXCLUDED.lexical_type,search_preview=EXCLUDED.search_preview,
      sense_ids=EXCLUDED.sense_ids,example_ids=EXCLUDED.example_ids,
      storage_shard=NULL,storage_release=NULL,storage_offset=NULL,storage_length=NULL,storage_raw_bytes=NULL''',
      e['release_id'],uuid.UUID(str(e['lexeme_id'])),normalize_search(e['display_lemma']),
      e['part_of_speech'],e['lexical_type'],json.dumps(e,ensure_ascii=False),content_hash(e),preview['custom'],
      json.dumps(preview,ensure_ascii=False),[uuid.UUID(str(s['sense_id'])) for s in senses],
      [uuid.UUID(str(x['example_id'])) for s in senses for x in s['examples']])

async def make_manifest(con,release):
    """Release inventory used by both legacy PostgreSQL and R2-backed releases.

    Mirrors dictionary/store.ts releaseManifest; the worker's logicalTerms
    becomes the authoritative search count once an R2 index is installed.
    """
    rows=await con.fetch('SELECT lexeme_id,content_sha,sense_ids,example_ids FROM dictionary_entries WHERE release_id=$1 ORDER BY lexeme_id',release)
    terms=await con.fetchval('SELECT count(*) FROM dictionary_search_terms WHERE release_id=$1',release)
    worker=await con.fetchval('SELECT descriptor FROM dictionary_search_indexes WHERE release_id=$1',release)
    if isinstance(worker,str):worker=json.loads(worker)
    if not rows or not (worker or terms):raise ValueError('index_validation_failed')
    senses=sorted(str(x) for r in rows for x in (r['sense_ids'] or []))
    examples=sorted(str(x) for r in rows for x in (r['example_ids'] or []))
    if len(senses)!=len(set(senses)) or len(examples)!=len(set(examples)):raise ValueError('duplicate_identity')
    shards=await con.fetch('SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 ORDER BY shard',release)
    descriptors=[json.loads(x['descriptor']) if isinstance(x['descriptor'],str) else x['descriptor'] for x in shards]
    result={'schema_version':'learners-area-database-release-v1','release_id':release,
      'lexemes':len(rows),'senses':len(senses),'examples':len(examples),
      'search_terms':int(worker['logicalTerms'] if worker else terms),
      'entry_inventory_sha256':sha('\n'.join(str(r['lexeme_id'])+':'+r['content_sha'] for r in rows)),
      'sense_set_sha256':sha(json.dumps(senses,separators=(',',':'))),
      'example_set_sha256':sha(json.dumps(examples,separators=(',',':'))),
      'normalization_version':'unicode-nfkc-casefold-apostrophe-hyphen-whitespace-v1'}
    if descriptors:
        result['storage']={'version':1,'shards':descriptors}
        if worker:result['storage']['search']=worker
    return result

async def create_draft(con,owner,changes):
    await con.execute(LOCK);active=await active_release(con);rel=active['active_release_id']
    ids=[]
    if changes['operation']=='add_lexeme':
        rows=await con.fetch('SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1 AND lemma_norm=$2',rel,normalize_search(changes['lemma']))
        ids=[r['lexeme_id'] for r in rows]
    else:ids=[changes['lexemeId']]
    original=await get_entries(con,rel,ids)
    apply_draft(original,changes,rel)
    row=await con.fetchrow('''INSERT INTO dictionary_drafts(owner_user_id,base_release_id,changes)
       VALUES($1,$2,$3::jsonb) RETURNING id''',owner,rel,json.dumps(changes,ensure_ascii=False))
    await con.execute('''INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,
     before_state,after_state,validation_result) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'{"pass":true}'::jsonb)''',
     owner,changes['operation'],str(row['id']),rel,json.dumps(original[0] if original else None,ensure_ascii=False),
     json.dumps(changes,ensure_ascii=False))
    return {'id':str(row['id'])}

async def start_publish(con,owner):
    await con.execute(LOCK)
    if await con.fetchval("SELECT 1 FROM dictionary_publish_jobs WHERE phase NOT IN ('complete','failed') LIMIT 1"):
        raise ValueError('publish_already_running')
    ch=await active_release(con);release=ch['active_release_id']
    drafts=await con.fetch('''SELECT id,changes,base_release_id FROM dictionary_drafts
      WHERE owner_user_id=$1 AND state='draft' ORDER BY created_at,id FOR UPDATE''',owner)
    if not drafts:raise ValueError('no_drafts')
    if len(drafts)>100:raise ValueError('draft_batch_limit')
    if any(d['base_release_id']!=release for d in drafts):raise ValueError('stale_draft')
    delivery=await con.fetchval('SELECT delivery FROM dictionary_releases WHERE id=$1',release)
    cap=await con.fetchrow('''SELECT pg_database_size(current_database())::text bytes,
      pg_total_relation_size('dictionary_entries')::text entries,
      pg_total_relation_size('dictionary_search_terms')::text terms,
      (SELECT count(*)::int FROM dictionary_releases WHERE state='validated') releases''')
    quota=float(os.getenv('DICTIONARY_DATABASE_LIMIT_BYTES') or (500000000 if os.getenv('APP_ENV')=='production' else 9007199254740991))
    reserve=(int(cap['entries'])+(0 if delivery=='r2-worker-v1' else int(cap['terms'])))/max(1,cap['releases'])
    if not math.isfinite(quota) or quota<1 or int(cap['bytes'])+reserve+25000000>quota:
        raise ValueError('dictionary_capacity_exceeded')
    cand='rel-v1-'+sha(stable({'base':release,'drafts':[{'id':str(d['id']),'changes':d['changes']} for d in drafts]}))[:24]
    if await con.fetchval('SELECT 1 FROM dictionary_releases WHERE id=$1',cand):raise ValueError('candidate_already_exists')
    await con.execute('''INSERT INTO dictionary_releases(id,base_release_id,state,created_by,delivery)
      VALUES($1,$2,'building',$3,$4)''',cand,release,owner,'r2-worker-v1' if delivery=='r2-worker-v1' else 'legacy')
    ids=[d['id'] for d in drafts]
    job=await con.fetchrow('''INSERT INTO dictionary_publish_jobs(owner_user_id,base_release_id,
     candidate_release_id,draft_ids,phase) VALUES($1,$2,$3,$4::uuid[],'copy') RETURNING *''',owner,release,cand,ids)
    await con.execute('''INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,
      base_release_id,candidate_release_id,validation_result)
      VALUES($1,'publish_started',$2,$3,$4,'{"pass":true}'::jsonb)''',owner,str(job['id']),release,cand)
    return dict(job)

async def advance_publish(con,owner,id):
    await con.execute(LOCK)
    job=await con.fetchrow('''SELECT * FROM dictionary_publish_jobs WHERE id=$1 AND owner_user_id=$2 FOR UPDATE''',id,owner)
    if not job:raise ValueError('job_not_found')
    job=dict(job)
    if job['phase'] in ('complete','failed','worker_index'):return job
    ch=await active_release(con)
    if ch['active_release_id']!=job['base_release_id']:raise ValueError('release_mismatch')
    cand=job['candidate_release_id'];base=job['base_release_id'];phase=job['phase'];cursor=job['cursor_id'];nxt=phase
    worker=(await con.fetchval('SELECT delivery FROM dictionary_releases WHERE id=$1',cand))=='r2-worker-v1'
    if phase=='copy':
        batch=await con.fetch('''SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1
          AND ($2::uuid IS NULL OR lexeme_id>$2) ORDER BY lexeme_id LIMIT 500''',base,cursor)
        if batch:
            await con.execute('''INSERT INTO dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,
             content_sha,is_custom,storage_offset,storage_length,storage_raw_bytes,storage_shard,storage_release,search_preview,sense_ids,example_ids)
             SELECT $1,lexeme_id,lemma_norm,part_of_speech,lexical_type,
               CASE WHEN payload IS NULL THEN NULL ELSE jsonb_set(payload,'{release_id}',to_jsonb($1::text)) END,
               content_sha,is_custom,storage_offset,storage_length,storage_raw_bytes,storage_shard,storage_release,
               search_preview,sense_ids,example_ids FROM dictionary_entries WHERE release_id=$2 AND lexeme_id=ANY($3::uuid[])
             ON CONFLICT DO NOTHING''',cand,base,[x['lexeme_id'] for x in batch]);cursor=batch[-1]['lexeme_id']
        else:nxt='apply';cursor=None
    elif phase=='apply':
        drafts=await con.fetch('''SELECT id,changes FROM dictionary_drafts WHERE id=ANY($1::uuid[])
         AND state='draft' AND owner_user_id=$2 ORDER BY created_at,id''',job['draft_ids'],owner)
        if len(drafts)!=len(job['draft_ids']):raise ValueError('draft_set_changed')
        edits={}
        for d in drafts:
            changes=d['changes'] if isinstance(d['changes'],dict) else json.loads(d['changes'])
            if changes['operation']=='add_lexeme':
                rows=await con.fetch('''SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1
                  AND lemma_norm=$2 AND lexical_type=$3''',cand,normalize_search(changes['lemma']),changes['lexicalType'])
                ids=[r['lexeme_id'] for r in rows]
            else:ids=[changes['lexemeId']]
            entries=await get_entries(con,cand,ids)
            entries=[edits.get(str(e['lexeme_id']),e) for e in entries]
            if changes['operation']=='add_lexeme':entries.extend(e for e in edits.values() if normalize_search(e['display_lemma'])==normalize_search(changes['lemma']) and str(e['lexeme_id']) not in {str(i) for i in ids})
            e=apply_draft(entries,changes,cand)
            if not worker:await put_entry(con,e)
            edits[str(e['lexeme_id'])]=e
        if worker:
            from .step40_dictionary_storage import write_shard
            for prefix in sorted({ident[:2] for ident in edits}):
                rows=await con.fetch("SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1 AND left(lexeme_id::text,2)=$2 ORDER BY lexeme_id",cand,prefix)
                group={e['lexeme_id']:e for e in await get_entries(con,cand,[r['lexeme_id'] for r in rows])}
                group.update({ident:e for ident,e in edits.items() if ident[:2]==prefix})
                await write_shard(con,list(group.values()),False)
        nxt='validate' if worker else 'index';cursor=None
    elif phase=='index':
        batch=await con.fetch('''SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1
          AND ($2::uuid IS NULL OR lexeme_id>$2) ORDER BY lexeme_id LIMIT 150''',cand,cursor)
        if batch:
            for e in await get_entries(con,cand,[b['lexeme_id'] for b in batch]):
                for t in entry_terms(e):
                    await con.execute('''INSERT INTO dictionary_search_terms(release_id,lexeme_id,direction,term,rank)
                      VALUES($1,$2,$3,$4,$5) ON CONFLICT(release_id,lexeme_id,direction,term)
                      DO UPDATE SET rank=LEAST(dictionary_search_terms.rank,excluded.rank)
                      WHERE dictionary_search_terms.rank>excluded.rank''',cand,uuid.UUID(str(e['lexeme_id'])),t['direction'],t['term'],t['rank'])
            cursor=batch[-1]['lexeme_id']
        else:nxt='validate';cursor=None
    elif phase=='validate':
        batch=await con.fetch('''SELECT lexeme_id,content_sha FROM dictionary_entries WHERE release_id=$1
           AND ($2::uuid IS NULL OR lexeme_id>$2) ORDER BY lexeme_id LIMIT 150''',cand,cursor)
        if batch:
            original=await get_entries(con,base,[b['lexeme_id'] for b in batch]);before={str(e['lexeme_id']):e for e in original}
            for e in await get_entries(con,cand,[b['lexeme_id'] for b in batch]):
                if e['release_id']!=cand or content_hash(e)!=next(b['content_sha'] for b in batch if str(b['lexeme_id'])==str(e['lexeme_id'])):
                    raise ValueError('release_validation_failed')
                r=await con.fetch('''SELECT direction,term,rank FROM dictionary_search_terms
                        WHERE release_id=$1 AND lexeme_id=$2''',cand,uuid.UUID(str(e['lexeme_id'])))
                actual=sorted(stable({'direction':x['direction'],'term':x['term'],'rank':x['rank']}) for x in r)
                expected=sorted(stable(x) for x in entry_terms(e))
                if not worker and actual!=expected:raise ValueError('index_validation_failed')
                old=before.get(str(e['lexeme_id']))
                if old:
                    if any(old[k]!=e[k] for k in ('display_lemma','part_of_speech','lexical_type')):raise ValueError('source_english_changed')
                    for s in old['senses']:
                        now=next((x for x in e['senses'] if x['sense_id']==s['sense_id']),None)
                        if not now or now['definition_en']!=s['definition_en'] or any(not any(x['example_id']==ex['example_id'] and x['text_en']==ex['text_en'] for x in now['examples']) for ex in s['examples']):
                            raise ValueError('source_english_changed')
            cursor=batch[-1]['lexeme_id']
        else:
            if not worker:
                manifest=await make_manifest(con,cand)
                await con.execute('''UPDATE dictionary_releases SET state='validated',manifest=$2::jsonb,manifest_sha=$3,
                   validated_at=NOW() WHERE id=$1 AND state='building' ''',cand,json.dumps(manifest),sha(stable(manifest)))
                nxt='activate'
            else:nxt='offload'
            cursor=None
    elif phase=='offload':
        from .step40_dictionary_storage import write_shard,put_immutable,manifest_key
        first=await con.fetchrow('''SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1
             AND (payload IS NOT NULL OR storage_release<>$1) ORDER BY lexeme_id LIMIT 1''',cand)
        if first:
            prefix=str(first['lexeme_id'])[:2]
            rows=await con.fetch('''SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1
                 AND left(lexeme_id::text,2)=$2 ORDER BY lexeme_id''',cand,prefix)
            await write_shard(con,await get_entries(con,cand,[r['lexeme_id'] for r in rows]),not worker)
        elif worker:nxt='worker_index';cursor=None
        else:
            manifest=await make_manifest(con,cand)
            await put_immutable(manifest_key(cand),stable(manifest).encode())
            await con.execute('''UPDATE dictionary_releases SET state='validated',manifest=$2::jsonb,manifest_sha=$3,
               validated_at=NOW() WHERE id=$1 AND state='building' ''',cand,json.dumps(manifest),sha(stable(manifest)))
            nxt='activate';cursor=None
    elif phase=='activate':
        release=await con.fetchrow('''SELECT manifest,manifest_sha FROM dictionary_releases WHERE id=$1 AND state='validated' ''',cand)
        if not release or sha(stable(release['manifest']))!=release['manifest_sha']:
            raise ValueError('manifest_validation_failed')
        await con.execute('''UPDATE dictionary_channels SET previous_release_id=active_release_id,active_release_id=$1,
            updated_at=NOW() WHERE name='stable' AND active_release_id=$2''',cand,base)
        await sync_learner_fields(con,cand)
        await con.execute('''UPDATE dictionary_drafts SET state='published',result_release_id=$1,updated_at=NOW()
         WHERE id=ANY($2::uuid[])''',cand,job['draft_ids'])
        await con.execute('''INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,
          base_release_id,candidate_release_id,result_release_id,validation_result)
          VALUES($1,'publish',$2,$3,$4,$4,'{"pass":true}'::jsonb)''',owner,str(id),base,cand)
        nxt='complete';cursor=None
    updated=await con.fetchrow('''UPDATE dictionary_publish_jobs SET phase=$2,cursor_id=$3,
      updated_at=NOW() WHERE id=$1 RETURNING *''',id,nxt,cursor)
    return dict(updated)

async def sync_learner_fields(con,release):
    mapped=await con.fetch('''SELECT e.lexeme_id,m.app_sense_id,m.sense_id FROM dictionary_sense_mappings m
       JOIN dictionary_entries e ON e.release_id=$1 AND
       (m.sense_id=ANY(e.sense_ids) OR (e.sense_ids IS NULL AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(e.payload->'senses') s WHERE s->>'sense_id'=m.sense_id::text)))''',release)
    for m in mapped:
        got=await entry(con,m['lexeme_id'],release)
        sense=next((s for s in got['senses'] if s['sense_id']==str(m['sense_id'])),None) if got else None
        if not sense:raise ValueError('sense_not_found')
        await con.execute('''UPDATE lexemes SET translation_uz=$2,
           example_sentence=COALESCE($3,example_sentence) WHERE id=$1''',m['app_sense_id'],
           sense['translations'][0]['text'],sense['examples'][0]['text_en'] if sense['examples'] else None)

async def retry_worker_index(con,owner,job_id):
    await con.execute(LOCK)
    channel=await active_release(con)
    row=await con.fetchrow('''SELECT j.* FROM dictionary_publish_jobs j
      JOIN dictionary_releases r ON r.id=j.candidate_release_id
      WHERE j.id=$1 AND j.owner_user_id=$2 AND j.phase='failed'
        AND j.error='dictionary_index_build_failed' AND r.state='building'
        AND r.delivery='r2-worker-v1' FOR UPDATE OF j''',job_id,owner)
    if not row:raise ValueError('job_not_found')
    if row['base_release_id']!=channel['active_release_id']:raise ValueError('release_mismatch')
    if await con.fetchval("SELECT 1 FROM dictionary_publish_jobs WHERE phase NOT IN ('complete','failed') LIMIT 1"):
        raise ValueError('publish_already_running')
    return dict(await con.fetchrow('''UPDATE dictionary_publish_jobs SET phase='worker_index',error=NULL,
      worker_lease_token=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=$1 RETURNING *''',job_id))

async def rollback(con,owner):
    await con.execute(LOCK)
    if await con.fetchval("SELECT 1 FROM dictionary_publish_jobs WHERE phase NOT IN ('complete','failed') LIMIT 1"):
        raise ValueError('publish_already_running')
    ch=await active_release(con);prev=ch['previous_release_id'];active=ch['active_release_id']
    if not prev:raise ValueError('previous_release_unavailable')
    row=await con.fetchrow("SELECT manifest,manifest_sha FROM dictionary_releases WHERE id=$1 AND state='validated'",prev)
    if not row or sha(stable(row['manifest']))!=row['manifest_sha']:raise ValueError('manifest_validation_failed')
    if isinstance(row['manifest'],dict) and row['manifest'].get('storage'):
        from .step40_dictionary_storage import verify_release_objects
        await verify_release_objects(prev,row['manifest'])
    rebuilt=await make_manifest(con,prev)
    if stable(rebuilt)!=stable(row['manifest']):raise ValueError('release_validation_failed')
    await con.execute('''UPDATE dictionary_channels SET active_release_id=$1,previous_release_id=$2,
         updated_at=NOW() WHERE name='stable' ''',prev,active)
    await sync_learner_fields(con,prev)
    await con.execute('''INSERT INTO dictionary_owner_events(owner_user_id,operation,base_release_id,
        result_release_id,validation_result) VALUES($1,'rollback',$2,$3,'{"pass":true}'::jsonb)''',owner,active,prev)
    return {'active':prev,'previous':active}

@router.post('/api/owner/dictionary/{action:path}')
async def dictionary_post(req:Request,action:str,background_tasks:BackgroundTasks):
    user=await core.current_user(req,active=True)
    if not user or user['role']!='owner':return core.j({'error':'forbidden'},403,PRIVATE)
    parts=action.split('/')
    if parts==['drafts']:
        body=draft_schema(await core.payload(req))
        if body is None:return core.j({'error':'invalid_input'},400)
        operation='draft'
    elif parts==['publish']:operation='start'
    elif len(parts)==2 and parts[0]=='publish' and core.uuid_value(parts[1]):operation='advance'
    elif len(parts)==3 and parts[0]=='publish' and core.uuid_value(parts[1]) and parts[2]=='retry':operation='retry'
    elif parts==['rollback']:operation='rollback'
    else:return core.j({'error':'not_found'},404)
    db=await core.pool()
    started=False
    try:
        async with dictionary_write_slot(), db.acquire() as con:
            async with con.transaction():
                started=True
                if operation=='draft':data={'draft':await create_draft(con,user['id'],body)}
                elif operation=='start':data={'job':await start_publish(con,user['id'])}
                elif operation=='advance':data={'job':await advance_publish(con,user['id'],core.uuid_value(parts[1]))}
                elif operation=='rollback':data=await rollback(con,user['id'])
                else:data={'job':await retry_worker_index(con,user['id'],core.uuid_value(parts[1]))}
        if operation in ('advance','retry') and data.get('job',{}).get('phase')=='worker_index':
            from .step40_dictionary_index import finish_worker_index
            background_tasks.add_task(finish_worker_index,user['id'],data['job']['id'])
        return core.j(data,headers=PRIVATE)
    except DictionaryBusy:
        return busy_response()
    except Exception as exc:
        if operation=='advance' and started:
            # An aborted DB transaction must be followed by durable failed-job
            # metadata, as in publish.ts; do not mask the original API error.
            try:
                reason=(str(exc) or 'publish_failed')[:120]
                async with dictionary_write_slot(), db.acquire() as con:
                    async with con.transaction():
                        await con.execute(LOCK)
                        await con.execute("UPDATE dictionary_publish_jobs SET phase='failed',error=$3,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND phase NOT IN ('complete','failed')",core.uuid_value(parts[1]),user['id'],reason)
                        await con.execute("INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,validation_result) VALUES($1,'publish_failed',$2,$3::jsonb)",user['id'],parts[1],json.dumps({'pass':False,'error':reason}))
            except Exception:pass
        return error_response(exc)

def install():core.app.include_router(router)
