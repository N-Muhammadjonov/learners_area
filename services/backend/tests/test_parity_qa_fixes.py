"""Differential regressions for verified Next.js vs FastAPI behavior discrepancies.
Node reference: rate-limit.ts, content/versions.ts, dictionary/{model,shards,build-index}.ts,
api/admin/listening/import/route.ts and import/listening/importer.ts.
"""
from __future__ import annotations
import copy
import gzip
import json
import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import main as core
from app import rate_limit as limiter
from app import step39_content_import as imports
from app import step39_listening_conversion as conversion
from app import step40_dictionary_storage as storage
from app import step40_dictionary_index as index
from app import step25_content_version as versioning
from _parity_fixture import dictionary_entry

REL = 'rel-v1-'+'a'*24
UID = '11111111-1111-4111-8111-111111111111'
C = TestClient(core.app)


def test_rate_limit_source_default_applies_after_all_router_imports():
    assert limiter.RULES['upload_intent'] == (120, 900)

@pytest.mark.parametrize('header,ip',[('x-real-ip','203.0.113.8:443'),('x-vercel-forwarded-for','[2001:db8::1]:443'),('x-forwarded-for','junk, 198.51.100.2:80'),('x-real-ip','203.0.113.8')])
def test_client_ip_match_node_transport_syntax(header, ip):
    req = Request({'type':'http','headers':[(header.encode(),ip.encode())], 'path':'/'})
    expected = '2001:db8::1' if '2001:' in ip else '198.51.100.2' if '198.' in ip else '203.0.113.8'
    assert limiter.client_key(req)==expected


def test_expired_rate_buckets_of_same_action_pruned(monkeypatch):
    now = 40000.0
    limiter.BUCKETS.clear()
    monkeypatch.setattr(limiter.time,'monotonic',lambda:now)
    limiter.BUCKETS[('upload_intent','old')]=(3,now-10)
    limiter.BUCKETS[('login_ip','unrelated')]=(2,now-10)
    assert limiter.counter('upload_intent','current',consume=True) is None
    assert ('upload_intent','old') not in limiter.BUCKETS
    assert ('login_ip','unrelated') in limiter.BUCKETS
    limiter.BUCKETS.clear()

@pytest.mark.parametrize('module,kind,semantic,meta',[
    ('writing','task1',{'prompt':'Describe the graph','taskType':'bar'},'category'),
    ('reading','passage',{'passages':[{'questions':[]}]},'topic'),
    ('listening','full_test',{'questions':[],'audio':{'durationSec':60}},'title'),
    ('speaking','material',{'category':'practice','description':'Start'},'title'),
    ('speaking','prompt',{'promptText':'Hello','prepSeconds':30},'title'),
    ('grammar','exercise',{'promptText':'Choose','correctOption':'A'},'title'),
    ('vocabulary','exercise',{'words':['arrive']},'category'),
    ('ted','video',{'transcript':'A sentence','notes':'Note'},'title'),
    ('media','podcast',{'transcriptText':'A sentence'},'topic'),
])
def test_metadata_only_edits_do_not_create_semantic_version(module,kind,semantic,meta):
    a={**semantic,meta:'older'}
    b={**semantic,meta:'newer'}
    before=versioning.version_hashes(module,kind,a)
    after=versioning.version_hashes(module,kind,b)
    assert before['semantic_hash']==after['semantic_hash']
    assert before['content_hash']!=after['content_hash']

@pytest.mark.parametrize('module,kind,payload,key,new',[('writing','task1',{'prompt':'Hi'},'prompt','Bye'),
    ('grammar','activity',{'correctOption':'A'},'correctOption','B'),
    ('ted','video',{'notes':'Hello'},'notes','Goodbye'),
    ('speaking','material',{'description':'A'},'description','B')])
def test_assessment_edit_creates_semantic_version(module,kind,payload,key,new):
    assert versioning.version_hashes(module,kind,payload)['semantic_hash']!=versioning.version_hashes(module,kind,{**payload,key:new})['semantic_hash']


def test_unknown_content_type_keeps_full_payload_as_semantic_fallback():
    a=versioning.version_hashes('lesson','unknown',{'foo':'A'})
    b=versioning.version_hashes('lesson','unknown',{'foo':'B'})
    assert a['semantic_hash']!=b['semantic_hash']

