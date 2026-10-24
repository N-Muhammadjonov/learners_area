"""Speaking entry projections, preserving retired shadowing and own history."""
import os
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, live, safe_resource
from .browser_writing import evaluation


async def materials(con, user, management=False):
    where = "TRUE" if management else live('m') + " AND m.category<>'shadowing'"
    rows = await con.fetch(f'SELECT m.*,u.name author_name FROM speaking_materials m JOIN users u ON u.id=m.created_by_user_id WHERE {where} ORDER BY m.category,m.created_at DESC')
    result = []
    for row in rows:
        m = camel({k:v for k,v in dict(row).items() if k!='author_name'})
        if not management and m.get('primaryObjectKey'):
            m['primaryUrl'] = safe_resource(m['primaryObjectKey'])
        blocks = [camel(r) for r in await con.fetch('SELECT * FROM material_blocks WHERE material_id=$1 ORDER BY position',row['id'])]
        for block in blocks:
            block['objectUrl'] = safe_resource(block.get('objectKey'))
        result.append({'material':m,'authorName':row['author_name'],'blocks':blocks,'canManage':user['role'] in ('admin','owner') or str(row['created_by_user_id'])==str(user['id'])})
    return result


async def read(req, user, path, q):
    if path == '/app/speaking/ai':
        data = await existing(req,'/api/speaking/practice/questions?channel=ai')
        from .owner_ai_control_port import status
        effective = (await status())['effective']
        return {'kind':'speaking_ai','matching':data['matching'],'readiness':{'transcription':bool(os.getenv('STT_PRIMARY_PROVIDER','none').lower() == 'openai' and effective['externalEnabled']),'aiEvaluation':bool(effective['externalEnabled'] and effective['providerIsExternal'] and effective['ready'])}}
    if path == '/app/speaking/live-partner':
        questions = await existing(req,'/api/speaking/live-partner/questions')
        db = await core.pool()
        async with db.acquire() as con:
            from .step24_live_partner import scores, photos
            gender = await con.fetchval('SELECT gender FROM users WHERE id=$1',user['id'])
            score = await scores(con,[user['id']])
            photo = await photos(con,[user['id']])
        return {'kind':'speaking_live_partner','questions':questions['questions'],'me':{'userId':str(user['id']),'name':user['name'],'avatar':'b' if gender=='female' else 'a','hasGender':bool(gender),'speakingScore':score.get(str(user['id'])),'hasPhoto':str(user['id']) in photo}}
    db = await core.pool()
    async with db.acquire() as con:
        if path == '/app/speaking/lessons':
            return {'kind':'speaking_materials','rows':await materials(con,user),'blocksUnavailable':False}
        if path == '/app/speaking/history':
            from .speaking_workflow_port import ATTEMPT_COLUMNS
            rows = [core.row_to_dict(r) for r in await con.fetch(f'SELECT {ATTEMPT_COLUMNS} FROM speaking_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 100',user['id'])]
            for row in rows:
                row['prompt'] = camel(await con.fetchrow('SELECT id,prompt_text,topic FROM speaking_prompts WHERE id=$1',row['promptId'])) if row['promptId'] else None
            return {'kind':'speaking_history','attempts':rows,'evaluations':{r['id']:ev for r in rows if (ev:=await evaluation(con,user['id'],'speaking_attempt',r['id']))}}
        if path in ('/app/speaking','/app/speaking/practice'):
            return {}
    raise HTTPException(404,'not_found')
