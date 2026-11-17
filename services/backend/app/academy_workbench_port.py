"""Authenticated read-only operational entry points; no AI/finance command execution."""
from fastapi import APIRouter,Depends,Query,Request
from fastapi.responses import Response
from . import main as core
from . import academy_workbench as views
from . import finance_balance_packets as packets
from .academy_availability import require_academy
from .tuition_port import actor,PRIVATE
from .rate_limit import RULES,async_counter,too_many

router=APIRouter(dependencies=[Depends(require_academy)])
RULES.setdefault('finance_balance_packets',(6,60))


@router.get('/api/staff/finance/balance-packets.zip')
async def finance_balance_packet(req: Request,studentIds: str=Query(...,max_length=740)):
    user,denied=await actor(req,('owner','admin'))
    if denied:return denied
    try:students=packets.parse_students(studentIds)
    except ValueError:return core.j({'error':'invalid_account_selection'},422,PRIVATE)
    delay=await async_counter('finance_balance_packets','u:'+str(user['id']),consume=True)
    if delay:return too_many(delay)
    pool=await core.pool()
    try:
        async with pool.acquire() as conn,conn.transaction(isolation='repeatable_read',readonly=True):
            rows=await packets.read_accounts(conn,students)
    except LookupError:return core.j({'error':'student_not_found'},404,PRIVATE)
    content,filename=packets.build_packet(rows)
    return Response(content,media_type='application/zip',headers={**PRIVATE,
        'Content-Disposition':f'attachment; filename="{filename}"','X-Content-Type-Options':'nosniff'})


@router.get('/api/staff/finance/debtors')
async def finance_debtor_list(req: Request,q: str=Query('',max_length=120),branch: str=Query('',max_length=120),
                              overdueOnly: bool=False,offset: int=Query(0,ge=0,le=100000),limit: int=Query(20,ge=1,le=50)):
    user,denied=await actor(req,('owner','admin'))
    if denied:return denied
    pool=await core.pool()
    async with pool.acquire() as conn,conn.transaction(readonly=True):
        result=await views.debtors(conn,q=q.strip(),branch=branch.strip(),overdue_only=overdueOnly,offset=offset,limit=limit)
    return core.j(result,headers=PRIVATE)


@router.get('/api/staff/academy/today')
async def academy_today(req: Request,classesOffset: int=Query(0,ge=0,le=100000),
                        followupsOffset: int=Query(0,ge=0,le=100000),
                        attendanceOffset: int=Query(0,ge=0,le=100000)):
    user,denied=await actor(req,('owner','admin','teacher'))
    if denied:return denied
    pool=await core.pool()
    async with pool.acquire() as conn,conn.transaction(readonly=True):
        result=await views.today(conn,actor_id=user['id'],role=user['role'],
                                 classes_offset=classesOffset,followups_offset=followupsOffset,
                                 attendance_offset=attendanceOffset)
    return core.j(result,headers=PRIVATE)


def install() -> None:
    core.app.include_router(router)
