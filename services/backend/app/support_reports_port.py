"""Support Reports public-submit and staff inbox endpoints."""
from __future__ import annotations

import json
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict

router=APIRouter()


@router.post('/api/support/reports')
async def submit_problem_report(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    b=await core.payload(req)
    if not isinstance(b,dict):return core.j({'error':'invalid_input'},400)
    route=b.get('route')
    module=b.get('module')
    message=b.get('message')
    if (not isinstance(route,str) or not 1<=len(route)<=200 or
        not route.startswith('/') or route.startswith('//') or
        not isinstance(module,str) or not 1<=len(module)<=60 or
        not isinstance(message,str) or not 3<=len(message)<=2000 or
        any(k in b and (not isinstance(b[k],str) or len(b[k])>size) for k,size in
            (('viewport',20),('build',60),('lastErrorCode',120)))):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        created=await conn.fetchrow('''INSERT INTO problem_reports
            (user_id,route,module,message,viewport,build,last_error_code)
            VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,route,module''',
            user['id'],route,module,message,b.get('viewport'),b.get('build'),b.get('lastErrorCode'))
        if not created:return core.j({'error':'report_write_failed'},500)
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
          VALUES($1,'support.reported','problem_report',$2,$3::jsonb)''',
          user['id'],str(created['id']),json.dumps({'route':created['route'],'module':created['module']}))
    return core.j({'ok':True,'id':str(created['id'])})


@router.get('/api/support/reports')
async def list_problem_reports(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('owner','admin','teacher'):
        return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as conn:
        rows=await conn.fetch('''SELECT r.id,r.route,r.module,r.message,r.viewport,r.build,
          r.last_error_code AS "lastErrorCode",r.status,r.created_at AS "createdAt",
          r.resolved_at AS "resolvedAt",u.name AS "reporterName",u.role AS "reporterRole"
          FROM problem_reports r INNER JOIN users u ON u.id=r.user_id
          ORDER BY r.created_at DESC LIMIT 50''')
    return core.j({'reports':[row_to_dict(row) for row in rows]})


def install():
    core.app.include_router(router)
