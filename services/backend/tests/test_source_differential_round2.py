"""Parity hardening: immutable object retries, bounded decompression, source hashes.

The stored JSON fixtures were computed by executing stableJson from the original
src/lib/dictionary/model.ts under Node 22 and normalizeForHash-equivalent source.
No Node/TypeScript runtime is required when these regression tests run.
"""
from __future__ import annotations
import copy
import gzip
import json
from pathlib import Path
import hashlib

import pytest

from app import main  # load router module graph in its real application order
from app import step25_content_version as version
from app import step40_dictionary_index as index
from app import step40_dictionary_storage as store
from app import step39_dictionary_publish as owner
from app.dictionary_canonical import stable
from _parity_fixture import dictionary_entry

REL='rel-v1-'+'b'*24
UID='aa111111-1111-4111-8111-111111111111'

@pytest.mark.parametrize('sample',json.loads(Path(__file__).with_name('node_source_parity_fixtures.json').read_text()),ids=lambda x:x['name'])
def test_node_source_exact_json_canonical_and_educational_hash(sample):
    assert stable(sample['value']) == sample['dictionary']
    assert owner.stable(sample['value']) == sample['dictionary']
    assert store.stable(sample['value']) == sample['dictionary']
    assert version.encoded(sample['value']) == sample['canonical_json']
    assert version.digest(sample['value']) == sample['canonical_sha256']

@pytest.mark.parametrize('name', ['directory','part-'+'a'*24])
@pytest.mark.asyncio
async def test_immutable_dictionary_index_retry_reuses_published_bytes(monkeypatch,name):
    obj={'version':index.VERSION,'release_id':REL,'pages':{'EN:word':{'terms':[['word',[[UID,0]]]]}}}
    proposed,desc=index.encode(name,obj)
    original_raw=store.stable(obj).encode()
    published=gzip.compress(original_raw,compresslevel=1,mtime=0)
    assert proposed!=published
    calls=[]
    async def put(key,body):
        calls.append(('put',key))
        raise ValueError('immutable_dictionary_object_conflict')
    async def read(key,limit):
        calls.append(('read',key,limit))
        return published
    monkeypatch.setattr(index,'put_immutable',put)
    monkeypatch.setattr(index,'read_immutable',read)
    result=await index.write_index_object(REL,name,obj)
    assert result['sha256']==hashlib.sha256(published).hexdigest()
    assert result['raw_sha256']==hashlib.sha256(original_raw).hexdigest()
    assert result['compressed_bytes']==len(published)
    assert len(calls)==2 and calls[1][2]==512*1024

@pytest.mark.asyncio
async def test_immutable_dictionary_index_rejects_different_payload(monkeypatch):
    async def put(*args):raise ValueError('immutable_dictionary_object_conflict')
    async def read(*args):return gzip.compress(b'{"unexpected":1}',mtime=0)
    monkeypatch.setattr(index,'put_immutable',put)
    monkeypatch.setattr(index,'read_immutable',read)
    with pytest.raises(ValueError,match='immutable_dictionary_object_conflict'):
        await index.write_index_object(REL,'directory',{'version':index.VERSION})

@pytest.mark.asyncio
async def test_immutable_dictionary_index_new_object_uses_own_checksum(monkeypatch):
    written=[]
    async def put(key,data):written.append((key,data))
    async def no_read(*a):raise AssertionError('New object does not need a second read')
    monkeypatch.setattr(index,'put_immutable',put)
    monkeypatch.setattr(index,'read_immutable',no_read)
    obj={'version':index.VERSION,'release_id':REL}
    result=await index.write_index_object(REL,'directory',obj)
    assert written and result['sha256']==store.checksum(written[0][1])

@pytest.mark.parametrize('packed',[False,True])
def test_shard_decode_rejects_bomb_before_full_allocation(packed):
    bomb=b'X'*(store.RAW_LIMIT+200)
    body=store.compress(bomb)
    descriptor={'shard':'aa','sha256':store.checksum(body), 'raw_sha256':store.checksum(bomb),
      'compressed_bytes':len(body),'raw_bytes':store.RAW_LIMIT,'entries':1}
    if packed:descriptor['format']='entry-jsonl-gzip-v1'
    with pytest.raises(ValueError,match='dictionary_object_limit'):
        store.decode_shard(REL,descriptor,body)

