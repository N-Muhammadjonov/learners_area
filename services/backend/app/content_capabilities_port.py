"""Static catalogue projection from the original author/taxonomy/preview registries.

Source: content/authors.ts, content/taxonomy.ts, content/preview.ts.  No frontend
is bundled. Snapshot MUST be refreshed if the source commit changes.
"""
from fastapi import APIRouter,Request
from . import main as core
router=APIRouter()
AUTHORS=[
 ('listening','full_test','Listening test',['questions']),
 ('listening','section','Listening section',['questions']),
 ('reading','general_set','Reading set',['passages']),
 ('reading','passage','Reading passage',['passages']),
 ('writing','task1','Writing Task 1',['prompt']),
 ('writing','task2','Writing Task 2',['prompt']),
 ('writing','lesson','Writing lesson',['body']),
 ('writing','model_text','Model text',['body']),
 ('writing','pattern','Language pattern',['pattern']),
 ('writing','translation_set','Translation set',['sentences']),
 ('speaking','part1_question','Speaking part1 question',['promptText']),
 ('speaking','cue_card','Speaking cue card',['promptText']),
 ('speaking','part3_question','Speaking part3 question',['promptText']),
 ('speaking','material','Speaking material',['primary']),
 ('grammar','topic','Grammar topic',['exercises']),
 ('lesson','lesson','Lesson',['blocks']),
 ('vocabulary','topic_pack','Vocabulary topic pack',['words'])]
AUTHORS.sort(key=lambda x:(x[0],x[1]))
LABELS={(m,t):label for m,t,label,_ in AUTHORS}
PARTS={(m,t):parts for m,t,_,parts in AUTHORS}
TAXONOMY=[
 ('listening','Listening',['academic','general_training'],['full_test','section','question_type_practice']),
 ('reading','Reading',['academic','general_training'],['general_set','full_test','passage','passage_set','question_type_practice']),
 ('writing','Writing',['academic','general_training'],['task1','task2','lesson','model_text','pattern','translation_set']),
 ('speaking','Speaking',['academic','general_training'],['part1_question','cue_card','part3_question','material']),
 ('grammar','Grammar',['unspecified'],['topic','exercise']),
 ('vocabulary','Vocabulary',['unspecified'],['topic_pack','retention_text']),
 ('ted','TED / Podcast',['unspecified'],['video_lesson','audio_lesson']),
 ('lesson','Lesson',['unspecified'],['lesson'])]
IMPORTABLE={('listening','full_test'),('reading','general_set')}
TEACHER={('lesson','lesson'),('speaking','material'),('ted','video_lesson'),('ted','audio_lesson')}

def is_staff(role):return role in ('teacher','admin','owner')
def may_author(role,module,content_type):
    return (module,content_type) in LABELS and (role in ('owner','admin') or (role=='teacher' and (module,content_type) in TEACHER))

@router.get('/api/admin/content/previews')
async def preview_inventory(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if not is_staff(user['role']):return core.j({'error':'forbidden'},403)
    items=[{'module':m,'contentType':t,'status':'PREVIEW_READY' if parts else 'PARTIAL',
            'requiredParts':parts} for m,t,_,parts in AUTHORS]
    return core.j({'ok':True,'items':items,'missing':[]},headers={'Cache-Control':'private, no-store'})

@router.get('/api/admin/content/authoring-capabilities')
async def content_capabilities(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if not is_staff(user['role']):return core.j({'error':'forbidden'},403)
    role=user['role']
    modules=[{'module':m,'label':label,'tracks':tracks,'contentTypes':[
        {'contentType':t,'authorable':may_author(role,m,t),'registered':(m,t) in LABELS,
         'importable':(m,t) in IMPORTABLE,'label':LABELS.get((m,t))} for t in types]}
      for m,label,tracks,types in TAXONOMY]
    return core.j({'modules':modules,'authorableKeys':[m+':'+t for m,t,_,_ in AUTHORS if may_author(role,m,t)],
                   'mayPublish':role in ('admin','owner')})

def install():core.app.include_router(router)
