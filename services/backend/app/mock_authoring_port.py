"""Role-gated, non-destructive Weekly IELTS Mock authoring.

A mock binds existing published content versions, never fabricates assessments.
Teacher can edit only own unpublished drafts; Owner can edit all drafts.
Publication is blocked until the existing runner's integrity validator accepts all five materials.
"""
from __future__ import annotations

import uuid
import json
import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from starlette.datastructures import UploadFile
from fastapi.responses import Response

router = APIRouter()

# Writing uses two version bindings, but only one scored Writing skill.
SLOTS = (
    ('listening', 'listening', None, 40, 1800),
    ('reading', 'reading', None, 40, 3600),
    ('writingTask1', 'writing', 'task1', None, 1200),
    ('writingTask2', 'writing', 'task2', None, 2400),
    ('speaking', 'speaking', None, None, 840),
)
SLOT_BY_KEY = {key: (skill, subtype, count, seconds) for key, skill, subtype, count, seconds in SLOTS}


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except (ValueError, TypeError, AttributeError):
        return None


def _eligible_version(row: dict, skill: str, subtype: str | None, track: str) -> bool:
    if row['publication_state'] != 'published' or row['module'] != 'mock' or not row['content_snapshot']:
        return False
    if row['content_type'] != (subtype or skill):
        return False
    return not row['track'] or row['track'] in (track, 'unspecified')


async def _session(req):
    from . import mock_system_port as mock
    user = await mock._auth_user(req)
    return user, mock._require_teacher_or_owner(user)


@router.get('/api/staff/mocks/authoring')
async def authoring_index(req: Request):
    from . import main as core
    from . import mock_system_port as mock
    user, err = await _session(req)
    if err:
        return err
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch(
            """SELECT t.id, t.title, t.track, t.kind, t.publication_state, t.version,
                      t.created_by_user_id, t.updated_at
               FROM mock_tests t JOIN courses c ON c.id = t.course_id
               WHERE c.slug = 'ielts' AND ($1::bool OR t.created_by_user_id = $2)
               ORDER BY t.updated_at DESC LIMIT 100""",
            user['role'] == 'owner', user['id'],
        )
        ids = [r['id'] for r in rows]
        sections = await con.fetch(
            """SELECT mock_test_id, position, skill, content_type, content_version_id
               FROM mock_sections WHERE mock_test_id = ANY($1::uuid[]) ORDER BY position""", ids,
        ) if ids else []
        # Only dedicated Mock uploads. Never mix practice MCQ, Reading or Writing banks.
        versions = await con.fetch(
            """SELECT id, title, module, content_type, track, source_ref, version_no
               FROM content_versions
               WHERE ($1::bool OR created_by_user_id=$2) AND module = 'mock' AND publication_state = 'published'
                 AND content_snapshot IS NOT NULL
                 AND content_type IN ('listening','reading','task1','task2','speaking')
               ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 500""",
            user['role']=='owner', user['id']
        )
        # Speaking bank is independent of content_versions and is grouped by topic.
        speaking_rows = await con.fetch(
            """SELECT part::text AS part, topic, COUNT(*)::int AS question_count
                FROM speaking_prompts
                WHERE is_active = TRUE AND part::text IN ('part1','part2','part3','1','2','3')
                GROUP BY part, topic ORDER BY part, topic LIMIT 3000"""
        )
        speaking_ids=[s['content_version_id'] for s in sections if s['skill']=='speaking' and s['content_version_id']]
        speaking_details=await con.fetch('SELECT id, content_snapshot FROM content_versions WHERE id=ANY($1::uuid[])',speaking_ids) if speaking_ids else []
    speaking_snapshots={str(r['id']): (r['content_snapshot'] if isinstance(r['content_snapshot'],dict) else json.loads(r['content_snapshot'] or '{}')) for r in speaking_details}
    speaking_topic_map={vid: snap.get('speakingTopics',{}) for vid,snap in speaking_snapshots.items()}
    speaking_mode_map={vid: ('auto' if snap.get('speakingMode')=='auto' else 'fixed') for vid,snap in speaking_snapshots.items()}
    by_test: dict[str, dict[str, str]] = {}
    for s in sections:
        key = 'writingTask1' if s['skill'] == 'writing' and s['content_type'] == 'task1' else (
            'writingTask2' if s['skill'] == 'writing' and s['content_type'] == 'task2' else s['skill'])
        if key in SLOT_BY_KEY and s['content_version_id']:
            by_test.setdefault(str(s['mock_test_id']), {})[key] = str(s['content_version_id'])
    return core.j({'ok': True,
        'tests': [{'id': str(t['id']), 'title': t['title'], 'track': t['track'],
                   'status': t['publication_state'], 'version': t['version'],
                   'sections': by_test.get(str(t['id']), {}),
                   'speakingTopics': speaking_topic_map.get(by_test.get(str(t['id']), {}).get('speaking',''), {}),
                   'speakingMode': speaking_mode_map.get(by_test.get(str(t['id']), {}).get('speaking',''), 'fixed')} for t in rows],
        'versions': [{'id': str(v['id']), 'title': v['title'], 'module': v['module'],
                      'contentType': v['content_type'], 'track': v['track'] or 'unspecified',
                      'version': v['version_no']} for v in versions],
        'speakingTopics': [{'part': 'P' + str(row['part']).replace('part',''),
                            'topic': row['topic'], 'count': row['question_count']}
                           for row in speaking_rows],
    }, headers=mock.PRIVATE_HEADERS)


