"""Reading answer submission + general progress + Academic start.
The client never supplies a score or unlocks a key. PostgreSQL owns the deadline.
"""
from __future__ import annotations
import json,re
from datetime import datetime,timezone,timedelta
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .js_text import collapse, trim, words
from pathlib import Path
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
STAFF=('teacher','admin','owner')
OMISSIONS={'reading105:test:08':('t08-p2-european-heat-wave',14),
'reading105:test:12':('t12-p1-how-printed-books-began',14),
'reading105:test:30':('t30-p1-the-terracotta-army',16),
'reading105:test:31':('t31-p1-this-is-very-much-the-story-of-a-story',14)}

def is_live(r):return bool(r and (r['publication_state']=='published' or (r['publication_state']=='scheduled' and r['publish_at'] and r['publish_at']<=datetime.now(timezone.utc))))
def norm(s):
 return re.sub(r'\.$','',collapse(trim(s).lower().replace('\u2018',"'").replace('\u2019',"'").replace('\u02bc',"'").replace('\u2013','-').replace('\u2014','-').replace('_',' ')))
def matches(a,b):
 a=norm(a);b=norm(b)
 if not a:return False
 if a==b:return True
 def label(s):
  m=re.match(r'^([a-z])\s*-\s*\S',s)
  return m.group(1) if m else None
 la=label(a);lb=label(b)
 return (la is not None and lb is not None and la==lb) or (la is not None and la==b) or (lb is not None and lb==a)

READING_TYPES=json.loads(Path(__file__).with_name('reading_question_types.json').read_text())
TYPE_IDS={alias.lower():kind for kind,aliases,_ in READING_TYPES for alias in [kind,*aliases]}

def choice_shape(value):
 value=trim(value)
 matched=re.match(r'^((?:[ivx]+|[a-z]))\s*[)—–.:\-]\s*(.+)$',value,re.I|re.ASCII)
 if matched:return matched[1].lower(),collapse(trim(matched[2])).lower()
 if re.fullmatch(r'(?:[ivx]+|[a-z])',value,re.I|re.ASCII):return value.lower(),''
 return None,collapse(value.lower())

def choice_matches(answer,key,options):
 left,text=choice_shape(answer);right,expected=choice_shape(key)
 if not left and not text:return False
 if left and right:return left==right
 if text and expected:return text==expected
 def option_label(text):
  return next((label for value in options for label,body in [choice_shape(value)] if label and body==text),None)
 return option_label(expected)==left if left and expected else option_label(text)==right if text and right else False

def correct(q,answer,choices=None):
 raw=q['accepted_answers'] or []
 constraints=q['answer_constraint'] or {}
 max_words=constraints.get('max_words',constraints.get('maxWords'))
 if isinstance(max_words,(float,int)) and len(words(answer))>max_words:return False
 kind=TYPE_IDS.get((q['type_code'] or q['type'] or '').lower())
 if not kind:return False
 options=[]
 for index,value in enumerate(q.get('options') or choices or []):
  label,text=choice_shape(value)
  options.append((label or chr(65+index))+') '+(text or value))
 if kind in ('true_false_not_given','yes_no_not_given'):
  allowed=constraints.get('allowed_values')
  if isinstance(allowed,list) and all(isinstance(v,str) for v in allowed):
   values={collapse(trim(v).upper()).replace(' ','_') for v in allowed}
   if values=={'YES','NO','NOT_GIVEN'}:kind='yes_no_not_given'
   elif values=={'TRUE','FALSE','NOT_GIVEN'}:kind='true_false_not_given'
  valid=('YES','NO','NOT GIVEN') if kind=='yes_no_not_given' else ('TRUE','FALSE','NOT GIVEN')
  value=collapse(trim(answer)).replace('_',' ').upper()
  return value in valid and value==collapse(trim(q['correct_answer'])).replace('_',' ').upper()
 if kind=='multiple_choice_multi':
  split=lambda s:[x.strip() for x in re.split(r'[,;]|\s+and\s+',s,flags=re.I) if x.strip()]
  provided=split(answer)
  for expected in [q['correct_answer'],*raw]:
   keys=split(expected)
   number=constraints.get('selection_count',len(keys))
   remaining=keys.copy()
   for value in provided:
    match=next((i for i,key in enumerate(remaining) if choice_matches(value,key,options)),None)
    if match is not None:remaining.pop(match)
   if len(keys)==number==len(provided) and len({x.lower() for x in provided})==len(provided) and not remaining:return True
  return False
 if kind=='multiple_choice':return choice_matches(answer,q['correct_answer'],options)
 if kind.startswith('matching_') or kind=='classification':
  return choice_matches(answer,q['correct_answer'],options) or any(matches(answer,x) for x in [q['correct_answer'],*raw])
 if kind!='short_answer' and not isinstance(max_words,(float,int)) and len(words(answer))>3:return False
 return any(matches(answer,x) for x in [q['correct_answer'],*raw])

