"""Offline recovery tools. Production sources are read-only; restore is local-only.

No scheduler, production configuration change, overwrite, prune or cloud delete.
Install requirements-recovery.txt in an operations environment, not the web image.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import threading
from urllib.parse import urlsplit, unquote

import asyncpg
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b'LA-BACKUP-GCM1\n'
CHUNK = 1024 * 1024
LOCAL = {'127.0.0.1','localhost','::1'}


def read_key(path):
    path=Path(path)
    mode=path.stat().st_mode
    if path.is_symlink() or not stat.S_ISREG(mode) or stat.S_IMODE(mode)&0o077:
        raise ValueError('key must be a private regular file (mode 0600)')
    value=path.read_bytes()
    if len(value)!=32:raise ValueError('key must contain exactly 32 random bytes')
    return value


class EncryptWriter:
    def __init__(self,out,key):
        self.out=out;self.size=0;nonce=os.urandom(12);header=MAGIC+nonce
        self.cipher=Cipher(algorithms.AES(key),modes.GCM(nonce)).encryptor()
        self.cipher.authenticate_additional_data(header);out.write(header)
    def write(self,data):
        self.size+=len(data)
        if self.size>32*1024**3:raise ValueError('archive exceeds 32 GiB; use reviewed shards')
        self.out.write(self.cipher.update(data));return len(data)
    def flush(self):self.out.flush()
    def finish(self):
        self.out.write(self.cipher.finalize());self.out.write(self.cipher.tag);self.out.flush()


@contextmanager
def encrypted_output(path,key_file):
    path=Path(path).resolve();path.parent.mkdir(parents=True,exist_ok=True)
    if Path(key_file).resolve().is_relative_to(path.parent):
        raise ValueError('store the encryption key outside the backup directory')
    key=read_key(key_file)
    if path.exists():raise ValueError('backup already exists; overwriting is forbidden')
    fd,tmp=tempfile.mkstemp(prefix='.backup-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            writer=EncryptWriter(out,key);yield writer
            writer.finish();os.fsync(out.fileno())
        # Atomic publish without replacing an earlier backup.
        os.link(tmp,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        os.unlink(tmp)


@contextmanager
def authenticated_plaintext(path,key_file):
    # Plaintext is never passed to a restore process until the GCM tag verifies.
    # TemporaryFile is private, unnamed/unlinked and removed on every exit path.
    key=read_key(key_file)
    with open(path,'rb') as source,tempfile.TemporaryFile() as out:
        header=source.read(len(MAGIC)+12)
        if not header.startswith(MAGIC) or len(header)!=len(MAGIC)+12:raise ValueError('invalid backup header')
        size=os.fstat(source.fileno()).st_size
        remaining=size-len(header)-16
        if remaining<0:raise ValueError('truncated backup')
        source.seek(-16,os.SEEK_END);tag=source.read(16);source.seek(len(header))
        cipher=Cipher(algorithms.AES(key),modes.GCM(header[-12:],tag)).decryptor()
        cipher.authenticate_additional_data(header)
        while remaining:
            part=source.read(min(CHUNK,remaining))
            if not part:raise ValueError('truncated backup')
            out.write(cipher.update(part));remaining-=len(part)
        out.write(cipher.finalize());out.seek(0);yield out


def digest_file(path):
    with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def connection_env(dsn,expected_host,*,restore=False):
    parsed=urlsplit(dsn)
    name=unquote(parsed.path.lstrip('/'))
    if parsed.scheme not in ('postgres','postgresql') or parsed.hostname!=expected_host or parsed.query or parsed.fragment:
        raise ValueError('source identity mismatch or unsupported DSN options')
    if not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_-]{0,62}',name):raise ValueError('invalid database identity')
    if restore and (parsed.hostname not in LOCAL or not name.startswith('learners_recovery_')):
        raise ValueError('restore is restricted to a new local learners_recovery_ database')
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST=parsed.hostname,PGPORT=str(parsed.port or 5432),PGDATABASE=name,
               PGUSER=unquote(parsed.username or 'postgres'),PGPASSWORD=unquote(parsed.password or ''),
               PGCONNECT_TIMEOUT='10',PGAPPNAME='learners-offline-recovery',
               PGSSLMODE='disable' if parsed.hostname in LOCAL else 'verify-full',
               PGOPTIONS='-c statement_timeout=300000'+('' if restore else ' -c default_transaction_read_only=on'))
    if parsed.hostname not in LOCAL:
        ca=os.environ.get('BACKUP_CA_FILE','')
        if not ca or not Path(ca).is_file():raise ValueError('verified PostgreSQL CA file is required')
        env['PGSSLROOTCERT']=ca
    return env


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


def backup_db(dsn,expected_host,path,key_file,pg_dump='pg_dump'):
    env=connection_env(dsn,expected_host)
    # ACLs/RLS/functions are preserved; do not use --no-acl or data-only export.
    process=subprocess.Popen([pg_dump,'--format=custom','--no-owner','--schema=public','--schema=drizzle',
                              '--lock-wait-timeout=10s'],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    deadline=threading.Timer(900,lambda:stop_process(process));deadline.start()
    try:
        with encrypted_output(path,key_file) as out:
            while part:=process.stdout.read(CHUNK):out.write(part)
            if process.wait()!=0:raise RuntimeError('pg_dump failed; archive was not published')
    finally:
        deadline.cancel();stop_process(process);process.stdout.close()
    return {'kind':'postgres-custom','sha256':digest_file(path),'encrypted_bytes':Path(path).stat().st_size,
            'schemas':['public','drizzle'],'source_host_sha256':hashlib.sha256(expected_host.encode()).hexdigest()}


async def empty_restore_target(dsn,*,prepare=False):
    con=await asyncpg.connect(dsn,timeout=10)
    try:
        count=await con.fetchval("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')")
        if count:raise ValueError('restore target is not empty')
        if prepare:
            # A fresh PostgreSQL database already has an empty public schema;
            # pg_dump also includes CREATE SCHEMA public. No CASCADE is allowed.
            # Only the guarded, empty local recovery target can reach this DDL.
            await con.execute('DROP SCHEMA IF EXISTS public')
    finally:await con.close()


def restore_db(dsn,path,key_file,expected_sha256,pg_restore='pg_restore'):
    env=connection_env(dsn,urlsplit(dsn).hostname,restore=True)
    if digest_file(path)!=expected_sha256:raise ValueError('encrypted archive checksum mismatch')
    asyncio.run(empty_restore_target(dsn))
    with authenticated_plaintext(path,key_file) as plain:
        asyncio.run(empty_restore_target(dsn,prepare=True))
        # No --clean, --create, --disable-triggers or permission stripping.
        process=subprocess.run([pg_restore,'--exit-on-error','--single-transaction','--no-owner',
                                '--dbname',env['PGDATABASE']],stdin=plain,env=env,stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL,timeout=900)
        if process.returncode:raise RuntimeError('pg_restore failed; transaction rolled back')
    return {'kind':'isolated-postgres-restore','result':'passed'}


def media_client(endpoint):
    from botocore.config import Config
    import boto3
    p=urlsplit(endpoint)
    if p.scheme!='https' or not p.hostname or not p.hostname.endswith('.r2.cloudflarestorage.com') or p.username or p.password or p.query or p.fragment or p.path not in ('','/'):
        raise ValueError('R2 HTTPS endpoint identity is required')
    return boto3.client('s3',endpoint_url=endpoint,region_name='auto',
        aws_access_key_id=os.environ['BACKUP_R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['BACKUP_R2_SECRET_ACCESS_KEY'],
        config=Config(connect_timeout=5,read_timeout=30,retries={'max_attempts':2,'mode':'standard'}))


def backup_media(endpoint,bucket,expected_bucket,path,key_file,*,apply=False,max_objects=10000,prefix=''):
    if bucket!=expected_bucket:raise ValueError('media bucket identity mismatch')
    client=media_client(endpoint);objects=[]
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket,**({'Prefix':prefix} if prefix else {})):
        for row in page.get('Contents',[]):
            key=row['Key']
            if key.startswith('/') or '\\' in key or any(p in ('','..','.') for p in key.split('/')):
                raise ValueError('unsafe object key; export stopped')
            objects.append(row)
            if len(objects)>max_objects:raise ValueError('object ceiling exceeded; review the inventory before increasing it')
    report={'kind':'r2-encrypted-tar','objects':len(objects),'source_bytes':sum(r['Size'] for r in objects),'applied':apply,'scope':'prefix' if prefix else 'whole bucket'}
    if not apply:return report
    with encrypted_output(path,key_file) as out:
        with tarfile.open(mode='w|',fileobj=out) as archive:
            for row in objects:
                result=client.get_object(Bucket=bucket,Key=row['Key'],IfMatch=row['ETag'])
                body=result['Body']
                try:
                    if result['ContentLength']!=row['Size']:raise ValueError('object changed during export')
                    info=tarfile.TarInfo(row['Key']);info.size=row['Size'];info.mode=0o600
                    info.pax_headers={'la.content-type':result.get('ContentType','application/octet-stream'),'la.etag':row['ETag']}
                    archive.addfile(info,body)
                finally:body.close()
    report.update(sha256=digest_file(path),encrypted_bytes=Path(path).stat().st_size)
    return report


def extract_media(path,key_file,target,expected_sha256):
    target=Path(target).resolve()
    metadata_path=Path(str(target)+'.metadata.json')
    if not target.name.startswith('learners_recovery_media_') or target.exists() or metadata_path.exists():
        raise ValueError('media recovery requires a new local learners_recovery_media_ directory')
    if digest_file(path)!=expected_sha256:raise ValueError('encrypted archive checksum mismatch')
    count=size=0;metadata=[];metadata_created=False
    with authenticated_plaintext(path,key_file) as plain:
        target.mkdir(mode=0o700)
        try:
            with tarfile.open(fileobj=plain,mode='r|') as archive:
                for info in archive:
                    key=info.name
                    if (not info.isfile() or key.startswith('/') or '\\' in key
                        or any(p in ('','..','.') for p in key.split('/'))):raise ValueError('unsafe archive member')
                    dest=target/key
                    if not dest.resolve().is_relative_to(target):raise ValueError('unsafe archive path')
                    dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                    fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                    with os.fdopen(fd,'wb') as out,archive.extractfile(info) as source:
                        shutil.copyfileobj(source,out,CHUNK)
                    count+=1;size+=info.size
                    metadata.append({'key':key,'size':info.size,'contentType':info.pax_headers.get('la.content-type'),
                                     'sourceEtag':info.pax_headers.get('la.etag')})
            fd=os.open(metadata_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);metadata_created=True
            with os.fdopen(fd,'w') as out:
                json.dump(metadata,out);out.flush();os.fsync(out.fileno())
        except BaseException:
            shutil.rmtree(target)
            if metadata_created:metadata_path.unlink()
            raise
    return {'kind':'isolated-media-restore','result':'passed','objects':count,'bytes':size,'mime_metadata_exported':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    key=sub.add_parser('init-key');key.add_argument('--key-file',required=True)
    backup=sub.add_parser('backup-db');backup.add_argument('--expected-host',required=True);backup.add_argument('--pg-dump',default='pg_dump')
    restore=sub.add_parser('restore-db');restore.add_argument('--sha256',required=True);restore.add_argument('--pg-restore',default='pg_restore')
    media=sub.add_parser('backup-media');media.add_argument('--bucket',required=True);media.add_argument('--expected-bucket',required=True);media.add_argument('--apply',action='store_true');media.add_argument('--max-objects',type=int,default=10000);media.add_argument('--prefix',default='')
    extract=sub.add_parser('extract-media');extract.add_argument('--target',required=True);extract.add_argument('--sha256',required=True)
    for p in (backup,restore,media,extract):p.add_argument('--archive',required=True);p.add_argument('--key-file',required=True)
    args=parser.parse_args()
    if args.action=='init-key':
        fd=os.open(args.key_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as out:out.write(os.urandom(32));out.flush();os.fsync(out.fileno())
        report={'result':'key created; keep separately in owner-controlled recovery storage'}
    elif args.action=='backup-db':report=backup_db(os.environ['BACKUP_DATABASE_URL'],args.expected_host,args.archive,args.key_file,args.pg_dump)
    elif args.action=='restore-db':report=restore_db(os.environ['RESTORE_DATABASE_URL'],args.archive,args.key_file,args.sha256,args.pg_restore)
    elif args.action=='extract-media':report=extract_media(args.archive,args.key_file,args.target,args.sha256)
    else:report=backup_media(os.environ['BACKUP_R2_ENDPOINT'],args.bucket,args.expected_bucket,args.archive,args.key_file,apply=args.apply,max_objects=args.max_objects,prefix=args.prefix)
    print(json.dumps(report))


if __name__=='__main__':
    try:main()
    except Exception as exc:
        # Provider/driver exceptions can contain credentials or object keys.
        print(json.dumps({'result':'failed','error_type':type(exc).__name__,'message':'Recovery operation stopped; no production restore is supported.'}))
        raise SystemExit(1)
