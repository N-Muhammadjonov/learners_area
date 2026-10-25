"""Bounded seven-kind domain history, with independent category failure reporting."""
from __future__ import annotations
import re
from datetime import datetime, timezone
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
router=APIRouter()
KINDS=('reading','listening','writing','speaking','grammar','mock','assignment')
PRIVATE={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
SQL={
 'reading':'''SELECT a.id,a.status,a.started_at AS "occurredAt",a.submitted_at AS "completedAt",a.score AS "scoreEarned",
   a.total_questions AS "scoreTotal",a.content_version_id AS "versionId",p.title,p.passage_no AS "passageNo"
   FROM reading_attempts a LEFT JOIN reading_passages p ON p.id=a.passage_id WHERE a.user_id=$1 ORDER BY a.started_at DESC LIMIT $2''',
 'listening':'''SELECT a.id,a.status,a.started_at AS "occurredAt",a.submitted_at AS "completedAt",a.score AS "scoreEarned",
   a.total_questions AS "scoreTotal",a.content_version_id AS "versionId",t.title
   FROM listening_attempts a LEFT JOIN listening_tests t ON t.id=a.test_id WHERE a.user_id=$1 ORDER BY a.started_at DESC LIMIT $2''',
 'writing':'''SELECT a.id,a.status,a.updated_at AS "occurredAt",a.submitted_at AS "completedAt",
  a.word_count AS "wordCount",a.content_version_id AS "versionId",p.prompt AS title
  FROM writing_submissions a LEFT JOIN writing_prompts p ON p.id=a.prompt_id
  WHERE a.user_id=$1 ORDER BY a.updated_at DESC LIMIT $2''',
 'speaking':'''SELECT a.id,a.status,a.started_at AS "occurredAt",a.submitted_at AS "completedAt",
  a.recording_duration_ms AS "durationMs",a.recording_object_key AS "recordingKey",a.content_version_id AS "versionId",
  a.part,p.topic,p.prompt_text AS "promptText" FROM speaking_attempts a
  LEFT JOIN speaking_prompts p ON p.id=a.prompt_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT $2''',
 'grammar':'''SELECT a.id,a.activity AS status,a.is_correct AS "isCorrect",a.attempted_at AS "occurredAt",
  a.attempted_at AS "completedAt",a.content_version_id AS "versionId",e.topic_id AS "topicId",t.title AS "topicTitle",
  e.prompt_text AS prompt FROM grammar_attempts a LEFT JOIN grammar_exercises e ON e.id=a.exercise_id
  LEFT JOIN grammar_topics t ON t.id=e.topic_id WHERE a.user_id=$1 ORDER BY a.attempted_at DESC LIMIT $2''',
 'mock':'''SELECT a.id,a.status,a.started_at AS "occurredAt",a.finished_at AS "completedAt",a.raw_score AS "scoreEarned",
  a.estimated_band AS band,a.mock_snapshot AS snapshot,a.content_version_bindings AS bindings,t.title
  FROM mock_attempts a LEFT JOIN mock_tests t ON t.id=a.mock_test_id WHERE a.user_id=$1 ORDER BY a.started_at DESC LIMIT $2''',
 'assignment':'''SELECT a.id,a.updated_at AS "occurredAt",t.completed_at AS "completedAt",t.status,
  x.id AS "assignmentId",x.title,x.module,x.content_type AS "contentType",x.source_ref AS "sourceRef",
  x.content_version_id AS "versionId" FROM assignment_responses a
  LEFT JOIN assignments x ON x.id=a.assignment_id
  LEFT JOIN assignment_targets t ON t.assignment_id=a.assignment_id AND t.student_user_id=a.user_id
  WHERE a.user_id=$1 ORDER BY a.updated_at DESC LIMIT $2'''
}

def title(value,default):
    if not value:return default
    s=re.sub(r'\s+',' ',str(value).strip())
    return s[:119]+'…' if len(s)>120 else s

def asdate(value):
    if value is None:return None
    if isinstance(value,str):
        try:return datetime.fromisoformat(value.replace('Z','+00:00'))
        except ValueError:return None
    return value

def build(kind,row):
    d=row_to_dict(row)
    refid=d['id'];version=d.get('versionId')
    ref={'reading':'reading_attempts','listening':'listening_attempts','writing':'writing_submissions','speaking':'speaking_attempts',
         'grammar':'grammar_attempts','mock':'mock_attempts','assignment':'assignment_responses'}[kind]
    href={'reading':f'/app/reading/attempts/{refid}','listening':f'/app/listening/attempts/{refid}',
          'writing':f'/app/writing/submissions/{refid}','speaking':'/app/speaking/history','grammar':f'/app/grammar/{d["topicId"]}' if d.get('topicId') else '/app/grammar',
          'mock':'/app/mocks','assignment':'/app/assignments'}[kind]
    caption={'reading': d.get('title') or ('Reading passage '+str(d.get('passageNo')) if d.get('passageNo') else 'Reading'),
          'listening':d.get('title') or 'Listening','writing':title(d.get('title'),'Writing'),
          'speaking':title(d.get('topic') or d.get('promptText'),('Speaking part '+str(d.get('part'))) if d.get('part') else 'Speaking'),
          'grammar':d.get('topicTitle') or d.get('prompt') or 'Grammar',
          'mock':(d.get('snapshot') or {}).get('title') or d.get('title') or 'Mock test',
          'assignment':d.get('title') or 'Assignment'}[kind]
    binding=version
    if kind=='mock':
        candidates=[v for v in (d.get('bindings') or {}).values() if isinstance(v,str) and v]
        binding=candidates[0] if candidates else None
    content=({'versionId':binding,'versionNo':None,'module':kind,'contentType':None,'sourceRef':None} if binding else None)
    if kind=='assignment' and d.get('module') and d.get('contentType') and d.get('sourceRef'):
        content={'versionId':version,'versionNo':None,'module':d['module'],'contentType':d['contentType'],'sourceRef':d['sourceRef']}
    facts={'status':d.get('status') or ('answered' if kind=='grammar' else 'submitted' if kind=='assignment' else ''),
          'scoreEarned':d.get('scoreEarned'),'scoreTotal':d.get('scoreTotal'),'band':d.get('band'),
          'wordCount':d.get('wordCount'),'durationMs':d.get('durationMs'),
          'hasRecording':bool(d.get('recordingKey')) if kind=='speaking' else None,
          'isCorrect':d.get('isCorrect')}
    return {'kind':kind,'reference':{'table':ref,'id':refid},'occurredAt':d.get('occurredAt') or '1970-01-01T00:00:00.000Z',
            'completedAt':d.get('completedAt'),'title':caption,'href':href,'content':content,
            'facts':facts,'assignmentId':d.get('assignmentId') if kind=='assignment' else None}

@router.get('/api/history')
async def history(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    p=req.query_params
    if p.get('userId') and p['userId']!=str(u['id']):return core.j({'error':'forbidden'},403)
    raw=p.get('limit');limit=min(int(raw),200) if raw and re.fullmatch(r'\d+',raw) else 50
    limit=max(1,limit)
    kinds=list(dict.fromkeys([k.strip() for k in p['kinds'].split(',') if k.strip() in KINDS])) if 'kinds' in p else list(KINDS)
    if not kinds:kinds=list(KINDS)
    def parsedate(key):
        try:return datetime.fromisoformat(p[key].replace('Z','+00:00')).astimezone(timezone.utc) if p.get(key) else None
        except (ValueError,TypeError):return None
    frm=parsedate('from');to=parsedate('to')
    errors=[];entries=[]
    db=await core.pool()
    async with db.acquire() as con:
        for k in kinds:
            try:
                rows=await con.fetch(SQL[k],u['id'],limit)
                for r in rows:
                    at=asdate(r['occurredAt'])
                    if at is not None and (frm is None or at>=frm) and (to is None or at<=to):entries.append(build(k,r))
            except Exception:errors.append(k)
        ids=[e['content']['versionId'] for e in entries if e['content'] and e['content']['versionId']]
        if ids:
            try:
                versions=await con.fetch('''SELECT id,module,content_type AS "contentType",source_ref AS "sourceRef",version_no AS "versionNo"
                  FROM content_versions WHERE id=ANY($1::uuid[])''',list(dict.fromkeys(ids)))
                by={str(v['id']):row_to_dict(v) for v in versions}
                for item in entries:
                    old=item['content']
                    if old and old['versionId'] in by:
                        v=by[old['versionId']]
                        item['content']={'versionId':v['id'],'versionNo':v['versionNo'],
                           'module':v['module'],'contentType':v['contentType'],'sourceRef':v['sourceRef']}
            except Exception:pass
    entries.sort(key=lambda item:(item['occurredAt'],item['reference']['id']),reverse=True)
    return core.j({'ok':True,'entries':entries[:limit],'unavailable':errors},headers=PRIVATE)

def install():core.app.include_router(router)
