"""Admission decisions, exactly one pending claim and original audit/notice flows."""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from . import main as core
from .lesson_writing_port import is_js_uuid,js_length
router=APIRouter()

async def _audit(conn,actor,action,target_type,target_id,metadata=None):
    await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
      VALUES($1,$2,$3,$4,$5::jsonb)''',actor,action,target_type,target_id,json.dumps(metadata) if metadata else None)

@router.post('/api/admin/admission/{id}/decide')
async def decide(req:Request,id:str):
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u or u['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not isinstance(b,dict) or b.get('decision') not in ('approve','reject'):
        return core.j({'error':'invalid_input'},400)
    note=b.get('note')
    if note is not None and (not isinstance(note,str) or js_length(note.strip())>500):return core.j({'error':'invalid_input'},400)
    note=note.strip() if isinstance(note,str) else None
    db=await core.pool()
    async with db.acquire() as conn:
        request=await conn.fetchrow('SELECT id,user_id,status FROM access_requests WHERE id=$1',id)
        if not request:
            user=await conn.fetchrow('SELECT id,account_status FROM users WHERE id=$1',id)
            open_request=await conn.fetchrow('''SELECT id,user_id,status FROM access_requests WHERE user_id=$1
                   AND status='pending' ORDER BY created_at DESC LIMIT 1''',id)
            if user and user['account_status']=='pending':
                request=open_request
                if not request:
                    request=await conn.fetchrow('''INSERT INTO access_requests(user_id,status) VALUES($1,'pending')
                      RETURNING id,user_id,status''',id)
                    await conn.execute('''UPDATE users SET account_status='pending',status_updated_at=NOW(),status_reason=NULL WHERE id=$1''',id)
                    await _audit(conn,id,'access.requested','access_request',request['id'])
                    reviewers=await conn.fetch("SELECT id FROM users WHERE role IN ('admin','owner') AND account_status='active'")
                    for reviewer in reviewers:
                        await conn.execute('''INSERT INTO notifications(user_id,type,title,body,href,payload)
                         VALUES($1,'ACCESS_REQUESTED','New access request','An applicant is waiting for approval.',
                          '/app/admin/admissions',$2::jsonb)''',reviewer['id'],json.dumps({'requestId':str(request['id'])}))
            else:request=open_request
            if not request:return core.j({'error':'not_found'},404)
        status='approved' if b['decision']=='approve' else 'rejected'
        claimed=await conn.fetchrow('''UPDATE access_requests SET status=$2,decided_by_user_id=$3,
          decided_at=NOW(),decision_note=$4 WHERE id=$1 AND status='pending' RETURNING id''',request['id'],status,u['id'],note)
        if not claimed:return core.j({'error':'already_decided'},409)
        account='active' if status=='approved' else 'rejected'
        await conn.execute('''UPDATE users SET account_status=$2,status_updated_at=NOW(),status_reason=$3
         WHERE id=$1''',request['user_id'],account,None if status=='approved' else note)
        await _audit(conn,u['id'],'access.approved' if status=='approved' else 'access.rejected','user',request['user_id'],{'requestId':str(request['id'])})
        await conn.execute('''INSERT INTO notifications(user_id,type,title,body,href)
          VALUES($1,$2,$3,$4,$5)''',request['user_id'],
          'ACCESS_APPROVED' if status=='approved' else 'ACCESS_REJECTED',
          'Access approved' if status=='approved' else 'Access rejected',
          'Your Learners Area access has been approved. Welcome in.' if status=='approved' else (note or 'Your access request was not approved.'),
          '/app' if status=='approved' else '/pending')
    return core.j({'ok':True,'status':account,'userId':str(request['user_id'])})
def install():core.app.include_router(router)