MAX_MOCK_DOCUMENT_BYTES = 3 * 1024 * 1024
MAX_MOCK_MEDIA_BYTES = 45 * 1024 * 1024
MOCK_MATERIAL_TYPES = {'listening': 'listening', 'reading': 'reading',
                       'writingTask1': 'task1', 'writingTask2': 'task2'}


def _content_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str,
                                      separators=(',', ':')).encode()).hexdigest()


def _validate_material_payload(slot: str, payload: dict, has_media: bool) -> tuple[str | None, str | None]:
    if not isinstance(payload, dict):
        return 'invalid_document', 'JSON must be an object.'
    if slot in ('listening','reading'):
        qs = payload.get('questions')
        if not isinstance(qs, list) or len(qs) != 40:
            return 'invalid_question_count', 'Exactly 40 genuine questions are required.'
        ids = [q.get('id') for q in qs if isinstance(q, dict)]
        if len(ids) != 40 or len(set(map(str,ids))) != 40:
            return 'invalid_question_ids', '40 unique question IDs are required.'
        from .mock_system_port import _question_has_answer_key
        if any(not isinstance(q,dict) or not (q.get('questionText') or q.get('question_text')) or
               not _question_has_answer_key(q) for q in qs):
            return 'missing_keys', 'Each question needs prompt text and an official answer key.'
    if slot == 'listening' and not has_media:
        return 'missing_audio', 'Upload the actual Listening recording with the JSON.'
    if slot == 'reading':
        ps=payload.get('passages')
        if not isinstance(ps,list) or not ps or any(not isinstance(x,dict) or not
            str(x.get('bodyText') or x.get('body_text') or '').strip() for x in ps):
            return 'missing_passages', 'Reading JSON must contain genuine passages with bodyText.'
    if slot.startswith('writing') and not str(payload.get('prompt') or '').strip():
        return 'missing_prompt', 'Writing material needs a real prompt.'
    if slot == 'writingTask1' and not has_media:
        return 'missing_task1_visual', 'Upload the Task 1 image, or include an authorized image reference.'
    return None, None


