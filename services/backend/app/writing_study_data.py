"""Learner-owned writing annotations and extra chunks in existing private event records."""
import hashlib
import json
from uuid import UUID, uuid5, NAMESPACE_URL

STUDY='WRITING_STEALING_STUDY'
PERSONAL='WRITING_PERSONAL_PATTERN'

def decoded(value):
    return json.loads(value) if isinstance(value,str) else dict(value or {})

def study_id(user_id,model_id):
    return uuid5(NAMESPACE_URL,f'learners-area:writing-study:{user_id}:{model_id}')

def source_hash(text):return hashlib.sha256(text.encode()).hexdigest()

def usage_uz(note):
    if note=='Adapt this chunk to a different topic. Copy the chunk, not the whole example sentence.':
        return 'Bu iborani boshqa mavzuga moslab ishlating. Butun misol gapni emas, faqat iboraning o‘zini oling.'
    return None

async def personal_patterns(con,user_id,model_id=None):
    rows=await con.fetch("""SELECT e.id,e.payload,m.title source_title,m.task_type,m.topic
      FROM activity_events e JOIN writing_model_texts m ON m.id::text=e.payload->>'modelId'
      WHERE e.user_id=$1 AND e.type='WRITING_PERSONAL_PATTERN'
      AND ($2::text IS NULL OR m.id::text=$2)
      AND (m.publication_state='published' OR (m.publication_state='scheduled' AND m.publish_at<=NOW()))
      AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||m.id::text)::uuid AND d.type='CONTENT_DELETED')
      ORDER BY e.created_at,e.id LIMIT 1000""",user_id,str(model_id) if model_id else None)
    result=[]
    for row in rows:
        data=decoded(row['payload'])
        result.append({'id':str(row['id']),'pattern':data['pattern'],'fn':'sentence_frame',
          'taskType':row['task_type'],'topic':row['topic'],'targetBand':None,
          'example':data.get('example',''),'usageNote':data.get('usageNote',''),
          'usageNoteUz':data.get('usageNote',''),'sourceId':data['modelId'],
          'sourceTitle':row['source_title'],'personal':True,'saved':True})
    return result

async def session_source(con,user_id,session_id):
    return await con.fetchrow("""SELECT s.id,s.step,s.completed_at,s.model_text_id,m.title,m.body,m.task_type,m.topic
      FROM writing_stealing_sessions s JOIN writing_model_texts m ON m.id=s.model_text_id
      WHERE s.id=$1 AND s.user_id=$2
      AND (m.publication_state='published' OR (m.publication_state='scheduled' AND m.publish_at<=NOW()))
      AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||m.id::text)::uuid AND d.type='CONTENT_DELETED')""",UUID(str(session_id)),user_id)
