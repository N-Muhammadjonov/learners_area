"""Retention text management. Translated from retention-bank.ts and admin routes.

This port deliberately keeps the transaction boundary and preserved-attempts
invariant, including FOR UPDATE and nullifying the current-version FK.
"""
from __future__ import annotations
import json
import math
import re
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict

router = APIRouter()
LEVELS = ('A2','B1','B2','C1','C2')

async def gate(req):
    u = await core.current_user(req,active=True)
    if not u:return None,core.auth_error()
    if u['role'] not in ('owner','admin'):return None,core.j({'error':'retention_forbidden'},403)
    return u,None

def invalid():return core.j({'error':'retention_invalid_input'},400)
def retention_error(code,status):return core.j({'error':code},status)
def _preview(s):
    v=re.sub(r'\s+',' ',s or '').strip()
    return v if len(v)<=140 else v[:139]+'…'

def _query_number(value, limit):
    try:
        n=float(value)
        if not math.isfinite(n) or n!=int(n) or n<1 or n>limit:return None
        return int(n)
    except (ValueError,TypeError):return None

@router.get('/api/admin/retention/texts')
async def list_texts(req:Request):
    u,err=await gate(req)
    if err:return err
    q=req.query_params
    level=q.get('level')
    if not isinstance(level,str) or len(level)<1 or len(level)>4:return invalid()
    flt=q.get('filter','active');sort=q.get('sort','label')
    if flt not in ('all','active','archived') or sort not in ('label','uses','newest'):return invalid()
    pn=_query_number(q['page'],100000) if 'page' in q else 1
    ps=_query_number(q['pageSize'],100) if 'pageSize' in q else 50
    if pn is None or ps is None:return invalid()
    db=await core.pool()
    async with db.acquire() as conn:
        cnt=await conn.fetch('''SELECT level::text AS level,
         count(*) filter (where active)::integer AS "activeCount",
         count(*) filter (where not active)::integer AS "archivedCount"
         FROM retention_texts GROUP BY level''')
        uses=await conn.fetch('''SELECT t.level::text AS level,count(*)::integer AS uses
         FROM retention_attempts a JOIN retention_texts t ON t.id=a.retention_text_id
         WHERE a.status IN ('completed','timed_out') GROUP BY t.level''')
        count_map={r['level']:r for r in cnt};usage_map={r['level']:r['uses'] for r in uses}
        inventory=[{'level':lv,'activeCount':int(count_map[lv]['activeCount']) if lv in count_map else 0,
          'archivedCount':int(count_map[lv]['archivedCount']) if lv in count_map else 0,
          'target':15,'remainingToTarget':max(0,15-(int(count_map[lv]['activeCount']) if lv in count_map else 0)),
          'lifetimeUses':int(usage_map.get(lv,0))} for lv in LEVELS]
        if level not in LEVELS:return core.j({'inventory':inventory,'level':None,'rows':[]})
        status_sql='' if flt=='all' else (' AND t.active=TRUE' if flt=='active' else ' AND t.active=FALSE')
        total=int(await conn.fetchval('SELECT count(*)::integer FROM retention_texts t WHERE t.level=$1'+status_sql,level) or 0)
        page_count=max(1,math.ceil(total/ps));page=min(pn,page_count)
        if total==0:return core.j({'inventory':inventory,'level':level,'rows':[],'total':0,'page':1,'pageSize':ps,'pageCount':1})
        order= {'label':'t.sequence ASC,t.id ASC','newest':'t.sequence DESC,t.id ASC',
                'uses':'"lifetimeUses" DESC,t.sequence ASC,t.id ASC'}[sort]
        rows=await conn.fetch(f'''SELECT t.id AS "textId",t.internal_label AS "internalLabel",
           t.level::text AS level,t.active,t.sequence,t.updated_at AS "updatedAt",
           t.current_version_id AS "currentVersionId",v.version_number AS "versionNumber",
           v.word_count AS "wordCount",v.body_text AS "bodyText",
           (SELECT count(*)::integer FROM retention_attempts a WHERE a.retention_text_id=t.id AND a.status IN ('completed','timed_out')) AS "lifetimeUses",
           (SELECT count(*)::integer FROM retention_attempts a WHERE a.retention_text_id=t.id AND a.retention_text_version_id=t.current_version_id AND a.status IN ('completed','timed_out')) AS "currentVersionUses"
           FROM retention_texts t LEFT JOIN retention_text_versions v ON v.id=t.current_version_id
           WHERE t.level=$1 {status_sql} ORDER BY {order} LIMIT $2 OFFSET $3''',level,ps,(page-1)*ps)
        result=[]
        for row in rows:
            r=row_to_dict(row)
            r['preview']=_preview(r.pop('bodyText'))
            for key in ('versionNumber','wordCount','lifetimeUses','currentVersionUses'):r[key]=int(r[key] or 0)
            r['currentVersionId']=r['currentVersionId'] or ''
            result.append(r)
        return core.j({'inventory':inventory,'level':level,'rows':result,'total':total,'page':page,'pageSize':ps,'pageCount':page_count})

