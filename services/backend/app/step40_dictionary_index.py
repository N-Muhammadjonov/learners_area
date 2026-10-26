"""Bounded prefix-sorted-postings-v3 dictionary index and durable worker release.

Python port of build-index.ts, search-index.ts and publish-worker-index.ts.
Builds immutable R2 index objects from shard streams, enforces publication
lease/owner authority and records failures for explicit retries.
"""
from __future__ import annotations
import asyncio,hashlib,gzip,json,os,tempfile,time,uuid
from collections import defaultdict
from .dictionary_collation import en_sorted_pairs
from pathlib import Path
from . import main as core
from .step17_dictionary_read_port import normalize_search,active_release
from .step40_dictionary_storage import stable,compress,checksum,put_immutable,index_key,read_shard,manifest_key,read_immutable

VERSION='prefix-sorted-postings-v3'
NORMAL='unicode-nfkc-casefold-apostrophe-hyphen-whitespace-v1'
TARGET=128*1024
MAX_POSTINGS=3_000_000
MAX_PREVIEWS=64*1024*1024

def preview(e,order):
    uz={}
    for s in e['senses']:
        for t in s['translations']:uz[normalize_search(t['text'])]=t['text']
    return [e['display_lemma'],order,e['part_of_speech'],', '.join(t['text'] for t in e['senses'][0]['translations']),en_sorted_pairs(uz.items())]

def entry_terms(e):
    from .step39_dictionary_publish import entry_terms as terms
    return terms(e)

def encode(name,content):
    raw=stable(content).encode();body=compress(raw)
    if not 0<len(raw)<=2*1024*1024 or not 0<len(body)<=512*1024:
        raise ValueError('dictionary_index_object_limit')
    return body,{'name':name,'sha256':checksum(body),'raw_sha256':checksum(raw),
        'compressed_bytes':len(body),'raw_bytes':len(raw)}

async def write_index_object(release, name, content):
    """Immutable R2 index idempotency across Node/Python zlib implementations.

    The SHA in the descriptor always comes from the bytes stored in R2.
    A concurrent/previous writer may have produced different DEFLATE bytes
    for exactly the same index JSON, which must be reused, not overwritten.
    A logically different object at that immutable key is a real conflict.
    """
    body, descriptor = encode(name, content)
    key = index_key(release, name)
    try:
        await put_immutable(key, body)
        return descriptor
    except ValueError as exc:
        if str(exc) != 'immutable_dictionary_object_conflict':
            raise
    previous = await read_immutable(key, 512 * 1024)
    from .step40_dictionary_storage import decompress_bounded
    try:
        raw = decompress_bounded(previous, 2 * 1024 * 1024)
        if json.loads(raw) != content:
            raise ValueError('immutable_dictionary_object_conflict')
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('immutable_dictionary_object_conflict') from exc
    return {'name':name, 'sha256':checksum(previous), 'raw_sha256':checksum(raw),
            'compressed_bytes':len(previous), 'raw_bytes':len(raw)}


def compact(d):
    objects=[];seen={}
    for desc in list(d['leaves'].values())+list(d['branches'].values()):
        if desc['name'] not in seen:seen[desc['name']]=len(objects);objects.append(desc)
    return {'version':VERSION,'release_id':d['release_id'],'normalization':NORMAL,'objects':objects,
        'leaves':{k:seen[v['name']] for k,v in d['leaves'].items()},
        'branches':{k:seen[v['name']] for k,v in d['branches'].items()},'term_count':d['term_count']}

def lookup(page,q):
    scores={}
    for term,ids in page['terms']:
        if term.startswith(q):
            for id,rank in ids:scores[id]=min(scores.get(id,4),rank if term==q else 3)
    out=[];v=page['previews']
    for id,score in sorted(scores.items(),key=lambda z:(z[1],v[z[0]][1],z[0]))[:20]:
        p=v[id];translation=p[3]
        if page['direction']=='UZ':
            translation=next((s for n,s in p[4] if n==q),next((s for n,s in p[4] if n.startswith(q)),translation))
        out.append({'lexeme_id':id,'display_lemma':p[0],'part_of_speech':p[2],
            'translation_uz':translation,'match_type':('exact_lemma','canonical_normalized','form','prefix')[score]})
    return out

