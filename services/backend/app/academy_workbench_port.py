"""Authenticated read-only operational entry points; no AI/finance command execution."""
from fastapi import APIRouter,Depends,Query,Request
from . import main as core
from . import academy_workbench as views
from .academy_availability import require_academy
from .tuition_port import actor,PRIVATE

router=APIRouter(dependencies=[Depends(require_academy)])


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
                        followupsOffset: int=Query(0,ge=0,le=100000)):
    user,denied=await actor(req,('owner','admin','teacher'))
    if denied:return denied
    pool=await core.pool()
    async with pool.acquire() as conn,conn.transaction(readonly=True):
        result=await views.today(conn,actor_id=user['id'],role=user['role'],
                                 classes_offset=classesOffset,followups_offset=followupsOffset)
    return core.j(result,headers=PRIVATE)


def install() -> None:
    core.app.include_router(router)
