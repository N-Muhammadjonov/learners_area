"""Ports of owner transfer and read-only typing history from matching TypeScript endpoints.

Do not use as a 1:1 certification until real PostgreSQL differential tests.
"""
from __future__ import annotations
import json
import re
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict

router=APIRouter()

@router.post('/api/owner/transfer')
async def transfer_owner(req:Request):
    owner=await core.current_user(req,active=True)
    if not owner or owner['role']!='owner':return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    email=b.get('email') if isinstance(b,dict) else None
    password=b.get('password') if isinstance(b,dict) else None
    role=b.get('keepRole') if isinstance(b,dict) else None
    if not isinstance(email,str) or not core.is_email(email.strip()) or not isinstance(password,str) or not password or role not in ('admin','teacher','student'):
        return core.j({'error':'invalid_input'},400)
    email=email.strip().lower()
    database=await core.pool()
    async with database.acquire() as conn:
        actor=await conn.fetchrow('SELECT id,password_hash FROM users WHERE id=$1',owner['id'])
        if not actor or not actor['password_hash']:return core.j({'error':'no_password_on_account'},409)
        import bcrypt
        try:valid=await core.run_blocking(bcrypt.checkpw,password.encode(),actor['password_hash'].encode())
        except ValueError:valid=False
        if not valid:return core.j({'error':'invalid_credentials'},401)
        target=await conn.fetchrow('SELECT id,name,account_status FROM users WHERE email=$1 LIMIT 1',email)
        if not target:return core.j({'error':'target_not_found'},404)
        if target['id']==owner['id']:return core.j({'error':'already_owner'},409)
        if target['account_status']!='active':return core.j({'error':'target_not_active'},409)
        try:
            async with conn.transaction():
                # Same role swap and end-of-transaction owner invariant as source.
                await conn.execute("UPDATE users SET role='owner' WHERE id=$1",target['id'])
                await conn.execute('UPDATE users SET role=$2 WHERE id=$1',owner['id'],role)
                await conn.execute('''INSERT INTO ownership_transfers(from_user_id,to_user_id,previous_owner_role)
                  VALUES ($1,$2,$3)''',owner['id'],target['id'],role)
                count=await conn.fetchval("SELECT count(*)::int FROM users WHERE role='owner' AND account_status='active'")
                if count<1:raise ValueError('owner_invariant')
        except Exception:
            return core.j({'error':'transfer_would_leave_no_owner'},409)
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
             VALUES($1,'ownership.transferred','user',$2,$3::jsonb)''',owner['id'],target['id'],json.dumps({'previousOwnerRole':role}))
        await conn.executemany('''INSERT INTO notifications(user_id,type,title,body,href)
             VALUES($1,'OWNERSHIP_TRANSFERRED','Ownership transferred',$2,'/app/owner')''',[(ident,'The centre is now owned by '+str(target['name'])+'.') for ident in (target['id'],owner['id'])])
    return core.j({'ok':True})

def install():core.app.include_router(router)
