"""Regression coverage for the last owner's immutable R2 publication phases.

The test doubles exercise branch decisions and SQL transaction semantics, not
external Postgres/R2/Worker availability (covered only by live integration).
"""
from __future__ import annotations
import copy,hashlib,json,uuid
import pytest
from _parity_fixture import dictionary_entry
from app import main as core
from app import step39_dictionary_publish as publication
from app import step40_dictionary_storage as storage
from app import step40_dictionary_index as index

REL='rel-v1-'+'a'*24
BASE='rel-v1-'+'b'*24
UID='11111111-1111-4111-8111-111111111111'
JID=uuid.UUID('22222222-2222-4222-8222-222222222222')

def test_immutable_shard_descriptor_roundtrip_with_packed_ranges():
    items=[]
    for v in (1,2):
        items.append(dictionary_entry(REL,f'aa00000{v}-1111-4111-8111-111111111111',f'word{v}'))
    body,descriptor,ranges=storage.encode_shard(REL,items,packed=True)
    assert descriptor['format']=='entry-jsonl-gzip-v1'
    assert descriptor['shard']=='aa' and descriptor['entries']==2
    assert storage.decode_shard(REL,descriptor,body)==items
    assert ranges[items[0]['lexeme_id']]['offset']==0
    assert ranges[items[1]['lexeme_id']]['offset']==ranges[items[0]['lexeme_id']]['length']
    with pytest.raises(ValueError,match='dictionary_shard_checksum_mismatch'):
        storage.decode_shard(REL,descriptor,body[:-1]+bytes([body[-1]^1]))
    with pytest.raises(ValueError,match='dictionary_shard_identity_mismatch'):
        storage.decode_shard(BASE,descriptor,body)

@pytest.mark.parametrize('key',[REL+'/shards/aa.json.gz','dictionary/../aa',
 'dictionary/releases/'+REL+'/shards/../../bad','dictionary/releases/'+REL+'/manifest.html',
 'dictionary/releases/not-a-release/manifest.json'])
def test_external_dictionary_keys_are_not_accepted(key):
    with pytest.raises(ValueError,match='invalid_dictionary_key'):storage.ensure_key(key)

def test_unmodified_shard_uses_compatible_list_layout():
    entry=dictionary_entry(REL,'ab000001-1111-4111-8111-111111111111','unmodified')
    body,desc,ranges=storage.encode_shard(REL,[entry],packed=False)
    assert desc['entries']==1 and 'format' not in desc and not ranges
    assert storage.decode_shard(REL,desc,body)==[entry]

def test_worker_index_encoded_checksums_and_hits():
    page={'direction':'UZ','terms':[['kitob',[[UID,0]]],['kitoblar',[[UID,2]]]],
          'previews':{UID:['book',0,'noun','kitob', [['kitob','kitob'],['kitoblar','kitoblar']] ]}}
    found=index.lookup(page,'kitob')
    assert found==[{'lexeme_id':UID,'display_lemma':'book','part_of_speech':'noun',
                   'translation_uz':'kitob','match_type':'exact_lemma'}]
    compressed,descriptor=index.encode('directory',{'version':index.VERSION,'release_id':REL})
    assert descriptor['sha256']==hashlib.sha256(compressed).hexdigest()
    assert descriptor['raw_bytes']>0

class FakeRelease:
    def __init__(self,phase,worker=True,shards=None):
        self.phase=phase;self.worker=worker;self.statements=[];self.shards=shards or []
        self.job={'phase':phase,'id':JID,'owner_user_id':UID,'base_release_id':BASE,
                  'candidate_release_id':REL,'cursor_id':None,'draft_ids':[JID]}
    async def execute(self,sql,*params):self.statements.append((sql,params))
    async def fetchrow(self,sql,*params):
        self.statements.append((sql,params))
        if 'SELECT * FROM dictionary_publish_jobs' in sql:return dict(self.job)
        if 'UPDATE dictionary_publish_jobs' in sql:
            self.job['phase']=params[1];return dict(self.job)
        if 'payload IS NOT NULL' in sql:return {'lexeme_id':uuid.UUID(UID)} if self.shards else None
        raise AssertionError(f'unhandled fetchrow: {sql}')
    async def fetchval(self,sql,*params):
        self.statements.append((sql,params))
        if 'SELECT delivery FROM dictionary_releases' in sql:return 'r2-worker-v1' if self.worker else 'legacy'
        raise AssertionError(f'unhandled fetchval: {sql}')
    async def fetch(self,sql,*params):
        self.statements.append((sql,params))
        if 'left(lexeme_id::text,2)' in sql:return [{'lexeme_id':uuid.UUID(UID)}]
        if 'FROM dictionary_drafts' in sql:return [{'id':JID,'changes':{'operation':'add_lexeme','lemma':'book','partOfSpeech':'noun','lexicalType':'word'}}]
        if 'AND lemma_norm' in sql:return []
        raise AssertionError(f'unhandled fetch: {sql}')

