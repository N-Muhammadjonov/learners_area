"""Fresh synthetic full application dump/restore with native PostgreSQL tools."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit

import asyncpg
import bcrypt
from botocore.response import StreamingBody
from unittest.mock import patch
from app import db
from browser_fixtures import seed, id
from tools import recovery_backup as recovery


async def seed_source(dsn):
    con=await asyncpg.connect(dsn)
    await db.initialize_connection(con)
    assert await con.fetchval("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")==0
    for path in sorted((Path(__file__).resolve().parents[1]/'migrations').glob('*.sql')):
        for sql in path.read_text().split('--> statement-breakpoint'):
            if sql.strip():await con.execute(sql)
    uid=id('recovery-student');digest=bcrypt.hashpw(b'RecoveryFixture123!',bcrypt.gensalt(rounds=4)).decode()
    await con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,locale) VALUES($1,'Recovery learner','recovery@example.test',$2,'student','active','en')",uid,digest)
    await seed(con,uid,digest)
    await con.execute("INSERT INTO telegram_login_intents(token_hash,browser_nonce_hash,telegram_user_id,purpose,expires_at) VALUES($1,$2,'7001','login',NOW()+INTERVAL '5 minutes')",'a'*64,'b'*64)
    await con.execute("INSERT INTO telegram_flow_drafts(actor_telegram_id,kind,payload,expires_at) VALUES('7001','auth_intent',$1,NOW()+INTERVAL '5 minutes')",{'token_hash':'a'*64})
    await con.execute("INSERT INTO telegram_processed_updates(update_id) VALUES('7001001')")
    await con.execute("INSERT INTO auth_session_revocations(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",'c'*64,uid)
    await con.execute("INSERT INTO notifications(user_id,type,title,body) VALUES($1,'TEST_RECOVERY','Synthetic recovery','Only fixture data')",uid)
    await con.close()


async def snapshot(dsn):
    con=await asyncpg.connect(dsn)
    try:
        tables=await con.fetch("SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('public','drizzle') AND table_type='BASE TABLE' ORDER BY 1,2")
        rows={}
        for row in tables:
            schema,name=row['table_schema'],row['table_name']
            count=await con.fetchval(f'SELECT count(*) FROM "{schema}"."{name}"')
            assert count<10000,'synthetic fixture only'
            digest=await con.fetchval(f"SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) FROM \"{schema}\".\"{name}\" t")
            rows[schema+'.'+name]={'rows':count,'digest':digest}
        constraints=await con.fetchval("SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','drizzle')")
        rls=await con.fetch("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1")
        function=await con.fetchrow("SELECT p.prosecdef,p.proconfig,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='la_claim_ai_provider_v1'")
        return {'tables':rows,'constraints':constraints,'rls':[list(x.values()) for x in rls],'ai_function':dict(function)}
    finally:await con.close()


def main():
    source=os.environ['RECOVERY_SOURCE_DATABASE_URL'];target=os.environ['RECOVERY_TARGET_DATABASE_URL']
    for dsn in (source,target):
        p=urlsplit(dsn)
        assert p.hostname in recovery.LOCAL and p.path.startswith('/learners_recovery_')
    assert source!=target
    asyncio.run(seed_source(source));before=asyncio.run(snapshot(source));checks=0
    base=Path(os.environ['RECOVERY_WORK_DIR']).resolve();base.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='recovery-',dir=base) as temp:
        temp=Path(temp);keys=temp/'keys';keys.mkdir(mode=0o700);key=keys/'key';key.write_bytes(os.urandom(32));key.chmod(0o600)
        archive=temp/'encrypted'/'application.labak'
        receipt=recovery.backup_db(source,urlsplit(source).hostname,archive,key,os.environ['PG_DUMP_BIN'])
        assert archive.read_bytes()[:len(recovery.MAGIC)]==recovery.MAGIC
        recovery.restore_db(target,archive,key,receipt['sha256'],os.environ['PG_RESTORE_BIN'])
        after=asyncio.run(snapshot(target))
        assert before==after,'table contents, constraints, RLS or function privileges changed'
        checks+=len(before['tables'])+3
        try:recovery.restore_db(target,archive,key,receipt['sha256'],os.environ['PG_RESTORE_BIN'])
        except ValueError as exc:assert 'not empty' in str(exc)
        else:raise AssertionError('nonempty restore accepted')
        checks+=1
        try:recovery.connection_env('postgresql://postgres@example.supabase.co/postgres','example.supabase.co',restore=True)
        except ValueError:pass
        else:raise AssertionError('production restore accepted')
        checks+=1
        tampered=temp/'encrypted'/'tampered.labak';data=bytearray(archive.read_bytes());data[len(data)//2]^=1;tampered.write_bytes(data)
        entered=False
        try:
            with recovery.authenticated_plaintext(tampered,key):entered=True
        except Exception as exc:
            from cryptography.exceptions import InvalidTag
            assert isinstance(exc,InvalidTag)
        assert not entered,'unauthenticated plaintext exposed to restore'
        checks+=1
        # Exercise streaming media archive/restore independently of cloud transport.
        contents={'speaking/fixture.webm':b'fake isolated media'*100,'reading/fixture.pdf':b'%PDF-isolated fixture'}
        class Pages:
            def paginate(self,**kwargs):
                assert kwargs=={'Bucket':'isolated-fixture'}
                yield {'Contents':[{'Key':k,'Size':len(v),'ETag':hashlib.md5(v).hexdigest()} for k,v in contents.items()]}
        class S3:
            def get_paginator(self,name):assert name=='list_objects_v2';return Pages()
            def get_object(self,**kwargs):
                data=contents[kwargs['Key']];assert kwargs['Bucket']=='isolated-fixture' and kwargs['IfMatch']==hashlib.md5(data).hexdigest()
                return {'Body':StreamingBody(io.BytesIO(data),len(data)),'ContentLength':len(data),'ContentType':'application/octet-stream'}
        media=temp/'encrypted'/'media.labak'
        with patch.object(recovery,'media_client',return_value=S3()):
            planned=recovery.backup_media('unused','isolated-fixture','isolated-fixture',media,key)
            assert not media.exists() and planned['applied'] is False
            saved=recovery.backup_media('unused','isolated-fixture','isolated-fixture',media,key,apply=True)
        extracted=temp/'learners_recovery_media_fixture'
        restored=recovery.extract_media(media,key,extracted,saved['sha256'])
        assert all((extracted/k).read_bytes()==v for k,v in contents.items())
        metadata=json.loads(Path(str(extracted)+'.metadata.json').read_text())
        assert {r['key'] for r in metadata}==set(contents)
        assert all(r['contentType']=='application/octet-stream' for r in metadata)
        checks+=4
        report={'result':'passed','checks':checks,'scope':'synthetic full application schema/data; native PostgreSQL dump+restore; no production copy',
                'tables':len(before['tables']),'populated_tables':sum(r['rows']>0 for r in before['tables'].values()),
                'rows':sum(r['rows'] for r in before['tables'].values()),'constraints':before['constraints'],
                'rls_and_function_acl_preserved':True,'database_archive':receipt,'media_archive':saved,'media_restored':restored,
                'guards':['production restore rejected','nonempty target rejected','corruption rejected before plaintext use','media plan is read-only'],
                'temporary_keys_archives_removed_on_exit':True}
    print(json.dumps(report),flush=True)


if __name__=='__main__':main()