@router.get('/api/admin/retention/texts/{id}')
async def detail(req:Request,id:str):
    u,err=await gate(req)
    if err:return err
    if not core.uuid_value(id):return retention_error('retention_unavailable',500) # PostgreSQL's UUID bind fails on invalid params
    db=await core.pool()
    async with db.acquire() as conn:
        row=await conn.fetchrow('''SELECT t.id AS "textId",t.internal_label AS "internalLabel",t.level::text AS level,
          t.active,t.current_version_id AS "currentVersionId",v.version_number AS "versionNumber",
          v.body_text AS "bodyText",v.word_count AS "wordCount",v.scoring_structure AS "scoringStructure",
          (SELECT count(*)::integer FROM retention_text_versions ver WHERE ver.retention_text_id=t.id) AS "versionCount",
          (SELECT count(*)::integer FROM retention_attempts a WHERE a.retention_text_id=t.id AND a.status IN ('completed','timed_out')) AS "lifetimeUses",
          (SELECT count(*)::integer FROM retention_attempts a WHERE a.retention_text_id=t.id AND a.retention_text_version_id=t.current_version_id AND a.status IN ('completed','timed_out')) AS "currentVersionUses"
          FROM retention_texts t LEFT JOIN retention_text_versions v ON v.id=t.current_version_id WHERE t.id=$1 LIMIT 1''',core.uuid_value(id))
        if not row:return core.j({'ok':True,'text':None})
        r=row_to_dict(row)
        # Stored scoring structure is validated on reads in the source implementation.
        value=r['scoringStructure']
        if isinstance(value,str):
            try:value=json.loads(value)
            except ValueError:value=None
        if not isinstance(value,dict) or value.get('schemaVersion')!=1 or not isinstance(value.get('claims'),list):
            return core.j({'error':'retention_invalid_structure','details':{'textId':r['textId']}},422)
        r['scoringStructure']=value
        for key in ('currentVersionUses','lifetimeUses','versionCount','versionNumber','wordCount'):r[key]=int(r[key] or 0)
        r['currentVersionId']=r['currentVersionId'] or ''
        r['bodyText']=r['bodyText'] or ''
    return core.j({'ok':True,'text':r})

@router.patch('/api/admin/retention/texts/{id}')
async def active(req:Request,id:str):
    u,err=await gate(req)
    if err:return err
    b=await core.payload(req)
    if not isinstance(b,dict) or not isinstance(b.get('active'),bool):return invalid()
    if not core.uuid_value(id):return retention_error('retention_unavailable',500)
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            r=await conn.fetchrow('SELECT id,active,level,internal_label FROM retention_texts WHERE id=$1 FOR UPDATE',core.uuid_value(id))
            if not r:return retention_error('retention_attempt_not_found',404)
            if r['active']!=b['active']:
                await conn.execute('UPDATE retention_texts SET active=$2,updated_at=NOW() WHERE id=$1',r['id'],b['active'])
                await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                 VALUES($1,$2,'retention_text',$3,$4::jsonb)''',u['id'],
                 'retention_text.restored' if b['active'] else 'retention_text.archived',r['id'],
                 json.dumps({'level':r['level'],'label':r['internal_label']}))
    return core.j({'ok':True,'textId':str(r['id']),'active':b['active']})

@router.delete('/api/admin/retention/texts/{id}')
async def delete(req:Request,id:str):
    u,err=await gate(req)
    if err:return err
    if u['role']!='owner':return retention_error('retention_forbidden',403)
    b=await core.payload(req)
    if not isinstance(b,dict) or not isinstance(b.get('expectedLabel'),str) or not re.fullmatch(r'(A2|B1|B2|C1|C2)-[0-9]{3,}',b['expectedLabel']):return invalid()
    if not core.uuid_value(id):return retention_error('retention_unavailable',500)
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            row=await conn.fetchrow('SELECT id,level,internal_label FROM retention_texts WHERE id=$1 FOR UPDATE',core.uuid_value(id))
            if not row:return retention_error('retention_attempt_not_found',404)
            if row['internal_label']!=b['expectedLabel']:return retention_error('retention_conflict',409)
            live=await conn.fetchval("SELECT id FROM retention_attempts WHERE retention_text_id=$1 AND status IN ('reading','recall') LIMIT 1",row['id'])
            if live:return retention_error('retention_conflict',409)
            count=int(await conn.fetchval('SELECT count(*)::integer FROM retention_attempts WHERE retention_text_id=$1',row['id']) or 0)
            await conn.execute('UPDATE retention_attempts SET retention_label_snapshot=$2 WHERE retention_text_id=$1',row['id'],row['internal_label'])
            await conn.execute('UPDATE retention_texts SET current_version_id=NULL WHERE id=$1',row['id'])
            await conn.execute('DELETE FROM retention_texts WHERE id=$1',row['id'])
            await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
             VALUES($1,'retention_text.permanently_deleted','retention_text',$2,$3::jsonb)''',u['id'],row['id'],
             json.dumps({'level':row['level'],'label':row['internal_label'],'preservedAttempts':count}))
    return core.j({'ok':True,'textId':str(row['id']),'deleted':True,'preservedAttempts':count})

def install():core.app.include_router(router)