@pytest.mark.asyncio
async def test_worker_apply_writes_one_shard_and_skips_legacy_index(monkeypatch):
    c=FakeRelease('apply')
    async def active(*args):return {'active_release_id':BASE}
    async def get(*args):return []
    async def write(*args):calls.append(args)
    def apply(entries,change,release):return {'release_id':REL,'lexeme_id':UID,'display_lemma':'book'}
    async def no_put(*args):raise AssertionError('worker draft was put into the legacy SQL payload')
    calls=[]
    monkeypatch.setattr(publication,'active_release',active)
    monkeypatch.setattr(publication,'get_entries',get)
    monkeypatch.setattr(publication,'apply_draft',apply)
    monkeypatch.setattr(publication,'put_entry',no_put)
    monkeypatch.setattr(storage,'write_shard',write)
    result=await publication.advance_publish(c,UID,JID)
    assert result['phase']=='validate'
    assert len(calls)==1 and calls[0][0] is c and calls[0][2] is False
    assert [x['lexeme_id'] for x in calls[0][1]]==[UID]
    assert not any('dictionary_search_terms' in s for s,args in c.statements)

@pytest.mark.asyncio
async def test_worker_offload_keeps_no_search_preview(monkeypatch):
    c=FakeRelease('offload',shards=[1]);calls=[]
    async def active(*a):return {'active_release_id':BASE}
    async def get(*args):return [{'release_id':REL,'lexeme_id':UID}]
    async def write(*args):calls.append(args)
    monkeypatch.setattr(publication,'active_release',active)
    monkeypatch.setattr(publication,'get_entries',get)
    monkeypatch.setattr(storage,'write_shard',write)
    res=await publication.advance_publish(c,UID,JID)
    assert res['phase']=='offload' and len(calls)==1
    assert calls[0][2] is False

@pytest.mark.asyncio
async def test_worker_offload_moves_to_index_phase_without_legacy_manifest(monkeypatch):
    c=FakeRelease('offload',shards=[])
    async def active(*a):return {'active_release_id':BASE}
    async def no_manifest(*args):raise AssertionError('worker tries to validate before search index built')
    monkeypatch.setattr(publication,'active_release',active)
    monkeypatch.setattr(publication,'make_manifest',no_manifest)
    res=await publication.advance_publish(c,UID,JID)
    assert res['phase']=='worker_index'

@pytest.mark.asyncio
async def test_release_manifest_includes_storage_index_descriptors():
    class Con:
        async def fetch(self,sql,*args):
            if 'FROM dictionary_entries' in sql:
                return [{'lexeme_id':uuid.UUID(UID),'content_sha':'f'*64,'sense_ids':[uuid.UUID(JID.hex)],'example_ids':[]}]
            if 'dictionary_r2_shards' in sql:return [{'descriptor':{'shard':'11','sha256':'a'*64}}]
            raise AssertionError(sql)
        async def fetchval(self,sql,*args):
            if 'dictionary_search_terms' in sql:return 0
            if 'dictionary_search_indexes' in sql:return {'version':index.VERSION,'logicalTerms':2200,'objects':[]}
            raise AssertionError(sql)
    result=await publication.make_manifest(Con(),REL)
    assert result['search_terms']==2200
    assert result['storage']['search']['logicalTerms']==2200
    assert result['storage']['shards'][0]['shard']=='11'

@pytest.mark.asyncio
async def test_release_manifest_requires_either_real_search_terms_or_worker_index():
    class Con:
        async def fetch(self,sql,*args):return ([{'lexeme_id':uuid.UUID(UID),'content_sha':'f'*64,'sense_ids':[],'example_ids':[]}]
                                                if 'dictionary_entries' in sql else [])
        async def fetchval(self,*args):return 0
    with pytest.raises(ValueError,match='index_validation_failed'):
        await publication.make_manifest(Con(),REL)

@pytest.mark.asyncio
async def test_worker_index_builds_searchable_immutable_directory_offline(monkeypatch):
    rel=REL
    item={'release_id':rel,'lexeme_id':UID,'display_lemma':'book',
          'normalized_search_form':'book','part_of_speech':'noun',
          'senses':[{'definition_uz':'kitob','translations':[{'text':'kitob'}]}],
          'forms':[]}
    records=[];created={};beats=[]
    async def read_shard(*args):
        records.append(args)
        return [item]
    async def put(key,body):created[key]=body
    async def beat():beats.append(1)
    monkeypatch.setattr(index,'read_shard',read_shard)
    monkeypatch.setattr(index,'put_immutable',put)
    manifest=await index.build_index(rel,[{'shard':'11'}],{UID:0},beat)
    assert manifest['version']==index.VERSION and manifest['logicalTerms']>0
    assert manifest['directory']['name']=='directory' and created
    assert any('/search/directory.json.gz' in k for k in created)
    assert beats
    directory=json.loads(__import__('gzip').decompress(created[storage.index_key(rel,'directory')]))
    assert directory['version']==index.VERSION
    assert len(directory['leaves'])>0
    assert len(directory['objects'])>0
    assert 'EN:book' not in directory['branches']
    assert all(d['sha256'] == hashlib.sha256(created[storage.index_key(rel,d['name'])]).hexdigest()
               for d in manifest['objects'])
