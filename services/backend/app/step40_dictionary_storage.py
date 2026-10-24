"""Immutable dictionary R2 shards and manifest verification.

Python port of src/lib/dictionary/{shards,object-store,offload}.ts.
No object is replaced on retry and no stored object key is accepted from a user.
"""
from __future__ import annotations
import asyncio,gzip,hashlib,json,os,re,uuid,zlib
from .step19_storage import _client

SHARD_LIMIT=2*1024*1024
RAW_LIMIT=8*1024*1024
KEY=re.compile(r'^dictionary/releases/rel-v1-[a-f0-9]{24}/(?:manifest\.json|shards/[a-f0-9]{2}\.json\.gz|search/(?:directory|part-[a-f0-9]{24})\.json\.gz)$')

from .dictionary_canonical import stable
def checksum(value:bytes):return hashlib.sha256(value).hexdigest()
def ensure_key(key):
    if not KEY.fullmatch(key):raise ValueError('invalid_dictionary_key')
    return key

def shard_key(release,shard):return ensure_key(f'dictionary/releases/{release}/shards/{shard}.json.gz')
def index_key(release,name):return ensure_key(f'dictionary/releases/{release}/search/{name}.json.gz')
def manifest_key(release):return ensure_key(f'dictionary/releases/{release}/manifest.json')

def _client_required():
    if os.getenv('STORAGE_PROVIDER')!='r2':raise ValueError('dictionary_r2_required')
    if not all(os.getenv(x) for x in ('R2_BUCKET_NAME','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY')):
        raise ValueError('dictionary_storage_unavailable')
    return _client()

async def read_immutable(key,max_bytes):
    ensure_key(key)
    if not 0<max_bytes<=SHARD_LIMIT:raise ValueError('dictionary_object_limit')
    def task():
        client,bucket=_client_required()
        response=client.get_object(Bucket=bucket,Key=key)
        if int(response.get('ContentLength',max_bytes+1))>max_bytes:raise ValueError('dictionary_object_limit')
        body=response['Body']
        try:result=body.read(max_bytes+1)
        finally:body.close()
        if len(result)>max_bytes:raise ValueError('dictionary_object_limit')
        return result
    return await asyncio.to_thread(task)

async def put_immutable(key,payload):
    ensure_key(key)
    if len(payload)>SHARD_LIMIT:raise ValueError('dictionary_object_limit')
    def task():
        client,bucket=_client_required()
        try:
            client.put_object(Bucket=bucket,Key=key,Body=payload,IfNoneMatch='*',
                ContentType='application/gzip' if key.endswith('.gz') else 'application/json',
                CacheControl='private, max-age=31536000, immutable')
        except client.exceptions.ClientError as err:
            if err.response.get('ResponseMetadata',{}).get('HTTPStatusCode')!=412:raise
            response=client.get_object(Bucket=bucket,Key=key)
            content=response['Body']
            try:old=content.read(len(payload)+1)
            finally:content.close()
            if checksum(old)!=checksum(payload):raise ValueError('immutable_dictionary_object_conflict')
    await asyncio.to_thread(task)
    actual=await read_immutable(key,len(payload))
    if checksum(actual)!=checksum(payload):raise ValueError('dictionary_upload_verification_failed')

def _dict_schema_error():
    raise ValueError('dictionary_entry_schema_invalid')


