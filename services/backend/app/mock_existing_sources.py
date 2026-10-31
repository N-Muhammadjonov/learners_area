"""Published Exam Mode sources for immutable Mock material bindings.

Catalogue is deliberately limited to full Listening tests, Academic Reading sets,
and the same published Writing prompts shown in the Writing Exam picker.
"""
import json
import uuid

from .browser_common import live
from .browser_listening import NOT_DELETED, PRODUCT_SQL
from .browser_reading import academic_question_count
from .step17_mcq_port import available_set
from .step21_academic_start_port import eligible
from .writing_exam_bank import catalogue as writing_exam_catalogue


def _plain(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _payload(value):
    if isinstance(value, str):
        return json.loads(value)
    return value if isinstance(value, dict) else {}


def _has_audio(row, package):
    audio = package.get('audio') if isinstance(package.get('audio'), dict) else {}
    key = row.get('audio_object_key')
    return (row.get('audio_url') or package.get('audioUrl') or audio.get('url')
            or (('/api/resources/' + key) if isinstance(key, str) and key else None))


async def existing_catalogue(con):
    # The Academic full-test product excludes MCQ programmes, exercise formats,
    # General sections, script completion, and other activity-only records.
    listening = await con.fetch(f"""
        SELECT t.id,t.title FROM listening_tests t
        JOIN listening_packages p ON p.test_id=t.id
        WHERE {live('t')} AND {NOT_DELETED}
          AND ({PRODUCT_SQL})='academic_full_test'
          AND CASE WHEN jsonb_typeof(p.payload->'questions')='array'
                   THEN jsonb_array_length(p.payload->'questions') ELSE 0 END=40
          AND CASE WHEN jsonb_typeof(p.payload->'sections')='array'
                   THEN jsonb_array_length(p.payload->'sections') ELSE 0 END=4
          AND COALESCE(NULLIF(t.audio_url,''),NULLIF(p.payload->>'audioUrl',''),
                       NULLIF(p.payload->'audio'->>'url',''),NULLIF(p.audio_object_key,'')) IS NOT NULL
        ORDER BY t.source_ref,t.id LIMIT 300
    """)
    # These are the exact Academic Exam set sources; General Reading's practice
    # materials are not consulted. The existing 41->40 exception is retained.
    reading = await con.fetch(f"""
        SELECT s.id,s.title FROM general_reading_sets s
        WHERE {live('s')}
          AND (SELECT COUNT(*) FROM general_reading_passages g WHERE g.set_id=s.id)=3
          AND NOT EXISTS (
             SELECT 1 FROM general_reading_passages g
             JOIN reading_passages p ON p.id=g.passage_id
             WHERE g.set_id=s.id AND (g.passage_no NOT IN (1,2,3) OR
                 NOT ({live('p')}) OR
                 NOT EXISTS(SELECT 1 FROM reading_questions q WHERE q.passage_id=p.id))
          )
          AND {academic_question_count()}
          AND NOT EXISTS (SELECT 1 FROM activity_events d WHERE
              d.id=md5('deleted-content:'||s.id::text)::uuid AND d.type='CONTENT_DELETED')
        ORDER BY s.created_at,s.id LIMIT 300
    """)
    writing_rows = await con.fetch(f"""
        SELECT p.id,p.task_type,p.category,p.prompt,p.source_ref FROM writing_prompts p
        WHERE p.is_active AND {live('p')}
          AND NOT EXISTS(SELECT 1 FROM activity_events e WHERE
              e.id=md5('deleted-content:'||p.id::text)::uuid AND e.type='CONTENT_DELETED')
        ORDER BY p.created_at DESC,p.id LIMIT 2000
    """)
    exam = writing_exam_catalogue(writing_rows)
    return {
        'listening': [{'id': str(r['id']), 'title': r['title']} for r in listening],
        'reading': [{'id': str(r['id']), 'title': r['title']} for r in reading],
        'writingTask1': [{'id': q['id'], 'title': q['title']}
                         for q in exam['questions'] if q['taskType']=='task1'],
        'writingTask2': [{'id': q['id'], 'title': q['title']}
                         for q in exam['questions'] if q['taskType']=='task2'],
    }


async def source_snapshot(con, slot: str, source_id: uuid.UUID):
    """Read only published, canonical content and freeze its actual answer keys."""
    from . import mock_system_port as mock
    if slot == 'listening':
        row = await con.fetchrow(f"""
            SELECT t.id,t.title,t.audio_url,p.payload,p.audio_object_key,
                   ({PRODUCT_SQL}) AS product
            FROM listening_tests t JOIN listening_packages p ON p.test_id=t.id
            WHERE t.id=$1 AND {live('t')} AND {NOT_DELETED}
        """, source_id)
        if not row or row['product']!='academic_full_test':
            return None
        package = _payload(row['payload'])
        if len(package.get('sections') or [])!=4 or len(package.get('questions') or [])!=40:
            return None
        audio = _has_audio(dict(row), package)
        if not audio:
            return None
        selected = await available_set(con, source_id)
        if len(selected)!=40:
            return None
        raw_questions = await con.fetch("""
            SELECT id,"order",question_text,type,type_code,options,correct_answer,explanation
            FROM listening_questions WHERE test_id=$1 ORDER BY "order",id
        """, source_id)
        questions = []
        for q in raw_questions:
            if str(q['id']) not in selected:
                continue
            questions.append({'id':str(q['id']), 'order':q['order'],
                'questionText':q['question_text'], 'type':q['type'],
                'typeCode':q['type_code'], 'options':q['options'],
                'correctAnswer':q['correct_answer'], 'explanation':q['explanation']})
        if len(questions)!=40 or len({q['id'] for q in questions})!=40:
            return None
        if any(not q['questionText'] or not mock._question_has_answer_key(q) for q in questions):
            return None
        return _plain({'title':row['title'], 'audioUrl':audio,
            'questions':questions, 'mockMaterialSlot':slot})

    if slot == 'reading':
        row = await con.fetchrow(f"""
            SELECT s.* FROM general_reading_sets s WHERE s.id=$1 AND {live('s')}
            AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE
                d.id=md5('deleted-content:'||s.id::text)::uuid AND d.type='CONTENT_DELETED')
        """, source_id)
        if not row:
            return None
        membership = await eligible(con, row)
        if not membership:
            return None
        slots, selected = membership
        passages = await con.fetch("""
            SELECT id,title,body_text FROM reading_passages WHERE id=ANY($1::uuid[])
        """, [s['passage_id'] for s in slots])
        lookup = {p['id']:p for p in passages}
        passage_data = [{'id':str(s['passage_id']), 'passageNo':s['passage_no'],
            'title':lookup[s['passage_id']]['title'],
            'bodyText':lookup[s['passage_id']]['body_text']} for s in slots if s['passage_id'] in lookup]
        if len(passage_data)!=3 or any(not p['bodyText'] for p in passage_data):
            return None
        qrows = await con.fetch("""
            SELECT id,"order",passage_id,question_text,type,type_code,options,correct_answer,
                   explanation FROM reading_questions WHERE id=ANY($1::uuid[])
        """, [q['id'] for q in selected])
        q_by_id = {q['id']:q for q in qrows}
        questions = []
        for m in selected:
            q = q_by_id.get(m['id'])
            if not q:
                return None
            questions.append({'id':str(q['id']), 'order':q['order'],
                'passageId':str(q['passage_id']), 'questionText':q['question_text'],
                'type':q['type'], 'typeCode':q['type_code'], 'options':q['options'],
                'correctAnswer':q['correct_answer'], 'explanation':q['explanation']})
        if len(questions)!=40 or any(not q['questionText'] or not mock._question_has_answer_key(q) for q in questions):
            return None
        return _plain({'title':row['title'], 'passages':passage_data,
            'questions':questions, 'mockMaterialSlot':slot})

    if slot in ('writingTask1','writingTask2'):
        task = 'task1' if slot=='writingTask1' else 'task2'
        row = await con.fetchrow(f"""
            SELECT p.id,p.task_type,p.category,p.prompt,p.target_word_count,p.source_ref
            FROM writing_prompts p WHERE p.id=$1 AND p.task_type=$2
              AND p.is_active AND {live('p')}
              AND NOT EXISTS(SELECT 1 FROM activity_events e WHERE
                  e.id=md5('deleted-content:'||p.id::text)::uuid AND e.type='CONTENT_DELETED')
        """, source_id, task)
        if not row or not str(row['prompt'] or '').strip():
            return None
        block = await con.fetchrow("""
            SELECT object_key FROM resource_blocks WHERE owner_type='writing'
             AND owner_id=$1 AND type='image' AND object_key IS NOT NULL
             ORDER BY position LIMIT 1
        """, source_id)
        image_key = block['object_key'] if block else None
        if not image_key and task=='task1':
            from .writing_exam_bank import PROMPTS as EXAM_PROMPTS
            from .writing_source_materials import PROMPTS as LEGACY_PROMPTS
            for bank in (EXAM_PROMPTS,LEGACY_PROMPTS):
                entry=bank.get(str(source_id))
                if entry and entry.get('sourceRef')==row['source_ref'] and entry.get('prompt')==row['prompt']:
                    image_key=(entry.get('image') or {}).get('objectKey')
                    if image_key: break
        return _plain({'title':str(row['prompt']).splitlines()[0],
            'promptId':str(row['id']), 'taskType':task,
            'category':row['category'], 'prompt':row['prompt'],
            'targetWordCount':row['target_word_count'],
            'mediaObjectKey':image_key, 'mockMaterialSlot':slot})
    return None