async def _insert_mock_version(con, *, vid, title, track, content_type, user_id, payload):
    digest=_content_hash(payload)
    # Version is an immutable, private mock material snapshot. No general practice
    # bank receives the uploaded material or its answer keys.
    await con.execute("""INSERT INTO content_versions
       (id, module, content_type, source_ref, version_no, status, title, track,
        content_hash, semantic_hash, answer_key_hash, publication_state,
        created_by_user_id, change_kind, provenance, published_at, content_snapshot)
       VALUES ($1, 'mock', $2, $3, 1, 'published', $4, $5, $6, $6, $6,
               'published', $7, 'created', $8::jsonb, NOW(), $9::jsonb)""",
       vid, content_type, 'mock-upload:'+str(vid), title, track, digest, user_id,
       json.dumps({'origin':'mock_authoring','dedicated':True}),
       json.dumps(payload,ensure_ascii=False))


@router.post('/api/staff/mocks/materials')
async def upload_mock_material(req: Request):
    from . import main as core, mock_system_port as mock
    user, err = await _session(req)
    if err: return err
    try:
        form=await req.form(max_files=2,max_fields=5,max_part_size=MAX_MOCK_DOCUMENT_BYTES)
    except Exception:
        return mock._err('invalid_upload', 'Expected a JSON material and optional audio/image.', 422)
    slot=str(form.get('slot') or '')
    track=str(form.get('track') or '')
    title=str(form.get('title') or '').strip()
    doc=form.get('material')
    media=form.get('media')
    if slot not in MOCK_MATERIAL_TYPES or track not in ('academic','general') or not 3 <= len(title) <= 160:
        return mock._err('invalid_material_details', 'Choose valid section, track and title.', 422)
    if not isinstance(doc,UploadFile):
        return mock._err('missing_material', 'A structured .json document is required.', 422)
    raw=await doc.read(MAX_MOCK_DOCUMENT_BYTES+1)
    if len(raw)>MAX_MOCK_DOCUMENT_BYTES:
        return mock._err('material_too_large', 'JSON document exceeds 3 MB.', 413)
    try: payload=json.loads(raw.decode('utf-8'))
    except (ValueError,UnicodeError): return mock._err('invalid_json', 'Material must contain valid UTF-8 JSON.', 422)
    has_media=isinstance(media,UploadFile) and bool(media.filename)
    if isinstance(payload,dict):
        # Never trust media references or object keys embedded in imported JSON.
        for key in ('audioUrl','audio_url','mediaRef','mediaObjectKey','mediaSha256','mediaMimeType'):
            payload.pop(key,None)
    problem,description=_validate_material_payload(slot,payload,has_media)
    if problem: return mock._err(problem,description,422)
    if has_media and slot not in ('listening','writingTask1'):
        return mock._err('unexpected_media','Only Listening audio and Task 1 images can be attached.',422)
    vid=uuid.uuid4()
    upload_data=None
    if has_media:
        mime=(media.content_type or '').split(';')[0].lower().strip()
        allowed=('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/mp3','audio/x-m4a','audio/wav','audio/x-wav','audio/aac') if slot=='listening' else ('image/png','image/jpeg')
        if mime not in allowed: return mock._err('invalid_media_type','Only supported real audio or PNG/JPEG files are accepted.',422)
        upload_data=await media.read(MAX_MOCK_MEDIA_BYTES+1)
        if len(upload_data)>MAX_MOCK_MEDIA_BYTES or len(upload_data)<64:
            return mock._err('invalid_media_size', 'Media must be 64 bytes to 45 MB.',413)
        if slot=='listening':
            if mock._verify_audio_magic(upload_data,mime):
                return mock._err('invalid_audio','Recording header does not match a recognized audio container.',422)
        elif not (upload_data.startswith(b'\x89PNG\r\n\x1a\n') if mime=='image/png' else upload_data.startswith(b'\xff\xd8\xff')):
            return mock._err('invalid_image','Unsupported image binary.',422)
        ext={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/mp3':'mp3','audio/x-m4a':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/aac':'aac','image/png':'png','image/jpeg':'jpg'}[mime]
        key=f'mock/materials/{vid}/{slot}.{ext}'
        payload['mediaObjectKey']=key
        payload['mediaSha256']=hashlib.sha256(upload_data).hexdigest()
        payload['mediaMimeType']=mime
        if slot=='listening': payload['audioUrl']=f'/api/mocks/media/{vid}'
        else: payload['mediaRef']=f'/api/mocks/media/{vid}'
    payload['mockMaterialSlot']=slot
    payload['track']=track
    if slot.startswith('writing'): payload['taskType']=MOCK_MATERIAL_TYPES[slot]
    # Persist bytes first. A database failure leaves an unreferenced, nonpublic
    # object only; never creates a published version with missing media.
    if upload_data is not None:
        try: await mock._write_storage_object(payload['mediaObjectKey'],upload_data,payload['mediaMimeType'])
        except Exception: return mock._err('storage_unavailable','Media upload failed; no material was published.',503)
    db=await core.pool()
    async with db.acquire() as con:
        await _insert_mock_version(con,vid=vid,title=title,track=track,
                                   content_type=MOCK_MATERIAL_TYPES[slot],user_id=user['id'],payload=payload)
    return core.j({'ok':True,'id':str(vid),'slot':slot,'title':title},headers=mock.PRIVATE_HEADERS)