async def build_index(release,descriptors,order,heartbeat,*,writer=None,shard_reader=None):
    """Spool postings to disk and recursively split hot prefixes; never scan an entire
    release in one PostgreSQL transaction or return an unbounded index object.
    """
    previews={};preview_bytes=0;logical_terms=0
    files={};published=[];leaves={};branches={};term_count=0
    with tempfile.TemporaryDirectory(prefix='la-dictionary-index-') as folder:
        root=Path(folder)
        def file_for(direction,prefix):return root/(checksum((direction+':'+prefix).encode())+'.jsonl')
        async def serial_reader():
            for descriptor in descriptors:
                yield descriptor,await read_shard(release,descriptor)
        reader=shard_reader(release,descriptors) if shard_reader else serial_reader()
        async for descriptor,records in reader:
            buffers=defaultdict(list)
            for e in records:
                uid=e['lexeme_id']
                if e['release_id']!=release or uid not in order:raise ValueError('dictionary_index_identity_mismatch')
                p=preview(e,order[uid]);preview_bytes+=len(stable(p).encode())*2
                if preview_bytes>MAX_PREVIEWS:raise ValueError('dictionary_index_preview_budget')
                previews[uid]=p
                for term in entry_terms(e):
                    logical_terms+=1
                    if logical_terms>MAX_POSTINGS:raise ValueError('dictionary_index_posting_budget')
                    word=term['term'][:81];prefix=word[:1];key=term['direction']+':'+prefix
                    files[key]=(term['direction'],prefix,file_for(term['direction'],prefix))
                    buffers[key].append(json.dumps([word,uid,term['rank']],separators=(',',':'),ensure_ascii=False))
            for key,lines in buffers.items():
                with files[key][2].open('a',encoding='utf8') as handle:handle.write('\n'.join(lines)+'\n')
            await heartbeat()
        pages={};page_bytes=0;branch_pages={}
        async def emit(name,payload):
            desc=await writer.write(release,name,payload) if writer else await write_index_object(release,name,payload)
            published.append(desc)
            return desc
        async def flush_pages():
            nonlocal pages,page_bytes
            if not pages:return
            name='part-'+checksum(('leaves:'+'\n'.join(pages)).encode())[:24]
            desc=await emit(name,{'version':VERSION,'release_id':release,'pages':pages})
            for key in pages:leaves[key]=desc
            pages={};page_bytes=0
        async def add_page(key,page):
            nonlocal page_bytes,term_count
            size=len(stable(page).encode())+len(key.encode())+8
            if page_bytes+size>TARGET:await flush_pages()
            pages[key]=page;page_bytes+=size;term_count+=len(page['terms'])
        def line_reader(path):
            with path.open('r',encoding='utf8') as handle:
                for line in handle:
                    if len(line)>400:raise ValueError('dictionary_index_spool_corrupt')
                    yield json.loads(line)
        async def partition(direction,prefix,path):
            await heartbeat()
            # The original bounded worker only holds a 2 MB spool partition.
            if path.stat().st_size<=2*1024*1024:
                terms=defaultdict(dict)
                for term,id,rank in line_reader(path):terms[term][id]=min(terms[term].get(id,3),rank)
                selected={};packed=[]
                for term,found in sorted(terms.items()):
                    kept={}
                    for rank in (0,1,2):
                        ranked=sorted(((id,val) for id,val in found.items() if val==rank),key=lambda t:(previews[t[0]][1],t[0]))[:20]
                        for id,val in ranked:kept[id]=val;selected[id]=previews[id]
                    packed.append([term,sorted([list(z) for z in kept.items()])])
                page={'version':VERSION,'release_id':release,'direction':direction,'prefix':prefix,
                    'terms':packed,'previews':selected}
                if len(stable(page).encode())<=TARGET:
                    await add_page(direction+':'+prefix,page)
                    path.unlink();return
            top={};children={}
            for term,id,rank in line_reader(path):
                score=rank if term==prefix else 3
                top[id]=min(top.get(id,4),score)
                if len(top)>21:
                    top=dict(sorted(top.items(),key=lambda z:(z[1],previews[z[0]][1],z[0]))[:20])
                if len(prefix)<80 and len(term)>len(prefix):
                    key=term[:len(prefix)+1]
                    if key not in children:children[key]=file_for(direction,key)
                    with children[key].open('a',encoding='utf8') as handle:
                        handle.write(json.dumps([term,id,rank],ensure_ascii=False,separators=(',',':'))+'\n')
            chosen={id:previews[id] for id in top}
            branch={'version':VERSION,'release_id':release,'direction':direction,'prefix':prefix,
                    'terms':sorted([[prefix+'\uffff' if score==3 else prefix,[[id,0 if score==3 else score]]] for id,score in top.items()]),
                    'previews':chosen}
            branch_pages[direction+':'+prefix]=lookup(branch,prefix)
            path.unlink()
            for key,child in sorted(children.items()):await partition(direction,key,child)
        for _,(direction,prefix,path) in sorted(files.items()):await partition(direction,prefix,path)
        await flush_pages()
        bunch={};size=0
        async def flush_branches():
            nonlocal bunch,size
            if not bunch:return
            name='part-'+checksum(('branches:'+'\n'.join(bunch)).encode())[:24]
            desc=await emit(name,{'version':VERSION,'release_id':release,'branches':bunch})
            for key in bunch:branches[key]=desc
            bunch={};size=0
        for key,hits in sorted(branch_pages.items()):
            n=len(stable(hits).encode())+len(key.encode())+8
            if size+n>TARGET:await flush_branches()
            bunch[key]=hits;size+=n
        await flush_branches()
        if writer:await writer.drain()
        directory=compact({'release_id':release,'leaves':leaves,'branches':branches,'term_count':term_count})
        root_desc=await write_index_object(release,'directory',directory)
        groups=defaultdict(lambda:{'release_id':release,'leaves':{},'branches':{},'term_count':0})
        fallbacks=set()
        for kind in ('leaves','branches'):
            for key,at in directory[kind].items():
                if len(key)==3:
                    if kind=='leaves':fallbacks.add(key[:2]+':*')
                    continue
                initial=key[:4];groups[initial][kind][key]=directory['objects'][at]
        routes={}
        for initial,d in sorted(groups.items()):
            name='part-'+checksum(('routing:'+initial).encode())[:24]
            routes[initial]=await emit(name,compact(d))
        for initial in fallbacks:routes[initial]=root_desc
        if writer:await writer.drain()
        return {'version':VERSION,'directory':root_desc,'routes':routes,
            'objects':[root_desc,*published],'logicalTerms':logical_terms}

