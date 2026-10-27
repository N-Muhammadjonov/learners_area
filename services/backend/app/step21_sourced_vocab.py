"""Source-bound Vocabulary additions: Speaking prompt and standalone Video.
Exact source occurrence and publication are verified server-side.
"""
from __future__ import annotations
import json
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .step21_vocab_batch import add_batch
router=APIRouter()
PRIVATE={'Cache-Control':'private,no-store'}

def live(row):return row['publication_state']=='published' or (row['publication_state']=='scheduled' and row['publish_at'] and row['publish_at']<=datetime.now(timezone.utc))

@router.post('/api/speaking/prompts/vocabulary')
async def prompt_vocabulary(req:Request):
 u=await core.current_user(req,active=True)
 if not u:return core.auth_error()
 b=await core.payload(req)
 indices=b.get('indices') if isinstance(b,dict) else None
 if not isinstance(b,dict) or not core.uuid_value(b.get('promptId')) or not isinstance(indices,list) or not 1<=len(indices)<=100 or any(type(i)!=int or not 0<=i<=99 for i in indices):return core.j({'error':'invalid_input'},400)
 db=await core.pool()
 async with db.acquire() as con:
  row=await con.fetchrow('SELECT * FROM speaking_prompts WHERE id=$1',core.uuid_value(b['promptId']))
  if not row or not live(row) or not any(x in (row['available_in'] or []) for x in ('practice_alone','live_partner')):
   return core.j({'error':'source_not_found'},404)
  support=row['study_support']
  if not isinstance(support,dict) or not isinstance(support.get('vocabulary',[]),list) or len(support['vocabulary'])>100:return core.j({'error':'invalid_source'},409)
  items=support.get('vocabulary',[])
  unique=list(dict.fromkeys(indices))
  if any(i>=len(items) for i in unique):return core.j({'error':'invalid_input'},400)
  words=[items[i] for i in unique]
  if any(not isinstance(x,dict) or not 1<=len(x.get('term','').strip())<=120 or not 1<=len(x.get('definitionEn','').strip())<=500 for x in words):return core.j({'error':'invalid_source'},409)
  async with con.transaction():
   folder=await con.fetchrow('''INSERT INTO vocab_folders(user_id,name) VALUES($1,$2)
          ON CONFLICT(user_id,name) DO UPDATE SET name=excluded.name RETURNING id,name''',u['id'],row['prompt_text'])
   r=await add_batch(con,u['id'],[dict(x,authored=True) for x in words],folder_id=folder['id'],source_type='speaking',source_id=row['id'])
  folder_result={'id':str(folder['id']),'userId':str(u['id']),'name':folder['name']}
  return core.j({**r,'folder':folder_result},200 if r['ok'] else 404)

@router.post('/api/video-lessons/{id}/vocabulary')
async def video_vocabulary(req:Request,id:str):
 u=await core.current_user(req,active=True)
 if not u:return core.auth_error()
 if not core.uuid_value(id):return core.j({'error':'not_found'},404,PRIVATE)
 db=await core.pool()
 async with db.acquire() as con:
  lesson=await con.fetchrow('''SELECT * FROM video_lessons WHERE id=$1 AND lesson_id IS NULL''',core.uuid_value(id))
  if not lesson or not live(lesson):return core.j({'error':'not_found'},404,PRIVATE)
  b=await core.payload(req)
  if not isinstance(b,dict) or not core.uuid_value(b.get('occurrenceId')) or (b.get('folderId') is not None and not core.uuid_value(b.get('folderId'))):return core.j({'error':'invalid_input'},400,PRIVATE)
  try:
   occurrences=await con.fetch('''SELECT o.id AS occurrence_id,o.segment_key,o.start_char,o.end_char,
    o.surface_form,o.sentence_text,l.* FROM lexical_occurrences o JOIN lexemes l ON l.id=o.lexeme_id
    WHERE o.video_lesson_id=$1 AND o.source_type='video' AND o.resolution_status='resolved' AND o.id=$2
    ORDER BY o.lexeme_id,o.start_char''',lesson['id'],core.uuid_value(b['occurrenceId']))
  except Exception as exc:
   if getattr(exc,'sqlstate',None) in ('42P01','42703'):return core.j({'error':'service_unavailable','reason':'schema_missing'},503,PRIVATE)
   raise
  word=next((r for r in occurrences if str(r['occurrence_id'])==b['occurrenceId']),None)
  transcript=lesson['transcript'] or []
  text='\n'.join(x for x in [lesson['transcript_text'],*[line.get('text') for line in transcript if isinstance(line,dict)],lesson['notes']] if x)
  if not word or (word['segment_key']!='v:'+str(word['id']) and text[word['start_char']:word['end_char']]!=word['surface_form']):return core.j({'error':'not_found'},404,PRIVATE)
  item={'canonicalLexemeId':str(word['id']),'term':word['term'],'partOfSpeech':word['part_of_speech'],
       'definitionEn':word['definition_en'],'translationUz':word['translation_uz'],
       'exampleSentence':word['sentence_text'],'sourceSnapshot':{'sourceType':'video','videoLessonId':id,
       'occurrenceId':str(word['occurrence_id']),'lexemeId':str(word['id']),'sourceTitle':lesson['title'],
       'surfaceForm':word['surface_form'],'sentenceText':word['sentence_text'] or ''}}
  async with con.transaction():r=await add_batch(con,u['id'],[item],source_type='video',source_id=lesson['id'],folder_id=core.uuid_value(b.get('folderId')))
  return core.j(r,200 if r['ok'] else 400,PRIVATE)

def install():core.app.include_router(router)