@router.get('/api/mocks/media/{versionId}')
async def get_mock_material_media(req: Request, versionId: str):
    from . import main as core, mock_system_port as mock
    user=await mock._auth_user(req)
    if not user: return mock._err('unauthenticated','Sign in again.',401)
    vid=_uuid(versionId)
    if not vid: return mock._err('not_found','Media not found.',404)
    db=await core.pool()
    async with db.acquire() as con:
        row=await con.fetchrow("""SELECT content_snapshot FROM content_versions
         WHERE id=$1 AND module='mock' AND publication_state='published'""",vid)
    if not row: return mock._err('not_found','Media not found.',404)
    payload=row['content_snapshot']
    if isinstance(payload,str): payload=json.loads(payload)
    if not isinstance(payload,dict): return mock._err('not_found','Media not found.',404)
    key=payload.get('mediaObjectKey')
    if not isinstance(key,str) or not key.startswith(f'mock/materials/{vid}/'):
        return mock._err('not_found','Media not found.',404)
    try: raw=await mock.read_object(key)
    except Exception: return mock._err('storage_unavailable','Media unavailable.',503)
    if raw is None: return mock._err('not_found','Media not found.',404)
    if hashlib.sha256(raw).hexdigest()!=payload.get('mediaSha256'):
        return mock._err('media_corrupt','Media integrity check failed.',503)
    mime=payload.get('mediaMimeType','application/octet-stream')
    headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'}
    # Safari and other browsers may request byte ranges while playing long audio.
    requested=req.headers.get('range','')
    if requested.startswith('bytes='):
        m=re.fullmatch(r'bytes=(\d*)-(\d*)',requested)
        if not m or (not m.group(1) and not m.group(2)):
            return Response(status_code=416,headers={**headers,'Content-Range':f'bytes */{len(raw)}'})
        if not m.group(1):
            size=int(m.group(2));start=max(0,len(raw)-size);end=len(raw)-1
        else:
            start=int(m.group(1));end=int(m.group(2)) if m.group(2) else len(raw)-1
        if start>=len(raw) or end<start:
            return Response(status_code=416,headers={**headers,'Content-Range':f'bytes */{len(raw)}'})
        end=min(end,len(raw)-1)
        headers['Content-Range']=f'bytes {start}-{end}/{len(raw)}'
        return Response(content=raw[start:end+1],media_type=mime,status_code=206,headers=headers)
    return Response(content=raw,media_type=mime,headers=headers)


