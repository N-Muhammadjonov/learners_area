"""Metadata for the supplied study collection, never an alternate content store.

Essays and patterns must be live database records. Metadata attaches only to
the matching source identity; the seven-stage model reveal remains unchanged.
"""
import json
from pathlib import Path

DATA=json.loads(Path(__file__).with_suffix('.json').read_text())
MODELS={m['id']:m for m in DATA['models']}

def metadata_for_model(row):
    if not row:return None
    r=dict(row);m=MODELS.get(str(r['id']))
    if not m or r.get('source_ref')!=m['sourceRef'] or r.get('title')!=m['title']:
        return None
    if r.get('task_type')!=m['taskType'] or r.get('topic')!=m['topic'] or float(r.get('target_band') or 0)!=m['targetBand']:
        return None
    if 'body' in r and r['body']!=m['body']:return None
    return {'estimatedBand':True,'sourceNumber':m['number'],'prompt':m['prompt'],'promptSource':m['promptSource'],
      'promptSourceUrl':m['promptSourceUrl'],'feedback':m['feedback']}

def collection_info():
    return {'method':DATA['method'],'notice':DATA['notice']}
