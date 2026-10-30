"""Teacher assignment creation, roster authorization and atomic learner notification."""
from __future__ import annotations
import json,re
from datetime import datetime
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .step17_mcq_port import live
from .notification_events import notify_assignment_assigned
router=APIRouter()
KNOWN={'listening':('full_test','section','question_type_practice'),
    'reading':('general_set','full_test','passage','passage_set','question_type_practice'),
    'writing':('task1','task2','lesson','model_text','pattern','translation_set'),
    'speaking':('part1_question','cue_card','part3_question','material'),
    'grammar':('topic','exercise'), 'vocabulary':('topic_pack','retention_text'),
    'ted':('video_lesson','audio_lesson'), 'lesson':('lesson',)}

def issue(reason):
    return {'code':'assign_forbidden_'+reason,'message':{'outside_roster':'A teacher may only set work for students on their roster.',
      'not_a_student':'Work can only be assigned to a student.','not_staff':'Only teachers and the owner can assign work.'}.get(reason,'Only staff can assign work.'), 'field':'studentIds'}

def bad(issues,status=422):return core.j({'ok':False,'issues':issues},status)

async def roster(con,actor,student):
    row=await con.fetchrow('SELECT role FROM users WHERE id=$1',student)
    if not row or row['role']!='student':return 'not_a_student'
    if actor['role']=='owner':return None
    allowed=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM teacher_student_links
      WHERE teacher_user_id=$1 AND student_user_id=$2)''',actor['id'],student)
    return None if allowed else 'outside_roster'

@router.post('/api/assignments')
async def assignments_create(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('teacher','owner'):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not isinstance(b,dict):return core.j({'error':'invalid_input'},400)
    title=b.get('title'); description=b.get('description');instructions=b.get('instructions')
    target=b.get('targetUserId');due=b.get('dueAt')
    if (not isinstance(title,str) or not 3<=len(title)<=200 or
        any(v is not None and (not isinstance(v,str) or len(v)>cap) for v,cap in ((description,2000),(instructions,4000))) or
        not core.uuid_value(target) or
        any(b.get(k) is not None and (not isinstance(b[k],str) or not mn<=len(b[k])<=mx)
            for k,mn,mx in (('module',2,20),('contentType',2,40),('sourceRef',1,80))) or
        any(b.get(k) is not None and not core.uuid_value(b[k]) for k in ('contentVersionId','relatedWritingPromptId'))):
        return core.j({'error':'invalid_input'},400)
    if due is not None:
        try:
            if not isinstance(due,str) or not re.search(r'(Z|[+-]\d\d:\d\d)$',due):raise ValueError()
            when=datetime.fromisoformat(due.replace('Z','+00:00'))
        except ValueError:return core.j({'error':'invalid_input'},400)
    else:when=None
    ref=all(isinstance(b.get(k),str) and b[k] for k in ('module','contentType','sourceRef'))
    if not ref and not b.get('relatedWritingPromptId'):return core.j({'error':'missing_content_reference'},400)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            problem=await roster(con,user,target)
            if problem:return bad([issue(problem)],403)
            if ref:
                module,typ,source=b['module'],b['contentType'],b['sourceRef']
                if module not in KNOWN or typ not in KNOWN[module]:
                    return bad([{'code':'unknown_content_type','message':f'"{module}:{typ}" is not a known content type.','field':'reference'}])
                if b.get('contentVersionId'):
                    version=await con.fetchrow('SELECT * FROM content_versions WHERE id=$1',core.uuid_value(b['contentVersionId']))
                else:
                    version=await con.fetchrow('''SELECT * FROM content_versions WHERE module=$1 AND content_type=$2 AND source_ref=$3
                        AND status='published' ORDER BY version_no DESC LIMIT 1''',module,typ,source)
                if not version:return bad([{'code':'version_not_found','message':'That content revision does not exist (or has never been published).','field':'reference'}])
                if version['module']!=module or version['content_type']!=typ or version['source_ref']!=source:
                    return bad([{'code':'version_identity_mismatch','message':'That revision belongs to different content.','field':'reference'}])
                if version['status']!='published':
                    return bad([{'code':'version_not_published','message':'Only a published revision can be assigned to a learner.','field':'reference'}])
                # A revision is not an assignable target when its materialized item has been withdrawn.
                table={'lesson':'lessons','reading':'reading_passages','writing':'writing_prompts','speaking':'speaking_prompts',
                       'grammar':'grammar_topics','listening':'listening_tests','ted':'video_lessons','vocabulary':'vocabulary_topic_packs'}.get(module)
                if table and version['target_id']:
                    targetrow=await con.fetchrow(f'SELECT * FROM {table} WHERE id=$1',version['target_id'])
                    if not targetrow or ('publication_state' in targetrow and not live(targetrow)):
                        return bad([{'code':'content_not_live','message':'That content is not open to learners.','field':'reference'}])
                created=await con.fetchrow('''INSERT INTO assignments(title,description,instructions,created_by_user_id,target_user_id,
                   module,content_type,source_ref,content_version_id,due_at,updated_at)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING id''',
                   title.strip(),description,instructions,user['id'],core.uuid_value(target),module,typ,source,version['id'],when)
            else:
                prompt=await con.fetchrow('''SELECT publication_state,publish_at FROM writing_prompts
                  WHERE id=$1''',core.uuid_value(b['relatedWritingPromptId']))
                if not prompt or not live(prompt):
                    return bad([{'code':'content_not_live','message':'That writing prompt does not exist or is not open to learners, so it cannot be set as work.','field':'relatedWritingPromptId'}])
                created=await con.fetchrow('''INSERT INTO assignments(title,description,instructions,created_by_user_id,target_user_id,
                     related_writing_prompt_id,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *''',
                     title,description,instructions,user['id'],core.uuid_value(target),core.uuid_value(b['relatedWritingPromptId']),when)
            await con.execute('''INSERT INTO assignment_targets(assignment_id,student_user_id,due_at) VALUES($1,$2,$3)''',
                created['id'],core.uuid_value(target),when)
            payload={'assignmentId':str(created['id']),'teacherId':str(user['id'])}
            if ref:payload['contentVersionId']=str(version['id'])
            await con.execute("INSERT INTO activity_events(user_id,type,payload) VALUES($1,'ASSIGNMENT_CREATED',$2::jsonb)",
               core.uuid_value(target),json.dumps(payload))
            await notify_assignment_assigned(con, assignment_id=created['id'],
                student_id=core.uuid_value(target), title=title.strip(), module=b.get('module'))
    if ref:return core.j({'ok':True,'assignment':{'id':str(created['id'])},'contentVersionId':str(version['id'])},201)
    return core.j({'ok':True,'assignment':row_to_dict(created)})

def install():core.app.include_router(router)