def validate_entry(entry):
    """Validate the full strict dictionary/model.ts entrySchema at R2 boundaries.

    Strict JSON objects reject unknown keys and required fields cannot be
    silently filled in. Equivalent to entrySchema.parse used by Node shards.ts.
    """
    def obj(value, required, optional=()):
        if not isinstance(value, dict) or not set(required).issubset(value) or set(value)-set(required)-set(optional):
            _dict_schema_error()
    def string(value, maximum=None, minimum=0, trim=False):
        if not isinstance(value,str):_dict_schema_error()
        check = value.strip() if trim else value
        # z.string().trim().min(...).max(...) applies both length bounds
        # AFTER trimming. It validates but does not mutate encodeShard inputs.
        if (maximum is not None and len(check)>maximum) or len(check)<minimum:
            _dict_schema_error()
    def uid(value):
        if not isinstance(value,str) or not re.fullmatch(r'[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}',value):
            _dict_schema_error()
        try: uuid.UUID(value)
        except ValueError: _dict_schema_error()
    def uz(value):
        string(value,6000,1,True)
        if re.search(r'[\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f]',value):_dict_schema_error()
    def array(value,max_n=None,min_n=0):
        if not isinstance(value,list) or len(value)<min_n or (max_n is not None and len(value)>max_n):_dict_schema_error()
    def num(value):
        if type(value)!=int or value<0:_dict_schema_error()
    def optstr(d,k,n):
        if k in d:string(d[k],n)
    obj(entry, ('schema_version','release_id','lexeme_id','display_lemma','normalized_search_form',
        'lexical_type','part_of_speech','homograph_group','is_satellite','pronunciations','forms',
        'senses','relations','collocations','attribution'))
    if entry['schema_version']!='1.0.0' or not re.fullmatch(r'rel-v1-[a-f0-9]{24}',str(entry['release_id'])):_dict_schema_error()
    uid(entry['lexeme_id']);string(entry['display_lemma'],120,1,True)
    string(entry['normalized_search_form'],160,1);string(entry['lexical_type'],24,1)
    string(entry['part_of_speech'],30,1)
    if entry['homograph_group'] is not None:string(entry['homograph_group'])
    if type(entry['is_satellite'])!=bool:_dict_schema_error()
    array(entry['pronunciations']);array(entry['forms']);array(entry['senses'],300,1)
    array(entry['relations']);array(entry['collocations']);array(entry['attribution'],min_n=1)
    for pr in entry['pronunciations']:
        obj(pr,('ipa',),('variety',));string(pr['ipa'],120);optstr(pr,'variety',120)
    for f in entry['forms']:
        obj(f,('surface_form',),('form_type',));string(f['surface_form'],160);optstr(f,'form_type',60)
    for sense in entry['senses']:
        obj(sense,('sense_id','definition_en','definition_uz','translations','examples'),
            ('editorial','sense_order','register','usage_label','domain_tags','cefr'))
        uid(sense['sense_id']);string(sense['definition_en'],6000,1,True);uz(sense['definition_uz'])
        array(sense['translations'],50,1);array(sense['examples'],100)
        for t in sense['translations']:
            obj(t,('translation_id','text','order'));uid(t['translation_id']);uz(t['text']);num(t['order'])
        for e in sense['examples']:
            obj(e,('example_id','text_en','text_uz'));uid(e['example_id']);string(e['text_en'],6000,1,True);uz(e['text_uz'])
        if 'editorial' in sense:
            ed=sense['editorial'];obj(ed,('status','translation_status','reference_urls','provenance'))
            if ed['status'] not in ('owner_supplied','source_checked','human_reviewed','ai_draft'):_dict_schema_error()
            if ed['translation_status'] not in ('owner_supplied','human_reviewed','ai_draft'):_dict_schema_error()
            array(ed['reference_urls'],10)
            for url in ed['reference_urls']:
                string(url,1000)
                from urllib.parse import urlsplit
                parsed=urlsplit(url)
                if not parsed.scheme or not parsed.netloc:_dict_schema_error()
            string(ed['provenance'],120,1)
        if 'sense_order' in sense:num(sense['sense_order'])
        for field in ('register','usage_label'):optstr(sense,field,120)
        if 'domain_tags' in sense:
            array(sense['domain_tags'],30)
            for value in sense['domain_tags']:string(value,120)
        optstr(sense,'cefr',12)
    for r in entry['relations']:
        obj(r,('relation_type','target_lexeme_id','display_lemma','part_of_speech','lexical_type'),('target_sense_id','source_sense_id'))
        for field in ('relation_type','display_lemma','part_of_speech','lexical_type'):string(r[field])
        uid(r['target_lexeme_id'])
        if 'source_sense_id' in r:uid(r['source_sense_id'])
        if r.get('target_sense_id') is not None:uid(r['target_sense_id'])
    for c in entry['collocations']:
        obj(c,('text',),('sense_id','pattern_type','direction'));string(c['text'])
        if c.get('sense_id') is not None:uid(c['sense_id'])
        for field in ('pattern_type','direction'):
            if field in c:string(c[field])
    for a in entry['attribution']:
        obj(a,('source_name','snapshot_id','creator','source_url','license_reference','license_url','attribution_text'))
        for value in a.values():string(value)
    return entry


