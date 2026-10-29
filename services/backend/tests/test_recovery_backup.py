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