def assessment_question_selection(source,rows):
 if len(rows)==40:return rows
 miss=OMISSIONS.get(source)
 if len(rows)!=41 or not miss:return None
 omitted=[q for q in rows if q['external_id']==miss[0] and q['question_no']==miss[1]]
 return [q for q in rows if q['id']!=omitted[0]['id']] if len(omitted)==1 else None

@router.post('/api/reading/general/progress')
async def general_progress(req:Request):
 u=await core.current_user(req,active=True)
 if not u:return core.auth_error()
 b=await core.payload(req)
 if not isinstance(b,dict) or not core.uuid_value(b.get('passageId')) or not isinstance(b.get('answers'),dict) or len(b['answers'])>60 or any(not core.uuid_value(k) or not isinstance(v,str) or len(v)>500 for k,v in b['answers'].items()) or ('check' in b and type(b['check'])!=bool) or ('start' in b and type(b['start'])!=bool):return core.j({'error':'invalid_input'},400)
 db=await core.pool()
 async with db.acquire() as con:
  record=await con.fetchrow('''SELECT g.set_id,g.reading_mode,s.* FROM general_reading_passages g
     JOIN general_reading_sets s ON s.id=g.set_id WHERE g.passage_id=$1''',core.uuid_value(b['passageId']))
  passage=await con.fetchrow('SELECT * FROM reading_passages WHERE id=$1',core.uuid_value(b['passageId']))
  if not record or record['reading_mode']!='general_practice' or not passage or (u['role'] not in STAFF and (not is_live(record) or not is_live(passage))):return core.j({'error':'not_found'},404)
  qs=await con.fetch('SELECT * FROM reading_questions WHERE passage_id=$1',passage['id'])
  allowed={str(q['id']) for q in qs}
  if b.get('start'):
   await con.execute('''INSERT INTO general_reading_progress(user_id,set_id,passage_id,answers)
      VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT(user_id,passage_id) DO NOTHING''',u['id'],record['set_id'],passage['id'])
   row=await con.fetchrow('SELECT * FROM general_reading_progress WHERE user_id=$1 AND passage_id=$2',u['id'],passage['id'])
   return core.j({'ok':True,'updatedAt':row_to_dict({'updatedAt':row['updated_at']})['updatedAt'], 'score':row['score'],'total':row['total'],'result':None})
  answers={k:v[:500] for k,v in b['answers'].items() if k in allowed}
  result=None;score=None;checked=bool(b.get('check'))
  if checked:
   result=[{'questionId':str(q['id']),'isCorrect':correct(q,answers.get(str(q['id']),'')),
           'correctAnswer':q['correct_answer'],'acceptedAnswers':q['accepted_answers'] or [],
           'evidenceQuote':q['evidence_quote'],'explanation':q['explanation'].strip() if q['explanation'] and q['explanation'].strip() else None} for q in qs]
   score=sum(r['isCorrect'] for r in result)
  saved=await con.fetchrow('''INSERT INTO general_reading_progress(user_id,set_id,passage_id,answers,score,total,checked_at,updated_at)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,CASE WHEN $7 THEN NOW() ELSE NULL END,NOW())
    ON CONFLICT(user_id,passage_id) DO UPDATE SET answers=excluded.answers,score=excluded.score,total=excluded.total,
    checked_at=excluded.checked_at,updated_at=excluded.updated_at RETURNING updated_at,score,total''',
    u['id'],record['set_id'],passage['id'],json.dumps(answers),score,len(qs) if checked else None,checked)
  return core.j({'ok':True,'updatedAt':row_to_dict({'updatedAt':saved['updated_at']})['updatedAt'],
     'score':saved['score'],'total':saved['total'],'result':result})