def compress(raw):
    # Node gzipSync(level=9) and Python zlib generate the same deflate stream,
    # but gzip.compress(...,mtime=0) writes OS=255 instead of Node's OS=3.
    # Keep the original zlib payload and CRC and correct only the gzip header.
    body=gzip.compress(raw,compresslevel=9,mtime=0)
    return body[:9]+b'\x03'+body[10:]


def encode_shard(release,entries,packed=False):
    if not entries:raise ValueError('empty_dictionary_shard')
    for entry in entries:validate_entry(entry)
    entries=sorted(entries,key=lambda e:e['lexeme_id']);shard=entries[0]['lexeme_id'][:2].lower()
    if len(entries)>2000 or len({e['lexeme_id'] for e in entries})!=len(entries) or any(e['release_id']!=release or e['lexeme_id'][:2].lower()!=shard for e in entries):
        raise ValueError('dictionary_shard_identity_mismatch')
    ranges={}
    if packed:
        bodies=[];raws=[];offset=0
        for e in entries:
            raw=(stable(e)+'\n').encode();part=compress(raw)
            ranges[e['lexeme_id']]={'offset':offset,'length':len(part),'raw_bytes':len(raw)}
            raws.append(raw);bodies.append(part);offset+=len(part)
        body=b''.join(bodies);raw=b''.join(raws)
    else:
        raw=stable(entries).encode();body=compress(raw)
    if not 0<len(body)<=SHARD_LIMIT or not 0<len(raw)<=RAW_LIMIT:
        raise ValueError('dictionary_object_limit')
    descriptor={'shard':shard,'sha256':checksum(body),'raw_sha256':checksum(raw),
                'compressed_bytes':len(body),'raw_bytes':len(raw),'entries':len(entries)}
    if packed:descriptor['format']='entry-jsonl-gzip-v1'
    return body,descriptor,ranges

def decompress_bounded(data: bytes, limit: int=RAW_LIMIT) -> bytes:
    """Bound output before allocating it; Node uses maxOutputLength at gunzipSync."""
    remaining = data
    output = bytearray()
    try:
        while remaining:
            decompressor = zlib.decompressobj(wbits=31)
            chunk = decompressor.decompress(remaining, limit - len(output) + 1)
            output.extend(chunk)
            if len(output) > limit or not decompressor.eof:
                raise ValueError('dictionary_object_limit')
            consumed = len(remaining) - len(decompressor.unused_data)
            if consumed <= 0:
                raise ValueError('dictionary_shard_checksum_mismatch')
            remaining = decompressor.unused_data
        return bytes(output)
    except zlib.error as exc:
        raise ValueError('dictionary_shard_checksum_mismatch') from exc


def decode_shard(release,descriptor,data):
    required={'shard','sha256','raw_sha256','compressed_bytes','raw_bytes','entries'}
    if not isinstance(descriptor,dict) or not required.issubset(descriptor) or set(descriptor)-required-{'format'}:
        raise ValueError('dictionary_shard_descriptor_invalid')
    if not (isinstance(descriptor['shard'],str) and re.fullmatch(r'[a-f0-9]{2}',descriptor['shard'])
        and all(isinstance(descriptor[key],str) and re.fullmatch(r'[a-f0-9]{64}',descriptor[key]) for key in ('sha256','raw_sha256'))
        and all(type(descriptor[key])==int for key in ('compressed_bytes','raw_bytes','entries'))
        and 0<descriptor['compressed_bytes']<=SHARD_LIMIT and 0<descriptor['raw_bytes']<=RAW_LIMIT
        and 0<descriptor['entries']<=2000
        and ('format' not in descriptor or descriptor['format']=='entry-jsonl-gzip-v1')):
        raise ValueError('dictionary_shard_descriptor_invalid')
    if len(data)!=descriptor['compressed_bytes'] or checksum(data)!=descriptor['sha256']:
        raise ValueError('dictionary_shard_checksum_mismatch')
    raw=decompress_bounded(data)
    if len(raw)!=descriptor['raw_bytes'] or len(raw)>RAW_LIMIT or checksum(raw)!=descriptor['raw_sha256']:
        raise ValueError('dictionary_shard_checksum_mismatch')
    entries=[json.loads(s) for s in raw.decode().splitlines()] if descriptor.get('format')=='entry-jsonl-gzip-v1' else json.loads(raw)
    if len(entries)!=descriptor['entries'] or len(set(e['lexeme_id'] for e in entries))!=len(entries):
        raise ValueError('dictionary_shard_identity_mismatch')
    for entry in entries:validate_entry(entry)
    if any(e['release_id']!=release or e['lexeme_id'][:2]!=descriptor['shard'] for e in entries):
        raise ValueError('dictionary_shard_identity_mismatch')
    return entries

