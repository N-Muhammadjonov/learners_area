"""Role-scoped HTTP boundary for academy groups."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, TypeVar
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from . import academy_attendance as attendance
from . import academy_groups as groups
from . import academy_leads as leads
from . import academy_sessions as sessions
from . import main as core
from .rate_limit import RULES, async_counter, too_many

guardian_router = APIRouter()
router = APIRouter(prefix='/api/staff/academy')
PRIVATE = {'Cache-Control': 'private, no-store'}
STAFF = (*groups.GROUP_STAFF, 'teacher')
PAGE = Annotated[int, Query(ge=1, le=4000)]
SEARCH = Annotated[str, Query(max_length=120)]
Model = TypeVar('Model', bound=groups.Command)
RULES.setdefault('academy_groups_write', (90, 60))
RULES.setdefault('academy_attendance_write', (90, 60))


def error(code: str, status: int) -> JSONResponse:
    return core.j({'error': code}, status, PRIVATE)


async def authorize(req: Request, roles: tuple[str, ...]) -> tuple[dict | None, JSONResponse | None]:
    user = await core.current_user(req, active=True)
    if not user:
        return None, error('unauthenticated', 401)
    if user['role'] not in roles:
        return None, error('forbidden', 403)
    return user, None


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
    if kind not in ('courses', 'teacher', 'student', 'lead-assignees'):
        return error('not_found', 404)
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
