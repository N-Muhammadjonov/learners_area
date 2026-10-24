"""Translation start/read: attempt ownership, published set choice, safe
in-progress projection (never leaks answers for an unfinished sentence).
Ported from writing/translation.ts and app/api/writing/translation routes.
"""
from __future__ import annotations
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
router=APIRouter()
LIVE="(publication_state='published' OR (publication_state='scheduled' AND publish_at <= NOW()))"
TYPES=('opinion','discussion','problem_solution','advantages_disadvantages','two_part')

async def auth(req):
 user=await core.current_user(req,active=True)
 if not user:return None,core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
 return user,None

@router.post('/api/writing/translation')
async def begin_translation(req:Request):
 u,e=await auth(req)
 if e:return e
 b=await core.payload(req)
 if not isinstance(b,dict):return core.j({'error':{'code':'invalid_input','message':'Choose a topic or a random essay.'}},400)
 valid=((set(b)=={'setId'} and isinstance(b.get('setId'),str) and core.uuid_value(b['setId'])) or
  (set(b)=={'random'} and isinstance(b.get('random'),dict) and set(b['random'])<= {'questionType','targetBand'} and
   ('questionType' not in b['random'] or b['random']['questionType'] in TYPES) and
   ('targetBand' not in b['random'] or type(b['random']['targetBand'])==int and b['random']['targetBand'] in (6,7,8))))
 if not valid:return core.j({'error':{'code':'invalid_input','message':'Choose a topic or a random essay.'}},400)
 try:
  db=await core.pool()
  async with db.acquire() as con:
   if 'setId' in b:
    sid=b['setId']
    found=await con.fetchval(f'SELECT id FROM writing_translation_sets WHERE id=$1 AND {LIVE}',sid)
    if not found:return core.j({'error':{'code':'not_found','message':'No published essay matches this choice.'}},404)
   else:
    filters=[];args=[];rand=b['random']
    if rand.get('questionType'):
     args.append(rand['questionType']);filters.append(f'question_type=${len(args)}')
    if rand.get('targetBand'):
     args.append(rand['targetBand']);filters.append(f'target_band=${len(args)}')
    filt=(' AND '+' AND '.join(filters)) if filters else ''
    sid=await con.fetchval(f'''SELECT s.id FROM writing_translation_sets s
     WHERE {LIVE}{filt} AND EXISTS(SELECT 1 FROM writing_translation_sentences t WHERE t.set_id=s.id)
     ORDER BY random() LIMIT 1''',*args)
    if not sid:return core.j({'error':{'code':'no_sets','message':'No published essay matches this choice.'}},404)
   existing=await con.fetchval('''SELECT id FROM writing_translation_attempts
    WHERE user_id=$1 AND set_id=$2 AND status='in_progress' ORDER BY started_at DESC LIMIT 1''',u['id'],sid)
   if existing:return core.j({'ok':True,'id':str(existing),'resumed':True})
   new=await con.fetchval('''INSERT INTO writing_translation_attempts(user_id,set_id) VALUES($1,$2) RETURNING id''',u['id'],sid)
  return core.j({'ok':True,'id':str(new),'resumed':False})
 except Exception:
  return core.j({'error':{'code':'not_migrated','message':'Translation is not available yet.'}},503)

def done(a):
 return bool(a and (a['evaluation_status']=='unavailable' or a['verdict'] in ('correct','acceptable') or a['tries']>=3))

def completed_result(attempt,sentences,by_id):
 targets=[]
 for s in sentences:
  for term in s['target_lexical_items'] or []:
   term=term.strip()
   if term and term not in targets:targets.append(term)
 answers=' \n '.join(by_id.get(str(s['id']),{}).get('answer_text','') for s in sentences).lower()
 used=[w for w in targets if w.lower() in answers]
 misses=[]
 for s in sentences:
  a=by_id.get(str(s['id']))
  if a and a['verdict']=='needs_revision' and (a['feedback'] or a['improved_version']):
   misses.append((a['meaning_preserved'] if a['meaning_preserved'] is not None else 0,s['position'],a['feedback'] or a['improved_version']))
 misses.sort()
 return {'overall':attempt['overall_estimate'],'meaning':attempt['meaning_score'],'grammar':attempt['grammar_band'],
  'vocabulary':attempt['vocabulary_band'],'bandWords':{'used':used,'total':len(targets)},
  'elapsedMs':attempt['elapsed_ms'],'topFixes':[{'position':pos,'text':msg} for _,pos,msg in misses[:3]],
  'checked':sum(bool(by_id.get(str(s['id'])) and by_id[str(s['id'])]['evaluation_status']!='unavailable') for s in sentences)}

@router.get('/api/writing/translation/{id}')
async def translation_view(req:Request,id:str):
 u,e=await auth(req)
 if e:return e
 if not core.uuid_value(id):return core.j({'error':{'code':'not_found','message':'Not found.'}},404)
 db=await core.pool()
 async with db.acquire() as con:
  attempt=await con.fetchrow('SELECT * FROM writing_translation_attempts WHERE id=$1 AND user_id=$2',id,u['id'])
  if not attempt:return core.j({'error':{'code':'not_found','message':'Not found.'}},404)
  doc=await con.fetchrow('''SELECT title,topic,question_type,target_band,prompt_text FROM writing_translation_sets WHERE id=$1''',attempt['set_id'])
  sentences=await con.fetch('''SELECT id,position,uzbek_source,model_english,notes,target_lexical_items
   FROM writing_translation_sentences WHERE set_id=$1 ORDER BY position''',attempt['set_id'])
  answers=await con.fetch('''SELECT sentence_id,answer_text,evaluation_status,verdict,meaning_preserved,grammar_band,
   vocabulary_band,feedback,improved_version,tries FROM writing_translation_answers WHERE attempt_id=$1''',id)
  by_id={str(a['sentence_id']):dict(a) for a in answers}
 current=next((s for s in sentences if not done(by_id.get(str(s['id'])))),None)
 finished=[]
 for s in sentences:
  a=by_id.get(str(s['id']))
  if not done(a):continue
  finished.append({'position':s['position'],'uzbek':s['uzbek_source'],'yours':a['answer_text'],
   'model':s['model_english'],'notes':s['notes'] or [],'verdict':a['verdict'],'status':a['evaluation_status'],
   'meaning':a['meaning_preserved'],'feedback':a['feedback'],'improved':a['improved_version']})
 latest=by_id.get(str(current['id'])) if current else None
 view={'attemptId':id,'status':attempt['status'],
  'set':{'title':doc['title'],'topic':doc['topic'],'questionType':doc['question_type'],
         'targetBand':float(doc['target_band']) if doc['target_band'] is not None else None,'prompt':doc['prompt_text']},
  'total':len(sentences),'finished':finished,
  'current':({'position':current['position'],'uzbek':current['uzbek_source'],
    'lastAnswer':latest['answer_text'] if latest else None,
    'lastFeedback':latest['feedback'] if latest else None,
    'lastImproved':latest['improved_version'] if latest else None,
    'tries':latest['tries'] if latest else 0} if current else None),
  'result':completed_result(attempt,sentences,by_id) if attempt['status']=='completed' else None}
 return core.j({'ok':True,'view':view},headers={'Cache-Control':'no-store'})

def install():core.app.include_router(router)