async def read_shard(release,descriptor):
    data=await read_immutable(shard_key(release,descriptor['shard']),descriptor['compressed_bytes'])
    return decode_shard(release,descriptor,data)

def _prepared_remote_shard(release,entries,data,packed):
    """Reuse approved immutable compressed bytes, even if zlib versions differ.

    Equivalent to the intent of preparedShard() in the source: a re-import
    keeps the existing SHA, descriptor and packed per-entry offsets instead of
    silently replacing an immutable key with a Python recompression.
    """
    if not data or len(data)>SHARD_LIMIT:raise ValueError('dictionary_object_limit')
    raws=[];ranges={};position=0;raw_size=0
    while position<len(data):
        decoder=zlib.decompressobj(wbits=31)
        portion=decoder.decompress(data[position:],RAW_LIMIT-raw_size+1)
        if not decoder.eof or raw_size+len(portion)>RAW_LIMIT:
            raise ValueError('dictionary_shard_checksum_mismatch')
        used=len(data[position:])-len(decoder.unused_data)
        if used<=0:raise ValueError('dictionary_shard_checksum_mismatch')
        raws.append((position,used,portion))
        raw_size+=len(portion);position+=used
    if packed:
        if len(raws)!=len(entries):raise ValueError('immutable_dictionary_object_conflict')
        decoded=[]
        for at,part,(start,length,raw) in zip(range(len(raws)),entries,raws):
            if not raw.endswith(b'\n'):raise ValueError('immutable_dictionary_object_conflict')
            decoded.append(json.loads(raw))
            ranges[part['lexeme_id']]={'offset':start,'length':length,'raw_bytes':len(raw)}
    else:
        if len(raws)!=1:raise ValueError('immutable_dictionary_object_conflict')
        decoded=json.loads(raws[0][2])
    if decoded!=entries:raise ValueError('immutable_dictionary_object_conflict')
    raw=b''.join(item[2] for item in raws)
    desc={'shard':entries[0]['lexeme_id'][:2].lower(),
          'sha256':checksum(data),'raw_sha256':checksum(raw),
          'compressed_bytes':len(data),'raw_bytes':len(raw),'entries':len(entries)}
    if packed:desc['format']='entry-jsonl-gzip-v1'
    return desc,ranges


def _is_missing_r2_object(error):
    response=getattr(error,'response',{})
    if not isinstance(response,dict):return False
    code=str(response.get('Error',{}).get('Code',''))
    status=response.get('ResponseMetadata',{}).get('HTTPStatusCode')
    return code in ('NoSuchKey','NotFound','404') or status==404


