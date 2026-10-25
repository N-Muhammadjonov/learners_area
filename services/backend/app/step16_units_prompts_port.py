"""Unit typeahead and published Speaking prompt catalogue.

Ports src/app/api/lessons/units and GET src/app/api/speaking/prompts.
"""
from __future__ import annotations
import base64
import json
import re
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .lesson_writing_port import js_length

router=APIRouter()
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',re.I)
B64=re.compile(r'^[A-Za-z0-9_-]+$')


def cursor_encode(row,term):
    value=[1,term,row['course'],row['module_order'],row['unit_order'],str(row['id'])]
    return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()).decode().rstrip('=')


def cursor_decode(raw,term):
    if not isinstance(raw,str) or not raw.strip() or len(raw)>1024 or not B64.fullmatch(raw):
        raise ValueError('cursor')
    try:
        value=json.loads(base64.urlsafe_b64decode(raw+'='*((-len(raw))%4)).decode('utf-8'))
    except (ValueError,UnicodeError):raise ValueError('cursor') from None
    if (not isinstance(value,list) or len(value)!=6 or type(value[0]) is not int or value[0]!=1 or
        not isinstance(value[1],str) or value[1]!=term or not isinstance(value[2],str) or js_length(value[2])>400 or
        any(type(x) is not int or x < -2147483648 or x > 2147483647 for x in value[3:5]) or
        not isinstance(value[5],str) or not UUID.fullmatch(value[5])):
        raise ValueError('cursor')
    return value[2:]


def option(r):
    return {'id':str(r['id']), 'label':f"{r['course']} › {r['module']} › {r['unit_order']}. {r['unit']}", 'course':r['course']}


@router.get('/api/lessons/units')
async def unit_options(req:Request):
    user=await core.current_user(req,active=True)
    if not user or user['role'] not in ('owner','admin','teacher'):
        return core.auth_error()
    qp=req.query_params
    # JS slice(0,120) counts UTF-16 units.
    search=qp.get('q','').strip().encode('utf-16-le','surrogatepass')[:240].decode('utf-16-le','surrogatepass')
    db=await core.pool()
    async with db.acquire() as con:
        if 'ids' in qp:
            ids=[]
            selected=[s.strip() for s in qp['ids'].split(',') if s.strip()][:50]
            for key in selected:
                if UUID.fullmatch(key) and key.lower() not in [i.lower() for i in ids]:ids.append(key)
            if not ids:return core.j({'options':[]},headers={'cache-control':'no-store'})
            rows=await con.fetch('''SELECT u.id,u.title AS unit,m.title AS module,c.title AS course,u."order" AS unit_order
                FROM units u JOIN course_modules m ON m.id=u.module_id JOIN courses c ON c.id=m.course_id
                WHERE u.id=ANY($1::uuid[])''',ids)
            return core.j({'options':[option(r) for r in rows]},headers={'cache-control':'no-store'})
        after=None
        if 'cursor' in qp:
            try:after=cursor_decode(qp['cursor'],search)
            except ValueError:return core.j({'error':'invalid_cursor'},400)
        args=[];conditions=[]
        if search:
            args.append('%'+search+'%')
            conditions.append('(u.title ILIKE $1 OR m.title ILIKE $1 OR c.title ILIKE $1)')
        count_condition='WHERE '+conditions[0] if conditions else ''
        if after:
            args.extend(after)
            start=len(args)-3
            conditions.append(f'''(c.title,m."order",u."order",u.id) >
               (${start},${start+1},${start+2},${start+3}::uuid)''')
        where='WHERE '+' AND '.join(conditions) if conditions else ''
        base='FROM units u JOIN course_modules m ON m.id=u.module_id JOIN courses c ON c.id=m.course_id '
        rows=await con.fetch(f'''SELECT u.id,u.title AS unit,m.title AS module,c.title AS course,
           m."order" AS module_order,u."order" AS unit_order {base} {where}
           ORDER BY c.title,m."order",u."order",u.id LIMIT 501''',*args)
        total=await con.fetchval('SELECT count(*)::int '+base+count_condition,*args[:1] if search else [])
    more=len(rows)>500;page=rows[:500];last=page[-1] if page else None
    return core.j({'options':[option(r) for r in page],'hasMore':more,
      'nextCursor':cursor_encode(last,search) if more and last else None,
      'matching':total or 0,'pageSize':500},headers={'cache-control':'no-store'})



def install():core.app.include_router(router)
