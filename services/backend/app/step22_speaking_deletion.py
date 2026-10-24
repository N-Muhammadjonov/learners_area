"""Soft-tombstone for Speaking teaching materials; original attempt results survive.
Source: src/lib/content/delete-material.ts & speaking/materials/[id]/route.ts.
"""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from . import main as core
router=APIRouter()

@router.delete('/api/speaking/materials/{id}')
async def remove_speaking_material(req:Request,id:str):
    target=core.uuid_value(id)
    if not target:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        row=await con.fetchrow('SELECT id,created_by_user_id FROM speaking_materials WHERE id=$1',target)
        if not row:return core.j({'error':'not_found'},404)
        if user['role'] not in ('teacher','admin','owner') or user['role']!='owner' and row['created_by_user_id'] is not None and row['created_by_user_id']!=user['id']:
            return core.j({'error':'forbidden'},403)
        async with con.transaction():
            row=await con.fetchrow('SELECT id,created_by_user_id FROM speaking_materials WHERE id=$1 FOR UPDATE',target)
            if not row:return core.j({'error':'not_found'},404)
            if user['role']!='owner' and row['created_by_user_id'] is not None and row['created_by_user_id']!=user['id']:return core.j({'error':'forbidden'},403)
            await con.execute('''INSERT INTO activity_events(id,user_id,type,payload)
                VALUES(md5('deleted-content:' || $1::text)::uuid,$2,'CONTENT_DELETED',$3::jsonb)
                ON CONFLICT(id) DO NOTHING''',str(target),user['id'],json.dumps({'contentType':'speaking','contentId':id,'resultsPreserved':True}))
            await con.execute('''UPDATE speaking_materials SET publication_state='draft',publish_at=NULL,is_active=FALSE WHERE id=$1''',target)
            versions=await con.fetch('SELECT id FROM content_versions WHERE target_id=$1',target)
            await con.execute("UPDATE content_versions SET publication_state='draft' WHERE target_id=$1",target)
            for v in versions:
                await con.execute('''INSERT INTO activity_events(id,user_id,type,payload)
                    VALUES(md5('deleted-content:' || $1::text)::uuid,$2,'CONTENT_DELETED',$3::jsonb)
                    ON CONFLICT(id) DO NOTHING''',str(v['id']),user['id'],json.dumps({'contentType':'content-version','contentId':str(v['id']),'resultsPreserved':True}))
            await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                  VALUES($1,'content.updated','speaking',$2,$3::jsonb)''',user['id'],id,json.dumps({'operation':'delete','resultsPreserved':True}))
    return core.j({'ok':True,'resultsPreserved':True})

def install():core.app.include_router(router)
