"""Staff lesson authoring read projection, using the existing write capabilities."""
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing


async def lesson_authoring(req,user,area,q):
    if user['role'] not in ('teacher','admin','owner'):
        raise HTTPException(403,'forbidden')
    units=await existing(req,'/api/lessons/units')
    db=await core.pool()
    async with db.acquire() as con:
        rows=await con.fetch('''SELECT id,title,slug,source_ref,learning_area,publication_state FROM lessons
            WHERE learning_area=$1 ORDER BY updated_at DESC,id LIMIT 500''',area)
        versions=await con.fetch('''SELECT id,target_id,version_no,publication_state,status FROM content_versions
            WHERE module='lesson' AND content_type='lesson' AND target_id=ANY($1::uuid[])
            ORDER BY version_no DESC,id''',[r['id'] for r in rows]) if rows else []
    lessons=[]
    for row in rows:
        related=[r for r in versions if r['target_id']==row['id']]
        entry=camel(row)
        for key,status in [('draft','draft'),('published','published')]:
            found=next((r for r in related if r['status']==status),None)
            entry[key]={'id':str(found['id']),'versionNo':found['version_no'],'publicationState':found['publication_state']} if found else None
        lessons.append(entry)
    return {'authorized':True,'canPublish':user['role'] in ('admin','owner'),'lessons':lessons,
            'units':units.get('options',[])}
