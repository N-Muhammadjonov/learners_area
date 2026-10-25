"""Writing Stealing new-topic practice selector (GET only).

Port of startPractice + practiceTopics. Keeps published-only and soft-delete access.
"""
from __future__ import annotations
import random
from fastapi import APIRouter,Request
from . import main as core
from .lesson_writing_port import is_js_uuid
router=APIRouter()
FALLBACK=('education','environment','technology','health','work','transport','crime','tourism','media','family')
LIVE="""publication_state='published' OR (publication_state='scheduled' AND publish_at<=now())"""
DELETED="""NOT EXISTS (SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||src.id::text)::uuid AND d.type='CONTENT_DELETED')"""

@router.get('/api/writing/stealing/practice')
async def start_pattern_practice(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    pid=req.query_params.get('patternId','')
    if not is_js_uuid(pid):return core.j({'error':{'code':'invalid_input','message':'Unknown pattern.'}},400)
    db=await core.pool()
    async with db.acquire() as con:
        p=await con.fetchrow('''SELECT id,topic FROM writing_language_patterns src
             WHERE id=$1 AND (publication_state='published' OR
               (publication_state='scheduled' AND publish_at<=now()))
               AND NOT EXISTS (SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||src.id::text)::uuid AND d.type='CONTENT_DELETED')''',pid)
        if not p:return core.j({'error':{'code':'not_found','message':'Unknown pattern.'}},404)
        pattern_topics=await con.fetch('''SELECT DISTINCT topic AS t FROM writing_language_patterns src WHERE
           (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))
           AND NOT EXISTS (SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||src.id::text)::uuid AND d.type='CONTENT_DELETED')''')
        text_topics=await con.fetch('''SELECT DISTINCT topic AS t FROM writing_model_texts src WHERE
           (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))
           AND NOT EXISTS (SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||src.id::text)::uuid AND d.type='CONTENT_DELETED')''')
    own=(p['topic'] or '').strip().lower()
    topics=sorted((set(FALLBACK)|{r['t'].strip().lower() for r in list(pattern_topics)+list(text_topics)
          if isinstance(r['t'],str) and r['t'].strip()})-{own})
    return core.j({'ok':True,'patternId':str(p['id']), 'newTopic':random.choice(topics), 'topics':topics},headers={'cache-control':'no-store'})

def install():core.app.include_router(router)

@router.post('/api/writing/stealing/sessions')
async def start_stealing_session(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    b=await core.payload(req)
    if not isinstance(b,dict) or set(b)!={'modelTextId'} or not is_js_uuid(b['modelTextId']):
        return core.j({'error':{'code':'invalid_input','message':'Choose a model text.'}},400)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            # Source stealingSources() requires a published/live model text and >=1 published linked pattern.
            valid=await con.fetchval('''SELECT m.id FROM writing_model_texts m WHERE m.id=$1
             AND (m.publication_state='published' OR (m.publication_state='scheduled' AND m.publish_at<=now()))
             AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||m.id::text)::uuid AND d.type='CONTENT_DELETED')
             AND EXISTS (SELECT 1 FROM writing_language_patterns p WHERE p.source_ref=m.id::text
               AND p.publication_state='published' AND (p.publish_at IS NULL OR p.publish_at<=now()))''',b['modelTextId'])
            if not valid:return core.j({'error':{'code':'not_found','message':'This model text is not available.'}},404)
            await con.execute('''INSERT INTO writing_stealing_sessions(user_id,model_text_id)
                 VALUES($1,$2) ON CONFLICT(user_id,model_text_id) DO NOTHING''',user['id'],b['modelTextId'])
            row=await con.fetchrow('''SELECT id FROM writing_stealing_sessions WHERE user_id=$1
               AND model_text_id=$2 LIMIT 1''',user['id'],b['modelTextId'])
    return core.j({'ok':True,'id':str(row['id'])})
