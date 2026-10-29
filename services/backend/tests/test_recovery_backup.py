"""Fail-closed backup guards, authenticated restore and interrupted export."""
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile

from cryptography.exceptions import InvalidTag
import pytest
from tools import recovery_backup as recovery
from botocore.response import StreamingBody


@pytest.fixture
def files(tmp_path):
    key=tmp_path/'key';key.write_bytes(os.urandom(32));key.chmod(0o600)
    return key,tmp_path/'archives'/'data.labak'


@pytest.mark.parametrize('dsn',[
    'postgresql://user:password@production.supabase.co/postgres',
    'postgresql://user:password@127.0.0.1/production',
    'postgresql://user:password@127.0.0.1/learners_recovery_test?options=unsafe',
])
def test_restore_target_guards_run_before_any_connection(dsn):
    with pytest.raises(ValueError):recovery.connection_env(dsn,recovery.urlsplit(dsn).hostname,restore=True)


def test_failed_dump_never_publishes_a_backup(files):
    key,archive=files
    with pytest.raises(RuntimeError):
        recovery.backup_db('postgresql://fixture@127.0.0.1/learners_recovery_fixture','127.0.0.1',archive,key,'/usr/bin/false')
    assert not archive.exists() and list(archive.parent.iterdir())==[]


@pytest.mark.parametrize('failure',['changed','wrong_key'])
def test_authentication_precedes_plaintext_use(files,failure):
    key,archive=files;content=b'isolated backup bytes'*(1024*64)
    with recovery.encrypted_output(archive,key) as out:out.write(content)
    if failure=='changed':
        data=bytearray(archive.read_bytes());data[len(data)//2]^=1;archive.write_bytes(data)
    else:key.write_bytes(os.urandom(32))
    entered=False
    with pytest.raises(InvalidTag):
        with recovery.authenticated_plaintext(archive,key):entered=True
    assert not entered


def test_unrestricted_or_colocated_key_is_refused(files):
    key,archive=files;key.chmod(0o644)
    with pytest.raises(ValueError):
        with recovery.encrypted_output(archive,key):pass
    key.chmod(0o600)
    with pytest.raises(ValueError):
        with recovery.encrypted_output(key.parent/'backup.labak',key):pass
    assert not archive.exists()


def test_authenticated_malicious_tar_cannot_escape_target(files,tmp_path):
    key,archive=files
    with recovery.encrypted_output(archive,key) as out:
        with tarfile.open(mode='w|',fileobj=out) as tar:
            info=tarfile.TarInfo('../escape');info.size=4;tar.addfile(info,io.BytesIO(b'test'))
    target=tmp_path/'learners_recovery_media_test'
    with pytest.raises(ValueError):recovery.extract_media(archive,key,target,recovery.digest_file(archive))
    assert not (tmp_path/'escape').exists() and not target.exists()


def test_cli_errors_do_not_print_connection_secrets(files):
    key,archive=files
    secret='must-never-appear-in-output'
    env={**os.environ,'BACKUP_DATABASE_URL':f'postgresql://user:{secret}@untrusted.example/postgres'}
    process=subprocess.run([sys.executable,str(Path(recovery.__file__)),'backup-db',
      '--expected-host','expected.example','--archive',str(archive),'--key-file',str(key)],env=env,capture_output=True,text=True)
    assert process.returncode==1 and secret not in process.stdout+process.stderr
    assert not archive.exists()


def test_legal_flat_r2_keys_preserved_without_filesystem_traversal(files,tmp_path,monkeypatch):
    key,archive=files
    contents={'folder/':b'','legacy//audio.bin':b'audio','../legacy.bin':b'preserved object bytes'}
    class Pages:
        def paginate(self,**kwargs):
            yield {'Contents':[{'Key':k,'Size':len(v),'ETag':k} for k,v in contents.items()]}
    class Client:
        def get_paginator(self,name):return Pages()
        def get_object(self,**kwargs):
            value=contents[kwargs['Key']]
            assert kwargs['IfMatch']==kwargs['Key']
            return {'Body':StreamingBody(io.BytesIO(value),len(value)),'ContentLength':len(value)}
    monkeypatch.setattr(recovery,'media_client',lambda endpoint:Client())
    saved=recovery.backup_media('unused','fixture','fixture',archive,key,apply=True)
    target=tmp_path/'learners_recovery_media_flat'
    recovery.extract_media(archive,key,target,saved['sha256'])
    import json
    metadata=json.loads(Path(str(target)+'.metadata.json').read_text())
    assert {r['key'] for r in metadata}==set(contents)
    assert all((target/r['file']).read_bytes()==contents[r['key']] for r in metadata)
    assert not (tmp_path/'legacy.bin').exists()


@pytest.mark.parametrize('permanent',[False,True])
def test_interrupted_stream_retries_exact_object_without_partial_publish(files,monkeypatch,permanent):
    from botocore.exceptions import ResponseStreamingError
    key,archive=files;attempts=[];bodies=[]
    class Body(io.BytesIO):
        def read(self,n=-1):
            if permanent or len(attempts)==1:raise ResponseStreamingError(error=ConnectionResetError())
            return super().read(n)
    class Client:
        def get_paginator(self,name):return self
        def paginate(self,**kwargs):yield {'Contents':[{'Key':'fixed/key','Size':5,'ETag':'exact-etag'}]}
        def get_object(self,**kwargs):
            attempts.append(kwargs);body=Body(b'hello');bodies.append(body)
            return {'Body':body,'ContentLength':5}
    monkeypatch.setattr(recovery,'media_client',lambda endpoint:Client())
    monkeypatch.setattr(recovery.time,'sleep',lambda seconds:None)
    if permanent:
        with pytest.raises(ResponseStreamingError):recovery.backup_media('unused','fixture','fixture',archive,key,apply=True)
        assert not archive.exists() and list(archive.parent.iterdir())==[]
    else:
        result=recovery.backup_media('unused','fixture','fixture',archive,key,apply=True)
        assert result['objects']==1
        with recovery.authenticated_plaintext(archive,key) as plain:
            with tarfile.open(fileobj=plain,mode='r|') as tar:
                info=next(iter(tar));assert tar.extractfile(info).read()==b'hello'
    assert len(attempts)==(3 if permanent else 2)
    assert all(x['Key']=='fixed/key' and x['IfMatch']=='exact-etag' for x in attempts)
    assert all(x.closed for x in bodies)


def test_shards_are_disjoint_and_cover_all_legal_keys(files,monkeypatch):
    key,archive=files;seen=[];keys=['a/','a//b','../c']+[str(i) for i in range(30)]
    class Client:
        def get_paginator(self,name):return self
        def paginate(self,**kwargs):yield {'Contents':[{'Key':k,'Size':1,'ETag':k} for k in keys]}
        def get_object(self,**kwargs):
            seen.append(kwargs['Key']);return {'Body':io.BytesIO(b'x'),'ContentLength':1}
    monkeypatch.setattr(recovery,'media_client',lambda endpoint:Client())
    for index in range(4):
        result=recovery.backup_media('unused','fixture','fixture',archive.with_name(str(index)+'.labak'),key,apply=True,shard_count=4,shard_index=index)
        assert result['inventory_objects']==len(keys)
    assert sorted(seen)==sorted(keys)
    with pytest.raises(ValueError):recovery.backup_media('unused','fixture','fixture',archive,key,shard_count=4,shard_index=4)
