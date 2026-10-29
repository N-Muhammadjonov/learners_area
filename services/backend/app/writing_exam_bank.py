"""Metadata and byte-exact visuals for the owner's 29 October Writing import.

PostgreSQL publication and the existing resource authorization remain authoritative.
"""
import hashlib
import json
from pathlib import Path

DATA = json.loads(Path(__file__).with_suffix('.json').read_text())
PROMPTS = {p['id']: p for p in DATA['prompts']}
GRAPHS = {p['image']['objectKey']: p['image'] for p in DATA['prompts'] if p.get('image')}
DIRECTORY = Path(__file__).resolve().parents[1] / 'assets/writing/exam-bank'


def graph_bytes(key):
    image = GRAPHS.get(key)
    if image is None:
        return None
    data = (DIRECTORY / image['archiveEntry']).read_bytes()
    if len(data) != image['size'] or hashlib.sha256(data).hexdigest() != image['sha256']:
        raise ValueError('writing_exam_graph_integrity')
    return data


def catalogue(rows):
    questions = []
    for row in rows:
        row = dict(row)
        item = PROMPTS.get(str(row['id']))
        metadata = item if item and item['sourceRef'] == row.get('source_ref') and item['prompt'] == row['prompt'] else {}
        questions.append({
            'id': str(row['id']), 'taskType': row['task_type'], 'category': row['category'],
            'prompt': row['prompt'], 'title': metadata.get('title') or row['prompt'].split('\n')[0],
            'code': metadata.get('code'), 'isNew': metadata.get('isNew', False),
            'sourceDate': metadata.get('sourceDate'), 'dateDetail': metadata.get('dateDetail'),
            'addedDate': metadata.get('addedDate'), 'sourceOrder': metadata.get('sourceOrder', 100000),
            'image': {'objectKey': metadata['image']['objectKey'], 'name': metadata['image']['originalName']}
                     if metadata.get('image') else None,
        })
    questions.sort(key=lambda p: (not p['isNew'], p['sourceOrder'], p['id']))
    by_key = {PROMPTS[p['id']]['sourceKey']: p for p in questions if p['id'] in PROMPTS}
    pairs = []
    for key, p in by_key.items():
        if p['taskType'] != 'task1':
            continue
        partner = by_key.get(key[:-1] + '2')
        if partner:
            pairs.append({'code': p['code'], 'title': p['code'] + ' · Task 1 + Task 2',
                          'promptIds': [p['id'], partner['id']]})
    return {'questions': questions, 'questionTypes': DATA['types'], 'fullTests': pairs}
