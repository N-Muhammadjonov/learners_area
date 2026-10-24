"""Canonical staff content bank, translated from src/lib/content/bank.ts.

Queries over content_versions (including drafts) rather than learner projections.
"""
from __future__ import annotations
from datetime import datetime, timezone
import re
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict

router = APIRouter()
PRIVATE = {'Cache-Control':'private, no-store'}
SECURE = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
STATES = ('draft','scheduled','published','archived')
MODULES = [
 ('listening','Listening',['full_test','section','question_type_practice']),
 ('reading','Reading',['general_set','full_test','passage','passage_set','question_type_practice']),
 ('writing','Writing',['task1','task2','lesson','model_text','pattern','translation_set']),
 ('speaking','Speaking',['part1_question','cue_card','part3_question','material']),
 ('grammar','Grammar',['topic','exercise']),
 ('vocabulary','Vocabulary',['topic_pack','retention_text']),
 ('ted','TED / Podcast',['video_lesson','audio_lesson']),
 ('lesson','Lesson',['lesson']),
]


def js_positive_int(s):
    # Number is only parsed if the entire value matches ^\d+$.
    if isinstance(s,str) and re.fullmatch(r'\d+',s):
        try:return min(int(s), 2**53-1)
        except ValueError:pass
    return None


def js_date(value):
    if not value:return None
    try:
        raw = value.replace('Z','+00:00')
        value = datetime.fromisoformat(raw)
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    except (ValueError, OverflowError):return None


def escape_like(value):
    return '%' + value.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'


def predicates(params):
    args=[]; where=['''NOT EXISTS (SELECT 1 FROM activity_events deleted_content
           WHERE deleted_content.id=md5('deleted-content:' || (cv.id)::text)::uuid
           AND deleted_content.type='CONTENT_DELETED')'''];having=['TRUE']
    def add(expr,val,target=where):
        args.append(val)
        target.append(expr.replace('?',f'${len(args)}'))
    for key, column in (('module','module'),('contentType','content_type'),('track','track')):
        value=params.get(key)
        if value:add(f'cv.{column} = ?', value)
    for key,col in (('sourceRef','source_ref'),('title','title')):
        v=params.get(key)
        if v:add(f"cv.{col} ILIKE ? ESCAPE '\\'", escape_like(v))
    q=params.get('q')
    if q:add("(cv.source_ref ILIKE ? ESCAPE '\\' OR cv.title ILIKE ? ESCAPE '\\')", escape_like(q))
    # The two placeholders above share the same bound parameter as Drizzle.
    # Replace the remaining '?' with the same index.
    if q:having_index=len(args);where[-1]=where[-1].replace('?',f'${having_index}')
    if params.get('state') in STATES:add('(array_agg(cv.publication_state ORDER BY cv.version_no DESC))[1] = ?',params['state'],having)
    if params.get('hasState') in STATES:add('COUNT(*) FILTER (WHERE cv.publication_state = ?) > 0',params['hasState'],having)
    version=js_positive_int(params.get('versionNo'))
    if version is not None:add('COUNT(*) FILTER (WHERE cv.version_no = ?) > 0',version,having)
    for key,op in (('from','>='),('to','<=')):
        date=js_date(params.get(key))
        if date is not None:add(f'MAX(cv.created_at) {op} ?',date,having)
    return ' AND '.join(where),' AND '.join(having),args


@router.get('/api/admin/content/bank')
async def content_bank(req: Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('owner','admin','teacher'):
        return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as con:
        if req.query_params.get('vocabulary')=='1':
            tracks=await con.fetch('SELECT DISTINCT track FROM content_versions ORDER BY track')
            return core.j({'ok':True,'vocabulary':{'modules':[{'module':m,'label':label,'contentTypes':types}
              for m,label,types in MODULES],'states':list(STATES),'tracks':[r['track'] for r in tracks if r['track']]}},headers=PRIVATE)
        where,having,args=predicates(req.query_params)
        limit=max(1,min(js_positive_int(req.query_params.get('limit')) or 25,100))
        offset=max(0,js_positive_int(req.query_params.get('offset')) or 0)
        basis=f'FROM content_versions cv WHERE {where} GROUP BY cv.module,cv.content_type,cv.source_ref HAVING {having}'
        rows=await con.fetch(f'''SELECT cv.module,cv.content_type,cv.source_ref,
          (array_agg(cv.title ORDER BY cv.version_no DESC))[1] title,
          (array_agg(cv.track ORDER BY cv.version_no DESC))[1] track,
          COUNT(*)::int versions,MAX(cv.version_no)::int latest_version_no,
          (array_agg(cv.id ORDER BY cv.version_no DESC))[1] latest_version_id,
          (array_agg(cv.publication_state ORDER BY cv.version_no DESC))[1] latest_state,
          COUNT(*) FILTER(WHERE cv.publication_state='draft')::int draft_count,
          COUNT(*) FILTER(WHERE cv.publication_state='scheduled')::int scheduled_count,
          COUNT(*) FILTER(WHERE cv.publication_state='published')::int published_count,
          COUNT(*) FILTER(WHERE cv.publication_state='archived')::int archived_count,
          COUNT(*) FILTER(WHERE cv.publication_state='published')::int published_revision_count,
          MIN(cv.created_at) created_at,MAX(cv.created_at) updated_at {basis}
          ORDER BY MAX(cv.created_at) DESC,cv.module,cv.content_type,cv.source_ref
          LIMIT {limit} OFFSET {offset}''',*args)
        total=await con.fetchval(f'''SELECT COUNT(*)::int FROM
          (SELECT cv.module,cv.content_type,cv.source_ref {basis}) grouped''',*args)
        facets=await con.fetch(f'''SELECT module,content_type,latest_state,track,COUNT(*)::int count FROM
         (SELECT cv.module,cv.content_type,cv.source_ref,
           (array_agg(cv.track ORDER BY cv.version_no DESC))[1] track,
           (array_agg(cv.publication_state ORDER BY cv.version_no DESC))[1] latest_state
           {basis}) grouped GROUP BY module,content_type,latest_state,track''',*args)
    output=[]
    for r in rows:
        m=r['module'] or '';t=r['content_type'] or '';src=r['source_ref'] or ''
        output.append({'key':f'{m}:{t}|{src}','module':m,'contentType':t,'sourceRef':src,
          'title':r['title'] or '','track':r['track'] or '',
          'versions':int(r['versions']),'latestVersionNo':int(r['latest_version_no']),
          'latestVersionId':str(r['latest_version_id']),'latestState':r['latest_state'] or '',
          'states':{'draft':int(r['draft_count']),'scheduled':int(r['scheduled_count']),
            'published':int(r['published_count']),'archived':int(r['archived_count'])},
          'createdAt':row_to_dict({'value':r['created_at']})['value'],
          'updatedAt':row_to_dict({'value':r['updated_at']})['value'],
          'hasPublishedRevision':int(r['published_revision_count'])>0})
    tally={key:{} for key in ('module','contentType','state','track')}
    for r in facets:
        for name,value in (('module',r['module'] or ''),('contentType',str(r['module'] or '')+':'+str(r['content_type'] or '')),
              ('state',r['latest_state'] or ''),('track',r['track'] or '')):
            if value:tally[name][value]=tally[name].get(value,0)+int(r['count'])
    facet_result={name:[{'value':value,'count':count} for value,count in sorted(items.items(),key=lambda x:(-x[1],x[0]))]
                  for name,items in tally.items()}
    return core.j({'ok':True,'rows':output,'total':total or 0,'limit':limit,
        'offset':offset,'facets':facet_result},headers=SECURE)


def install():core.app.include_router(router)
