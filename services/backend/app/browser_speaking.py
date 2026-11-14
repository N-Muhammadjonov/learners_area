"""Speaking entry projections for supported materials and own history."""
import os
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, live, safe_resource
from .browser_writing import evaluation, evaluation_result


async def materials(con, user, management=False):
    supported = "m.category IN ('part1','part2','part3','general','top_structures')"
    where = supported if management else live('m') + " AND " + supported
    rows = await con.fetch(f'SELECT m.*,u.name author_name FROM speaking_materials m JOIN users u ON u.id=m.created_by_user_id WHERE {where} ORDER BY m.category,m.created_at DESC')
    ids=[row['id'] for row in rows]
    block_rows=await con.fetch('SELECT * FROM material_blocks WHERE material_id=ANY($1::uuid[]) ORDER BY material_id,position',ids) if ids else []
    by_material={}
    for block in block_rows:
        by_material.setdefault(block['material_id'],[]).append(block)
    result = []
    for row in rows:
        m = camel({k:v for k,v in dict(row).items() if k!='author_name'})
        if not management and m.get('primaryObjectKey'):
            m['primaryUrl'] = safe_resource(m['primaryObjectKey'])
        blocks = [camel(r) for r in by_material.get(row['id'],[])]
        for block in blocks:
            block['objectUrl'] = safe_resource(block.get('objectKey'))
        result.append({'material':m,'authorName':row['author_name'],'blocks':blocks,'canManage':user['role'] in ('admin','owner') or str(row['created_by_user_id'])==str(user['id'])})
    return result


async def read(req, user, path, q):
    if path == '/app/speaking/speak-or-die':
        return {'kind':'speaking_fluency'}
    if path == '/app/speaking/ai':
        data = await existing(req,'/api/speaking/practice/questions?channel=ai')
        from .owner_ai_control_port import status
        effective = (await status())['effective']
        return {'kind':'speaking_ai','matching':data['matching'],'readiness':{'transcription':bool(os.getenv('STT_PRIMARY_PROVIDER','none').lower() == 'openai' and effective['externalEnabled']),'aiEvaluation':bool(effective['externalEnabled'] and effective['providerIsExternal'] and effective['ready'])}}
    if path == '/app/speaking/live-partner':
        # Partner questions are fetched per topic rather than capped at the first 500.
        db = await core.pool()
        async with db.acquire() as con:
            from .step24_live_partner import scores, photos
            profile = await con.fetchrow('''SELECT u.gender,op.current_level FROM users u LEFT JOIN onboarding_profiles op ON op.user_id=u.id WHERE u.id=$1''',user['id'])
            gender = profile['gender'] if profile else None
            score = await scores(con,[user['id']])
            photo = await photos(con,[user['id']])
        return {'kind':'speaking_live_partner','questions':[],'me':{'userId':str(user['id']),'name':user['name'],'avatar':'b' if gender=='female' else 'a','hasGender':bool(gender),'gender':str(gender) if gender else None,'level':profile['current_level'] if profile else None,'speakingScore':score.get(str(user['id'])),'hasPhoto':str(user['id']) in photo}}
    db = await core.pool()
    async with db.acquire() as con:
        if path == '/app/speaking/lessons':
            return {'kind':'speaking_materials','rows':await materials(con,user),'blocksUnavailable':False}
        if path == '/app/speaking/history':
            from .speaking_workflow_port import ATTEMPT_COLUMNS
            rows = [core.row_to_dict(r) for r in await con.fetch(f'SELECT {ATTEMPT_COLUMNS} FROM speaking_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 100',user['id'])]
            prompt_ids=list({core.uuid_value(row['promptId']) for row in rows if row['promptId']})
            prompts=await con.fetch('SELECT id,prompt_text,topic FROM speaking_prompts WHERE id=ANY($1::uuid[])',prompt_ids) if prompt_ids else []
            by_prompt={str(row['id']):camel(row) for row in prompts}
            ids=[core.uuid_value(row['id']) for row in rows]
            evaluations=await con.fetch("SELECT * FROM evaluations WHERE user_id=$1 AND source_type='speaking_attempt' AND source_id=ANY($2::uuid[])",user['id'],ids) if ids else []
            for row in rows:
                row['prompt']=by_prompt.get(row['promptId']) if row['promptId'] else None
            return {'kind':'speaking_history','attempts':rows,'evaluations':{str(row['source_id']):evaluation_result(row) for row in evaluations}}
        if path in ('/app/speaking','/app/speaking/practice'):
            return {}
    raise HTTPException(404,'not_found')
