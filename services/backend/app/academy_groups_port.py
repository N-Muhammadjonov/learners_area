"""Role-scoped HTTP boundary for academy groups."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Annotated, TypeVar
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

from . import academy_attendance as attendance
from . import academy_directory as directory
from . import academy_directory_files as directory_files
from . import academy_groups as groups
from . import academy_leads as leads
from . import academy_sessions as sessions
from . import main as core
from .rate_limit import RULES, async_counter, too_many
from .request_lifecycle import WorkBusy, run_blocking, unavailable

guardian_router = APIRouter()
router = APIRouter(prefix='/api/staff/academy')
PRIVATE = {'Cache-Control': 'private, no-store'}
STAFF = (*groups.GROUP_STAFF, 'teacher')
PAGE = Annotated[int, Query(ge=1, le=4000)]
SEARCH = Annotated[str, Query(max_length=120)]
Model = TypeVar('Model', bound=groups.Command)
RULES.setdefault('academy_groups_write', (90, 60))
RULES.setdefault('academy_attendance_write', (90, 60))
RULES.setdefault('academy_directory_files', (45, 60))


def error(code: str, status: int) -> JSONResponse:
    return core.j({'error': code}, status, PRIVATE)


async def authorize(req: Request, roles: tuple[str, ...]) -> tuple[dict | None, JSONResponse | None]:
    user = await core.current_user(req, active=True)
    if not user:
        return None, error('unauthenticated', 401)
    if user['role'] not in roles:
        return None, error('forbidden', 403)
    return user, None


async def directory_file(req: Request, model):
    body = bytearray()
    async for chunk in req.stream():
        if len(body)+len(chunk) > (directory_files.MAX_FILE+2)//3*4+4096:
            raise directory.DirectoryError('file_too_large',413)
        body.extend(chunk)
    try:
        command = model.model_validate_json(body)
    except ValidationError as exc:
        raise directory.DirectoryError('invalid_input') from exc
    data = directory_files.decode(command.data)
    table = await run_blocking(directory_files.parse, data, command.format, command.sheet)
    return command, table, hashlib.sha256(data).hexdigest()


@router.post('/directory/import/{operation}')
async def academy_directory_import(req: Request, operation: directory.Operation,
                                   page: Annotated[int, Query(ge=1,le=100)] = 1):
    user, denied = await authorize(req, ('owner',))
    if denied is not None:
        return denied
    model = {'inspect':directory.FileInput,'preview':directory.PreviewInput,'apply':directory.ApplyInput}[operation]
    try:
        rate = await async_counter('academy_directory_files',str(user['id']),consume=True)
        if rate:
            return too_many(rate)
        command, table, digest = await directory_file(req, model)
        if operation == 'inspect':
            return core.j({'headers':table.headers,'rowCount':len(table.rows),'sheets':table.sheets,
                           'sheet':table.sheet,'suggested':directory_files.suggest(table.headers),
                           'fileSha256':digest}, headers=PRIVATE)
        rows = await run_blocking(directory.normalize_rows,table,command.columns)
        db = await core.pool()
        async with db.acquire() as conn:
            if operation == 'apply':
                report = await directory.apply(conn,user['id'],command,rows,digest)
                return core.j({k:v for k,v in report.items() if k!='issues'},headers=PRIVATE)
            async with conn.transaction(isolation='repeatable_read',readonly=True):
                items = await directory.classify(conn,command.source,rows)
        return core.j(directory.preview(items,command.source,digest,page),headers=PRIVATE)
    except directory.DirectoryError as exc:
        return error(exc.code,exc.status)
    except directory_files.FileError as exc:
        return error(str(exc),422)
    except WorkBusy:
        return unavailable()


def directory_attachment(data: bytes, kind: directory_files.FileFormat, name: str, **headers) -> Response:
    media_type = ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  if kind=='xlsx' else 'text/csv')
    return Response(data,media_type=media_type,headers={
        **PRIVATE,**headers,'Content-Disposition':f'attachment; filename="{name}.{kind}"',
        'X-Content-Type-Options':'nosniff'})


@router.get('/directory/imports/{batch_id}/issues.csv')
async def academy_directory_issues(req: Request, batch_id: UUID):
    _, denied = await authorize(req, ('owner',))
    if denied is not None:
        return denied
    db = await core.pool()
    try:
        async with db.acquire() as conn:
            rows = await directory.issue_rows(conn,batch_id)
        data = await run_blocking(directory_files.spreadsheet,'csv',('row','status'),rows)
        return directory_attachment(data,'csv','directory-import-issues')
    except directory.DirectoryError as exc:
        return error(exc.code,exc.status)
    except WorkBusy:
        return unavailable()


@router.get('/directory/pending')
async def academy_directory_pending(req: Request,
                                    source: Annotated[str, Query(pattern=r'^[a-z0-9][a-z0-9._-]{0,79}$')],
                                    after: Annotated[str | None, Query(max_length=120)] = None):
    _, denied = await authorize(req, ('owner',))
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn:
        return core.j(await directory.pending_rows(conn,source,after),headers=PRIVATE)


@router.post('/directory/pending/link')
async def academy_directory_link(req: Request):
    user, denied = await authorize(req, ('owner',))
    if denied is not None:
        return denied
    rate = await async_counter('academy_directory_files',str(user['id']),consume=True)
    if rate:
        return too_many(rate)
    try:
        command = directory.ResolveInput.model_validate(await core.payload(req))
        db = await core.pool()
        async with db.acquire() as conn:
            return core.j(await directory.resolve_pending(conn,user['id'],command),headers=PRIVATE)
    except ValidationError:
        return error('invalid_input',422)
    except directory.DirectoryError as exc:
        return error(exc.code,exc.status)


@router.get('/directory/export/{kind}')
async def academy_directory_export(req: Request, kind: directory_files.FileFormat,
                                   source: Annotated[str | None, Query(pattern=r'^[a-z0-9][a-z0-9._-]{0,79}$')] = None,
                                   role: directory.DirectoryRole | None = None,
                                   after: Annotated[str | None, Query(max_length=120)] = None):
    user, denied = await authorize(req, ('owner',))
    if denied is not None:
        return denied
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            rows = await directory.export_rows(conn,source,role,after)
        current = rows[:directory.MAX_EXPORT]
        headings = (*directory_files.FIELDS,'account_status')
        data = await run_blocking(directory_files.spreadsheet,kind,headings,
                                  [[row[key] for key in headings] for row in current])
        headers = {}
        if len(rows)>directory.MAX_EXPORT:
            params = {k:v for k,v in {'source':source,'role':role,'after':current[-1]['external_id']}.items()
                      if v is not None}
            headers['Link'] = f'</api/staff/academy/directory/export/{kind}?{urlencode(params)}>; rel="next"'
        async with db.acquire() as conn:
            await conn.execute(
                """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                   VALUES($1,'academy.directory.exported','academy_directory',$2,$3::jsonb)""",
                user['id'],source or 'users',json.dumps({'role':role,'format':kind,'rows':len(current)}))
        return directory_attachment(data,kind,'academy-directory',**headers)
    except directory.DirectoryError as exc:
        return error(exc.code,exc.status)
    except WorkBusy:
        return unavailable()


async def write(req: Request, model: type[Model],
                action: Callable[..., Awaitable[dict]], *ids: UUID, status: int = 200) -> JSONResponse:
    user, denied = await authorize(req, groups.GROUP_STAFF)
    if denied is not None:
        return denied
    data = await core.payload(req)
    try:
        command = model.model_validate(data)
    except ValidationError:
        return error('invalid_input', 422)
    db = await core.pool()
    async with db.acquire() as conn:
        delay = await async_counter('academy_groups_write', str(user['id']), consume=True, connection=conn)
        if delay:
            response = too_many(delay)
            response.headers.update(PRIVATE)
            return response
        try:
            row = await action(conn, user['id'], *ids, command)
        except groups.GroupError as exc:
            return error(exc.code, exc.status)
    return core.j(row, status, PRIVATE)


@router.get('/leads')
async def academy_lead_list(req: Request, q: SEARCH = '', stage: leads.Stage | None = None,
                            page: PAGE = 1, mine: bool = False) -> JSONResponse:
    user, denied = await authorize(req, groups.GROUP_STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction(isolation='repeatable_read', readonly=True):
        data = await leads.lead_list(conn, q.strip(), stage, page, user['id'] if mine else None)
    return core.j(data, headers=PRIVATE)


@router.get('/leads/{lead_id}')
async def academy_lead_detail(req: Request, lead_id: UUID, page: PAGE = 1) -> JSONResponse:
    _, denied = await authorize(req, groups.GROUP_STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction(isolation='repeatable_read', readonly=True):
        try:
            data = await leads.lead_detail(conn, lead_id, page)
        except groups.GroupError as exc:
            return error(exc.code, exc.status)
    return core.j(data, headers=PRIVATE)


@router.post('/leads')
async def academy_lead_create(req: Request) -> JSONResponse:
    return await write(req, leads.CreateLead, leads.create, status=201)


@router.put('/leads/{lead_id}')
async def academy_lead_update(req: Request, lead_id: UUID) -> JSONResponse:
    return await write(req, leads.UpdateLead, leads.update, lead_id)


@router.post('/leads/{lead_id}/notes')
async def academy_lead_note(req: Request, lead_id: UUID) -> JSONResponse:
    return await write(req, leads.LeadNote, leads.add_note, lead_id, status=201)


@router.post('/leads/{lead_id}/convert')
async def academy_lead_convert(req: Request, lead_id: UUID) -> JSONResponse:
    return await write(req, leads.ConvertLead, leads.convert, lead_id)


@router.get('/groups')
async def academy_groups_list(req: Request, q: SEARCH = '', status: groups.GroupStatus | None = None,
                              page: PAGE = 1, courseId: UUID | None = None) -> JSONResponse:
    user, denied = await authorize(req, STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn:
        data = await groups.list_groups(conn, user['id'], user['role'], q.strip(), status, page, courseId)
    return core.j(data, headers=PRIVATE)


@router.get('/groups/{group_id}')
async def academy_group_detail(req: Request, group_id: UUID, q: SEARCH = '', page: PAGE = 1) -> JSONResponse:
    user, denied = await authorize(req, STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn:
        try:
            data = await groups.group_detail(conn, group_id, user['id'], user['role'], q.strip(), page)
        except groups.GroupError as exc:
            return error(exc.code, exc.status)
    return core.j(data, headers=PRIVATE)


@router.get('/lookups/{kind}')
async def academy_group_lookup(req: Request, kind: str, q: SEARCH = '') -> JSONResponse:
    _, denied = await authorize(req, groups.GROUP_STAFF)
    if denied is not None:
        return denied
    if kind not in ('courses', 'teacher', 'student', 'lead-assignees', 'directory-teacher'):
        return error('not_found', 404)
    if kind == 'directory-teacher':
        _, rejected = await authorize(req, ('owner',))
        if rejected is not None:
            return rejected
    db = await core.pool()
    async with db.acquire() as conn:
        options = (await leads.staff_choices(conn, q.strip()) if kind == 'lead-assignees'
                   else await groups.lookup(conn, kind, q.strip()))
    return core.j({'options': options}, headers=PRIVATE)


@router.post('/groups')
async def academy_group_create(req: Request) -> JSONResponse:
    return await write(req, groups.CreateGroup, groups.create_group, status=201)


@router.put('/groups/{group_id}')
async def academy_group_update(req: Request, group_id: UUID) -> JSONResponse:
    return await write(req, groups.UpdateGroup, groups.save_group, group_id)


@router.post('/groups/{group_id}/memberships')
async def academy_group_enrol(req: Request, group_id: UUID) -> JSONResponse:
    return await write(req, groups.Enrol, groups.enrol, group_id, status=201)


@router.put('/groups/{group_id}/memberships/{member_id}')
async def academy_group_membership_update(req: Request, group_id: UUID, member_id: UUID) -> JSONResponse:
    return await write(req, groups.UpdateMembership, groups.set_membership, group_id, member_id)


@router.post('/groups/{group_id}/memberships/{member_id}/transfer')
async def academy_group_transfer(req: Request, group_id: UUID, member_id: UUID) -> JSONResponse:
    return await write(req, groups.Transfer, groups.transfer, group_id, member_id, status=201)


@router.get('/students/{student_id}/groups')
async def academy_student_group_history(req: Request, student_id: UUID, page: PAGE = 1) -> JSONResponse:
    _, denied = await authorize(req, groups.GROUP_STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn:
        if not await conn.fetchval("SELECT id FROM users WHERE id=$1 AND role='student'", student_id):
            return error('student_not_found', 404)
        data = await groups.student_groups(conn, student_id, page)
    return core.j(data, headers=PRIVATE)


@router.get('/groups/{group_id}/sessions')
async def academy_session_list(req: Request, group_id: UUID, page: PAGE = 1) -> JSONResponse:
    user, denied = await authorize(req, STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn:
        try:
            data = await sessions.list_sessions(conn, group_id, user['id'], user['role'], page)
        except groups.GroupError as exc:
            return error(exc.code, exc.status)
    return core.j(data, headers=PRIVATE)


@router.post('/groups/{group_id}/sessions')
async def academy_session_book(req: Request, group_id: UUID) -> JSONResponse:
    return await write(req, sessions.Book, sessions.book, group_id, status=201)


@router.put('/groups/{group_id}/sessions/{session_id}')
async def academy_session_update(req: Request, group_id: UUID, session_id: UUID) -> JSONResponse:
    return await write(req, sessions.Transition, sessions.transition, group_id, session_id)


@router.post('/groups/{group_id}/sessions/{session_id}/reschedule')
async def academy_session_reschedule(req: Request, group_id: UUID, session_id: UUID) -> JSONResponse:
    return await write(req, sessions.Reschedule, sessions.reschedule, group_id, session_id, status=201)


@router.get('/groups/{group_id}/sessions/{session_id}/attendance')
async def academy_attendance_read(req: Request, group_id: UUID, session_id: UUID, page: PAGE = 1) -> JSONResponse:
    user, denied = await authorize(req, STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn:
        try:
            data = await attendance.read(conn, user['id'], user['role'], group_id, session_id, page)
        except groups.GroupError as exc:
            return error(exc.code, exc.status)
    return core.j(data, headers=PRIVATE)


@router.put('/groups/{group_id}/sessions/{session_id}/attendance')
async def academy_attendance_save(req: Request, group_id: UUID, session_id: UUID) -> JSONResponse:
    user, denied = await authorize(req, STAFF)
    if denied is not None:
        return denied
    try:
        data = attendance.BulkMarks.model_validate(await core.payload(req))
    except ValidationError:
        return error('invalid_input', 422)
    db = await core.pool()
    async with db.acquire() as conn:
        delay = await async_counter('academy_attendance_write', str(user['id']), consume=True, connection=conn)
        if delay:
            response = too_many(delay)
            response.headers.update(PRIVATE)
            return response
        try:
            result = await attendance.save(conn, user['id'], user['role'], group_id, session_id, data)
        except groups.GroupError as exc:
            return error(exc.code, exc.status)
    return core.j(result, headers=PRIVATE)


@router.get('/students/{student_id}/attendance')
async def academy_student_attendance(req: Request, student_id: UUID) -> JSONResponse:
    user, denied = await authorize(req, STAFF)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction(isolation='repeatable_read', readonly=True):
        permitted = await conn.fetchval(
            """SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.role='student'
                AND ($2::boolean OR EXISTS(SELECT 1 FROM teacher_student_links t
                     WHERE t.teacher_user_id=$3 AND t.student_user_id=u.id)))""",
            student_id, user['role'] in groups.GROUP_STAFF, user['id'])
        if not permitted:
            return error('student_not_found', 404)
        return core.j(await attendance.student_summary(conn, student_id), headers=PRIVATE)


@guardian_router.get('/api/guardian/children/{student_id}/attendance')
async def academy_guardian_attendance(req: Request, student_id: str) -> JSONResponse:
    from .guardian_port import child_user, guardian_actor

    _, profile, denied = await guardian_actor(req)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction(isolation='repeatable_read', readonly=True):
        child = await child_user(conn, profile['id'], student_id)
        if not child:
            return error('forbidden', 403)
        result = await attendance.student_summary(conn, child['id'])
    return core.j(result, headers=PRIVATE)


def install() -> None:
    core.app.include_router(router)
    core.app.include_router(guardian_router)