async def write_shard(con,entries,keep_preview):
    if not entries:return None
    release=entries[0]['release_id'];body,descriptor,ranges=encode_shard(release,entries,packed=not keep_preview)
    key=shard_key(release,descriptor['shard'])
    # A prior Node.js publish may have used different zlib bytes for the same
    # educational payload. Do not overwrite it or attach a mismatched SHA.
    try:
        previous=await read_immutable(key,SHARD_LIMIT)
    except Exception as ex:
        if not _is_missing_r2_object(ex):raise
        previous=None
    if previous is not None:
        descriptor,ranges=_prepared_remote_shard(release,sorted(entries,key=lambda e:e['lexeme_id']),
                                                    previous,packed=not keep_preview)
    else:
        try:
            await put_immutable(key,body)
        except ValueError as ex:
            if str(ex)!='immutable_dictionary_object_conflict':raise
            # A concurrent writer won the immutable key; accept only exactly
            # the same validated entries and preserve the winning descriptor.
            previous=await read_immutable(key,SHARD_LIMIT)
            descriptor,ranges=_prepared_remote_shard(release,sorted(entries,key=lambda e:e['lexeme_id']),
                                                        previous,packed=not keep_preview)
    # Upload before the database transition: an unreferenced immutable object is
    # safe if the transaction fails. Retries verify identical bytes.
    from .step39_dictionary_publish import content_hash,normalize_search
    values=[]
    for entry in entries:
        senses=entry['senses'];translations=[t for s in senses for t in s['translations']]
        preview={'display_lemma':entry['display_lemma'],'custom':any(x['source_name']=='Learners Area' for x in entry['attribution']),
          'translation_uz':', '.join(t['text'] for t in senses[0]['translations']),
          'uz_terms':list({normalize_search(t['text']):{'text':t['text'],'norm':normalize_search(t['text'])} for t in translations}.values())} if keep_preview else None
        item= {'release_id':release,'lexeme_id':entry['lexeme_id'],'lemma_norm':normalize_search(entry['display_lemma']),
          'part_of_speech':entry['part_of_speech'],'lexical_type':entry['lexical_type'],'content_sha':content_hash(entry),
          'is_custom':any(x['source_name']=='Learners Area' for x in entry['attribution']),
          'storage_offset':ranges.get(entry['lexeme_id'],{}).get('offset'),
          'storage_length':ranges.get(entry['lexeme_id'],{}).get('length'),
          'storage_raw_bytes':ranges.get(entry['lexeme_id'],{}).get('raw_bytes'),
          'storage_shard':descriptor['shard'],'storage_release':release,'search_preview':preview,
          'sense_ids':[s['sense_id'] for s in senses],
          'example_ids':[x['example_id'] for s in senses for x in s['examples']]}
        values.append(item)
    await con.execute('''INSERT INTO dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,
      content_sha,is_custom,storage_offset,storage_length,storage_raw_bytes,storage_shard,storage_release,
      search_preview,sense_ids,example_ids)
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(release_id text,lexeme_id uuid,lemma_norm text,
      part_of_speech text,lexical_type text,content_sha text,is_custom boolean,storage_offset int,
      storage_length int,storage_raw_bytes int,storage_shard text,storage_release text,search_preview jsonb,
      sense_ids uuid[],example_ids uuid[])
      ON CONFLICT(release_id,lexeme_id) DO UPDATE SET payload=NULL,content_sha=EXCLUDED.content_sha,
      is_custom=EXCLUDED.is_custom,storage_offset=EXCLUDED.storage_offset,storage_length=EXCLUDED.storage_length,
      storage_raw_bytes=EXCLUDED.storage_raw_bytes,storage_shard=EXCLUDED.storage_shard,
      storage_release=EXCLUDED.storage_release,search_preview=EXCLUDED.search_preview,
      sense_ids=EXCLUDED.sense_ids,example_ids=EXCLUDED.example_ids''',json.dumps(values,ensure_ascii=False))
    await con.execute('''INSERT INTO dictionary_r2_shards(release_id,shard,descriptor)
      VALUES($1,$2,$3::jsonb) ON CONFLICT(release_id,shard) DO UPDATE SET descriptor=EXCLUDED.descriptor
      WHERE dictionary_r2_shards.descriptor IS DISTINCT FROM EXCLUDED.descriptor''',
      release,descriptor['shard'],json.dumps(descriptor))
    return descriptor

async def hydrate(con,release,ids):
    from .step17_dictionary_read_port import entry
    result=[]
    for id in ids:
        value=await entry(con,uuid.UUID(str(id)),release)
        if value:result.append(value)
    return result

async def verify_release_objects(release,manifest):
    storage=manifest.get('storage') if isinstance(manifest,dict) else None
    if not storage:return
    for descriptor in storage.get('shards',[]):await read_shard(release,descriptor)
    search=storage.get('search')
    if search:
        for desc in search.get('objects',[]):
            data=await read_immutable(index_key(release,desc['name']),desc['compressed_bytes'])
            if checksum(data)!=desc['sha256']:raise ValueError('dictionary_index_checksum_mismatch')
    body=await read_immutable(manifest_key(release),SHARD_LIMIT)
    if checksum(body)!=checksum(stable(manifest).encode()):raise ValueError('manifest_validation_failed')