@router.post('/api/reading/attempts/{id}/submit')
async def reading_submit(req:Request,id:str):
 if not core.uuid_value(id):return core.j({'error':'not_found'},404)
 u=await core.current_user(req,active=True)
 if not u:return core.auth_error()
 b=await core.payload(req)
 entries=b.get('answers') if isinstance(b,dict) else None
 if not isinstance(entries,list) or any(not isinstance(x,dict) or not core.uuid_value(x.get('questionId')) or not isinstance(x.get('answer'),str) or len(x['answer'])>500 for x in entries):return core.j({'error':'invalid_input'},400)
 db=await core.pool()
 async with db.acquire() as con:
  async with con.transaction():
   attempt=await con.fetchrow('''SELECT a.*,p.suggested_minutes FROM reading_attempts a
          JOIN reading_passages p ON p.id=a.passage_id WHERE a.id=$1 AND a.user_id=$2 FOR UPDATE OF a''',core.uuid_value(id),u['id'])
   if not attempt:return core.j({'error':'not_found'},404)
   if attempt['status']!='in_progress':return core.j({'error':'already_submitted'},409)
   slots=await con.fetch('SELECT passage_id FROM reading_assessment_passages WHERE attempt_id=$1 ORDER BY passage_no',attempt['id'])
   passage_ids=[r['passage_id'] for r in slots] if slots else [attempt['passage_id']]
   metadata=await con.fetchrow('SELECT duration_minutes FROM reading_assessments WHERE attempt_id=$1',attempt['id'])
   selected=await con.fetch('SELECT question_id FROM reading_assessment_questions WHERE attempt_id=$1 ORDER BY position',attempt['id'])
   if selected and len(selected)!=40:return core.j({'error':'not_found'},409)
   questions=await con.fetch('''SELECT * FROM reading_questions WHERE passage_id=ANY($1::uuid[])''',passage_ids)
   if selected:
    permitted={r['question_id'] for r in selected};questions=[q for q in questions if q['id'] in permitted]
    if len(questions)!=40:return core.j({'error':'not_found'},409)
   groups=await con.fetch('SELECT * FROM reading_question_groups WHERE passage_id=ANY($1::uuid[])',passage_ids)
   groups_map={g['id']:g for g in groups}
   duration=metadata['duration_minutes'] if metadata else attempt['suggested_minutes']
   minutes=duration if isinstance(duration,int) and 5<=duration<=90 else 20
   timed_out=(datetime.now(timezone.utc)-attempt['started_at']).total_seconds()>=minutes*60
   actual=await con.fetch('SELECT question_id,user_answer FROM reading_answers WHERE attempt_id=$1 AND is_correct IS NULL',attempt['id']) if timed_out else []
   by_answer={str(x['question_id']):x['user_answer'] for x in actual} if timed_out else {x['questionId']:x['answer'] for x in entries}
   score=0
   await con.execute('DELETE FROM reading_answers WHERE attempt_id=$1 AND is_correct IS NULL',attempt['id'])
   for q in questions:
    ans=by_answer.get(str(q['id']),'')
    group=groups_map.get(q['group_id'])
    checked=correct(q,ans,group['shared_choices'] if group else None)
    score+=bool(checked)
    await con.execute('''INSERT INTO reading_answers(attempt_id,question_id,user_answer,is_correct)
            VALUES($1,$2,$3,$4)''',attempt['id'],q['id'],ans,checked)
   await con.execute("UPDATE reading_attempts SET status='completed',score=$2,total_questions=$3,submitted_at=NOW() WHERE id=$1 AND status='in_progress'",attempt['id'],score,len(questions))
   await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'READING_ATTEMPT_COMPLETED', $2::jsonb)''',
         u['id'],json.dumps({'attemptId':id,'score':score,'totalQuestions':len(questions)}))
 return core.j({'ok':True,'score':score,'totalQuestions':len(questions)})

def install():core.app.include_router(router)