async def _speaking_version(con, user, topics: dict, track: str, title: str):
    if not isinstance(topics,dict) or any(not isinstance(topics.get(p),str) or not topics[p].strip() for p in ('P1','P2','P3')):
        return None
    parts=[]
    for part in ('P1','P2','P3'):
        part_no=part[-1]
        rows=await con.fetch("""SELECT id, part::text AS part, topic, prompt_text, cue_card
          FROM speaking_prompts WHERE is_active=TRUE
          AND part::text IN ($1,$2) AND topic=$3 ORDER BY id LIMIT 60""",
          'part'+part_no,part_no,topics[part])
        if not rows: return None
        for row in rows:
            parts.append({'part':part,'questionId':str(row['id']),'topic':row['topic'],
                          'promptText':row['prompt_text'],'cueCard':row['cue_card']})
    vid=uuid.uuid4()
    await _insert_mock_version(con,vid=vid,title=title+' — Speaking',track=track,
                               content_type='speaking',user_id=user['id'],
                               payload={'parts':parts,'speakingTopics':topics,'mockMaterialSlot':'speaking'})
    return vid


async def _auto_speaking_version(con, user, track: str, title: str):
    """Freeze published question bank and explicit Part2.follow_ups -> Part3 links.

    This is a server-side source pool. It is NEVER returned to students; each
    attempt receives only its chosen three-part questions in mock_snapshot.
    """
    rows = await con.fetch("""SELECT id, part::text AS part, topic, prompt_text,
                           cue_card, follow_ups, external_id FROM speaking_prompts
                           WHERE is_active=TRUE AND publication_state='published'
                             AND part::text IN ('part1','part2','part3','1','2','3')
                           ORDER BY part, topic, id""")
    def material(row, part):
        return {'part':part, 'questionId':str(row['id']), 'topic':row['topic'],
                'promptText':row['prompt_text'] or row['topic'], 'cueCard':row['cue_card']}
    p1_topics={}
    p3_by_text={}
    part2=[]
    for row in rows:
        part=str(row['part']).replace('part','')
        if part=='1' and row['topic'] and row['prompt_text']:
            p1_topics.setdefault(row['topic'],[]).append(material(row,'P1'))
        elif part=='2' and row['prompt_text']:
            part2.append(row)
        elif part=='3' and row['prompt_text']:
            group = str(row['external_id'] or '').split('-')
            if len(group) >= 4 and group[0]=='s166':
                p3_by_text.setdefault((group[1], str(row['prompt_text']).strip()), []).append(material(row,'P3'))
    pairs=[]
    for row in part2:
        group = str(row['external_id'] or '').split('-')
        if len(group) < 4 or group[0] != 's166':
            continue
        raw=row['follow_ups']
        followups=json.loads(raw) if isinstance(raw,str) else raw
        if not isinstance(followups,list):
            continue
        matched=[]
        seen=set()
        for text in followups:
            if not isinstance(text,str):continue
            for linked in p3_by_text.get((group[1], text.strip()),[]):
                if linked['questionId'] not in seen:
                    matched.append(linked)
                    seen.add(linked['questionId'])
        if matched:
            pairs.append({'part2':material(row,'P2'), 'part3':matched})
    topics=[{'topic':topic,'parts':parts} for topic,parts in sorted(p1_topics.items()) if parts]
    if not topics or not pairs:
        return None
    vid=uuid.uuid4()
    await _insert_mock_version(con,vid=vid,title=title+' — Speaking (Auto)',track=track,
                               content_type='speaking',user_id=user['id'],
                               payload={'speakingMode':'auto','part1Pool':topics,
                                        'part2Pairs':pairs,'mockMaterialSlot':'speaking'})
    return vid


