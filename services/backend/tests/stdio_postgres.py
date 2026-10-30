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
    async def executemany(self, sql, values):
        # asyncpg executes the batch atomically; the caller here also holds the
        # same explicit transaction as the application under test.
        for parameters in values:
            await self.execute(sql, *parameters)
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