async def finish_worker_index(owner,id):
    """A durable leased worker, initiated after POST has returned its 200 response."""
    from .step39_dictionary_publish import make_manifest,sha,LOCK
    import logging
    db=await core.pool()
    token=uuid.uuid4();deadline=time.monotonic()+900;last_beat=0
    async with db.acquire() as con:
        async with con.transaction():
            job=await con.fetchrow('''UPDATE dictionary_publish_jobs SET worker_lease_token=$3,
             worker_lease_until=NOW()+interval '45 seconds' WHERE id=$1 AND owner_user_id=$2
             AND phase='worker_index' AND (worker_lease_until IS NULL OR worker_lease_until<NOW())
             RETURNING *''',id,owner,token)
    if not job:return
    candidate=job['candidate_release_id'];base=job['base_release_id']
    async def heartbeat():
        nonlocal last_beat
        if time.monotonic()>deadline:raise ValueError('dictionary_index_build_timeout')
        if time.monotonic()-last_beat<2:return
        last_beat=time.monotonic()
        async with db.acquire() as con:
            verified=await con.fetchval('''UPDATE dictionary_publish_jobs j SET updated_at=NOW(),
             worker_lease_until=NOW()+interval '45 seconds' FROM users u,dictionary_channels c
             WHERE u.id=j.owner_user_id AND c.name='stable' AND j.id=$1 AND j.owner_user_id=$2
             AND j.phase='worker_index' AND j.worker_lease_token=$3 AND j.worker_lease_until>NOW()
             AND u.role='owner' AND u.account_status='active' AND c.active_release_id=j.base_release_id
             RETURNING j.id''',id,owner,token)
            if not verified:raise ValueError('dictionary_publish_authority_changed')
    try:
        await heartbeat()
        async with db.acquire() as con:
            ordered=await con.fetch('SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1 ORDER BY lemma_norm,lexeme_id LIMIT 100001',candidate)
            if len(ordered)>100000 or not ordered:raise ValueError('dictionary_index_identity_budget')
            shards=await con.fetch('SELECT descriptor FROM dictionary_r2_shards WHERE release_id=$1 ORDER BY shard',candidate)
        order={str(r['lexeme_id']):i for i,r in enumerate(ordered)}
        descriptors=[json.loads(r['descriptor']) if isinstance(r['descriptor'],str) else r['descriptor'] for r in shards]
        manifest=await build_index(candidate,descriptors,order,heartbeat)
        await heartbeat()
        async with db.acquire() as con:
            async with con.transaction():
                await con.execute(LOCK)
                active=await active_release(con)
                if active['active_release_id']!=base:raise ValueError('release_mismatch')
                found=await con.fetchval('''SELECT 1 FROM dictionary_publish_jobs j JOIN users u ON u.id=j.owner_user_id
                  WHERE j.id=$1 AND j.phase='worker_index' AND j.worker_lease_token=$2
                   AND j.owner_user_id=$3 AND u.role='owner' AND u.account_status='active' FOR UPDATE OF j''',id,token,owner)
                if not found:raise ValueError('dictionary_publish_authority_changed')
                await con.execute('INSERT INTO dictionary_search_indexes(release_id,descriptor) VALUES($1,$2::jsonb)',candidate,json.dumps(manifest,ensure_ascii=False))
                release=await make_manifest(con,candidate)
                await put_immutable(manifest_key(candidate),stable(release).encode())
                await con.execute('''UPDATE dictionary_releases SET state='validated',manifest=$2::jsonb,
                 manifest_sha=$3,validated_at=NOW() WHERE id=$1 AND state='building' ''',candidate,json.dumps(release,ensure_ascii=False),sha(stable(release)))
                await con.execute('''UPDATE dictionary_publish_jobs SET phase='activate',cursor_id=NULL,
                 worker_lease_token=NULL,worker_lease_until=NULL,updated_at=NOW()
                 WHERE id=$1 AND phase='worker_index' ''',id)
    except Exception as exc:
        logging.exception('dictionary index job failed: %s',str(id))
        reason=str(exc) if str(exc) in ('release_mismatch','dictionary_publish_authority_changed') else 'dictionary_index_build_failed'
        async with db.acquire() as con:
            async with con.transaction():
                failed=await con.fetchval('''UPDATE dictionary_publish_jobs SET phase='failed',error=$4,
                 worker_lease_token=NULL,worker_lease_until=NULL,updated_at=NOW()
                 WHERE id=$1 AND owner_user_id=$2 AND worker_lease_token=$3 AND phase='worker_index' RETURNING id''',id,owner,token,reason)
                if failed:
                    await con.execute('''INSERT INTO dictionary_owner_events(owner_user_id,operation,entity_id,validation_result)
                      VALUES($1,'publish_failed',$2,$3::jsonb)''',owner,str(id),json.dumps({'pass':False,'error':reason}))