@pytest.mark.parametrize('raw,hexvalue',[
    (b'abc','1f8b08000000000002034b4c4a0600c241243503000000'),
    (b'{"a":1,"z":"x"}','1f8b0800000000000203ab564a54b232d451aa52b252aa50aa0500fdf54ea60f000000')])
def test_gzip_node_v22_byte_fixture_small_payload(raw,hexvalue):
    assert storage.compress(raw)==bytes.fromhex(hexvalue)
    assert gzip.decompress(storage.compress(raw))==raw


def test_dictionary_full_entry_required_at_encode_and_decode():
    entry=dictionary_entry(REL,UID,'word')
    body, descriptor, ranges=storage.encode_shard(REL,[entry],packed=True)
    assert storage.decode_shard(REL,descriptor,body)==[entry]
    for bad in ({**entry,'senses':[]},{k:v for k,v in entry.items() if k!='attribution'},
                {**entry,'new_unrecognized_field':True},
                {**entry,'senses':[{**entry['senses'][0],'definition_uz':'кирилл'}]}):
        with pytest.raises(ValueError,match='dictionary_entry_schema_invalid'):
            storage.encode_shard(REL,[bad])
    # Existing remote shards must also be subject to the full schema at read.
    unsupported={'release_id':REL,'lexeme_id':UID,'display_lemma':'word'}
    compressed=storage.compress(storage.stable([unsupported]).encode())
    fake={'sha256':storage.checksum(compressed),'raw_sha256':storage.checksum(storage.stable([unsupported]).encode()),
          'compressed_bytes':len(compressed),'raw_bytes':len(storage.stable([unsupported]).encode()),'entries':1,'shard':'11'}
    with pytest.raises(ValueError,match='dictionary_entry_schema_invalid'):
        storage.decode_shard(REL,fake,compressed)


def test_uzbek_preview_uses_english_icu_collation_for_accented_terms():
    example=dictionary_entry(REL,UID,'apple')
    example['senses'][0]['translations']=[
        {**example['senses'][0]['translations'][0],'text':word,'translation_id':str(uuid.uuid5(uuid.NAMESPACE_DNS,word)),'order':i}
        for i,word in enumerate(('z','é','a'))]
    preview=index.preview(example,0)
    assert [key for key,_ in preview[4]] == ['a','é','z']

class _Ready:
    async def fetchval(self,*a,**k):return True
    async def __aenter__(self):return self
    async def __aexit__(self,*a):pass
class _Pool:
    def acquire(self):return _Ready()

@pytest.mark.parametrize('body',[{'payload':{},'audioUploadId':UID},
    {'payload':{},'audioUploadId':UID,'imageUploadId':'not-uuid'},
    {'package':{},'dryRun':'false'}, {'package':{},'publish':1},
    {'package':{},'assetUploads':{'key':123}}, {'package':{},'acknowledgeGradeImpact':None},
    {'package':{},'originalFilename':'x'*256}])
def test_listening_import_refuses_invalid_request_before_import(monkeypatch,body):
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=_Pool()))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':UID,'role':'owner'}))
    res=C.post('/api/admin/listening/import',json=body)
    assert res.status_code==400,res.text
    assert res.json()['error']=='invalid_package'

@pytest.mark.asyncio
async def test_content_import_nullish_fallback_is_same_as_typescript(monkeypatch):
    captured=[]
    def fake_parse(value):captured.append(value);return ({'module':'reading','contentType':'general_set'},[])
    monkeypatch.setattr(imports,'parse_package',fake_parse)
    monkeypatch.setattr(imports,'allowed',lambda *a:False)
    class F: pass
    req=F()
    with pytest.raises(imports.ImportFailure):
        await imports._route_import(req,{'role':'student'},{'package':None,'raw':{'test':'fallback'}})
    assert captured==[{'test':'fallback'}]
    captured.clear()
    with pytest.raises(imports.ImportFailure) as ex:
        await imports._route_import(req,{'role':'student'},{'package':0,'raw':{'test':'ignored'}})
    assert ex.value.code=='invalid_input' and captured==[]

