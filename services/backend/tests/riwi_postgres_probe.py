"""Actual ASGI requests against embedded PostgreSQL via a stdio driver adapter.

No TCP port, production database, external service or user account is used.
The adapter returns PostgreSQL metadata/records in asyncpg's documented shapes.
"""
import asyncio
import json
import os
import sys
import threading
from datetime import datetime, date
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import bcrypt
from fastapi.testclient import TestClient
from app import main as core
from app.asgi import application

LOCK = threading.Lock()


class DatabaseError(Exception):
    def __init__(self, message, code):super().__init__(message);self.sqlstate = code


def encode(value):
    if isinstance(value, (UUID, Decimal)):return str(value)
    if isinstance(value, (datetime, date)):return value.isoformat()
    raise TypeError(type(value).__name__)


def exchange(mode, sql, values):
    with LOCK:
        print(json.dumps({'mode': mode, 'sql': sql, 'values': values}, default=encode), flush=True)
        response = json.loads(sys.stdin.readline())
    if 'error' in response:raise DatabaseError(response['error'], response.get('code'))
    return response


def decode(value, oid):
    if value is None:return None
    if oid == 2950:return UUID(value)
    if oid in (1114, 1184):return datetime.fromisoformat(value.replace('Z', '+00:00'))
    if oid == 1082:return date.fromisoformat(value[:10])
    if oid == 1700:return Decimal(str(value))
    return value


class Transaction:
    def __init__(self, con, readonly=False):self.con = con;self.readonly = readonly
    async def __aenter__(self):
        self.depth = self.con.depth;self.con.depth += 1
        await self.con.execute(('BEGIN READ ONLY' if self.readonly else 'BEGIN') if self.depth == 0 else f'SAVEPOINT probe_{self.depth}')
        return self.con
    async def __aexit__(self, kind, value, trace):
        self.con.depth -= 1
        await self.con.execute(('ROLLBACK' if kind else 'COMMIT') if self.depth == 0 else (f'ROLLBACK TO SAVEPOINT probe_{self.depth}' if kind else f'RELEASE SAVEPOINT probe_{self.depth}'))
        return False


class Connection:
    depth = 0
    async def __aenter__(self):return self
    async def __aexit__(self, *args):return False
    def acquire(self):return self
    def transaction(self, readonly=False):return Transaction(self, readonly)
    async def fetch(self, sql, *values):
        result = await asyncio.to_thread(exchange, 'query', sql, values)
        return [{field['name']: decode(row[field['name']], field['dataTypeID']) for field in result['fields']} for row in result['rows']]
    async def fetchrow(self, sql, *values):
        rows = await self.fetch(sql, *values);return rows[0] if rows else None
    async def fetchval(self, sql, *values):
        row = await self.fetchrow(sql, *values);return next(iter(row.values())) if row else None
    async def execute(self, sql, *values):
        result = await asyncio.to_thread(exchange, 'query' if values else 'exec', sql, values)
        return result.get('command', '')
    async def prepare(self, sql, *, name):
        assert name == ''
        description = await asyncio.to_thread(exchange, 'describe', sql, [])
        con = self
        class Statement:
            def get_parameters(self):return [SimpleNamespace(name=p['name']) for p in description['params']]
            def get_attributes(self):return [SimpleNamespace(name=f['name'], type=SimpleNamespace(name=f['typeName'], oid=f['dataTypeID'])) for f in description['fields']]
            async def fetch(self, *values):
                rows = await con.fetch(sql, *values)
                return [tuple(row[f['name']] for f in description['fields']) for row in rows]
        return Statement()



from app import riwi_assessment_policy_store as policies
from app.riwi_capabilities import RiwiActor

