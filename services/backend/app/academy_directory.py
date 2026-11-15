"""Import directory entries while preserving the canonical user and its history."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Annotated, Literal
from uuid import UUID

from asyncpg import Connection
from pydantic import BaseModel, ConfigDict, Field, Strict

from .academy_directory_files import FIELDS, MAX_FILE, FileFormat, Table, contains_controls

PAGE_SIZE = 100
CHUNK_SIZE = 500
MAX_EXPORT = 10_000
ROLES = {
    'student': 'student', 'learner': 'student', 'o‘quvchi': 'student', 'talaba': 'student',
    "o'quvchi": 'student', 'ученик': 'student', 'студент': 'student',
    'teacher': 'teacher', 'instructor': 'teacher', 'o‘qituvchi': 'teacher',
    "o'qituvchi": 'teacher', 'учитель': 'teacher', 'преподаватель': 'teacher',
}
READY = ('ready_link', 'ready_stage')
Column = Literal['external_id', 'name', 'email', 'role', 'user_id']
Operation = Literal['inspect', 'preview', 'apply']
DirectoryRole = Literal['student', 'teacher']


class DirectoryError(ValueError):
    def __init__(self, code: str, status: int = 422):
        super().__init__(code)
        self.code = code
        self.status = status


class FileInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    format: FileFormat
    data: str = Field(min_length=1, max_length=(MAX_FILE+2)//3*4)
    sheet: str | None = Field(default=None, min_length=1, max_length=31)


class PreviewInput(FileInput):
    source: str = Field(pattern=r'^[a-z0-9][a-z0-9._-]{0,79}$')
    columns: dict[Column, Annotated[int, Strict(), Field(ge=0, lt=50)]]


class ApplyInput(PreviewInput):
    commandId: UUID
    reviewHash: str = Field(pattern=r'^[a-f0-9]{64}$')


class ResolveInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: str = Field(pattern=r'^[a-z0-9][a-z0-9._-]{0,79}$')
    externalId: str = Field(min_length=1,max_length=120)
    userId: UUID


@dataclass(frozen=True)
class PreparedRow:
    number: int
    external_id: str
    name: str
    email: str | None
    role: str
    user_id: UUID | None
    error: str | None


def hash_value(value: object) -> str:
    data = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str)
    return hashlib.sha256(data.encode()).hexdigest()


def normalize_rows(table: Table, columns: dict[str, int]) -> list[PreparedRow]:
    required = {'external_id', 'name', 'role'}
    if (not required.issubset(columns) or not ({'email', 'user_id'} & columns.keys())
            or len(set(columns.values())) != len(columns)
            or any(index >= len(table.headers) for index in columns.values())):
        raise DirectoryError('invalid_mapping')
    result = []
    for number, cells, formulas in table.rows:
        values = {}
        for key in FIELDS:
            index = columns.get(key)
            raw = cells[index] if index is not None and index < len(cells) else ''
            values[key] = unicodedata.normalize('NFC', raw).strip()
        external = values['external_id']
        name = values['name']
        email = values['email'].lower() or None
        role = ROLES.get(values['role'].casefold(), '')
        user_id = None
        try:
            if values['user_id']:
                user_id = UUID(values['user_id'])
        except ValueError:
            pass
        error = None
        if any(index in formulas for index in columns.values()):
            error = 'formula_cell'
        elif any(contains_controls(value) for value in values.values()):
            error = 'invalid_text'
        elif not 1 <= len(external) <= 120:
            error = 'invalid_external_id'
        elif not 1 <= len(name) <= 200:
            error = 'invalid_name'
        elif not role:
            error = 'unsupported_role'
        elif email and (len(email) > 320 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email)):
            error = 'invalid_email'
        elif values['user_id'] and user_id is None:
            error = 'invalid_account_id'
        elif not email and not user_id:
            error = 'contact_required'
        result.append(PreparedRow(number,external,name,email,role,user_id,error))
    return result


async def classify(conn: Connection, source: str, rows: list[PreparedRow], *, lock: bool = False) -> list[dict]:
    valid = [row for row in rows if not row.error]
    emails = [row.email for row in valid if row.email]
    external_ids = [row.external_id for row in valid]
    explicit_ids = [row.user_id for row in valid if row.user_id]
    account_rows = await conn.fetch(
        """SELECT id,lower(email) AS email,role::text AS role FROM users
            WHERE id=ANY($1::uuid[]) OR lower(email)=ANY($2::text[])
            ORDER BY id""" + (' FOR SHARE' if lock else ''), explicit_ids, emails)
    by_id = {item['id']: item for item in account_rows}
    by_email = defaultdict(list)
    for account in account_rows:
        if account['email']:
            by_email[account['email']].append(account)
    existing = await conn.fetch(
        """SELECT external_id,name,email,role,user_id FROM academy_directory_records
            WHERE source=$1 AND (external_id=ANY($2::text[]) OR email=ANY($3::text[])
                            OR user_id=ANY($4::uuid[]))""", source, external_ids, emails, list(by_id))
    external_map = {item['external_id']: item for item in existing}
    email_map = {item['email']: item['external_id'] for item in existing if item['email']}
    user_map = {item['user_id']: item['external_id'] for item in existing if item['user_id']}
    duplicate_ids = Counter(external_ids)
    duplicate_emails = Counter(emails)
    result = []
    for row in rows:
        state, user = classify_row(row, external_map.get(row.external_id), by_id, by_email)
        if not row.error:
            if duplicate_ids[row.external_id] > 1:
                state = 'duplicate_external_id'
            elif row.email and duplicate_emails[row.email] > 1:
                state = 'duplicate_email'
            elif row.email in email_map and email_map[row.email] != row.external_id:
                state = 'source_email_conflict'
            elif user in user_map and user_map[user] != row.external_id:
                state = 'source_account_conflict'
        result.append({'row': row.number, 'externalId': row.external_id, 'name': row.name,
                       'email': row.email, 'role': row.role, 'userId': str(user) if user else None,
                       'status': state})
    users = Counter(item['userId'] for item in result if item['status'] in READY and item['userId'])
    for item in result:
        if item['status'] in READY and users[item['userId']] > 1:
            item['status'] = 'duplicate_account'
    return result


def classify_row(row: PreparedRow, existing, by_id: dict, by_email: dict) -> tuple[str, UUID | None]:
    if row.error:
        return row.error, None
    candidates = by_email.get(row.email, [])
    if row.user_id:
        account = by_id.get(row.user_id)
        if not account or account['role'] != row.role:
            return 'account_role_mismatch', None
        if row.email and (account['email'] != row.email or len(candidates) != 1):
            return 'account_email_mismatch', None
    else:
        if len(candidates) > 1:
            return 'ambiguous_email', None
        account = candidates[0] if candidates else None
        if account and account['role'] != row.role:
            return 'account_role_mismatch', None
    user = account['id'] if account else None
    if existing:
        if (existing['name'],existing['email'],existing['role']) != (row.name,row.email,row.role):
            return 'source_record_conflict', None
        if existing['user_id']:
            if user is not None and existing['user_id'] != user:
                return 'source_account_conflict', None
            return 'already_linked', existing['user_id']
        if not user:
            return 'already_staged', None
    return ('ready_link' if user else 'ready_stage'), user


def report_for(items: list[dict]) -> dict:
    totals = dict(Counter(item['status'] for item in items))
    return {'total':len(items),'counts':totals,'ready':sum(totals.get(key,0) for key in READY)}


def preview(items: list[dict], source: str, file_hash: str, page: int) -> dict:
    offset = (page-1)*PAGE_SIZE
    return {**report_for(items), 'page':page, 'pageSize':PAGE_SIZE,
            'rows':items[offset:offset+PAGE_SIZE],
            'reviewHash':hash_value([source,file_hash,items])}


async def apply(conn: Connection, actor: UUID, command: ApplyInput, rows: list[PreparedRow],
                file_hash: str) -> dict:
    fingerprint = hash_value([command.source,file_hash,command.columns,command.sheet,command.reviewHash])
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':directory-command'),hashtext($1))",
                           str(command.commandId))
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':directory-source'),hashtext($1))",
                           command.source)
        old = await conn.fetchrow(
            'SELECT actor_user_id,fingerprint,report::text FROM academy_directory_imports WHERE id=$1',
            command.commandId)
        if old:
            if old['actor_user_id'] != actor or old['fingerprint'] != fingerprint:
                raise DirectoryError('idempotency_conflict',409)
            return json.loads(old['report'])
        items = await classify(conn, command.source, rows, lock=True)
        if hash_value([command.source,file_hash,items]) != command.reviewHash:
            raise DirectoryError('preview_changed',409)
        stats = report_for(items)
        if not stats['ready']:
            raise DirectoryError('nothing_to_apply',409)
        report = {'batchId':str(command.commandId),'source':command.source,'total':stats['total'],
                  'counts':stats['counts'],'linked':stats['counts'].get('ready_link',0),
                  'staged':stats['counts'].get('ready_stage',0),'fileSha256':file_hash,
                  'issues':[[item['row'],item['status']] for item in items
                            if item['status'] not in (*READY,'already_linked','already_staged')]}
        await conn.execute(
            """INSERT INTO academy_directory_imports(id,actor_user_id,source,fingerprint,file_sha256,report)
                VALUES($1,$2,$3,$4,$5,$6::jsonb)""",
            command.commandId,actor,command.source,fingerprint,file_hash,json.dumps(report))
        candidates = [item for item in items if item['status'] in READY]
        for offset in range(0,len(candidates),CHUNK_SIZE):
            chunk = candidates[offset:offset+CHUNK_SIZE]
            changed = await conn.fetchval(
                """WITH written AS (
                       INSERT INTO academy_directory_records
                         (source,external_id,name,email,role,user_id,created_in,linked_in)
                       SELECT $1,r."externalId",r.name,r.email,r.role,r."userId",$2::uuid,
                              CASE WHEN r."userId" IS NOT NULL THEN $2::uuid END
                         FROM jsonb_to_recordset($3::jsonb) AS r("externalId" text,name text,email text,role text,"userId" uuid)
                       ON CONFLICT(source,external_id) DO UPDATE
                         SET user_id=EXCLUDED.user_id,linked_in=EXCLUDED.linked_in
                       WHERE academy_directory_records.user_id IS NULL AND EXCLUDED.user_id IS NOT NULL
                       RETURNING 1
                   ) SELECT count(*)::int FROM written""",command.source,command.commandId,json.dumps(chunk))
            if changed != len(chunk):
                raise DirectoryError('preview_changed',409)
        await conn.execute(
            """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
               VALUES($1,'academy.directory.imported','academy_directory_import',$2,$3::jsonb)""",
            actor,str(command.commandId),json.dumps({key:value for key,value in report.items() if key!='issues'}))
        return report


async def issue_rows(conn: Connection, batch: UUID) -> list[list]:
    data = await conn.fetchval('SELECT report::text FROM academy_directory_imports WHERE id=$1', batch)
    if data is None:
        raise DirectoryError('import_not_found',404)
    return json.loads(data)['issues']


async def pending_rows(conn: Connection, source: str, after: str | None) -> dict:
    rows = await conn.fetch(
        """SELECT external_id,name,email,role FROM academy_directory_records
            WHERE source=$1 AND user_id IS NULL AND ($2::text IS NULL OR external_id>$2)
            ORDER BY external_id LIMIT $3""",source,after,PAGE_SIZE+1)
    return {'rows':[dict(row) for row in rows[:PAGE_SIZE]],
            'next':rows[PAGE_SIZE-1]['external_id'] if len(rows)>PAGE_SIZE else None}


async def resolve_pending(conn: Connection, actor: UUID, command: ResolveInput) -> dict:
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':directory-source'),hashtext($1))",
                           command.source)
        row = await conn.fetchrow(
            'SELECT role,user_id FROM academy_directory_records WHERE source=$1 AND external_id=$2',
            command.source,command.externalId)
        if not row:
            raise DirectoryError('record_not_found',404)
        if row['user_id']:
            if row['user_id']==command.userId:
                return {'linked':True}
            raise DirectoryError('source_account_conflict',409)
        role = await conn.fetchval('SELECT role::text FROM users WHERE id=$1 FOR SHARE',command.userId)
        if role!=row['role']:
            raise DirectoryError('account_role_mismatch',422)
        duplicate = await conn.fetchval(
            'SELECT 1 FROM academy_directory_records WHERE source=$1 AND user_id=$2',
            command.source,command.userId)
        if duplicate:
            raise DirectoryError('source_account_conflict',409)
        await conn.execute(
            'UPDATE academy_directory_records SET user_id=$3 WHERE source=$1 AND external_id=$2',
            command.source,command.externalId,command.userId)
        await conn.execute(
            """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
               VALUES($1,'academy.directory.linked','user',$2,$3::jsonb)""",
            actor,str(command.userId),json.dumps({'source':command.source,'externalId':command.externalId}))
        return {'linked':True}


async def export_rows(conn: Connection, source: str | None, role: str | None, after: str | None) -> list:
    if source:
        return await conn.fetch(
            """SELECT r.external_id,r.name,r.email,r.role,r.user_id,u.account_status::text AS account_status
                 FROM academy_directory_records r LEFT JOIN users u ON u.id=r.user_id
                WHERE r.source=$1 AND ($2::text IS NULL OR r.role=$2)
                  AND ($3::text IS NULL OR r.external_id>$3)
                ORDER BY r.external_id LIMIT $4""", source,role,after,MAX_EXPORT+1)
    try:
        last = UUID(after) if after else None
    except ValueError as exc:
        raise DirectoryError('invalid_cursor') from exc
    return await conn.fetch(
        """SELECT id::text AS external_id,name,email,role::text,id AS user_id,
                  account_status::text AS account_status FROM users
            WHERE role IN ('student','teacher') AND ($1::text IS NULL OR role::text=$1)
              AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3""",role,last,MAX_EXPORT+1)