@pytest.mark.parametrize('packed',[False,True])
def test_shard_concat_gzip_member_bounded_roundtrip(packed):
    e1=dictionary_entry(REL,UID,'alpha')
    e2=dictionary_entry(REL,'aa222222-2222-4222-8222-222222222222','beta')
    raw=(store.stable(e1)+'\n'+store.stable(e2)+'\n').encode()
    assert store.decompress_bounded(store.compress((store.stable(e1)+'\n').encode())+store.compress((store.stable(e2)+'\n').encode()))==raw
    original,desc,ranges=store.encode_shard(REL,[e1,e2],packed=packed)
    assert store.decode_shard(REL,desc,original)==[e1,e2]

@pytest.mark.parametrize('field,value', [('display_lemma','  word  '),('display_lemma',' ' * 200 + 'word')])
def test_dictionary_zod_trim_length_uses_trimmed_value(field,value):
    entry=dictionary_entry(REL,UID,'word')
    entry[field]=value
    store.validate_entry(entry)
    assert store.decode_shard(REL,*_body_desc(entry))==[entry]

def _body_desc(e):
    body,desc,_=store.encode_shard(REL,[e])
    return desc,body

from app.step17_dictionary_read_port import normalize_search

@pytest.mark.parametrize('sample', json.loads(Path(__file__).with_name('node_dictionary_normalize_fixtures.json').read_text()), ids=lambda x:repr(x['input']))
def test_dictionary_normalization_matches_original_typescript_unicode_16(sample):
    assert normalize_search(sample['input']) == sample['normalized']

def test_python_unicode_15_vs_node_unicode_16_frozen_deltas_are_loaded():
    from app.step17_dictionary_read_port import UNICODE16
    assert UNICODE16['reference']=='Node.js 22.16.0 / Unicode 16.0'
    assert len(UNICODE16['lower'])==27 and len(UNICODE16['nfkc'])==36


import base64
import hmac
import os
import time
from app import security


def _signed_cookie(secret, head, body):
    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj, separators=(',', ':')).encode()).decode().rstrip('=')
    unsigned=b64(head)+'.'+b64(body)
    signature=base64.urlsafe_b64encode(hmac.digest(secret.encode(), unsigned.encode(), 'sha256')).decode().rstrip('=')
    return unsigned+'.'+signature


@pytest.mark.parametrize('changes', [
    {'authVersion':2**53}, {'authVersion':-1}, {'authVersion':1.25},
    {'exp':2**53}, {'iat':'bad'}, {'nbf':'soon'}, {'nbf':10**12},
    {'onboarded':'true'}, {'locale':42}, {'role':'superuser'},
])
def test_jose_session_claim_validation_parity(monkeypatch,changes):
    monkeypatch.setenv('AUTH_SECRET','test-secret-with-more-than-16-characters')
    valid={'sub':UID,'role':'owner','name':'Teacher','locale':'en', 'onboarded':True,
           'authVersion':0,'iat':int(time.time())-10,'exp':int(time.time())+3600}
    valid.update(changes)
    token=_signed_cookie(os.environ['AUTH_SECRET'],{'alg':'HS256'},valid)
    assert security.verify_token(token) is None


def test_jose_cookie_legacy_epoch_and_header_contract(monkeypatch):
    monkeypatch.setenv('AUTH_SECRET','test-secret-with-more-than-16-characters')
    claims={'sub':UID,'role':'owner','name':'Teacher','locale':'en', 'onboarded':True,
            'iat':int(time.time())-10,'exp':int(time.time())+3600}
    token=_signed_cookie(os.environ['AUTH_SECRET'],{'alg':'HS256'},claims)
    verified=security.verify_token(token)
    assert verified is not None and verified['authVersion']==0
    malformed_header=_signed_cookie(os.environ['AUTH_SECRET'],['HS256'],claims)
    assert security.verify_token(malformed_header) is None
    critical=_signed_cookie(os.environ['AUTH_SECRET'],{'alg':'HS256','crit':['example']},claims)
    assert security.verify_token(critical) is None