if __name__=='__main__':
    con=Connection()
    async def pool():return con
    core.pool=pool
    checks=0
    async def run():
        global checks
        uid='11111111-1111-4111-8111-111111111111'
        await con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status) VALUES($1,'Isolated Owner','riwi-owner@example.invalid','fixture','owner','active')",uid)
        actor=RiwiActor(id=uid,role='owner',account_status='active',locale='en')
        overlay={'maxWeaknesses':2,'feedbackStyle':'concise'}
        created=await policies.create(con,actor,'writing.task2.*',overlay)
        item=created['policyVersion'];checks+=1
        assert item['state']=='candidate'
        assert (await policies.active(con,'writing.task2.opinion'))==(None,None,None);checks+=1
        try:await policies.review(con,actor,item['id'],'0'*64,'approve')
        except ValueError:pass
        else:raise AssertionError('stale hash approved')
        assert (await policies.active(con,'writing.task2.opinion'))==(None,None,None);checks+=1
        approved=await policies.review(con,actor,item['id'],item['contentHash'],'approve')
        assert approved['state']=='approved';checks+=1
        assert (await policies.active(con,'writing.task2.opinion'))[0]==overlay;checks+=1
        try:await policies.review(con,actor,item['id'],item['contentHash'],'approve')
        except ValueError:pass
        else:raise AssertionError('approval replay accepted')
        checks+=1
        second=(await policies.create(con,actor,'writing.task2.*',{'maxWeaknesses':1}))['policyVersion']
        await policies.review(con,actor,second['id'],second['contentHash'],'approve')
        rolled=await policies.review(con,actor,item['id'],item['contentHash'],'rollback')
        assert rolled['version']==3 and rolled['versionId']!=item['id'];checks+=1
        assert (await policies.active(con,'writing.task2.opinion'))[0]==overlay;checks+=1
        states=await con.fetch('SELECT version,state FROM riwi_assessment_policy_versions ORDER BY version')
        assert [(r['version'],r['state']) for r in states]==[(1,'superseded'),(2,'superseded'),(3,'approved')];checks+=1
        for role in ('student','teacher','admin'):
            other=RiwiActor(id=uid,role=role,account_status='active',locale='en')
            try:await policies.create(con,other,'writing.task2.*',overlay)
            except PermissionError:pass
            else:raise AssertionError('non-owner policy created')
            checks+=1
        # Audit failure must roll back both parent and candidate creation.
        from unittest.mock import patch,AsyncMock
        before=await con.fetchval('SELECT count(*) FROM riwi_assessment_policy_versions')
        with patch.object(policies,'record_riwi_audit',AsyncMock(side_effect=RuntimeError('fixture audit unavailable'))):
            try:await policies.create(con,actor,'writing.task1.*',overlay)
            except RuntimeError:pass
            else:raise AssertionError('write without audit')
        assert await con.fetchval('SELECT count(*) FROM riwi_assessment_policy_versions')==before;checks+=1
        assert not await con.fetchval("SELECT count(*) FROM riwi_assessment_policies WHERE scope='writing.task1.*'");checks+=1
    asyncio.run(run())
    from app.security import SESSION_COOKIE,issue_token
    os.environ['AUTH_SECRET']='isolated-riwi-policy-test-signing-secret'
    token=issue_token({'id':'11111111-1111-4111-8111-111111111111','name':'Isolated Owner','role':'owner','locale':'en'})
    client=TestClient(core.app)
    headers={'Cookie':f'{SESSION_COOKIE}={token}'}
    items=client.get('/api/riwi/owner/assessment-policies',headers=headers)
    assert items.status_code==200,items.text
    assert len(items.json()['items'])==3
    checks+=1
    preview=client.post('/api/riwi/owner/assessment-policies/preview',headers=headers,
        json={'scope':'writing.task1.*','overlay':{'maxWeaknesses':1}})
    assert preview.status_code==200 and preview.json()['regression']['passed'],preview.text
    checks+=1
    created=client.post('/api/riwi/owner/assessment-policies',headers=headers,
        json={'scope':'writing.task1.*','overlay':{'maxWeaknesses':1}})
    assert created.status_code==200,created.text
    item=created.json()['policyVersion'];checks+=1
    denied=client.post(f"/api/riwi/owner/assessment-policies/{item['id']}/approve",headers=headers,json={})
    assert denied.status_code==400,denied.text
    checks+=1
    approved=client.post(f"/api/riwi/owner/assessment-policies/{item['id']}/approve",headers=headers,json={'contentHash':item['contentHash']})
    assert approved.status_code==200,approved.text
    checks+=1
    print(json.dumps({'event':'done','probeKind':'riwi_policy','checks':checks,'storeChecks':14,'httpChecks':5}),flush=True)
