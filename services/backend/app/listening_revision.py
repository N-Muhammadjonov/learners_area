"""Pinned Listening keys and prompts; legacy drift is held instead of misgraded."""
import json,re
from fastapi import HTTPException

def plain(value):return json.loads(value) if isinstance(value,str) else value
def normal(value):return re.sub(r'\s+',' ',str(value or '').strip().lower())

async def revision_package(con,attempt,current=None):
    if not attempt.get('content_version_id'):return current
    row=await con.fetchrow("SELECT content_snapshot,target_id FROM content_versions WHERE id=$1 AND module='listening'",attempt['content_version_id'])
    data=plain(row['content_snapshot']) if row else None
    if not isinstance(data,dict) or not isinstance(data.get('questions'),list) or row['target_id'] is not None and str(row['target_id'])!=str(attempt['test_id']):
        raise HTTPException(409,'content_revision_unavailable')
    return data

def revision_rows(package,rows):
    source={q.get('number'):q for q in package['questions'] if isinstance(q,dict)}
    if len(source)!=len(package['questions']) or len(source)!=len(rows):raise HTTPException(409,'content_revision_unavailable')
    result=[]
    for row in rows:
        q=source.get(row['order']);key=q.get('key') if q else None
        if not q or not isinstance(key,str) or not key.strip() or normal(q.get('text'))!=normal(row['question_text']):raise HTTPException(409,'content_revision_unavailable')
        choices=q.get('options') or []
        allowed=[key,*q.get('alternatives',[])]
        allowed.extend(option for option in choices if any(re.match(r'^'+re.escape(str(k))+r'(?:\s|[).])',option,re.I) for k in allowed.copy()))
        if normal(row['correct_answer']) not in {normal(v) for v in allowed}:raise HTTPException(409,'content_revision_unavailable')
        explanation=(q.get('evidence') or {}).get('why')
        result.append({**dict(row),'question_text':q['text'],'correct_answer':row['correct_answer'],
                       'explanation':explanation if isinstance(explanation,str) and explanation.strip() else row.get('explanation')})
    return result
