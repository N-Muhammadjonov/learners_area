"""Optional legacy source inventory. Real Exam test content and graph bytes have been removed.

Content must also be currently published in PostgreSQL. This inventory is not
an alternate publication or authorization mechanism.
"""
import hashlib
import json
from pathlib import Path
from uuid import UUID

DATA=json.loads(Path(__file__).with_suffix('.json').read_text())
PROMPTS={p['id']:p for p in DATA['prompts']}
FULL_TESTS={t['code']:t for t in DATA['fullTests']}
GRAPHS={p['image']['objectKey']:p['image'] for p in DATA['prompts'] if p.get('image')}
GRAPH_DIRECTORY=Path(__file__).resolve().parents[1]/'assets/writing/source-materials-graphs'

def source_prompt(row):
    p=PROMPTS.get(str(row['id']))
    if p and row.get('source_ref')==p['sourceRef'] and row.get('prompt')==p['prompt'] and row.get('task_type')==p['taskType']:
        return p
    return None

def metadata_for_prompt(row):
    p=source_prompt(dict(row)) if row else None
    return p['practice'] if p else None

async def live_inventory(con):
    rows=await con.fetch('''SELECT p.id,p.task_type,p.prompt,p.source_ref FROM writing_prompts p
      WHERE p.id=ANY($1::uuid[]) AND p.is_active AND
      (p.publication_state='published' OR (p.publication_state='scheduled' AND p.publish_at<=NOW()))
      AND NOT EXISTS (SELECT 1 FROM activity_events e
        WHERE e.id=md5('deleted-content:' || p.id::text)::uuid AND e.type='CONTENT_DELETED')''',
      [UUID(id) for id in PROMPTS])
    return {str(r['id']):p for r in rows if (p:=source_prompt(dict(r)))}

def catalogue(inventory):
    return {'fullTests':[t for t in DATA['fullTests'] if t['ready'] and all(id in inventory for id in t['promptIds'])],
      'task1':[{'id':p['id'],'title':p['practice']['title']} for p in DATA['prompts'] if p['taskType']=='task1' and p['id'] in inventory],
      'task2':[{'id':p['id'],'title':p['practice']['title']} for p in DATA['prompts'] if p['taskType']=='task2' and p['id'] in inventory]}

def graph_bytes(key):
    image=GRAPHS.get(key)
    if not image:return None
    data=(GRAPH_DIRECTORY/image['archiveEntry']).read_bytes()
    if len(data)!=image['size'] or hashlib.sha256(data).hexdigest()!=image['sha256']:
        raise ValueError('writing_graph_integrity')
    return data
