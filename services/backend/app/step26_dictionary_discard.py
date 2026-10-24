"""Owner Dictionary draft discard (DELETE), mirrored from mutateDraft(discard=true).

This route only supports the exact original draft discard operation, preserving
advisory serialization, publication conflicts and audit within one transaction.
"""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from . import main as core
from .step17_dictionary_read_port import active_release,error_response

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}

@router.delete('/api/owner/dictionary/{action:path}')
async def discard_dictionary_draft(req:Request,action:str):
    user=await core.current_user(req,active=True)
    if not user or user['role']!='owner':
        return core.j({'error':'forbidden'},403,PRIVATE)
    parts=action.split('/')
    if len(parts)!=2 or parts[0]!='drafts' or not core.uuid_value(parts[1]):
        return core.j({'error':'not_found'},404)
    draft_id=core.uuid_value(parts[1])
    try:
        db=await core.pool()
        async with db.acquire() as con:
            async with con.transaction():
                await con.execute('SELECT pg_advisory_xact_lock(387384)')
                draft=await con.fetchrow('''SELECT changes,base_release_id FROM dictionary_drafts
                    WHERE id=$1 AND owner_user_id=$2 AND state='draft' FOR UPDATE''',draft_id,user['id'])
                if not draft:raise ValueError('entry_not_found')
                busy=await con.fetchrow('''SELECT id FROM dictionary_publish_jobs
                    WHERE phase NOT IN ('complete','failed') AND $1=ANY(draft_ids)''',draft_id)
                if busy:raise ValueError('publish_already_running')
                active=await active_release(con)
                if active['active_release_id']!=draft['base_release_id']:
                    raise ValueError('stale_draft')
                await con.execute("UPDATE dictionary_drafts SET state='discarded',updated_at=NOW() WHERE id=$1",draft_id)
                before=draft['changes']
                if isinstance(before,str):before=json.loads(before)
                await con.execute('''INSERT INTO dictionary_owner_events(
                    owner_user_id,operation,entity_id,base_release_id,before_state,after_state,validation_result)
                    VALUES($1,'discard_draft',$2,$3,$4::jsonb,'null'::jsonb,'{"pass":true}'::jsonb)''',
                    user['id'],str(draft_id),draft['base_release_id'],json.dumps(before))
        return core.j({'ok':True},headers=PRIVATE)
    except Exception as exc:
        return error_response(exc)

def install():core.app.include_router(router)