@router.post('/api/staff/mocks/authoring')
async def save_mock_draft(req: Request):
    from . import main as core
    from . import mock_system_port as mock
    user, err = await _session(req)
    if err:
        return err
    try:
        body = await req.json()
    except (ValueError, TypeError):
        return mock._err('invalid_json', 'Invalid request JSON.', 422)
    if not isinstance(body, dict):
        return mock._err('invalid_payload', 'Expected a JSON object.', 422)
    title = str(body.get('title') or '').strip()
    track = body.get('track')
    publish = body.get('publish') is True
    selected = body.get('sections')
    test_id = _uuid(body.get('id'))
    if body.get('id') and test_id is None:
        return mock._err('invalid_test_id', 'Invalid mock test ID.', 422)
    if not 3 <= len(title) <= 160 or track not in ('academic', 'general') or not isinstance(selected, dict):
        return mock._err('invalid_mock', 'Title, track and section bindings are required.', 422)
    if any(key not in SLOT_BY_KEY for key in selected):
        return mock._err('invalid_section', 'Unsupported section binding.', 422)
    speaking_topics=body.get('speakingTopics') or {}
    speaking_mode=body.get('speakingMode','fixed')
    if speaking_mode not in ('fixed','auto'):
        return mock._err('invalid_speaking_mode','Unknown Speaking assignment mode.',422)
    if publish and any(not selected.get(key) for key in SLOT_BY_KEY if key!='speaking'):
        return mock._err('missing_sections', 'All four newly uploaded Mock materials are required.', 422)
    if publish and speaking_mode=='fixed' and not selected.get('speaking') and not all(speaking_topics.get(k) for k in ('P1','P2','P3')):
        return mock._err('missing_speaking_topics', 'Select published Speaking topics for Parts 1, 2 and 3.', 422)
    bindings: dict[str, uuid.UUID] = {}
    for key in SLOT_BY_KEY:
        if not selected.get(key):
            continue
        value = _uuid(selected[key])
        if not value:
            return mock._err('invalid_version', 'Invalid content version ID.', 422)
        bindings[key] = value
    if len(bindings.values()) != len(set(bindings.values())):
        return mock._err('duplicate_version', 'Each Mock section must use its own content version.', 422)

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            if test_id:
                existing=await con.fetchrow('SELECT created_by_user_id, publication_state FROM mock_tests WHERE id=$1 FOR UPDATE',test_id)
                if not existing: return mock._err('not_found','Mock draft not found.',404)
                if user['role']!='owner' and existing['created_by_user_id']!=user['id']:
                    return mock._err('forbidden','Only your own Mock drafts can be edited.',403)
                if existing['publication_state']!='draft':
                    return mock._err('published_immutable','Published mocks cannot be edited.',409)
            source_rows = await con.fetch(
                """SELECT id, title, module, content_type, track, source_ref,
                          publication_state, content_snapshot, created_by_user_id
                   FROM content_versions WHERE id = ANY($1::uuid[]) FOR SHARE""",
                list(bindings.values()),
            ) if bindings else []
            source_map = {r['id']: dict(r) for r in source_rows}
            # Resolve the existing Speaking bank into an immutable, dedicated Mock
            # snapshot. It is never taken from arbitrary `content_versions` rows.
            if not bindings.get('speaking') and (speaking_mode=='auto' or all(speaking_topics.get(k) for k in ('P1','P2','P3'))):
                speak_vid=(await _auto_speaking_version(con,user,track,title) if speaking_mode=='auto'
                           else await _speaking_version(con,user,speaking_topics,track,title))
                if not speak_vid:
                    return mock._err('missing_speaking_bank', 'The selected Speaking topic has no active questions.', 422)
                bindings['speaking']=speak_vid
                source_rows=await con.fetch(
                    """SELECT id,title,module,content_type,track,source_ref,publication_state,content_snapshot,created_by_user_id
                    FROM content_versions WHERE id=$1""",speak_vid)
                source_map[speak_vid]=dict(source_rows[0])
            new_sections = []
            for position, (key, skill, subtype, count, seconds) in enumerate(SLOTS, 1):
                vid = bindings.get(key)
                if not vid:
                    continue
                source = source_map.get(vid)
                if (not source or not _eligible_version(source, skill, subtype, track) or
                    (user['role'] != 'owner' and source['created_by_user_id'] != user['id'])):
                    return mock._err('unpublished_or_mismatched_material',
                                     f'{key} must reference a published {track} content version.', 422)
                if key=='speaking':
                    content=source['content_snapshot']
                    content=json.loads(content) if isinstance(content,str) else content
                    if (content.get('speakingMode')=='auto') != (speaking_mode=='auto'):
                        return mock._err('speaking_mode_mismatch','Save a new Speaking selection for this mode.',422)
                ref = str(source['source_ref'] or vid)
                if len(ref) > 80:
                    return mock._err('invalid_source_ref', f'{key} source reference is too long.', 422)
                new_sections.append({'position': position, 'skill': skill, 'module': skill,
                                     'content_type': subtype or source['content_type'],
                                     'source_ref': ref, 'content_version_id': vid,
                                     'question_count': count, 'seconds': seconds})
            if publish and len(new_sections)!=5:
                return mock._err('missing_sections','Complete all five Mock materials before publication.',422)
            if publish:
                for section in new_sections:
                    valid, code, msg, _ = await mock._verify_section_material_integrity(
                        con, section, expected_track=track)
                    if not valid:
                        return mock._err(code or 'invalid_material', msg or 'Material is incomplete.', 422)
            if test_id:
                existing = await con.fetchrow(
                    """SELECT id, created_by_user_id, publication_state
                       FROM mock_tests WHERE id = $1 FOR UPDATE""", test_id)
                if not existing:
                    return mock._err('not_found', 'Mock draft not found.', 404)
                if user['role'] != 'owner' and existing['created_by_user_id'] != user['id']:
                    return mock._err('forbidden', 'You can only edit your own Mock drafts.', 403)
                if existing['publication_state'] != 'draft':
                    return mock._err('published_immutable', 'Published mocks cannot be modified.', 409)
                used = await con.fetchval('SELECT count(*)::int FROM mock_attempts WHERE mock_test_id = $1', test_id)
                if used:
                    return mock._err('attempts_exist', 'A Mock with attempts cannot be edited.', 409)
            else:
                course_id = await con.fetchval("SELECT id FROM courses WHERE slug = 'ielts'")
                if not course_id:
                    await con.execute(
                        "INSERT INTO courses (slug, title) VALUES ('ielts', 'IELTS') ON CONFLICT (slug) DO NOTHING")
                    course_id = await con.fetchval("SELECT id FROM courses WHERE slug = 'ielts'")
                test_id = await con.fetchval(
                    """INSERT INTO mock_tests (course_id, title, skill, track, kind, publication_state,
                                               created_by_user_id, version)
                       VALUES ($1, $2, 'full', $3, 'full', 'draft', $4, 1) RETURNING id""",
                    course_id, title, track, user['id'],
                )
            if body.get('id'):
                await con.execute(
                    """UPDATE mock_tests SET title = $2, track = $3, version = version + 1,
                             updated_at = NOW() WHERE id = $1""", test_id, title, track)
                await con.execute('DELETE FROM mock_sections WHERE mock_test_id = $1', test_id)
            for sec in new_sections:
                await con.execute(
                    """INSERT INTO mock_sections
                       (mock_test_id, position, skill, module, content_type, source_ref,
                        content_version_id, question_count, seconds)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                    test_id, sec['position'], sec['skill'], sec['module'], sec['content_type'],
                    sec['source_ref'], sec['content_version_id'], sec['question_count'], sec['seconds'],
                )
            if publish:
                await con.execute(
                    "UPDATE mock_tests SET publication_state = 'published', updated_at = NOW() WHERE id = $1", test_id)
    return core.j({'ok': True, 'testId': str(test_id),
                   'speakingMode': speaking_mode,
                   'speakingVersionId': str(bindings.get('speaking')) if bindings.get('speaking') else None,
                   'status': 'published' if publish else 'draft'}, headers=mock.PRIVATE_HEADERS)