@pytest.mark.asyncio
async def test_removed_mcq_question_kept_with_original_history_warning():
    class Conn:
        def __init__(self):self.sql=[]
        async def fetch(self,*a):return [{'id':'old','order':7}]
        async def fetchval(self,sql,*a):return None if 'listening_attempts' in sql else 1
        async def execute(self,sql,*a):self.sql.append(sql)
    conn=Conn()
    out=await conversion.reconcile(conn,UID,{'questions':[]})
    assert out==['Question 7 was not in this package but is kept because learners have completed work recorded against it. The superseded question is retained for history and is not served to new learners.']
    assert not conn.sql

@pytest.mark.parametrize('packed',[False,True])
def test_existing_immutable_r2_bytes_remain_authoritative_across_zlib_builds(packed):
    entry=dictionary_entry(REL,UID,'book')
    raw=(storage.stable(entry)+'\n').encode() if packed else storage.stable([entry]).encode()
    other_zlib=gzip.compress(raw,compresslevel=1,mtime=0)
    # Different compressed hashes, same approved educational content.
    proposed=storage.encode_shard(REL,[entry],packed=packed)[0]
    assert proposed!=other_zlib
    descriptor,ranges=storage._prepared_remote_shard(REL,[entry],other_zlib,packed)
    assert descriptor['sha256']==storage.checksum(other_zlib)
    assert descriptor['raw_sha256']==storage.checksum(raw)
    assert descriptor['format']=='entry-jsonl-gzip-v1' if packed else 'format' not in descriptor
    if packed:
        assert ranges[UID]=={'offset':0,'length':len(other_zlib),'raw_bytes':len(raw)}
    assert storage.decode_shard(REL,descriptor,other_zlib)==[entry]

@pytest.mark.asyncio
async def test_write_shard_reuses_existing_immutable_bytes_without_put(monkeypatch):
    entry=dictionary_entry(REL,UID,'book')
    previous=gzip.compress((storage.stable(entry)+'\n').encode(),compresslevel=1,mtime=0)
    async def get(key,max_bytes):return previous
    async def no_put(*a):raise AssertionError('Existing R2 shard must not be overwritten')
    monkeypatch.setattr(storage,'read_immutable',get)
    monkeypatch.setattr(storage,'put_immutable',no_put)
    class Db:
        def __init__(self):self.queries=[]
        async def execute(self,*a):self.queries.append(a)
    db=Db()
    desc=await storage.write_shard(db,[entry],False)
    assert desc['sha256']==storage.checksum(previous)
    assert any('dictionary_r2_shards' in sql for sql,*_ in db.queries)
    assert any('dictionary_entries' in sql for sql,*_ in db.queries)


def test_invalid_r2_descriptor_rejected_before_decompression():
    entry=dictionary_entry(REL,UID,'word')
    body,desc,_=storage.encode_shard(REL,[entry])
    for bad in ({**desc,'extra':'not allowed'},{**desc,'raw_bytes':10**9},{**desc,'sha256':'wrong'}):
        with pytest.raises(ValueError,match='dictionary_shard_descriptor_invalid'):
            storage.decode_shard(REL,bad,body)

@pytest.mark.parametrize('body',[{}, {'package':None}, {'package':None,'raw':0}])
def test_generic_content_import_missing_package_has_original_plain_error(monkeypatch,body):
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':UID,'role':'owner'}))
    res=C.post('/api/admin/content/import',json=body)
    assert res.status_code==400
    assert res.json()=={'error':'invalid_input','detail':'Missing `package`.'}

@pytest.mark.parametrize('module,kind,payload,expected',[
    ('writing','task1',{'prompt':'Graph','category':'housing'},'8e5ced7e1e012cd4bbc57e4991262211797d8c9a7507f240e31c8f49c414ad42'),
    ('listening','full_test',{'title':'Old','questions':[],'audio':{'durationSec':30}},'0b62ca90405fcb7f03682559501c64af513cdfcc31982f4c65654c15b76eb568'),
    ('grammar','exercise',{'promptText':' Hello ','category':'a','correctOption':'A'},'e0e4e03ed8b239b0872647cade875975e30deccf59e3c7a682585d36746d18f1'),
])
def test_semantic_sha256_exactly_matches_node_reference(module,kind,payload,expected):
    assert versioning.version_hashes(module,kind,payload)['semantic_hash']==expected
