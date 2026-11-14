"""FastAPI router and database service layer for the Weekly IELTS Mock System (Phases 2–7).

Implements all endpoints and invariants specified in Section 07 of the DOCX:
- GET  /api/mocks/catalog
- POST /api/mocks/{testId}/attempts
- GET  /api/mocks/attempts/{id}
- PUT  /api/mocks/attempts/{id}/sections/{skill}/draft
- POST /api/mocks/attempts/{id}/sections/{skill}/submit
- POST /api/mocks/attempts/{id}/speaking/upload-finalize
- GET  /api/mocks/attempts/{id}/results
- GET  /api/staff/mocks/queue
- GET  /api/staff/mocks/prompts
- POST /api/staff/mocks/exports
- GET  /api/staff/mocks/exports/{batchId}/download
- POST /api/staff/mocks/grade-imports/validate
- POST /api/staff/mocks/grade-imports/commit
- POST /api/staff/mocks/grades/{revisionId}/revise
- POST /api/staff/mocks/grades/{revisionId}/approve
- POST /api/staff/mocks/batches/{batchId}/publish
"""
from __future__ import annotations

import json
import math
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import Response





router = APIRouter()


def install(app=None):
    from . import main as _core
    target_app = app if app is not None else getattr(_core, 'app', None)
    if target_app is not None:
        target_app.include_router(router)


from . import main as core
from .mock_exports_and_prompts import (
    BATCH_SCHEMA_VERSION,
    GRADING_SCHEMA_VERSION,
    JSON_REPAIR_GEMINI_PROMPT,
    MAX_BATCH_SIZE_DEFAULT,
    SPEAKING_GEMINI_PROMPT,
    WRITING_GEMINI_PROMPT,
    make_student_alias,
    render_speaking_batch_zip,
    render_writing_batch_docx,
    split_into_stable_batches,
    validate_gemini_grading_json,
)
from .mock_scoring_engine import (
    DEFAULT_SECTION_SECONDS,
    FULL_MOCK_SKILLS,
    SPEAKING_CRITERIA,
    TASHKENT_TZ,
    WRITING_TASK1_CRITERIA,
    WRITING_TASK2_CRITERIA,
    canonical_json_sha256,
    compute_attempt_schedule_plan,
    compute_overall_mock_band,
    compute_speaking_band,
    compute_speaking_source_sha256,
    compute_writing_bands,
    compute_writing_source_sha256,
    count_words,
    current_weekly_slot,
    grade_mock_section,
    build_objective_review,
    sanitize_section_payload_for_exam,
    sha256_hex,
)
from .step19_storage import head_object, local_object_path, provider, read_object, valid_key, _client
from .request_lifecycle import run_io

ALLOWED_SPEAKING_MIMES = frozenset((
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/wav',
    'audio/x-wav',
    'audio/mpeg',
))
ALLOWED_SPEAKING_CODECS = frozenset(('webm', 'ogg', 'mp4', 'm4a', 'aac', 'wav', 'mp3', 'mpeg', 'opus'))
MIN_SPEAKING_AUDIO_BYTES = 64
MAX_SPEAKING_AUDIO_BYTES = 60 * 1024 * 1024
LISTENING_TAB_LOCK_SECONDS = 35


def _verify_audio_magic(raw_bytes: bytes, mime_type: str = '') -> str | None:
    """Verify that raw_bytes begins with a real audio container header and is never executable or plain text."""
    if not raw_bytes or len(raw_bytes) < MIN_SPEAKING_AUDIO_BYTES:
        return 'empty_audio'
    if raw_bytes[:2] == b'MZ' or raw_bytes[:4] in (b'\x7fELF', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf') or raw_bytes[:2] == b'#!':
        return 'executable_payload'
    # WebM / Matroska EBML header
    if raw_bytes.startswith(b'\x1a\x45\xdf\xa3'):
        return None
    # Ogg container
    if raw_bytes.startswith(b'OggS'):
        return None
    # RIFF WAVE container
    if raw_bytes[:4] == b'RIFF' and raw_bytes[8:12] == b'WAVE':
        return None
    # MP4 / M4A ISO Base Media File Format
    if len(raw_bytes) >= 12 and raw_bytes[4:8] in (b'ftyp', b'moov', b'mdat', b'wide', b'free'):
        return None
    # FLAC
    if raw_bytes.startswith(b'fLaC'):
        return None
    # MP3 ID3 or MPEG ADTS sync frame
    if raw_bytes[:3] == b'ID3' or (len(raw_bytes) > 2 and raw_bytes[0] == 0xFF and (raw_bytes[1] & 0xE0) == 0xE0):
        return None
    return 'corrupt_audio_format'


async def _write_storage_object(object_key: str, data: bytes, mime_type: str) -> None:
    if not valid_key(object_key):
        raise ValueError('invalid_object_key')
    kind = provider()
    if kind == 'local':
        dest = local_object_path(object_key)
        def _write_local():
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        await run_io(_write_local)
        return
    def _write_s3():
        s3, bucket = _client()
        s3.put_object(Bucket=bucket, Key=object_key, Body=data, ContentType=mime_type)
    await run_io(_write_s3)


async def _check_attempt_ownership(con, aid: uuid.UUID, user: dict[str, Any], for_update: bool = False):
    """Verify attempt exists and belongs to the authenticated student.
    Returns (attempt_row, error_response). Cross-user access returns 403 Forbidden.
    """
    lock_sql = ' FOR UPDATE' if for_update else ''
    row = await con.fetchrow(f'SELECT * FROM mock_attempts WHERE id = $1{lock_sql}', aid)
    if not row:
        return None, _err('not_found', 'Attempt not found.', 404)
    if row['user_id'] != user['id']:
        return None, _err('forbidden', 'You do not have permission to access another student\'s mock attempt.', 403)
    return row, None


def _question_has_answer_key(q: dict[str, Any]) -> bool:
    for k in ('correct_answer', 'correctAnswer', 'key', 'answer_key', 'answerKey'):
        val = q.get(k)
        if val is not None and str(val).strip() != '':
            return True
    acc = q.get('accepted_answers') or q.get('acceptedAnswers')
    return isinstance(acc, list) and len(acc) > 0


def _valid_auto_speaking_pool(payload):
    if payload.get('speakingMode') != 'auto':return False
    topics=payload.get('part1Pool')
    pairs=payload.get('part2Pairs')
    def question(q,part):
        return isinstance(q,dict) and q.get('part')==part and bool(q.get('questionId')) and bool(q.get('promptText'))
    return (isinstance(topics,list) and bool(topics) and
            isinstance(pairs,list) and bool(pairs) and
            all(isinstance(t,dict) and t.get('topic') and isinstance(t.get('parts'),list) and
                t['parts'] and all(question(q,'P1') for q in t['parts']) for t in topics) and
            all(isinstance(p,dict) and question(p.get('part2'),'P2') and
                isinstance(p.get('part3'),list) and p['part3'] and
                all(question(q,'P3') for q in p['part3']) for p in pairs))


def select_attempt_speaking_material(pool):
    """Independent student assignment. Part3 comes ONLY from the chosen Part2 link.

    The selected set is persisted in mock_attempts.mock_snapshot inside the
    attempt creation transaction; refresh and resume never select again.
    """
    import secrets
    if not _valid_auto_speaking_pool(pool):
        raise ValueError('invalid_speaking_pool')
    topic=secrets.choice(pool['part1Pool'])
    pair=secrets.choice(pool['part2Pairs'])
    return {'speakingMode':'auto','parts':[*topic['parts'],pair['part2'],*pair['part3']]}


async def _verify_section_material_integrity(
    con,
    section_row: dict[str, Any],
    expected_track: str | None = None,
) -> tuple[bool, str | None, str | None, dict[str, Any]]:
    """Verify that a section has real published material, bound version, and answer keys (Task 5).
    Never generates placeholder questions or keys.
    """
    skill = section_row.get('skill')
    version_id = section_row.get('content_version_id')
    if version_id:
        vrow = await con.fetchrow('SELECT id, track, publication_state, content_snapshot FROM content_versions WHERE id = $1', version_id)
        if not vrow or vrow['publication_state'] != 'published' or not vrow['content_snapshot']:
            return False, 'invalid_content_version', f'Bound content version for {skill} is missing.', {}
        if expected_track and vrow['track'] and str(vrow['track']).lower() not in (str(expected_track).lower(), 'unspecified'):
            return False, 'track_mismatch', f'Section {skill} track ({vrow["track"]}) does not match mock track ({expected_track}).', {}

    raw_data = await _load_section_questions_from_version(con, section_row, reveal_keys=True)
    if not isinstance(raw_data, dict) or not raw_data:
        return False, 'mock_content_unavailable', f'Published material for {skill} is unavailable.', {}

    expected_q_count = int(section_row.get('question_count') or 40)
    if skill == 'listening':
        audio_url = str(raw_data.get('audioUrl') or raw_data.get('audio_url') or '').strip()
        questions = raw_data.get('questions') if isinstance(raw_data.get('questions'), list) else []
        if not audio_url:
            return False, 'missing_listening_audio', 'Official Listening audio is missing for this mock test.', raw_data
        if len(questions) != expected_q_count:
            return False, 'invalid_question_count', f'Listening requires {expected_q_count} published questions, found {len(questions)}.', raw_data
        if any(not isinstance(q, dict) or not q.get('id') or not (q.get('question_text') or q.get('questionText')) or not _question_has_answer_key(q) for q in questions):
            return False, 'missing_answer_keys', 'One or more Listening questions are missing prompt text or official answer keys.', raw_data
        return True, None, None, raw_data

    if skill == 'reading':
        passages = raw_data.get('passages') if isinstance(raw_data.get('passages'), list) else []
        questions = raw_data.get('questions') if isinstance(raw_data.get('questions'), list) else []
        if not passages or any(not isinstance(p, dict) or not str(p.get('bodyText') or p.get('body_text') or '').strip() for p in passages):
            return False, 'missing_reading_passages', 'Official Reading passages are missing for this mock test.', raw_data
        if len(questions) != expected_q_count:
            return False, 'invalid_question_count', f'Reading requires {expected_q_count} published questions, found {len(questions)}.', raw_data
        if any(not isinstance(q, dict) or not q.get('id') or not (q.get('question_text') or q.get('questionText')) or not _question_has_answer_key(q) for q in questions):
            return False, 'missing_answer_keys', 'One or more Reading questions are missing prompt text or official answer keys.', raw_data
        return True, None, None, raw_data

    if skill == 'writing':
        prompt_text = str(raw_data.get('prompt') or '').strip()
        if not prompt_text:
            return False, 'missing_writing_prompt', 'Official Writing prompt text is missing.', raw_data
        return True, None, None, raw_data

    if skill == 'speaking':
        if raw_data.get('speakingMode') == 'auto':
            if _valid_auto_speaking_pool(raw_data):
                return True, None, None, raw_data
            return False, 'invalid_speaking_pool', 'Auto Speaking requires real Part 1, Part 2 and linked Part 3 questions.', raw_data
        parts = raw_data.get('parts') if isinstance(raw_data.get('parts'), list) else []
        for req_part in ('P1', 'P2', 'P3'):
            if not any(isinstance(p, dict) and p.get('part') == req_part and p.get('questionId') and str(p.get('promptText') or p.get('topic') or '').strip() for p in parts):
                return False, 'missing_speaking_prompts', f'Official Speaking {req_part} prompt is missing.', raw_data
        return True, None, None, raw_data

    return False, 'unknown_skill', f'Unsupported skill: {skill}', {}


PAGE_SIZE = 25
PRIVATE_HEADERS = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
TEACHER_OWNER_ROLES = frozenset(('teacher', 'owner'))
VALID_SKILLS = frozenset(('listening', 'reading', 'writing', 'speaking'))


async def _auth_user(req: Request):
    return await core.current_user(req, active=True)


def _err(code: str, message: str, status: int = 400, **extra: Any):
    return core.j({'error': {'code': code, 'message': message, **extra}}, status, headers=PRIVATE_HEADERS)


def _iso(dt: datetime | str | None) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _mock_access_locked(row: dict[str, Any]) -> bool:
    """Read server-owned access metadata; legacy tests remain available."""
    metadata = row.get('provenance') or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            metadata = {}
    return isinstance(metadata, dict) and metadata.get('accessLocked') is True


def _require_student(user: dict[str, Any] | None):
    if not user:
        return _err('unauthenticated', 'Sign in again.', 401)
    if user.get('role') != 'student':
        return _err('forbidden', 'Only students can take mock exams.', 403)
    return None


def _require_teacher_or_owner(user: dict[str, Any] | None):
    if not user:
        return _err('unauthenticated', 'Sign in again.', 401)
    # Admin explicitly does NOT gain mock grading rights (Section 02 & Section 12).
    if user.get('role') not in TEACHER_OWNER_ROLES:
        return _err('forbidden', 'Only assigned Teachers and the Owner can access Mock Grading.', 403)
    return None


def _teacher_scope_sql(user: dict[str, Any], student_col: str = 'a.user_id', param_index: int = 1) -> tuple[str, list[Any]]:
    if user['role'] == 'owner':
        return 'TRUE', []
    return (
        f'EXISTS (SELECT 1 FROM teacher_student_links l WHERE l.teacher_user_id = ${param_index} AND l.student_user_id = {student_col})',
        [user['id']],
    )


async def _verify_teacher_can_access_attempts(con, user: dict[str, Any], attempt_ids: list[uuid.UUID]) -> bool:
    if user['role'] == 'owner':
        return True
    if user['role'] != 'teacher' or not attempt_ids:
        return False
    unassigned = await con.fetchval(
        """SELECT count(*)::int FROM mock_attempts a
           WHERE a.id = ANY($1::uuid[])
             AND NOT EXISTS (
               SELECT 1 FROM teacher_student_links l
               WHERE l.teacher_user_id = $2 AND l.student_user_id = a.user_id
             )""",
        attempt_ids,
        user['id'],
    )
    return int(unassigned or 0) == 0


async def _log_mock_audit(
    con,
    *,
    actor_user_id: uuid.UUID | None,
    attempt_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
    action: str,
    source_hash: str | None = None,
    old_revision_id: uuid.UUID | None = None,
    new_revision_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
):
    await con.execute(
        """INSERT INTO mock_audit_events
           (actor_user_id, attempt_id, batch_id, action, source_hash, old_revision_id, new_revision_id, metadata, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())""",
        actor_user_id,
        attempt_id,
        batch_id,
        action,
        source_hash,
        old_revision_id,
        new_revision_id,
        json.dumps(metadata or {}, ensure_ascii=False, default=str),
    )


def _student_visible_status(internal_status: str | None) -> str:
    """Never expose internal export or Gemini batch states to students (Section 03)."""
    st = (internal_status or 'in_progress').lower()
    if st in ('in_progress', 'available', 'scheduled'):
        return st
    if st in ('published', 'completed', 'auto_graded'):
        return st
    if st == 'abandoned':
        return 'abandoned'
    return 'awaiting_grading'


async def _load_section_questions_from_version(con, section_row: dict[str, Any], reveal_keys: bool = False) -> dict[str, Any]:
    """Load frozen content for a mock section from content_versions or canonical tables."""
    skill = section_row['skill']
    version_id = section_row.get('content_version_id')
    source_ref = section_row.get('source_ref') or ''

    version_payload = None
    if version_id:
        vrow = await con.fetchrow('SELECT content_snapshot, title, track FROM content_versions WHERE id = $1', version_id)
        if vrow and vrow['content_snapshot']:
            raw_c = vrow['content_snapshot']
            version_payload = json.loads(raw_c) if isinstance(raw_c, str) else dict(raw_c)

    if isinstance(version_payload, dict) and (version_payload.get('speakingMode') == 'auto' or
                                             version_payload.get('questions') or
                                             version_payload.get('parts') or
                                             version_payload.get('prompt')):
        return version_payload if reveal_keys else sanitize_section_payload_for_exam(version_payload)

    if skill == 'listening':
        test_row = await con.fetchrow(
            'SELECT id, title, audio_url FROM listening_tests WHERE source_ref = $1 OR id::text = $1 LIMIT 1',
            source_ref,
        )
        if test_row:
            if version_id:
                qrows = await con.fetch(
                    'SELECT id, "order", type, type_code, question_text, options, correct_answer, explanation FROM listening_questions WHERE test_id = $1 AND content_version_id = $2 ORDER BY "order"',
                    test_row['id'],
                    version_id,
                )
            else:
                qrows = []
            if not qrows:
                qrows = await con.fetch(
                    'SELECT id, "order", type, type_code, question_text, options, correct_answer, explanation FROM listening_questions WHERE test_id = $1 ORDER BY "order" LIMIT 40',
                    test_row['id'],
                )
            payload = {
                'title': test_row['title'],
                'audioUrl': test_row['audio_url'],
                'questions': [dict(r) for r in qrows],
            }
            return payload if reveal_keys else sanitize_section_payload_for_exam(payload)

    if skill == 'reading':
        set_row = await con.fetchrow(
            'SELECT id, title, description FROM general_reading_sets WHERE source_ref = $1 OR id::text = $1 LIMIT 1',
            source_ref,
        )
        if set_row:
            p_rows = await con.fetch(
                """SELECT p.id, p.title, p.body_text, g.passage_no
                   FROM general_reading_passages g
                   JOIN reading_passages p ON p.id = g.passage_id
                   WHERE g.set_id = $1 ORDER BY g.passage_no""",
                set_row['id'],
            )
            p_ids = [r['id'] for r in p_rows]
            q_rows = await con.fetch(
                'SELECT * FROM reading_questions WHERE passage_id = ANY($1::uuid[]) ORDER BY passage_id, "order", id LIMIT 40',
                p_ids,
            ) if p_ids else []
            g_rows = await con.fetch(
                'SELECT * FROM reading_question_groups WHERE passage_id = ANY($1::uuid[]) ORDER BY position, id',
                p_ids,
            ) if p_ids else []
            payload = {
                'title': set_row['title'],
                'passages': [
                    {'id': str(p['id']), 'passageNo': p['passage_no'], 'title': p['title'], 'bodyText': p['body_text']}
                    for p in p_rows
                ],
                'questions': [dict(r) for r in q_rows],
                'groups': [dict(r) for r in g_rows],
            }
            return payload if reveal_keys else sanitize_section_payload_for_exam(payload)

    if skill == 'writing':
        p_row = await con.fetchrow(
            'SELECT id, task_type, category, prompt, target_word_count, source_ref FROM writing_prompts WHERE source_ref = $1 OR id::text = $1 LIMIT 1',
            source_ref,
        )
        if p_row:
            blocks = await con.fetch(
                "SELECT type, object_key, text_content FROM resource_blocks WHERE owner_type = 'writing' AND owner_id = $1 ORDER BY position",
                p_row['id'],
            )
            media_ref = next((b['object_key'] for b in blocks if b['type'] == 'image' and b['object_key']), None)
            return {
                'promptId': str(p_row['id']),
                'taskType': p_row['task_type'],
                'category': p_row['category'],
                'prompt': p_row['prompt'],
                'targetWordCount': p_row['target_word_count'],
                'mediaRef': f'/api/resources/{media_ref}' if media_ref else None,
                'mediaObjectKey': media_ref,
            }

    if skill == 'speaking':
        s_rows = await con.fetch(
            "SELECT id, part, topic, prompt_text, cue_card FROM speaking_prompts WHERE is_active = TRUE ORDER BY part, created_at LIMIT 6"
        )
        return {
            'parts': [
                {
                    'part': f"P{r['part']}" if str(r['part']).isdigit() else str(r['part']).upper(),
                    'questionId': str(r['id']),
                    'topic': r['topic'],
                    'promptText': r['prompt_text'],
                    'cueCard': r['cue_card'],
                }
                for r in s_rows
            ]
        }

    return version_payload or {}


@router.get('/api/mocks/catalog')
async def get_mocks_catalog(req: Request):
    user = await _auth_user(req)
    if not user:
        return _err('unauthenticated', 'Sign in again.', 401)

    slot = current_weekly_slot()
    db = await core.pool()
    async with db.acquire() as con:
        tests = await con.fetch(
            """SELECT t.id, t.title, t.description, t.skill, t.track, t.kind,
                      t.timing_policy_id, t.publication_state, t.publish_at, t.version, t.provenance,
                      (SELECT count(*)::int FROM mock_sections ms WHERE ms.mock_test_id = t.id) AS section_count
               FROM mock_tests t
               JOIN courses c ON c.id = t.course_id
               WHERE c.slug = 'ielts'
                 AND t.publication_state IN ('published', 'scheduled')
               ORDER BY CASE WHEN t.publication_state = 'published' THEN 0 ELSE 1 END, t.title, t.id
               LIMIT 200"""
        )
        attempts = await con.fetch(
            """SELECT a.id, a.mock_test_id, a.weekly_slot, a.status, a.started_at,
                      a.submitted_at, a.finished_at, a.deadline_at, a.raw_score,
                      a.estimated_band, a.mock_snapshot, a.section_results
               FROM mock_attempts a
               WHERE a.user_id = $1
               ORDER BY a.started_at DESC NULLS LAST, a.id DESC
               LIMIT 100""",
            user['id'],
        )
        sub_rows = await con.fetch(
            """SELECT s.attempt_id, s.skill, s.status, s.raw_score, s.score_max, s.band, s.submitted_at
               FROM mock_section_submissions s
               JOIN mock_attempts a ON a.id = s.attempt_id
               WHERE a.user_id = $1""",
            user['id'],
        )

    subs_by_attempt: dict[str, dict[str, Any]] = {}
    for s in sub_rows:
        aid = str(s['attempt_id'])
        subs_by_attempt.setdefault(aid, {})[s['skill']] = {
            'skill': s['skill'],
            'status': _student_visible_status(s['status']),
            'rawScore': s['raw_score'] if s['skill'] in ('listening', 'reading') else None,
            'scoreMax': s['score_max'] if s['skill'] in ('listening', 'reading') else None,
            'band': float(s['band']) if s['band'] is not None and (s['skill'] in ('listening', 'reading') or s['status'] == 'published') else None,
            'submittedAt': _iso(s['submitted_at']),
        }

    active_weekly_attempt = next(
        (a for a in attempts if a['weekly_slot'] == slot and a['status'] != 'abandoned'),
        None,
    )

    catalog_items = []
    for t in tests:
        is_published = t['publication_state'] == 'published'
        access_locked = _mock_access_locked(t)
        tid = str(t['id'])
        resumable = next(
            (a for a in attempts if str(a['mock_test_id']) == tid and a['status'] == 'in_progress'),
            None,
        )
        catalog_items.append({
            'id': tid,
            'title': t['title'],
            'description': t['description'],
            'skill': t['skill'],
            'track': t['track'],
            'kind': t['kind'],
            'version': t['version'],
            'status': 'locked' if access_locked else ('available' if is_published else 'scheduled'),
            'locked': access_locked,
            'publishAt': _iso(t['publish_at']),
            'sectionCount': int(t['section_count'] or 0),
            'resumableAttemptId': str(resumable['id']) if resumable else None,
            'canStart': bool(is_published and not access_locked and (resumable is not None or active_weekly_attempt is None or t['kind'] != 'full')),
        })

    attempt_items = []
    for a in attempts:
        aid = str(a['id'])
        snap = a['mock_snapshot'] if isinstance(a['mock_snapshot'], dict) else (json.loads(a['mock_snapshot']) if isinstance(a['mock_snapshot'], str) else {})
        sec_map = subs_by_attempt.get(aid, {})
        l_band = sec_map.get('listening', {}).get('band')
        r_band = sec_map.get('reading', {}).get('band')
        w_band = sec_map.get('writing', {}).get('band')
        s_band = sec_map.get('speaking', {}).get('band')
        overall = compute_overall_mock_band({'listening': l_band, 'reading': r_band, 'writing': w_band, 'speaking': s_band})
        if overall is None and a['finished_at'] and a['estimated_band'] is not None:
            overall = float(a['estimated_band'])

        attempt_items.append({
            'id': aid,
            'mockTestId': str(a['mock_test_id']) if a['mock_test_id'] else None,
            'title': snap.get('title') or 'IELTS Mock',
            'track': snap.get('track') or 'academic',
            'kind': snap.get('kind') or 'full',
            'weeklySlot': a['weekly_slot'],
            'status': _student_visible_status(a['status']),
            'startedAt': _iso(a['started_at']),
            'submittedAt': _iso(a['submitted_at']),
            'finishedAt': _iso(a['finished_at']),
            'deadlineAt': _iso(a['deadline_at']),
            'estimatedBand': overall,
            'sections': sec_map,
        })

    return core.j({
        'ok': True,
        'weeklySlot': slot,
        'timezone': 'Asia/Tashkent',
        'weeklyEligible': active_weekly_attempt is None,
        'activeWeeklyAttemptId': str(active_weekly_attempt['id']) if active_weekly_attempt else None,
        'tests': catalog_items,
        'attempts': attempt_items,
    }, headers=PRIVATE_HEADERS)


@router.post('/api/mocks/{testId}/attempts')
async def start_or_resume_mock_attempt(req: Request, testId: str):
    user = await _auth_user(req)
    err_resp = _require_student(user)
    if err_resp:
        return err_resp
    tid = core.uuid_value(testId)
    if not tid:
        return _err('not_found', 'Mock test not found.', 404)

    slot = current_weekly_slot()
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            mock_row = await con.fetchrow(
                """SELECT id, title, track, kind, timing_policy_id, score_policies, publication_state, version, provenance
                   FROM mock_tests WHERE id = $1 FOR SHARE""",
                tid,
            )
            if not mock_row or mock_row['publication_state'] != 'published':
                return _err('mock_not_published', 'This mock test is not currently available.', 404)
            if _mock_access_locked(mock_row):
                return _err('mock_locked', 'This mock test is locked by its author.', 403)

            existing_open = await con.fetchrow(
                """SELECT id, mock_version, started_at, deadline_at, active_section_position, section_deadlines
                   FROM mock_attempts
                   WHERE user_id = $1 AND mock_test_id = $2 AND status = 'in_progress'
                   ORDER BY started_at DESC LIMIT 1 FOR UPDATE""",
                user['id'],
                tid,
            )
            if existing_open:
                return core.j({
                    'ok': True,
                    'attemptId': str(existing_open['id']),
                    'resumed': True,
                    'weeklySlot': slot,
                    'mockVersion': existing_open['mock_version'],
                    'startedAt': _iso(existing_open['started_at']),
                    'deadlineAt': _iso(existing_open['deadline_at']),
                    'activeSectionPosition': existing_open['active_section_position'],
                }, headers=PRIVATE_HEADERS)

            if mock_row['kind'] == 'full':
                weekly_taken = await con.fetchrow(
                    """SELECT id, mock_test_id, status FROM mock_attempts
                       WHERE user_id = $1 AND weekly_slot = $2 AND status <> 'abandoned'
                       LIMIT 1 FOR UPDATE""",
                    user['id'],
                    slot,
                )
                if weekly_taken:
                    return _err(
                        'weekly_limit_reached',
                        'Only one full mock attempt is permitted per week (Asia/Tashkent). Resume or view your current weekly mock.',
                        409,
                        attemptId=str(weekly_taken['id']),
                        weeklySlot=slot,
                    )

            sec_rows = await con.fetch(
                """SELECT position, skill, module, content_type, source_ref, content_version_id, question_count, seconds
                   FROM mock_sections WHERE mock_test_id = $1 ORDER BY position""",
                tid,
            )
            sections_list = [dict(r) for r in sec_rows]
            if not sections_list:
                return _err('mock_content_unavailable', 'This mock test has no configured sections.', 422)
            if mock_row['kind'] == 'full':
                present_skills = {r['skill'] for r in sections_list}
                missing_skills = [sk for sk in FULL_MOCK_SKILLS if sk not in present_skills]
                if missing_skills:
                    return _err(
                        'mock_content_unavailable',
                        f'Full mock test is missing required section(s): {", ".join(missing_skills)}.',
                        422,
                    )

            # TASK 5: Verify every section has real published questions, answer keys, prompts, and media before starting
            verified_writing_materials: list[tuple[dict[str, Any], dict[str, Any]]] = []
            attempt_speaking_material = None
            for s_row in sections_list:
                ok_mat, err_code, err_msg, raw_mat = await _verify_section_material_integrity(
                    con, s_row, expected_track=mock_row['track']
                )
                if not ok_mat:
                    return _err(err_code or 'mock_content_unavailable', err_msg or 'Required mock content is unavailable.', 422)
                if s_row['skill'] == 'writing':
                    verified_writing_materials.append((s_row, raw_mat))
                elif s_row['skill']=='speaking':
                    attempt_speaking_material=(select_attempt_speaking_material(raw_mat)
                        if raw_mat.get('speakingMode')=='auto' else raw_mat)

            if any(r['skill'] == 'writing' for r in sections_list) and len(verified_writing_materials) < 2:
                return _err('missing_writing_prompt', 'Both Writing Task 1 and Task 2 published prompts are required.', 422)

            plan = compute_attempt_schedule_plan(now, sections_list)
            bindings = {str(r['position']): (str(r['content_version_id']) if r['content_version_id'] else None) for r in sections_list}
            snapshot = {
                'title': mock_row['title'],
                'track': mock_row['track'],
                'kind': mock_row['kind'],
                'timingPolicyId': mock_row['timing_policy_id'],
                'scorePolicies': mock_row['score_policies'] if isinstance(mock_row['score_policies'], dict) else {},
                'sections': [
                    {
                        'position': r['position'],
                        'skill': r['skill'],
                        'contentType': r['content_type'],
                        'sourceRef': r['source_ref'],
                        'contentVersionId': str(r['content_version_id']) if r['content_version_id'] else None,
                        'questionCount': r['question_count'],
                        'seconds': r['seconds'],
                    }
                    for r in sections_list
                ],
            }
            if attempt_speaking_material is not None:
                snapshot['speakingMaterial'] = attempt_speaking_material
                from .mock_speaking_questions import available as question_capture_available
                if await question_capture_available(con):
                    snapshot['speakingCaptureMode']='question'
            snapshot_hash = canonical_json_sha256(snapshot)
            deadline_dt = datetime.fromisoformat(plan['deadlineAt'].replace('Z', '+00:00'))

            attempt_id = await con.fetchval(
                """INSERT INTO mock_attempts
                   (user_id, mock_test_id, weekly_slot, mock_snapshot, mock_version, status,
                    started_at, deadline_at, content_snapshot_hash, active_section_position,
                    section_deadlines, score_policy_version, content_version_bindings)
                   VALUES ($1, $2, $3, $4::jsonb, $5, 'in_progress',
                           $6, $7, $8, 1, $9::jsonb, 'v1', $10::jsonb)
                   RETURNING id""",
                user['id'],
                tid,
                slot if mock_row['kind'] == 'full' else None,
                json.dumps(snapshot, ensure_ascii=False),
                mock_row['version'],
                now,
                deadline_dt,
                snapshot_hash,
                json.dumps(plan['sectionDeadlines']),
                json.dumps(bindings),
            )

            for p_sec in plan['sections']:
                sk = p_sec['skill']
                sec_deadline = datetime.fromisoformat(p_sec['deadlineAt'].replace('Z', '+00:00'))
                ver_id = next((r['content_version_id'] for r in sections_list if r['skill'] == sk and r['content_version_id']), None)
                await con.execute(
                    """INSERT INTO mock_section_submissions
                       (attempt_id, skill, status, score_max, answers_json, content_version_id, started_at, deadline_at)
                       VALUES ($1, $2, 'in_progress', $3, '{}'::jsonb, $4, $5, $6)
                       ON CONFLICT (attempt_id, skill) DO NOTHING""",
                    attempt_id,
                    sk,
                    40 if sk in ('listening', 'reading') else None,
                    ver_id,
                    now,
                    sec_deadline,
                )

            for idx_w, (w_sec, w_content) in enumerate(verified_writing_materials[:2], 1):
                t_type = 'task1' if idx_w == 1 or w_sec.get('content_type') == 'task1' else 'task2'
                await con.execute(
                    """INSERT INTO mock_writing_answers
                       (attempt_id, task_type, prompt_snapshot_id, prompt_text, content, media_ref, media_sha256, word_count)
                       VALUES ($1, $2, $3, $4, '', $5, $6, 0)
                       ON CONFLICT (attempt_id, task_type) DO NOTHING""",
                    attempt_id,
                    t_type,
                    w_sec.get('content_version_id'),
                    str(w_content.get('prompt') or ''),
                    w_content.get('mediaObjectKey') or w_content.get('mediaRef'),
                    w_content.get('mediaSha256'),
                )

            await _log_mock_audit(
                con,
                actor_user_id=user['id'],
                attempt_id=attempt_id,
                action='mock.attempt.started',
                source_hash=snapshot_hash,
                metadata={'mockTestId': str(tid), 'weeklySlot': slot, 'version': mock_row['version']},
            )

    return core.j({
        'ok': True,
        'attemptId': str(attempt_id),
        'resumed': False,
        'weeklySlot': slot,
        'mockVersion': mock_row['version'],
        'startedAt': _iso(now),
        'deadlineAt': plan['deadlineAt'],
        'activeSectionPosition': 1,
    }, headers=PRIVATE_HEADERS)


@router.get('/api/mocks/attempts/{id}')
async def get_mock_attempt_snapshot(req: Request, id: str):
    user = await _auth_user(req)
    if not user:
        return _err('unauthenticated', 'Sign in again.', 401)
    aid = core.uuid_value(id)
    if not aid:
        return _err('not_found', 'Attempt not found.', 404)

    db = await core.pool()
    async with db.acquire() as con:
        attempt, own_err = await _check_attempt_ownership(con, aid, user, for_update=False)
        if own_err:
            return own_err

        sub_rows = await con.fetch(
            """SELECT skill, status, draft_revision, answers_json, result_details, started_at, deadline_at, submitted_at
               FROM mock_section_submissions WHERE attempt_id = $1 ORDER BY started_at, skill""",
            aid,
        )
        writing_rows = await con.fetch(
            """SELECT task_type, prompt_snapshot_id, prompt_text, content, media_ref, word_count, draft_revision, finalized_at
               FROM mock_writing_answers WHERE attempt_id = $1 ORDER BY task_type""",
            aid,
        )
        speaking_rows = await con.fetch(
            """SELECT part, question_ids, codec, bytes, duration_ms, sha256, object_key, capture_status, finalized_at
               FROM mock_speaking_audio WHERE attempt_id = $1 ORDER BY part""",
            aid,
        )
        from .mock_speaking_questions import question_mode,rows as question_capture_rows
        if question_mode(attempt):
            speaking_rows=await question_capture_rows(con,aid)

        snap = attempt['mock_snapshot']
        if isinstance(snap, str):
            snap = json.loads(snap)
        snap = snap or {}

        sec_defs = snap.get('sections') or []
        materials_by_skill: dict[str, Any] = {}
        for s_def in sec_defs:
            sk = s_def.get('skill')
            if sk=='speaking' and isinstance(snap.get('speakingMaterial'),dict):
                materials_by_skill[sk] = snap['speakingMaterial']
            elif sk in ('listening', 'reading', 'speaking') and sk not in materials_by_skill:
                materials_by_skill[sk] = await _load_section_questions_from_version(
                    con,
                    {
                        'skill': sk,
                        'source_ref': s_def.get('sourceRef'),
                        'content_version_id': core.uuid_value(s_def.get('contentVersionId')) if s_def.get('contentVersionId') else None,
                    },
                    reveal_keys=False,
                )

    now = datetime.now(timezone.utc)
    started_at = attempt['started_at'] or now
    plan = compute_attempt_schedule_plan(started_at, sec_defs)

    sections_state = []
    for p_sec in plan['sections']:
        sk = p_sec['skill']
        s_row = next((r for r in sub_rows if r['skill'] == sk), None)
        dl_dt = s_row['deadline_at'] if s_row and s_row['deadline_at'] else datetime.fromisoformat(p_sec['deadlineAt'].replace('Z', '+00:00'))
        rem_sec = max(0, int((dl_dt - now).total_seconds()))
        ans_json = s_row['answers_json'] if s_row else {}
        if isinstance(ans_json, str):
            ans_json = json.loads(ans_json)
        res_details = s_row.get('result_details') if s_row else None
        if isinstance(res_details, str):
            try:
                res_details = json.loads(res_details)
            except Exception:
                res_details = {}
        res_details = res_details if isinstance(res_details, dict) else {}
        playback_info = res_details.get('playback') if sk == 'listening' else None

        sections_state.append({
            'position': p_sec['position'],
            'skill': sk,
            'questionCount': p_sec.get('questionCount') or (40 if sk in ('listening', 'reading') else None),
            'status': _student_visible_status(s_row['status'] if s_row else 'in_progress'),
            'draftRevision': int(s_row['draft_revision'] or 0) if s_row else 0,
            'remainingSeconds': 0 if (s_row and s_row['submitted_at']) else rem_sec,
            'deadlineAt': _iso(dl_dt),
            'submittedAt': _iso(s_row['submitted_at']) if s_row else None,
            'answers': ans_json if sk in ('listening', 'reading') else None,
            'playback': playback_info,
            'material': sanitize_section_payload_for_exam(materials_by_skill.get(sk, {})),
        })

    writing_tasks = [
        {
            'taskType': w['task_type'],
            'prompt': w['prompt_text'],
            'content': w['content'],
            'mediaUrl': (f"/api/mocks/media/{w['prompt_snapshot_id']}" if str(w['media_ref']).startswith('mock/materials/') and w.get('prompt_snapshot_id')
                         else f"/api/resources/{w['media_ref']}" if not str(w['media_ref']).startswith('/') else w['media_ref']) if w['media_ref'] else None,
            'wordCount': w['word_count'],
            'draftRevision': w['draft_revision'],
            'finalizedAt': _iso(w['finalized_at']),
        }
        for w in writing_rows
    ]

    speaking_parts = [
        {
            'part': s['part'],
            'questionIds': s['question_ids'] if isinstance(s['question_ids'], list) else json.loads(s['question_ids'] or '[]'),
            'codec': s['codec'],
            'bytes': s['bytes'],
            'durationMs': s['duration_ms'],
            'sha256': s.get('sha256'),
            'objectKey': s.get('object_key'),
            'captureStatus': s['capture_status'],
            'finalizedAt': _iso(s['finalized_at']),
        }
        for s in speaking_rows
    ]
    if question_mode(attempt):
        from .mock_speaking_questions import public_row
        speaking_parts=[public_row(s) for s in speaking_rows]

    return core.j({
        'ok': True,
        'serverNow': _iso(now),
        'attempt': {
            'id': str(attempt['id']),
            'mockTestId': str(attempt['mock_test_id']) if attempt['mock_test_id'] else None,
            'title': snap.get('title') or 'IELTS Mock',
            'track': snap.get('track') or 'academic',
            'kind': snap.get('kind') or 'full',
            'status': _student_visible_status(attempt['status']),
            'startedAt': _iso(attempt['started_at']),
            'deadlineAt': _iso(attempt['deadline_at']),
            'activeSectionPosition': attempt['active_section_position'],
            'examConditions': {
                'dictionaryEnabled': False,
                'transcriptVisible': False,
                'answerKeyVisible': False,
            },
            'sections': sections_state,
            'writingTasks': writing_tasks,
            'speakingParts': speaking_parts,
            'speakingCaptureMode': 'question' if question_mode(attempt) else 'part',
        },
    }, headers=PRIVATE_HEADERS)


@router.post('/api/mocks/attempts/{id}/listening/playback')
async def update_mock_listening_playback(req: Request, id: str):
    """TASK 4: Authoritative server-persisted Listening single-play policy."""
    user = await _auth_user(req)
    err_resp = _require_student(user)
    if err_resp:
        return err_resp
    aid = core.uuid_value(id)
    if not aid:
        return _err('not_found', 'Attempt not found.', 404)

    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Invalid playback payload.', 400)
    action = str(body.get('action') or '').lower().strip()
    tab_id = str(body.get('tabId') or '').strip()[:120]
    req_pos_ms = body.get('positionMs', 0)

    if action not in ('start', 'resume', 'heartbeat', 'interrupt', 'complete'):
        return _err('invalid_input', 'Action must be start, resume, heartbeat, interrupt, or complete.', 400)
    if not tab_id:
        return _err('invalid_input', 'tabId is required for Listening single-play synchronization.', 400)
    if not isinstance(req_pos_ms, (int, float)) or isinstance(req_pos_ms, bool) or req_pos_ms < 0 or req_pos_ms > 7200_000:
        return _err('invalid_input', 'Invalid playback positionMs.', 400)
    req_pos_ms = int(req_pos_ms)

    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            attempt, own_err = await _check_attempt_ownership(con, aid, user, for_update=True)
            if own_err:
                return own_err
            if attempt['status'] != 'in_progress':
                return _err('attempt_closed', 'This mock attempt is already submitted.', 409)

            sub = await con.fetchrow(
                """SELECT id, status, result_details, submitted_at
                   FROM mock_section_submissions WHERE attempt_id = $1 AND skill = 'listening' FOR UPDATE""",
                aid,
            )
            if not sub:
                return _err('not_found', 'Listening section not found.', 404)
            if sub['status'] != 'in_progress' or sub['submitted_at'] is not None:
                return _err('section_closed', 'Listening section is already submitted.', 409)

            details = sub.get('result_details')
            if isinstance(details, str):
                try:
                    details = json.loads(details)
                except Exception:
                    details = {}
            details = dict(details) if isinstance(details, dict) else {}
            pb = dict(details.get('playback') or {})

            cur_status = pb.get('status') or 'not_started'
            cur_tab = pb.get('activeTabId')
            cur_pos_ms = int(pb.get('positionMs') or 0)
            completed_at = pb.get('completedAt')
            last_hb_str = pb.get('lastHeartbeatAt')
            last_hb_dt = None
            if isinstance(last_hb_str, str) and last_hb_str:
                try:
                    last_hb_dt = datetime.fromisoformat(last_hb_str.replace('Z', '+00:00'))
                except Exception:
                    last_hb_dt = None

            if cur_status == 'completed' or completed_at:
                return _err(
                    'listening_replay_forbidden',
                    'Listening audio playback has already completed for this attempt and cannot be replayed.',
                    409,
                    playback=pb,
                )

            other_tab_active = (
                cur_status == 'playing'
                and cur_tab
                and cur_tab != tab_id
                and last_hb_dt is not None
                and (now - last_hb_dt).total_seconds() < LISTENING_TAB_LOCK_SECONDS
            )
            if other_tab_active:
                return _err(
                    'listening_already_playing_in_other_tab',
                    'Listening audio is currently playing in another browser tab for this attempt.',
                    409,
                    playback=pb,
                )

            if action in ('start', 'resume'):
                # Prevent restarting from 0 if playback already progressed beyond 0
                effective_pos = max(cur_pos_ms, req_pos_ms)
                pb = {
                    'status': 'playing',
                    'activeTabId': tab_id,
                    'startedAt': pb.get('startedAt') or _iso(now),
                    'lastHeartbeatAt': _iso(now),
                    'positionMs': effective_pos,
                    'completedAt': None,
                    'interruptCount': int(pb.get('interruptCount') or 0),
                }
            elif action == 'heartbeat':
                pb = {
                    'status': 'playing',
                    'activeTabId': tab_id,
                    'startedAt': pb.get('startedAt') or _iso(now),
                    'lastHeartbeatAt': _iso(now),
                    'positionMs': max(cur_pos_ms, req_pos_ms),
                    'completedAt': None,
                    'interruptCount': int(pb.get('interruptCount') or 0),
                }
            elif action == 'interrupt':
                pb = {
                    'status': 'interrupted',
                    'activeTabId': tab_id,
                    'startedAt': pb.get('startedAt') or _iso(now),
                    'lastHeartbeatAt': _iso(now),
                    'positionMs': max(cur_pos_ms, req_pos_ms),
                    'completedAt': None,
                    'interruptCount': int(pb.get('interruptCount') or 0) + 1,
                }
            elif action == 'complete':
                pb = {
                    'status': 'completed',
                    'activeTabId': tab_id,
                    'startedAt': pb.get('startedAt') or _iso(now),
                    'lastHeartbeatAt': _iso(now),
                    'positionMs': max(cur_pos_ms, req_pos_ms),
                    'completedAt': _iso(now),
                    'interruptCount': int(pb.get('interruptCount') or 0),
                }

            details['playback'] = pb
            await con.execute(
                """UPDATE mock_section_submissions
                   SET result_details = $3::jsonb, updated_at = NOW()
                   WHERE attempt_id = $1 AND skill = 'listening'""",
                aid,
                'listening',
                json.dumps(details, ensure_ascii=False),
            )

    return core.j({'ok': True, 'playback': pb}, headers=PRIVATE_HEADERS)


@router.put('/api/mocks/attempts/{id}/sections/{skill}/draft')
async def save_mock_section_draft(req: Request, id: str, skill: str):
    user = await _auth_user(req)
    err_resp = _require_student(user)
    if err_resp:
        return err_resp
    aid = core.uuid_value(id)
    if not aid or skill not in VALID_SKILLS:
        return _err('not_found', 'Section not found.', 404)

    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Invalid draft payload.', 400)
    revision = body.get('revision')
    if not isinstance(revision, int) or isinstance(revision, bool) or not (1 <= revision <= 1_000_000):
        return _err('invalid_input', 'Revision must be an integer between 1 and 1000000.', 400)

    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            attempt, own_err = await _check_attempt_ownership(con, aid, user, for_update=True)
            if own_err:
                return own_err
            if attempt['status'] != 'in_progress':
                return _err('attempt_closed', 'This mock attempt is already submitted.', 409)

            sub = await con.fetchrow(
                """SELECT id, status, draft_revision, answers_json, deadline_at
                   FROM mock_section_submissions WHERE attempt_id = $1 AND skill = $2 FOR UPDATE""",
                aid,
                skill,
            )
            if not sub:
                return _err('not_found', 'Section submission not found.', 404)
            if sub['status'] != 'in_progress' or (sub['deadline_at'] and now > sub['deadline_at'] and (now - sub['deadline_at']).total_seconds() > 15):
                return _err('section_closed', 'This section time window has closed.', 409)

            if skill in ('listening', 'reading'):
                answers = body.get('answers')
                if not isinstance(answers, dict) or len(answers) > 60 or any(not isinstance(k, str) or len(k) > 80 or not isinstance(v, str) or len(v) > 500 for k, v in answers.items()):
                    return _err('invalid_input', 'Answers must be a bounded map of questionId -> string.', 400)
                cur_rev = int(sub['draft_revision'] or 0)
                if revision <= cur_rev:
                    cur_ans = sub.get('answers_json')
                    if isinstance(cur_ans, str):
                        cur_ans = json.loads(cur_ans)
                    return core.j({
                        'ok': True,
                        'revision': cur_rev,
                        'savedAt': _iso(now),
                        'stale': True,
                        'answers': cur_ans or {},
                    }, headers=PRIVATE_HEADERS)
                await con.execute(
                    """UPDATE mock_section_submissions
                       SET answers_json = $3::jsonb, draft_revision = $4, updated_at = NOW()
                       WHERE attempt_id = $1 AND skill = $2""",
                    aid,
                    skill,
                    json.dumps(answers, ensure_ascii=False),
                    revision,
                )
            elif skill == 'writing':
                task_type = body.get('taskType')
                content = body.get('content')
                if task_type not in ('task1', 'task2') or not isinstance(content, str) or len(content) > 25000:
                    return _err('invalid_input', 'Provide taskType (task1|task2) and essay text.', 400)
                w_row = await con.fetchrow(
                    'SELECT draft_revision, content, finalized_at FROM mock_writing_answers WHERE attempt_id = $1 AND task_type = $2 FOR UPDATE',
                    aid,
                    task_type,
                )
                if w_row and w_row['finalized_at']:
                    return _err('section_closed', 'Writing task is already finalized.', 409)
                cur_w_rev = int(w_row['draft_revision'] or 0) if w_row else 0
                if w_row and revision <= cur_w_rev:
                    return core.j({
                        'ok': True,
                        'revision': cur_w_rev,
                        'savedAt': _iso(now),
                        'stale': True,
                        'content': w_row.get('content') or '',
                    }, headers=PRIVATE_HEADERS)
                wc = count_words(content)
                await con.execute(
                    """INSERT INTO mock_writing_answers (attempt_id, task_type, content, word_count, draft_revision, sha256, updated_at)
                       VALUES ($1, $2, $3, $4, $5, $6, NOW())
                       ON CONFLICT (attempt_id, task_type) DO UPDATE
                       SET content = EXCLUDED.content, word_count = EXCLUDED.word_count,
                           draft_revision = EXCLUDED.draft_revision, sha256 = EXCLUDED.sha256, updated_at = NOW()""",
                    aid,
                    task_type,
                    content,
                    wc,
                    revision,
                    sha256_hex(content),
                )
                await con.execute(
                    'UPDATE mock_section_submissions SET draft_revision = GREATEST(draft_revision, $3), updated_at = NOW() WHERE attempt_id = $1 AND skill = $2',
                    aid,
                    skill,
                    revision,
                )

    return core.j({'ok': True, 'revision': revision, 'savedAt': _iso(now), 'stale': False}, headers=PRIVATE_HEADERS)


@router.post('/api/mocks/attempts/{id}/speaking/upload-intent')
async def create_mock_speaking_upload_intent(req: Request, id: str):
    """TASK 1 & TASK 2: Create an authenticated upload intent bound to (user, attempt, part, sha256, bytes)."""
    user = await _auth_user(req)
    err_resp = _require_student(user)
    if err_resp:
        return err_resp
    aid = core.uuid_value(id)
    if not aid:
        return _err('not_found', 'Attempt not found.', 404)

    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Invalid speaking upload intent payload.', 400)

    part = str(body.get('part') or '').upper().strip()
    codec = str(body.get('codec') or 'webm').lower().strip()
    mime_type = str(body.get('mimeType') or 'audio/webm').split(';', 1)[0].strip().lower()
    size_bytes = body.get('bytes')
    duration_ms = body.get('durationMs')
    client_sha256 = str(body.get('sha256') or '').lower().strip()
    question_ids = body.get('questionIds') if isinstance(body.get('questionIds'), list) else []

    if part not in ('P1', 'P2', 'P3'):
        return _err('invalid_input', 'Speaking part must be P1, P2, or P3.', 400)
    if codec not in ALLOWED_SPEAKING_CODECS:
        return _err('unsupported_codec', f'Unsupported audio codec: {codec}.', 422)
    if mime_type not in ALLOWED_SPEAKING_MIMES:
        return _err('invalid_content_type', f'Unsupported audio content type: {mime_type}.', 422)
    if not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes < MIN_SPEAKING_AUDIO_BYTES:
        return _err('empty_audio', 'Audio recording must be at least 64 bytes.', 400)
    if size_bytes > MAX_SPEAKING_AUDIO_BYTES:
        return _err('file_too_large', 'Audio recording exceeds the 60 MB limit.', 413)
    if not isinstance(duration_ms, (int, float)) or isinstance(duration_ms, bool) or duration_ms <= 0 or duration_ms > 3600_000:
        return _err('invalid_input', 'Invalid audio duration.', 400)
    if not re.fullmatch(r'[0-9a-f]{64}', client_sha256):
        return _err('invalid_input', 'A valid 64-character hex SHA-256 digest is required.', 400)

    ext_map = {'webm': 'webm', 'ogg': 'ogg', 'mp4': 'mp4', 'm4a': 'm4a', 'aac': 'aac', 'wav': 'wav', 'mp3': 'mp3', 'mpeg': 'mp3', 'opus': 'ogg'}
    ext = ext_map.get(codec, 'webm')

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            attempt, own_err = await _check_attempt_ownership(con, aid, user, for_update=True)
            if own_err:
                return own_err
            from .mock_speaking_questions import question_mode
            if question_mode(attempt):
                return _err('question_capture_required','Record each Speaking question separately.',409)
            if attempt['status'] != 'in_progress':
                return _err('attempt_closed', 'This mock attempt is already submitted.', 409)

            existing = await con.fetchrow(
                'SELECT id, upload_intent_id, object_key, sha256, bytes, capture_status FROM mock_speaking_audio WHERE attempt_id = $1 AND part = $2 FOR UPDATE',
                aid,
                part,
            )
            if existing and existing['capture_status'] == 'finalized':
                if existing['sha256'] == client_sha256 and int(existing['bytes'] or 0) == size_bytes:
                    return core.j({
                        'ok': True,
                        'uploadId': str(existing['upload_intent_id'] or existing['id']),
                        'objectKey': existing['object_key'],
                        'uploadUrl': f'/api/mocks/attempts/{aid}/speaking/uploads/{existing["upload_intent_id"] or existing["id"]}',
                        'mimeType': mime_type,
                        'alreadyFinalized': True,
                    }, headers=PRIVATE_HEADERS)
                return _err('part_already_finalized', f'Speaking {part} recording is already finalized and immutable.', 409)

            # Reuse pending intent if the exact same recording is being retried
            if existing and existing['capture_status'] == 'incomplete' and existing['sha256'] == client_sha256 and int(existing['bytes'] or 0) == size_bytes and existing.get('upload_intent_id'):
                upload_id = existing['upload_intent_id']
                object_key = existing['object_key']
            else:
                upload_id = uuid.uuid4()
                object_key = f'speaking/attempts/{aid}/audio/{part.lower()}/{upload_id}.{ext}'
                await con.execute(
                    """INSERT INTO upload_intents
                       (id, user_id, speaking_attempt_id, purpose, block_kind, object_key, original_name, mime_type, size, status, direct_to_storage, expires_at)
                       VALUES ($1, $2, $3, 'speaking_recording', 'audio', $4, $5, $6, $7, 'pending', FALSE, NOW() + INTERVAL '30 minutes')""",
                    upload_id,
                    user['id'],
                    aid,
                    object_key,
                    f'{part}.{ext}',
                    mime_type,
                    size_bytes,
                )
                await con.execute(
                    """INSERT INTO mock_speaking_audio
                       (attempt_id, part, question_ids, object_key, upload_intent_id, codec, mime_type,
                        bytes, duration_ms, sha256, capture_status, finalized_at)
                       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, 'incomplete', NULL)
                       ON CONFLICT (attempt_id, part) DO UPDATE
                       SET question_ids = EXCLUDED.question_ids, object_key = EXCLUDED.object_key,
                           upload_intent_id = EXCLUDED.upload_intent_id, codec = EXCLUDED.codec,
                           mime_type = EXCLUDED.mime_type, bytes = EXCLUDED.bytes,
                           duration_ms = EXCLUDED.duration_ms, sha256 = EXCLUDED.sha256,
                           capture_status = 'incomplete', finalized_at = NULL""",
                    aid,
                    part,
                    json.dumps([str(q) for q in question_ids[:20]]),
                    object_key,
                    upload_id,
                    codec,
                    mime_type,
                    size_bytes,
                    int(duration_ms),
                    client_sha256,
                )

    return core.j({
        'ok': True,
        'uploadId': str(upload_id),
        'objectKey': object_key,
        'uploadUrl': f'/api/mocks/attempts/{aid}/speaking/uploads/{upload_id}',
        'mimeType': mime_type,
    }, headers=PRIVATE_HEADERS)


@router.put('/api/mocks/attempts/{id}/speaking/uploads/{uploadId}')
async def upload_mock_speaking_bytes(req: Request, id: str, uploadId: str):
    """TASK 1 & TASK 2: Receive raw recorded audio bytes, verify size, SHA-256, and container magic, and store in R2/local storage."""
    user = await _auth_user(req)
    err_resp = _require_student(user)
    if err_resp:
        return err_resp
    aid = core.uuid_value(id)
    uid = core.uuid_value(uploadId)
    if not aid or not uid:
        return _err('not_found', 'Upload target not found.', 404)

    raw_bytes = await req.body()
    if not isinstance(raw_bytes, (bytes, bytearray)) or len(raw_bytes) == 0:
        return _err('empty_audio', 'Uploaded audio body is empty.', 400)
    raw_bytes = bytes(raw_bytes)
    if len(raw_bytes) < MIN_SPEAKING_AUDIO_BYTES:
        return _err('empty_audio', 'Uploaded audio is smaller than the minimum valid speech size.', 400)
    if len(raw_bytes) > MAX_SPEAKING_AUDIO_BYTES:
        return _err('file_too_large', 'Uploaded audio exceeds the 60 MB limit.', 413)

    db = await core.pool()
    async with db.acquire() as con:
        attempt, own_err = await _check_attempt_ownership(con, aid, user, for_update=False)
        if own_err:
            return own_err
        if attempt['status'] != 'in_progress':
            return _err('attempt_closed', 'This mock attempt is already submitted.', 409)

        intent = await con.fetchrow('SELECT * FROM upload_intents WHERE id = $1', uid)
        if not intent:
            return _err('upload_not_found', 'Upload intent not found.', 404)
        if intent['user_id'] != user['id'] or str(intent.get('speaking_attempt_id')) != str(aid):
            return _err('forbidden', 'You do not have permission to upload to this recording intent.', 403)
        if intent['status'] not in ('pending', 'finalized', 'attached'):
            return _err('upload_not_active', 'Upload intent is no longer active.', 409)

        part_row = await con.fetchrow(
            'SELECT part, sha256, bytes, mime_type, capture_status FROM mock_speaking_audio WHERE attempt_id = $1 AND upload_intent_id = $2',
            aid,
            uid,
        )
        expected_size = int(intent['size'] or (part_row['bytes'] if part_row else 0))
        expected_sha = (part_row['sha256'] if part_row else '') or str(req.headers.get('x-content-sha256') or '').lower().strip()
        mime_type = str(intent['mime_type'] or 'audio/webm').split(';', 1)[0].strip().lower()

    if expected_size and len(raw_bytes) != expected_size:
        return _err('size_mismatch', f'Uploaded byte length ({len(raw_bytes)}) does not match declared size ({expected_size}).', 409)

    actual_sha = sha256_hex(raw_bytes)
    if expected_sha and actual_sha != expected_sha:
        return _err('checksum_mismatch', 'Uploaded audio SHA-256 does not match declared digest.', 409)

    magic_err = _verify_audio_magic(raw_bytes, mime_type)
    if magic_err:
        return _err(magic_err, 'Uploaded bytes do not match a valid audio container header.', 422)

    try:
        await _write_storage_object(intent['object_key'], raw_bytes, mime_type)
    except Exception:
        return _err('storage_unavailable', 'Failed to persist audio object to storage.', 503)

    return core.j({
        'ok': True,
        'uploadId': str(uid),
        'objectKey': intent['object_key'],
        'bytes': len(raw_bytes),
        'sha256': actual_sha,
    }, headers=PRIVATE_HEADERS)


@router.post('/api/mocks/attempts/{id}/speaking/upload-finalize')
async def finalize_mock_speaking_upload(req: Request, id: str):
    """TASK 2: Hardened Speaking upload finalization.
    Verifies session, attempt & intent ownership, storage object existence, nonzero byte length,
    allowed content type, valid audio container signature, and exact SHA-256 match against stored bytes.
    Never trusts client-supplied metadata or hashes without storage verification.
    """
    user = await _auth_user(req)
    err_resp = _require_student(user)
    if err_resp:
        return err_resp
    aid = core.uuid_value(id)
    if not aid:
        return _err('not_found', 'Attempt not found.', 404)

    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Invalid speaking audio payload.', 400)
    part = str(body.get('part') or '').upper().strip()
    upload_id = core.uuid_value(body.get('uploadId')) if body.get('uploadId') else None
    object_key = str(body.get('objectKey') or '').strip()
    codec = str(body.get('codec') or 'webm').lower().strip()[:32]
    declared_mime = str(body.get('mimeType') or 'audio/webm').split(';', 1)[0].strip().lower()
    declared_bytes = body.get('bytes')
    duration_ms = body.get('durationMs')
    client_sha256 = str(body.get('sha256') or '').lower().strip()
    question_ids = body.get('questionIds') if isinstance(body.get('questionIds'), list) else []

    if part not in ('P1', 'P2', 'P3'):
        return _err('invalid_input', 'Speaking part must be P1, P2, or P3.', 400)
    if codec not in ALLOWED_SPEAKING_CODECS:
        return _err('unsupported_codec', f'Unsupported audio codec: {codec}.', 422)
    if declared_mime not in ALLOWED_SPEAKING_MIMES:
        return _err('invalid_content_type', f'Unsupported audio content type: {declared_mime}.', 422)
    if not isinstance(declared_bytes, int) or isinstance(declared_bytes, bool) or declared_bytes <= 0:
        return _err('empty_audio', 'Declared audio byte length must be a positive integer.', 400)
    if declared_bytes < MIN_SPEAKING_AUDIO_BYTES:
        return _err('empty_audio', 'Audio recording is too small to contain speech.', 400)
    if declared_bytes > MAX_SPEAKING_AUDIO_BYTES:
        return _err('file_too_large', 'Audio recording exceeds the 60 MB limit.', 413)
    if not isinstance(duration_ms, (int, float)) or isinstance(duration_ms, bool) or duration_ms <= 0 or duration_ms > 3600_000:
        return _err('invalid_input', 'Invalid audio duration.', 400)
    if not re.fullmatch(r'[0-9a-f]{64}', client_sha256):
        return _err('invalid_input', 'A valid 64-character hex SHA-256 digest is required.', 400)

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            attempt, own_err = await _check_attempt_ownership(con, aid, user, for_update=True)
            if own_err:
                return own_err
            from .mock_speaking_questions import question_mode
            if question_mode(attempt):
                return _err('question_capture_required','Record each Speaking question separately.',409)
            if attempt['status'] != 'in_progress':
                return _err('attempt_closed', 'This mock attempt is already submitted.', 409)

            existing_part = await con.fetchrow(
                'SELECT id, sha256, object_key, bytes, duration_ms, capture_status FROM mock_speaking_audio WHERE attempt_id = $1 AND part = $2 FOR UPDATE',
                aid,
                part,
            )
            if existing_part and existing_part['capture_status'] == 'finalized':
                if (
                    existing_part['sha256'] == client_sha256
                    and existing_part['object_key'] == (object_key or existing_part['object_key'])
                    and int(existing_part['bytes'] or 0) == declared_bytes
                ):
                    stored_check = await read_object(existing_part['object_key'])
                    if stored_check is None or len(stored_check) != declared_bytes or sha256_hex(stored_check) != client_sha256:
                        return _err('audio_object_missing', 'Stored audio object could not be verified.', 404)
                    return core.j({
                        'ok': True,
                        'part': part,
                        'objectKey': existing_part['object_key'],
                        'bytes': int(existing_part['bytes']),
                        'durationMs': int(existing_part['duration_ms'] or duration_ms),
                        'sha256': existing_part['sha256'],
                        'captureStatus': 'finalized',
                        'idempotent': True,
                    }, headers=PRIVATE_HEADERS)
                return _err('part_already_finalized', f'Speaking {part} recording is already finalized and immutable.', 409)

            mime_type = declared_mime
            if upload_id:
                intent = await con.fetchrow(
                    'SELECT * FROM upload_intents WHERE id = $1 FOR UPDATE',
                    upload_id,
                )
                if not intent:
                    return _err('upload_not_found', 'Audio upload intent not found.', 404)
                if intent['user_id'] != user['id']:
                    return _err('forbidden', 'Cannot finalize an upload intent belonging to another user.', 403)
                if intent.get('speaking_attempt_id') and str(intent['speaking_attempt_id']) != str(aid):
                    return _err('forbidden', 'Upload intent is bound to a different attempt.', 403)
                if intent['status'] not in ('pending', 'finalized', 'attached'):
                    return _err('upload_not_active', 'Audio upload intent is not active.', 409)
                if object_key and object_key != intent['object_key']:
                    return _err('object_key_mismatch', 'Provided objectKey does not match the upload intent.', 409)
                object_key = intent['object_key']
                mime_type = str(intent['mime_type'] or declared_mime).split(';', 1)[0].strip().lower()
                if int(intent['size'] or 0) != declared_bytes:
                    return _err('size_mismatch', 'Declared bytes do not match the upload intent size.', 409)

            expected_prefix = f'speaking/attempts/{aid}/'
            if not valid_key(object_key) or not object_key.startswith(expected_prefix):
                return _err('forbidden_object_key', 'Object key must be scoped to the authenticated attempt.', 403)

            # TASK 2: Fail closed if actual stored object is missing or unreadable in storage
            raw_bytes = await read_object(object_key)
            if raw_bytes is None:
                return _err('audio_object_missing', 'Uploaded audio object does not exist in storage.', 404)

            head = await head_object(object_key)
            if head is not None:
                head_mime = str(head.get('contentType') or '').split(';', 1)[0].strip().lower()
                if head_mime and head_mime != 'application/octet-stream' and head_mime not in ALLOWED_SPEAKING_MIMES:
                    return _err('invalid_content_type', f'Stored object has disallowed content type: {head_mime}.', 422)
                if isinstance(head.get('size'), int) and int(head['size']) != len(raw_bytes):
                    return _err('size_mismatch', 'Storage metadata size does not match stored object bytes.', 409)

            actual_size = len(raw_bytes)
            if actual_size <= 0 or actual_size < MIN_SPEAKING_AUDIO_BYTES:
                return _err('empty_audio', 'Stored audio object is empty or truncated.', 400)
            if actual_size > MAX_SPEAKING_AUDIO_BYTES:
                return _err('file_too_large', 'Stored audio object exceeds maximum size.', 413)
            if actual_size != declared_bytes:
                return _err('size_mismatch', f'Stored byte length ({actual_size}) does not match declared size ({declared_bytes}).', 409)

            actual_sha = sha256_hex(raw_bytes)
            if actual_sha != client_sha256:
                return _err('checksum_mismatch', 'Stored audio SHA-256 does not match client digest.', 409)

            magic_err = _verify_audio_magic(raw_bytes, mime_type)
            if magic_err:
                return _err(magic_err, 'Stored audio object failed container signature verification.', 422)

            if upload_id:
                await con.execute(
                    "UPDATE upload_intents SET status = 'attached', finalized_at = COALESCE(finalized_at, NOW()), used_at = NOW() WHERE id = $1",
                    upload_id,
                )

            await con.execute(
                """INSERT INTO mock_speaking_audio
                   (attempt_id, part, question_ids, object_key, upload_intent_id, codec, mime_type,
                    bytes, duration_ms, sha256, capture_status, finalized_at)
                   VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, 'finalized', NOW())
                   ON CONFLICT (attempt_id, part) DO UPDATE
                   SET question_ids = EXCLUDED.question_ids, object_key = EXCLUDED.object_key,
                       upload_intent_id = EXCLUDED.upload_intent_id, codec = EXCLUDED.codec,
                       mime_type = EXCLUDED.mime_type, bytes = EXCLUDED.bytes,
                       duration_ms = EXCLUDED.duration_ms, sha256 = EXCLUDED.sha256,
                       capture_status = 'finalized', finalized_at = NOW()""",
                aid,
                part,
                json.dumps([str(q) for q in question_ids[:20]]),
                object_key,
                upload_id,
                codec,
                mime_type,
                actual_size,
                int(duration_ms),
                actual_sha,
            )

    return core.j({
        'ok': True,
        'part': part,
        'objectKey': object_key,
        'bytes': actual_size,
        'durationMs': int(duration_ms),
        'sha256': actual_sha,
        'captureStatus': 'finalized',
    }, headers=PRIVATE_HEADERS)


@router.post('/api/mocks/attempts/{id}/sections/{skill}/submit')
async def submit_mock_section(req: Request, id: str, skill: str):
    user = await _auth_user(req)
    err_resp = _require_student(user)
    if err_resp:
        return err_resp
    aid = core.uuid_value(id)
    if not aid or skill not in VALID_SKILLS:
        return _err('not_found', 'Section not found.', 404)

    body = await core.payload(req)
    body = body if isinstance(body, dict) else {}

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            attempt, own_err = await _check_attempt_ownership(con, aid, user, for_update=True)
            if own_err:
                return own_err

            sub = await con.fetchrow(
                'SELECT * FROM mock_section_submissions WHERE attempt_id = $1 AND skill = $2 FOR UPDATE',
                aid,
                skill,
            )
            if not sub:
                return _err('not_found', 'Section not found.', 404)

            # Idempotent return if section was already submitted
            if sub['status'] != 'in_progress' and sub['submitted_at'] is not None:
                return core.j({
                    'ok': True,
                    'idempotent': True,
                    'skill': skill,
                    'status': _student_visible_status(sub['status']),
                    'rawScore': sub['raw_score'] if skill in ('listening', 'reading') else None,
                    'scoreMax': sub['score_max'] if skill in ('listening', 'reading') else None,
                    'band': float(sub['band']) if sub['band'] is not None and skill in ('listening', 'reading') else None,
                    'submittedAt': _iso(sub['submitted_at']),
                }, headers=PRIVATE_HEADERS)

            snap = attempt['mock_snapshot']
            if isinstance(snap, str):
                snap = json.loads(snap)
            snap = snap or {}
            track = str(snap.get('track') or 'academic')
            sec_defs = snap.get('sections') or []
            s_def = next((s for s in sec_defs if s.get('skill') == skill), {'skill': skill})

            if skill in ('listening', 'reading'):
                saved_answers = sub['answers_json']
                if isinstance(saved_answers, str):
                    saved_answers = json.loads(saved_answers)
                saved_answers = dict(saved_answers or {})
                if isinstance(body.get('answers'), dict):
                    for k, v in body['answers'].items():
                        if isinstance(k, str) and len(k) <= 80 and isinstance(v, str) and len(v) <= 500:
                            saved_answers[k] = v

                # TASK 5: Verify bound content version, question count, and answer keys before grading
                sec_row_for_check = {
                    'skill': skill,
                    'source_ref': s_def.get('sourceRef'),
                    'content_version_id': sub['content_version_id'] or (core.uuid_value(s_def.get('contentVersionId')) if s_def.get('contentVersionId') else None),
                    'question_count': s_def.get('questionCount') or 40,
                }
                ok_mat, err_code, err_msg, content_data = await _verify_section_material_integrity(
                    con, sec_row_for_check, expected_track=track
                )
                if not ok_mat:
                    return _err(err_code or 'mock_content_unavailable', err_msg or 'Official section content is unavailable.', 422)

                questions = content_data.get('questions') or []
                groups = {str(g.get('id')): g for g in (content_data.get('groups') or []) if isinstance(g, dict) and g.get('id')}
                graded_res = grade_mock_section(skill, questions, saved_answers, track=track, groups_by_id=groups)

                existing_details = sub.get('result_details')
                if isinstance(existing_details, str):
                    try:
                        existing_details = json.loads(existing_details)
                    except Exception:
                        existing_details = {}
                existing_details = dict(existing_details) if isinstance(existing_details, dict) else {}
                existing_details.update({'policyRef': graded_res['policyRef'], 'items': graded_res['items']})

                await con.execute(
                    """UPDATE mock_section_submissions
                       SET status = 'auto_graded',
                           raw_score = $3,
                           score_max = $4,
                           band = $5,
                           answers_json = $6::jsonb,
                           result_details = $7::jsonb,
                           answer_hash = $8,
                           submitted_at = NOW(),
                           updated_at = NOW()
                       WHERE attempt_id = $1 AND skill = $2""",
                    aid,
                    skill,
                    graded_res['rawScore'],
                    graded_res['scoreMax'],
                    graded_res['band'],
                    json.dumps(saved_answers, ensure_ascii=False),
                    json.dumps(existing_details),
                    graded_res['answerHash'],
                )
                new_status = 'auto_graded'
                raw_out = graded_res['rawScore']
                max_out = graded_res['scoreMax']
                band_out = graded_res['band']
                ans_hash = graded_res['answerHash']

            elif skill == 'writing':
                if isinstance(body.get('tasks'), dict):
                    for t_type in ('task1', 'task2'):
                        t_content = body['tasks'].get(t_type)
                        if isinstance(t_content, str) and len(t_content) <= 25000:
                            await con.execute(
                                """INSERT INTO mock_writing_answers (attempt_id, task_type, content, word_count, sha256, updated_at)
                                   VALUES ($1, $2, $3, $4, $5, NOW())
                                   ON CONFLICT (attempt_id, task_type) DO UPDATE
                                   SET content = EXCLUDED.content, word_count = EXCLUDED.word_count,
                                       sha256 = EXCLUDED.sha256, updated_at = NOW()
                                   WHERE mock_writing_answers.finalized_at IS NULL""",
                                aid,
                                t_type,
                                t_content,
                                count_words(t_content),
                                sha256_hex(t_content),
                            )

                w_rows = await con.fetch(
                    'SELECT task_type, prompt_text, content, media_ref, media_sha256 FROM mock_writing_answers WHERE attempt_id = $1 FOR UPDATE',
                    aid,
                )
                by_t = {r['task_type']: dict(r) for r in w_rows}
                t1 = by_t.get('task1', {'prompt_text': '', 'content': '', 'media_sha256': None})
                t2 = by_t.get('task2', {'prompt_text': '', 'content': ''})
                digests = compute_writing_source_sha256(
                    str(aid),
                    str(t1.get('prompt_text') or ''),
                    str(t1.get('content') or ''),
                    t1.get('media_sha256'),
                    str(t2.get('prompt_text') or ''),
                    str(t2.get('content') or ''),
                )
                await con.execute(
                    "UPDATE mock_writing_answers SET finalized_at = COALESCE(finalized_at, NOW()), sha256 = CASE WHEN task_type = 'task1' THEN $2 ELSE $3 END WHERE attempt_id = $1",
                    aid,
                    digests['task1Sha256'],
                    digests['task2Sha256'],
                )
                await con.execute(
                    """UPDATE mock_section_submissions
                       SET status = 'awaiting_export',
                           answer_hash = $3,
                           submitted_at = NOW(),
                           updated_at = NOW()
                       WHERE attempt_id = $1 AND skill = $2""",
                    aid,
                    skill,
                    digests['sourceSha256'],
                )
                new_status = 'awaiting_export'
                raw_out = None
                max_out = None
                band_out = None
                ans_hash = digests['sourceSha256']

            else:
                # TASK 2: Speaking section submit requires all 3 parts finalized AND verified in storage
                s_rows = await con.fetch(
                    'SELECT part, question_ids, object_key, sha256, bytes, duration_ms, capture_status FROM mock_speaking_audio WHERE attempt_id = $1 ORDER BY part FOR UPDATE',
                    aid,
                )
                parts_list = [dict(r) for r in s_rows]
                from .mock_speaking_questions import question_mode,rows as question_capture_rows,questions
                if question_mode(attempt):
                    parts_list=[dict(r) for r in await question_capture_rows(con,aid)]
                    required={(q['part'],q['questionId']) for q in questions(attempt)}
                    captured={(r['part'],str(r['question_id'])) for r in parts_list}
                    if not required or required!=captured:
                        return _err('speaking_audio_incomplete','Record every frozen Speaking question before submitting.',409)
                by_part = {p['part']: p for p in parts_list}
                for req_part in ('P1', 'P2', 'P3'):
                    p_rec = by_part.get(req_part)
                    if not p_rec or p_rec.get('capture_status') != 'finalized' or int(p_rec.get('bytes') or 0) < MIN_SPEAKING_AUDIO_BYTES:
                        return _err(
                            'speaking_audio_incomplete',
                            f'Speaking {req_part} recording must be finalized and verified before submitting.',
                            409,
                        )
                for recording in parts_list:
                    obj_bytes=await read_object(recording['object_key'])
                    if not obj_bytes or len(obj_bytes)!=recording['bytes'] or sha256_hex(obj_bytes)!=recording['sha256']:
                        return _err('audio_object_missing','A Speaking recording failed integrity verification.',409)

                source_sha = compute_speaking_source_sha256(str(aid), parts_list)
                new_status = 'awaiting_export'
                await con.execute(
                    """UPDATE mock_section_submissions
                       SET status = $3,
                           answer_hash = $4,
                           result_details = $5::jsonb,
                           submitted_at = NOW(),
                           updated_at = NOW()
                       WHERE attempt_id = $1 AND skill = $2""",
                    aid,
                    skill,
                    new_status,
                    source_sha,
                    json.dumps({'partsRecorded': len(parts_list), 'complete': True}),
                )
                raw_out = None
                max_out = None
                band_out = None
                ans_hash = source_sha

            all_subs = await con.fetch(
                'SELECT skill, status, raw_score, score_max, band, submitted_at FROM mock_section_submissions WHERE attempt_id = $1',
                aid,
            )
            next_pos = min(len(all_subs), int(attempt['active_section_position'] or 1) + 1)
            all_submitted = len(all_subs) > 0 and all(r['submitted_at'] is not None for r in all_subs)

            section_results_json = [
                {
                    'skill': r['skill'],
                    'raw': r['raw_score'],
                    'total': r['score_max'],
                    'band': float(r['band']) if r['band'] is not None and (r['skill'] in ('listening', 'reading') or r['status'] == 'published') else None,
                    'status': _student_visible_status(r['status']),
                }
                for r in all_subs
            ]

            await con.execute(
                """UPDATE mock_attempts
                   SET active_section_position = $2,
                       status = CASE WHEN $3 THEN 'awaiting_grading' ELSE status END,
                       submitted_at = CASE WHEN $3 AND submitted_at IS NULL THEN NOW() ELSE submitted_at END,
                       section_results = $4::jsonb
                   WHERE id = $1""",
                aid,
                next_pos,
                all_submitted,
                json.dumps(section_results_json),
            )

            await _log_mock_audit(
                con,
                actor_user_id=user['id'],
                attempt_id=aid,
                action=f'mock.section.{skill}.submitted',
                source_hash=ans_hash,
                metadata={'skill': skill, 'status': new_status, 'rawScore': raw_out, 'band': band_out},
            )

    return core.j({
        'ok': True,
        'idempotent': False,
        'skill': skill,
        'status': _student_visible_status(new_status),
        'rawScore': raw_out,
        'scoreMax': max_out,
        'band': band_out,
        'submittedAt': _iso(datetime.now(timezone.utc)),
        'allSectionsSubmitted': all_submitted,
    }, headers=PRIVATE_HEADERS)


@router.get('/api/mocks/attempts/{id}/results')
async def get_mock_attempt_results(req: Request, id: str):
    user = await _auth_user(req)
    if not user:
        return _err('unauthenticated', 'Sign in again.', 401)
    aid = core.uuid_value(id)
    if not aid:
        return _err('not_found', 'Attempt not found.', 404)

    reviews: dict[str, Any] = {}
    db = await core.pool()
    async with db.acquire() as con:
        attempt = await con.fetchrow('SELECT * FROM mock_attempts WHERE id = $1', aid)
        if not attempt:
            return _err('not_found', 'Attempt not found.', 404)

        if user['role'] == 'student':
            if attempt['user_id'] != user['id']:
                return _err('not_found', 'Attempt not found.', 404)
        elif user['role'] in TEACHER_OWNER_ROLES:
            if not await _verify_teacher_can_access_attempts(con, user, [aid]):
                return _err('forbidden', 'Student is not assigned to your roster.', 403)
        else:
            return _err('forbidden', 'Forbidden.', 403)

        subs = await con.fetch(
            'SELECT * FROM mock_section_submissions WHERE attempt_id = $1 ORDER BY started_at, skill',
            aid,
        )
        revisions = await con.fetch(
            """SELECT DISTINCT ON (section)
                      id, section, rubric_version, status, payload_json, calculated_band,
                      task1_band, task2_band, approved_at, published_at, created_at
               FROM mock_grading_revisions
               WHERE attempt_id = $1 AND status = 'published' AND published_at IS NOT NULL
               ORDER BY section, published_at DESC, created_at DESC""",
            aid,
        )

        # Feedback must not reveal answers while any part of this full exam is active.
        submitted = {s['skill'] for s in subs if s['submitted_at'] is not None}
        if attempt['submitted_at'] is not None and all(sk in submitted for sk in FULL_MOCK_SKILLS):
            snapshot = attempt['mock_snapshot']
            snapshot = json.loads(snapshot) if isinstance(snapshot, str) else (snapshot or {})
            for sk in ('listening', 'reading'):
                definition = next((s for s in snapshot.get('sections', []) if s.get('skill') == sk), None)
                submission = next((s for s in subs if s['skill'] == sk), None)
                if not definition or not submission:
                    continue
                material = await _load_section_questions_from_version(con, {
                    'skill': sk, 'source_ref': definition.get('sourceRef'),
                    'content_version_id': submission.get('content_version_id') or core.uuid_value(definition.get('contentVersionId')),
                }, reveal_keys=True)
                answers = submission['answers_json'] or {}
                answers = json.loads(answers) if isinstance(answers, str) else dict(answers)
                reviews[sk] = build_objective_review(material, answers, sk, snapshot.get('track') or 'academic')

    rev_by_sec = {r['section']: dict(r) for r in revisions}
    section_bands: dict[str, float | None] = {}
    sections_out: dict[str, Any] = {}

    for s in subs:
        sk = s['skill']
        if sk in ('listening', 'reading'):
            b_val = float(s['band']) if s['band'] is not None else None
            section_bands[sk] = b_val
            sections_out[sk] = {
                'skill': sk,
                'status': 'completed' if s['submitted_at'] else 'in_progress',
                'rawScore': s['raw_score'],
                'scoreMax': s['score_max'],
                'band': b_val,
                'submittedAt': _iso(s['submitted_at']),
                'feedback': None,
                **({'review': reviews[sk]} if sk in reviews else {}),
            }
        else:
            pub_rev = rev_by_sec.get(sk)
            if pub_rev and pub_rev['published_at'] is not None:
                b_val = float(pub_rev['calculated_band']) if pub_rev['calculated_band'] is not None else None
                section_bands[sk] = b_val
                p_json = pub_rev['payload_json']
                if isinstance(p_json, str):
                    p_json = json.loads(p_json)
                p_json = dict(p_json or {})
                # Exclude internal batch student_id alias and source_sha256 from student view
                student_feedback = {
                    k: v for k, v in p_json.items()
                    if k not in ('student_id', 'source_sha256')
                }
                sections_out[sk] = {
                    'skill': sk,
                    'status': 'published',
                    'rawScore': None,
                    'scoreMax': None,
                    'band': b_val,
                    'task1Band': float(pub_rev['task1_band']) if pub_rev['task1_band'] is not None else None,
                    'task2Band': float(pub_rev['task2_band']) if pub_rev['task2_band'] is not None else None,
                    'submittedAt': _iso(s['submitted_at']),
                    'publishedAt': _iso(pub_rev['published_at']),
                    'feedback': student_feedback,
                }
            else:
                section_bands[sk] = None
                sections_out[sk] = {
                    'skill': sk,
                    'status': 'awaiting_grading' if s['submitted_at'] else 'in_progress',
                    'rawScore': None,
                    'scoreMax': None,
                    'band': None,
                    'submittedAt': _iso(s['submitted_at']),
                    'publishedAt': None,
                    'feedback': None,
                }

    overall_band = compute_overall_mock_band(section_bands)
    snap = attempt['mock_snapshot']
    if isinstance(snap, str):
        snap = json.loads(snap)
    snap = snap or {}

    return core.j({
        'ok': True,
        'attemptId': str(aid),
        'title': snap.get('title') or 'IELTS Mock',
        'track': snap.get('track') or 'academic',
        'kind': snap.get('kind') or 'full',
        'label': 'IELTS-equivalent estimate',
        'status': 'published' if overall_band is not None else _student_visible_status(attempt['status']),
        'overallBand': overall_band,
        'sections': sections_out,
    }, headers=PRIVATE_HEADERS)


@router.get('/api/staff/mocks/prompts')
async def get_staff_gemini_prompts(req: Request):
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    return core.j({
        'ok': True,
        'schemaVersion': GRADING_SCHEMA_VERSION,
        'prompts': {
            'writing': WRITING_GEMINI_PROMPT,
            'speaking': SPEAKING_GEMINI_PROMPT,
            'repair': JSON_REPAIR_GEMINI_PROMPT,
        },
    }, headers=PRIVATE_HEADERS)


async def build_staff_mock_queue(con, user: dict[str, Any], q: dict[str, str]) -> dict[str, Any]:
    """Query role-scoped Mock Grading Center queue with 25-per-page pagination."""
    scope_sql, scope_args = _teacher_scope_sql(user, 'a.user_id', 1)
    args = list(scope_args)
    conds = [scope_sql, "s.skill IN ('writing', 'speaking')", 's.submitted_at IS NOT NULL']

    section_filter = (q.get('section') or 'all').strip().lower()
    if section_filter not in ('all', 'writing', 'speaking'):
        section_filter = 'all'
    if section_filter in ('writing', 'speaking'):
        args.append(section_filter)
        conds.append(f's.skill = ${len(args)}')

    status_filter = (q.get('status') or 'ungraded').strip().lower()
    if status_filter == 'ungraded':
        conds.append("s.status <> 'published'")
    elif status_filter in ('awaiting_export', 'exported', 'imported_draft', 'needs_review', 'approved', 'published', 'retryable_failure'):
        args.append(status_filter)
        conds.append(f's.status = ${len(args)}')

    date_from = (q.get('dateFrom') or '').strip()
    if date_from and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_from):
        args.append(date.fromisoformat(date_from))
        conds.append(f"(s.submitted_at AT TIME ZONE 'Asia/Tashkent')::date >= ${len(args)}::date")

    date_to = (q.get('dateTo') or '').strip()
    if date_to and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_to):
        args.append(date.fromisoformat(date_to))
        conds.append(f"(s.submitted_at AT TIME ZONE 'Asia/Tashkent')::date <= ${len(args)}::date")

    weekly_slot = (q.get('weeklySlot') or '').strip()
    if weekly_slot and len(weekly_slot) <= 32:
        args.append(weekly_slot)
        conds.append(f'a.weekly_slot = ${len(args)}')

    student_q = (q.get('student') or '').strip()[:80]
    if student_q:
        args.append(f'%{student_q}%')
        conds.append(f'(u.name ILIKE ${len(args)} OR u.id::text ILIKE ${len(args)} OR a.id::text ILIKE ${len(args)})')

    try:
        page = max(1, min(100000, int(q.get('page') or '1')))
    except ValueError:
        page = 1

    where_sql = ' WHERE ' + ' AND '.join(conds)
    base_from = """
      FROM mock_section_submissions s
      JOIN mock_attempts a ON a.id = s.attempt_id
      JOIN users u ON u.id = a.user_id AND u.role = 'student'
      LEFT JOIN mock_tests t ON t.id = a.mock_test_id
    """

    counts_row = await con.fetchrow(
        f"""SELECT
              count(*)::int AS total_filtered,
              count(*) FILTER (WHERE s.status IN ('awaiting_export', 'exported', 'imported_draft', 'needs_review'))::int AS pending_review,
              count(*) FILTER (WHERE s.status = 'approved')::int AS ready_to_publish,
              count(*) FILTER (WHERE s.status = 'published')::int AS published_count
            {base_from}
            {where_sql}""",
        *args,
    )
    total = int(counts_row['total_filtered'] or 0) if counts_row else 0
    total_pages = max(1, math.ceil(total / PAGE_SIZE))
    page = min(page, total_pages)

    rows = await con.fetch(
        f"""SELECT
              s.id AS submission_id,
              s.attempt_id,
              s.skill AS section,
              s.status,
              s.band,
              s.answer_hash,
              s.submitted_at,
              a.user_id AS student_user_id,
              u.name AS student_name,
              a.weekly_slot,
              COALESCE(t.title, a.mock_snapshot->>'title', 'IELTS Mock') AS mock_title,
              COALESCE(t.track, a.mock_snapshot->>'track', 'academic') AS track,
              rev.id AS revision_id,
              rev.batch_id,
              rev.status AS revision_status,
              rev.calculated_band,
              rev.task1_band,
              rev.task2_band,
              rev.payload_json,
              rev.approved_at,
              rev.published_at
            {base_from}
            LEFT JOIN LATERAL (
              SELECT r.*
              FROM mock_grading_revisions r
              WHERE r.attempt_id = s.attempt_id AND r.section = s.skill AND r.status <> 'superseded'
              ORDER BY r.created_at DESC, r.id DESC
              LIMIT 1
            ) rev ON TRUE
            {where_sql}
            ORDER BY s.submitted_at DESC, s.id DESC
            LIMIT {PAGE_SIZE} OFFSET {(page - 1) * PAGE_SIZE}""",
        *args,
    )

    batch_conds = []
    batch_args: list[Any] = []
    if user['role'] == 'teacher':
        batch_args.append(user['id'])
        batch_conds.append(f'b.created_by = ${len(batch_args)}')
    batch_where = (' WHERE ' + ' AND '.join(batch_conds)) if batch_conds else ''
    batches = await con.fetch(
        f"""SELECT b.id, b.batch_code, b.scope, b.section, b.filter_mode, b.date_from, b.date_to,
                   b.created_at, b.export_manifest_hash, b.status, b.published_at,
                   (SELECT count(*)::int FROM mock_grading_revisions r WHERE r.batch_id = b.id AND r.status <> 'superseded') AS revision_count,
                   (SELECT count(*)::int FROM mock_grading_revisions r WHERE r.batch_id = b.id AND r.status = 'approved') AS approved_count
            FROM mock_grading_batches b
            {batch_where}
            ORDER BY b.created_at DESC
            LIMIT 25""",
        *batch_args,
    )

    items = []
    for idx, r in enumerate(rows, 1 + (page - 1) * PAGE_SIZE):
        payload = r['payload_json']
        if isinstance(payload, str):
            payload = json.loads(payload)
        payload = payload if isinstance(payload, dict) else None
        alias = (payload or {}).get('student_id') or make_student_alias(idx, str(r['attempt_id']))
        items.append({
            'submissionId': str(r['submission_id']),
            'attemptId': str(r['attempt_id']),
            'studentUserId': str(r['student_user_id']),
            'studentAlias': alias,
            'studentName': r['student_name'],
            'section': r['section'],
            'status': r['status'],
            'weeklySlot': r['weekly_slot'] or current_weekly_slot(),
            'mockTitle': r['mock_title'],
            'track': r['track'],
            'submittedAt': _iso(r['submitted_at']),
            'answerHash': r['answer_hash'],
            'band': float(r['band']) if r['band'] is not None else (float(r['calculated_band']) if r['calculated_band'] is not None else None),
            'revision': {
                'id': str(r['revision_id']),
                'batchId': str(r['batch_id']) if r['batch_id'] else None,
                'status': r['revision_status'],
                'calculatedBand': float(r['calculated_band']) if r['calculated_band'] is not None else None,
                'task1Band': float(r['task1_band']) if r['task1_band'] is not None else None,
                'task2Band': float(r['task2_band']) if r['task2_band'] is not None else None,
                'payload': payload,
                'approvedAt': _iso(r['approved_at']),
                'publishedAt': _iso(r['published_at']),
            } if r['revision_id'] else None,
        })

    batch_items = [
        {
            'id': str(b['id']),
            'batchCode': b['batch_code'],
            'scope': b['scope'],
            'section': b['section'],
            'filterMode': b['filter_mode'],
            'dateFrom': str(b['date_from']) if b['date_from'] else None,
            'dateTo': str(b['date_to']) if b['date_to'] else None,
            'createdAt': _iso(b['created_at']),
            'exportManifestHash': b['export_manifest_hash'],
            'status': b['status'],
            'publishedAt': _iso(b['published_at']),
            'revisionCount': int(b['revision_count'] or 0),
            'approvedCount': int(b['approved_count'] or 0),
        }
        for b in batches
    ]

    return {
        'scope': 'owner' if user['role'] == 'owner' else 'assigned',
        'filters': {
            'section': section_filter,
            'status': status_filter,
            'dateFrom': date_from or None,
            'dateTo': date_to or None,
            'weeklySlot': weekly_slot or None,
            'student': student_q or '',
        },
        'summary': {
            'submissions': total,
            'pendingReview': int(counts_row['pending_review'] or 0) if counts_row else 0,
            'readyToPublish': int(counts_row['ready_to_publish'] or 0) if counts_row else 0,
            'published': int(counts_row['published_count'] or 0) if counts_row else 0,
        },
        'items': items,
        'batches': batch_items,
        'page': page,
        'pageSize': PAGE_SIZE,
        'total': total,
        'totalPages': total_pages,
        'prompts': {
            'writing': WRITING_GEMINI_PROMPT,
            'speaking': SPEAKING_GEMINI_PROMPT,
            'repair': JSON_REPAIR_GEMINI_PROMPT,
        },
    }


@router.get('/api/staff/mocks/queue')
async def get_staff_mock_queue(req: Request):
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    db = await core.pool()
    async with db.acquire() as con:
        data = await build_staff_mock_queue(con, user, dict(req.query_params))
    return core.j({'ok': True, **data}, headers=PRIVATE_HEADERS)


@router.post('/api/staff/mocks/exports')
async def create_staff_mock_export_batch(req: Request):
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp

    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Invalid export request.', 400)
    section = str(body.get('section') or '').lower()
    if section not in ('writing', 'speaking'):
        return _err('invalid_input', 'Export section must be writing or speaking.', 400)

    filter_mode = str(body.get('filterMode') or 'ungraded').lower()
    if filter_mode not in ('ungraded', 'all'):
        return _err('invalid_input', 'filterMode must be ungraded or all.', 400)
    include_exported = bool(body.get('includePreviouslyExported', False))
    date_from = body.get('dateFrom')
    date_to = body.get('dateTo')
    max_per_batch = body.get('maxPerBatch', MAX_BATCH_SIZE_DEFAULT)
    if type(max_per_batch) is not int or not 1 <= max_per_batch <= 50:
        return _err('invalid_input', 'maxPerBatch must be an integer from 1 to 50.', 400)
    try:
        for value in (date_from,date_to):
            if value is not None and (not isinstance(value,str) or date.fromisoformat(value).isoformat()!=value):
                return _err('invalid_input','Use a valid calendar date in YYYY-MM-DD format.',400)
    except ValueError:
        return _err('invalid_input','Use a valid calendar date in YYYY-MM-DD format.',400)
    if date_from and date_to and date_from>date_to:
        return _err('invalid_input','Date from must not follow date to.',400)

    requested_ids = body.get('attemptIds')
    if requested_ids is not None and (not isinstance(requested_ids,list) or len(requested_ids)>200):
        return _err('invalid_input','Supply at most 200 attempt IDs.',400)
    explicit_attempt_ids: list[uuid.UUID] = []
    if isinstance(requested_ids, list) and requested_ids:
        for x in requested_ids:
            u_id = core.uuid_value(x)
            if not u_id:
                return _err('invalid_input', 'Invalid attemptId in attemptIds.', 400)
            explicit_attempt_ids.append(u_id)

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            scope_sql, scope_args = _teacher_scope_sql(user, 'a.user_id', 1)
            args: list[Any] = [*scope_args, section]
            conds = [scope_sql, f's.skill = ${len(args)}', 's.submitted_at IS NOT NULL']

            if filter_mode == 'ungraded':
                if include_exported:
                    conds.append("s.status IN ('awaiting_export', 'exported', 'needs_review')")
                else:
                    conds.append("s.status = 'awaiting_export'")

            if explicit_attempt_ids:
                if not await _verify_teacher_can_access_attempts(con, user, explicit_attempt_ids):
                    return _err('forbidden', 'One or more requested student attempts are outside your assigned scope.', 403)
                args.append(explicit_attempt_ids)
                conds.append(f's.attempt_id = ANY(${len(args)}::uuid[])')

            student_filter=body.get('student')
            if student_filter is not None and not isinstance(student_filter,str):
                return _err('invalid_input','Invalid student filter.',400)
            if student_filter:
                if not isinstance(student_filter,str) or len(student_filter)>200:
                    return _err('invalid_input','Invalid student filter.',400)
                args.append('%'+student_filter.strip()+'%')
                conds.append(f'EXISTS(SELECT 1 FROM users u WHERE u.id=a.user_id AND (u.name ILIKE ${len(args)} OR u.id::text ILIKE ${len(args)}))')
            weekly_filter=body.get('weeklySlot')
            if weekly_filter is not None and not isinstance(weekly_filter,str):
                return _err('invalid_input','Invalid weekly slot.',400)
            if weekly_filter:
                if not isinstance(weekly_filter,str) or not re.fullmatch(r'\d{4}-W\d{2}',weekly_filter):
                    return _err('invalid_input','Invalid weekly slot.',400)
                args.append(weekly_filter);conds.append(f'a.weekly_slot=${len(args)}')

            if isinstance(date_from, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_from):
                args.append(date.fromisoformat(date_from))
                conds.append(f"(s.submitted_at AT TIME ZONE 'Asia/Tashkent')::date >= ${len(args)}::date")
            if isinstance(date_to, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_to):
                args.append(date.fromisoformat(date_to))
                conds.append(f"(s.submitted_at AT TIME ZONE 'Asia/Tashkent')::date <= ${len(args)}::date")

            rows = await con.fetch(
                f"""SELECT s.attempt_id, s.answer_hash, s.submitted_at,
                           a.user_id AS student_user_id, a.weekly_slot, a.mock_snapshot,
                           COALESCE(t.title, a.mock_snapshot->>'title', 'MOCK-01') AS test_title,
                           COALESCE(t.track, a.mock_snapshot->>'track', 'academic') AS track
                    FROM mock_section_submissions s
                    JOIN mock_attempts a ON a.id = s.attempt_id
                    LEFT JOIN mock_tests t ON t.id = a.mock_test_id
                    WHERE {' AND '.join(conds)}
                    ORDER BY s.submitted_at ASC, s.attempt_id ASC
                    LIMIT 200
                    FOR UPDATE OF s""",
                *args,
            )
            if not rows:
                return _err('no_submissions_for_export', 'No matching ungraded submissions found for export.', 404)

            attempt_uuids = [r['attempt_id'] for r in rows]
            entries_raw: list[dict[str, Any]] = []

            if section == 'writing':
                w_rows = await con.fetch(
                    'SELECT * FROM mock_writing_answers WHERE attempt_id = ANY($1::uuid[]) ORDER BY attempt_id, task_type',
                    attempt_uuids,
                )
                w_by_attempt: dict[uuid.UUID, dict[str, dict[str, Any]]] = {}
                for w in w_rows:
                    w_by_attempt.setdefault(w['attempt_id'], {})[w['task_type']] = dict(w)

                for r in rows:
                    aid = r['attempt_id']
                    tasks_map = w_by_attempt.get(aid, {})
                    t1 = tasks_map.get('task1', {})
                    t2 = tasks_map.get('task2', {})
                    digests = compute_writing_source_sha256(
                        str(aid),
                        str(t1.get('prompt_text') or ''),
                        str(t1.get('content') or ''),
                        t1.get('media_sha256'),
                        str(t2.get('prompt_text') or ''),
                        str(t2.get('content') or ''),
                    )
                    entries_raw.append({
                        'attemptId': str(aid),
                        'studentUserId': str(r['student_user_id']),
                        'testCode': r['test_title'],
                        'track': r['track'],
                        'submittedAt': _iso(r['submitted_at']),
                        'task1Prompt': str(t1.get('prompt_text') or ''),
                        'task1Answer': str(t1.get('content') or ''),
                        'task1MediaRef': t1.get('media_ref'),
                        'task1MediaSha256': t1.get('media_sha256'),
                        'task1Sha256': digests['task1Sha256'],
                        'task2Prompt': str(t2.get('prompt_text') or ''),
                        'task2Answer': str(t2.get('content') or ''),
                        'task2Sha256': digests['task2Sha256'],
                        'sourceSha256': digests['sourceSha256'],
                    })
            else:
                s_rows = await con.fetch(
                    'SELECT * FROM mock_speaking_audio WHERE attempt_id = ANY($1::uuid[]) ORDER BY attempt_id, part',
                    attempt_uuids,
                )
                s_by_attempt: dict[uuid.UUID, list[dict[str, Any]]] = {}
                for s in s_rows:
                    s_by_attempt.setdefault(s['attempt_id'], []).append(dict(s))
                from .mock_speaking_questions import question_mode
                question_attempts=[r['attempt_id'] for r in rows if question_mode(r)]
                if question_attempts:
                    q_rows=await con.fetch('SELECT * FROM mock_speaking_question_captures WHERE attempt_id=ANY($1::uuid[]) ORDER BY attempt_id,part,question_id',question_attempts)
                    for aid in question_attempts:s_by_attempt[aid]=[]
                    for recording in q_rows:s_by_attempt[recording['attempt_id']].append(dict(recording))

                for r in rows:
                    aid = r['attempt_id']
                    p_list = s_by_attempt.get(aid, [])
                    snap = r['mock_snapshot']
                    snap = json.loads(snap) if isinstance(snap, str) else (snap or {})
                    speaking_material = snap.get('speakingMaterial')
                    if not speaking_material:
                        # Fixed mode: read the frozen shared version, not today's bank.
                        speak_section = next((section for section in snap.get('sections', [])
                                              if section.get('skill') == 'speaking'), None)
                        if speak_section and speak_section.get('contentVersionId'):
                            version = await con.fetchrow('SELECT content_snapshot FROM content_versions WHERE id=$1',
                                                         uuid.UUID(speak_section['contentVersionId']))
                            if version:
                                speaking_material = version['content_snapshot']
                                if isinstance(speaking_material, str):
                                    speaking_material = json.loads(speaking_material)
                    source_parts = speaking_material.get('parts', []) if isinstance(speaking_material, dict) else []
                    question_order={(q.get('part'),str(q.get('questionId'))):n for n,q in enumerate(source_parts)}
                    p_list.sort(key=lambda p:(p['part'],question_order.get((p['part'],str(p.get('question_id'))),0)))
                    for part_audio in p_list:
                        part_code = part_audio['part']
                        qids = part_audio.get('question_ids') or []
                        if isinstance(qids, str): qids = json.loads(qids)
                        allowed_ids = set(map(str, qids))
                        part_audio['prompts'] = [str(q['promptText']) for q in source_parts
                            if q.get('part') == part_code and q.get('promptText') and
                               (not allowed_ids or str(q.get('questionId')) in allowed_ids)]
                        part_audio['cueCards']=[q['cueCard'] for q in source_parts if q.get('part')==part_code
                            and q.get('cueCard') and (not allowed_ids or str(q.get('questionId')) in allowed_ids)]
                    src_sha = compute_speaking_source_sha256(str(aid), p_list)
                    entries_raw.append({
                        'attemptId': str(aid),
                        'studentUserId': str(r['student_user_id']),
                        'testCode': r['test_title'],
                        'track': r['track'],
                        'submittedAt': _iso(r['submitted_at']),
                        'sourceSha256': src_sha,
                        'parts': [
                            {
                                'part': p['part'],
                                'questionIds': p['question_ids'] if isinstance(p['question_ids'], list) else json.loads(p['question_ids'] or '[]'),
                                'prompts': p.get('prompts', []),
                                'cueCards': p.get('cueCards', []),
                                **({'questionId':str(p['question_id']),'transcriptCapture':p['transcript_capture']}
                                   if p.get('question_id') else {}),
                                'objectKey': p['object_key'],
                                'codec': p['codec'],
                                'mimeType': p['mime_type'],
                                'bytes': p['bytes'],
                                'durationMs': p['duration_ms'],
                                'sha256': p['sha256'],
                                'captureStatus': p['capture_status'],
                                'startedAt': _iso(p['started_at']),
                                'endedAt': _iso(p['ended_at']),
                            }
                            for p in p_list
                        ],
                    })

            slot_code = current_weekly_slot()
            prefix = 'W' if section == 'writing' else 'S'
            seq_num = await con.fetchval('SELECT count(*)::int + 1 FROM mock_grading_batches WHERE section = $1', section)
            base_code = f'{prefix}-{slot_code}-{int(seq_num or 1):03d}'
            try:
                split_batches = split_into_stable_batches(base_code, entries_raw, max_per_batch=max_per_batch,
                    max_audio_bytes=64*1024*1024 if section=='speaking' else None)
            except ValueError:
                return _err('export_too_large','One attempt exceeds the 64 MB audio export limit.',413)

            created_batches = []
            for sub_b in split_batches:
                b_code = sub_b['batchCode']
                b_entries = sub_b['entries']
                alias_map: dict[str, dict[str, Any]] = {}
                for idx_e, entry in enumerate(b_entries, 1):
                    alias = make_student_alias(idx_e, entry['attemptId'])
                    entry['studentId'] = alias
                    alias_map[alias] = {
                        'studentUserId': entry['studentUserId'],
                        'attemptId': entry['attemptId'],
                        'sourceSha256': entry['sourceSha256'],
                        **({'speakingQuestions':[{'part':p['part'],'questionId':qid}
                             for p in entry.get('parts',[]) for qid in p.get('questionIds',[])]}
                           if section=='speaking' else {}),
                    }

                manifest_json = {
                    'schemaVersion': BATCH_SCHEMA_VERSION,
                    'batchId': b_code,
                    'section': section,
                    'scope': 'owner' if user['role'] == 'owner' else 'assigned',
                    'generatedAt': _iso(datetime.now(timezone.utc)),
                    'entries': [
                        {k: v for k, v in e.items() if k != 'studentUserId'}
                        for e in b_entries
                    ],
                }
                manifest_hash = canonical_json_sha256(manifest_json)
                manifest_json['exportManifestHash'] = manifest_hash

                batch_id = await con.fetchval(
                    """INSERT INTO mock_grading_batches
                       (batch_code, scope, section, filter_mode, date_from, date_to,
                        created_by, export_manifest_hash, manifest_json, student_alias_map, status)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, 'exported')
                       RETURNING id""",
                    b_code,
                    'owner' if user['role'] == 'owner' else 'assigned',
                    section,
                    filter_mode,
                    date.fromisoformat(date_from) if isinstance(date_from, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_from) else None,
                    date.fromisoformat(date_to) if isinstance(date_to, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_to) else None,
                    user['id'],
                    manifest_hash,
                    json.dumps(manifest_json, ensure_ascii=False),
                    json.dumps(alias_map, ensure_ascii=False),
                )

                sub_attempt_uuids = [uuid.UUID(e['attemptId']) for e in b_entries]
                await con.execute(
                    """UPDATE mock_section_submissions
                       SET status = CASE WHEN status = 'awaiting_export' THEN 'exported' ELSE status END,
                           updated_at = NOW()
                       WHERE attempt_id = ANY($1::uuid[]) AND skill = $2""",
                    sub_attempt_uuids,
                    section,
                )
                await _log_mock_audit(
                    con,
                    actor_user_id=user['id'],
                    batch_id=batch_id,
                    action=f'mock.batch.{section}.exported',
                    source_hash=manifest_hash,
                    metadata={'batchCode': b_code, 'attemptCount': len(b_entries)},
                )
                created_batches.append({
                    'id': str(batch_id),
                    'batchCode': b_code,
                    'section': section,
                    'attemptCount': len(b_entries),
                    'exportManifestHash': manifest_hash,
                    'downloadUrl': f'/api/staff/mocks/exports/{batch_id}/download',
                })

    return core.j({'ok': True, 'batches': created_batches}, headers=PRIVATE_HEADERS)


@router.get('/api/staff/mocks/exports/{batchId}/download')
async def download_staff_mock_export(req: Request, batchId: str):
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    bid = core.uuid_value(batchId)
    if not bid:
        return _err('not_found', 'Batch not found.', 404)

    db = await core.pool()
    async with db.acquire() as con:
        batch = await con.fetchrow('SELECT * FROM mock_grading_batches WHERE id = $1', bid)
        if not batch:
            return _err('not_found', 'Batch not found.', 404)
        if user['role'] == 'teacher' and batch['created_by'] != user['id']:
            return _err('forbidden', 'You can only download batches you created.', 403)

        alias_map = batch['student_alias_map']
        if isinstance(alias_map, str):
            alias_map = json.loads(alias_map)
        alias_map = alias_map or {}
        attempt_uuids = [uuid.UUID(v['attemptId']) for v in alias_map.values() if isinstance(v, dict) and v.get('attemptId')]

        # Re-check live teacher roster scope (Section 12 & 13: Teacher unassigned during review -> 403)
        if not await _verify_teacher_can_access_attempts(con, user, attempt_uuids):
            return _err('forbidden', 'One or more students in this batch are no longer assigned to you.', 403)

        manifest = batch['manifest_json']
        if isinstance(manifest, str):
            manifest = json.loads(manifest)
        manifest = dict(manifest or {})

        section = batch['section']
        batch_code = batch['batch_code']

        if section == 'writing':
            for entry in manifest.get('entries', []):
                media_ref = entry.get('task1MediaRef')
                if media_ref:
                    key=media_ref.removeprefix('/api/resources/') if isinstance(media_ref,str) else None
                    if not key or not valid_key(key):
                        return _err('export_media_unavailable','The pinned Task 1 image cannot be resolved.',409)
                    from .writing_exam_bank import graph_bytes as exam_graph_bytes
                    from .writing_source_materials import graph_bytes as source_graph_bytes
                    img_bytes=exam_graph_bytes(key) or source_graph_bytes(key) or await read_object(key)
                    if not img_bytes:
                        return _err('export_media_unavailable','Task 1 image is missing; an incomplete DOCX was not created.',503)
                    if entry.get('task1MediaSha256') and sha256_hex(img_bytes)!=entry['task1MediaSha256']:
                        return _err('export_media_changed','Task 1 image does not match the frozen source.',409)
                    entry['task1MediaBytes'] = img_bytes
            payload_bytes = await core.run_blocking(render_writing_batch_docx, manifest)
            media_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            filename = f'{batch_code}_Writing_Batch.docx'
        else:
            audio_blobs: dict[str, bytes] = {}
            total_audio_bytes=0
            for entry in manifest.get('entries', []):
                for p in entry.get('parts', []):
                    okey = p.get('objectKey')
                    if isinstance(okey, str) and valid_key(okey) and okey not in audio_blobs:
                        total_audio_bytes+=int(p.get('bytes') or 0)
                        if total_audio_bytes>64*1024*1024:
                            return _err('export_too_large','Select a smaller Speaking batch (audio limit: 64 MB).',413)
                        raw = await read_object(okey)
                        if not raw or len(raw)!=p.get('bytes') or sha256_hex(raw)!=p.get('sha256'):
                            return _err('export_audio_unavailable','Original audio is missing or changed; an incomplete ZIP was not created.',503)
                        audio_blobs[okey] = raw
                    elif not isinstance(okey,str) or not valid_key(okey):
                        return _err('export_audio_unavailable','Invalid pinned audio reference.',409)
            payload_bytes = await core.run_blocking(render_speaking_batch_zip, manifest, audio_blobs)
            media_type = 'application/zip'
            filename = f'{batch_code}_Speaking_Audio.zip'

        await _log_mock_audit(
            con,
            actor_user_id=user['id'],
            batch_id=bid,
            action=f'mock.batch.{section}.downloaded',
            source_hash=batch['export_manifest_hash'],
            metadata={'batchCode': batch_code, 'bytes': len(payload_bytes)},
        )

    safe_name = re.sub(r'[^A-Za-z0-9._-]', '_', filename)
    return Response(
        content=payload_bytes,
        media_type=media_type,
        headers={
            **PRIVATE_HEADERS,
            'Content-Disposition': f'attachment; filename="{safe_name}"',
            'X-Batch-Code': batch_code,
            'X-Export-Manifest-Sha256': batch['export_manifest_hash'],
        },
    )


async def _prepare_batch_validation(con, user: dict[str, Any], body: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None, Any]:
    batch_id_Or_code = str(body.get('batchId') or body.get('batch_id') or '').strip()
    raw_json = body.get('gradingJson') if 'gradingJson' in body else body.get('payload')
    if raw_json is None and 'schema_version' in body:
        raw_json = body

    if not batch_id_Or_code and isinstance(raw_json, dict):
        batch_id_Or_code = str(raw_json.get('batch_id') or '').strip()
    elif not batch_id_Or_code and isinstance(raw_json, str):
        try:
            parsed_peek = json.loads(raw_json)
            if isinstance(parsed_peek, dict):
                batch_id_Or_code = str(parsed_peek.get('batch_id') or '').strip()
        except Exception:
            pass

    if not batch_id_Or_code:
        return None, None, _err('missing_batch_id', 'Provide batchId or a JSON payload with batch_id.', 400)

    bid_uuid = core.uuid_value(batch_id_Or_code)
    if bid_uuid:
        batch = await con.fetchrow('SELECT * FROM mock_grading_batches WHERE id = $1', bid_uuid)
    else:
        batch = await con.fetchrow('SELECT * FROM mock_grading_batches WHERE batch_code = $1', batch_id_Or_code)

    if not batch:
        return None, None, _err('batch_not_found', 'Export batch not found.', 404)

    alias_map = batch['student_alias_map']
    if isinstance(alias_map, str):
        alias_map = json.loads(alias_map)
    alias_map = alias_map or {}
    attempt_uuids = [uuid.UUID(v['attemptId']) for v in alias_map.values() if isinstance(v, dict) and v.get('attemptId')]

    if not await _verify_teacher_can_access_attempts(con, user, attempt_uuids):
        return None, None, _err('forbidden', 'One or more students in this batch are outside your assigned roster.', 403)

    pub_rows = await con.fetch(
        """SELECT attempt_id FROM mock_section_submissions
           WHERE attempt_id = ANY($1::uuid[]) AND skill = $2 AND status = 'published'""",
        attempt_uuids,
        batch['section'],
    )
    already_published = {str(r['attempt_id']) for r in pub_rows}

    hash_rows = await con.fetch(
        """SELECT payload_sha256 FROM mock_grading_revisions
           WHERE batch_id = $1 AND source = 'gemini_manual'""",
        batch['id'],
    )
    existing_hashes = {str(r['payload_sha256']) for r in hash_rows}

    batch_record = {
        'id': str(batch['id']),
        'batchCode': batch['batch_code'],
        'section': batch['section'],
        'studentAliasMap': alias_map,
    }
    report = validate_gemini_grading_json(
        raw_json,
        batch_record,
        already_published_attempts=already_published,
        existing_payload_hashes=existing_hashes,
    )
    return dict(batch), report, None


@router.post('/api/staff/mocks/grade-imports/validate')
async def validate_staff_grade_import(req: Request):
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Expected JSON body.', 400)

    db = await core.pool()
    async with db.acquire() as con:
        batch, report, err = await _prepare_batch_validation(con, user, body)
        if err:
            return err
    return core.j({'ok': True, 'dryRun': True, 'report': report}, headers=PRIVATE_HEADERS)


@router.post('/api/staff/mocks/grade-imports/commit')
async def commit_staff_grade_import(req: Request):
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Expected JSON body.', 400)

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            batch, report, err = await _prepare_batch_validation(con, user, body)
            if err:
                return err
            assert batch is not None and report is not None

            if not report['ok']:
                for issue in report.get('issues', []):
                    await con.execute(
                        """INSERT INTO mock_grading_import_issues
                           (batch_id, row_number, attempt_id, student_alias, error_code, details, created_by)
                           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                        batch['id'],
                        issue.get('rowNumber'),
                        core.uuid_value(issue.get('attemptId')),
                        issue.get('studentAlias'),
                        issue.get('errorCode') or 'validation_error',
                        issue.get('details') or 'Validation error',
                        user['id'],
                    )
                return core.j({'ok': False, 'committed': False, 'report': report}, status=422, headers=PRIVATE_HEADERS)

            created_revisions = []
            for row in report['validRows']:
                aid = uuid.UUID(row['attemptId'])
                if row.get('idempotentDuplicate'):
                    existing_rev_id = await con.fetchval(
                        """SELECT id FROM mock_grading_revisions
                           WHERE batch_id = $1 AND attempt_id = $2 AND section = $3 AND payload_sha256 = $4""",
                        batch['id'],
                        aid,
                        row['section'],
                        row['payloadSha256'],
                    )
                    created_revisions.append({'revisionId': str(existing_rev_id), 'attemptId': row['attemptId'], 'idempotent': True})
                    continue

                prev_rev_id = await con.fetchval(
                    """SELECT id FROM mock_grading_revisions
                       WHERE attempt_id = $1 AND section = $2 AND status <> 'superseded'
                       ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
                    aid,
                    row['section'],
                )
                if prev_rev_id:
                    await con.execute(
                        "UPDATE mock_grading_revisions SET status = 'superseded' WHERE id = $1 AND status IN ('imported_draft', 'needs_review')",
                        prev_rev_id,
                    )

                rev_id = await con.fetchval(
                    """INSERT INTO mock_grading_revisions
                       (attempt_id, section, batch_id, rubric_version, source, status,
                        payload_json, raw_gemini_json, payload_sha256, source_sha256,
                        calculated_band, task1_band, task2_band, author_user_id, supersedes_id)
                       VALUES ($1, $2, $3, $4, 'gemini_manual', $5,
                               $6::jsonb, $7::jsonb, $8, $9,
                               $10, $11, $12, $13, $14)
                       RETURNING id""",
                    aid,
                    row['section'],
                    batch['id'],
                    row['rubricVersion'],
                    row['status'],
                    json.dumps(row['payloadJson'], ensure_ascii=False),
                    json.dumps(row['rawGeminiJson'], ensure_ascii=False),
                    row['payloadSha256'],
                    row['sourceSha256'],
                    row['calculatedBand'],
                    row['task1Band'],
                    row['task2Band'],
                    user['id'],
                    prev_rev_id,
                )

                await con.execute(
                    """UPDATE mock_section_submissions
                       SET status = $3, band = $4, updated_at = NOW()
                       WHERE attempt_id = $1 AND skill = $2 AND status <> 'published'""",
                    aid,
                    row['section'],
                    row['status'],
                    row['calculatedBand'],
                )

                await _log_mock_audit(
                    con,
                    actor_user_id=user['id'],
                    attempt_id=aid,
                    batch_id=batch['id'],
                    action=f"mock.grade.{row['section']}.imported",
                    source_hash=row['sourceSha256'],
                    old_revision_id=prev_rev_id,
                    new_revision_id=rev_id,
                    metadata={'status': row['status'], 'calculatedBand': row['calculatedBand']},
                )
                created_revisions.append({'revisionId': str(rev_id), 'attemptId': row['attemptId'], 'idempotent': False})

            for issue in report.get('issues', []):
                await con.execute(
                    """INSERT INTO mock_grading_import_issues
                       (batch_id, row_number, attempt_id, student_alias, error_code, details, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                    batch['id'],
                    issue.get('rowNumber'),
                    core.uuid_value(issue.get('attemptId')),
                    issue.get('studentAlias'),
                    issue.get('errorCode') or 'import_warning',
                    issue.get('details') or '',
                    user['id'],
                )

            batch_next_status = 'needs_review' if (report['counts']['needsReview'] > 0 or report['counts']['missing'] > 0) else 'imported_draft'
            await con.execute(
                'UPDATE mock_grading_batches SET status = $2 WHERE id = $1',
                batch['id'],
                batch_next_status,
            )

    return core.j({
        'ok': True,
        'committed': True,
        'batchStatus': batch_next_status,
        'revisions': created_revisions,
        'report': report,
    }, headers=PRIVATE_HEADERS)


@router.post('/api/staff/mocks/grades/{revisionId}/revise')
async def revise_staff_mock_grade(req: Request, revisionId: str):
    """Create a new append-only grading revision when Teacher/Owner edits criteria or feedback."""
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    rid = core.uuid_value(revisionId)
    if not rid:
        return _err('not_found', 'Revision not found.', 404)

    body = await core.payload(req)
    if not isinstance(body, dict):
        return _err('invalid_input', 'Invalid revision payload.', 400)

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            rev = await con.fetchrow('SELECT * FROM mock_grading_revisions WHERE id = $1 FOR UPDATE', rid)
            if not rev:
                return _err('not_found', 'Revision not found.', 404)
            if not await _verify_teacher_can_access_attempts(con, user, [rev['attempt_id']]):
                return _err('forbidden', 'Student is outside your assigned roster.', 403)

            old_payload = rev['payload_json']
            if isinstance(old_payload, str):
                old_payload = json.loads(old_payload)
            updated_payload = json.loads(json.dumps(old_payload or {}))

            section = rev['section']
            if section == 'writing':
                if isinstance(body.get('tasks'), dict):
                    for t_key, crit_keys in (('task1', WRITING_TASK1_CRITERIA), ('task2', WRITING_TASK2_CRITERIA)):
                        if isinstance(body['tasks'].get(t_key), dict):
                            src_t = body['tasks'][t_key]
                            dst_t = updated_payload.setdefault('tasks', {}).setdefault(t_key, {'criteria': {}, 'feedback': '', 'explanations': [], 'errors': []})
                            if isinstance(src_t.get('criteria'), dict):
                                for ck in crit_keys:
                                    if ck in src_t['criteria']:
                                        val = src_t['criteria'][ck]
                                        if not isinstance(val, int) or isinstance(val, bool) or not (0 <= val <= 9):
                                            return _err('invalid_criterion', f'{t_key}.{ck} must be integer 0..9.', 400)
                                        dst_t.setdefault('criteria', {})[ck] = val
                            if isinstance(src_t.get('feedback'), str):
                                dst_t['feedback'] = src_t['feedback'].strip()[:8000]
                if isinstance(body.get('overallFeedback'), str):
                    updated_payload['overall_feedback'] = body['overallFeedback'].strip()[:8000]
                updated_payload['status'] = 'graded'
                updated_payload['review_reason'] = None
                t1_c = updated_payload.get('tasks', {}).get('task1', {}).get('criteria', {})
                t2_c = updated_payload.get('tasks', {}).get('task2', {}).get('criteria', {})
                bands = compute_writing_bands(t1_c, t2_c)
                if bands['band'] is None:
                    return _err('incomplete_criteria', 'All 4 criteria for Task 1 and Task 2 must be integers 0..9.', 400)
                calc_band = bands['band']
                t1_band = bands['task1Band']
                t2_band = bands['task2Band']
            else:
                if isinstance(body.get('criteria'), dict):
                    dst_c = updated_payload.setdefault('criteria', {})
                    for ck in SPEAKING_CRITERIA:
                        if ck in body['criteria']:
                            val = body['criteria'][ck]
                            if not isinstance(val, int) or isinstance(val, bool) or not (0 <= val <= 9):
                                return _err('invalid_criterion', f'{ck} must be integer 0..9.', 400)
                            dst_c[ck] = val
                if isinstance(body.get('overallFeedback'), str):
                    updated_payload['overall_feedback'] = body['overallFeedback'].strip()[:8000]
                updated_payload['status'] = 'graded'
                updated_payload['review_reason'] = None
                s_bands = compute_speaking_band(updated_payload.get('criteria', {}))
                if s_bands['band'] is None:
                    return _err('incomplete_criteria', 'All 4 Speaking criteria must be integers 0..9.', 400)
                calc_band = s_bands['band']
                t1_band = None
                t2_band = None

            new_payload_sha = canonical_json_sha256(updated_payload)
            source_type = 'owner_revision' if user['role'] == 'owner' else 'teacher_revision'

            await con.execute("UPDATE mock_grading_revisions SET status = 'superseded' WHERE id = $1", rid)
            new_rev_id = await con.fetchval(
                """INSERT INTO mock_grading_revisions
                   (attempt_id, section, batch_id, rubric_version, source, status,
                    payload_json, raw_gemini_json, payload_sha256, source_sha256,
                    calculated_band, task1_band, task2_band, author_user_id, supersedes_id)
                   VALUES ($1, $2, $3, $4, $5, 'imported_draft',
                           $6::jsonb, $7::jsonb, $8, $9,
                           $10, $11, $12, $13, $14)
                   RETURNING id""",
                rev['attempt_id'],
                section,
                rev['batch_id'],
                rev['rubric_version'],
                source_type,
                json.dumps(updated_payload, ensure_ascii=False),
                rev['raw_gemini_json'] if isinstance(rev['raw_gemini_json'], str) else json.dumps(rev['raw_gemini_json'] or {}, ensure_ascii=False),
                new_payload_sha,
                rev['source_sha256'],
                calc_band,
                t1_band,
                t2_band,
                user['id'],
                rid,
            )

            await con.execute(
                """UPDATE mock_section_submissions
                   SET status = 'imported_draft', band = $3, updated_at = NOW()
                   WHERE attempt_id = $1 AND skill = $2""",
                rev['attempt_id'],
                section,
                calc_band,
            )

            await _log_mock_audit(
                con,
                actor_user_id=user['id'],
                attempt_id=rev['attempt_id'],
                batch_id=rev['batch_id'],
                action=f'mock.grade.{section}.revised',
                source_hash=rev['source_sha256'],
                old_revision_id=rid,
                new_revision_id=new_rev_id,
                metadata={'calculatedBand': calc_band, 'source': source_type},
            )

    return core.j({
        'ok': True,
        'oldRevisionId': str(rid),
        'revisionId': str(new_rev_id),
        'calculatedBand': calc_band,
        'task1Band': t1_band,
        'task2Band': t2_band,
        'status': 'imported_draft',
    }, headers=PRIVATE_HEADERS)


@router.post('/api/staff/mocks/grades/{revisionId}/approve')
async def approve_staff_mock_grade(req: Request, revisionId: str):
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    rid = core.uuid_value(revisionId)
    if not rid:
        return _err('not_found', 'Revision not found.', 404)

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            rev = await con.fetchrow('SELECT * FROM mock_grading_revisions WHERE id = $1 FOR UPDATE', rid)
            if not rev:
                return _err('not_found', 'Revision not found.', 404)
            if not await _verify_teacher_can_access_attempts(con, user, [rev['attempt_id']]):
                return _err('forbidden', 'Student is outside your assigned roster.', 403)
            if rev['status'] == 'superseded':
                return _err('revision_superseded', 'This revision was superseded by a newer revision.', 409)
            if rev['calculated_band'] is None:
                return _err('incomplete_grade', 'Cannot approve a revision with missing criterion scores.', 409)

            if rev['status'] in ('approved', 'published'):
                return core.j({
                    'ok': True,
                    'idempotent': True,
                    'revisionId': str(rid),
                    'status': rev['status'],
                    'calculatedBand': float(rev['calculated_band']),
                }, headers=PRIVATE_HEADERS)

            await con.execute(
                """UPDATE mock_grading_revisions
                   SET status = 'approved', approved_by = $2, approved_at = NOW()
                   WHERE id = $1""",
                rid,
                user['id'],
            )
            await con.execute(
                """UPDATE mock_section_submissions
                   SET status = 'approved', band = $3, updated_at = NOW()
                   WHERE attempt_id = $1 AND skill = $2""",
                rev['attempt_id'],
                rev['section'],
                rev['calculated_band'],
            )
            await _log_mock_audit(
                con,
                actor_user_id=user['id'],
                attempt_id=rev['attempt_id'],
                batch_id=rev['batch_id'],
                action=f"mock.grade.{rev['section']}.approved",
                source_hash=rev['source_sha256'],
                new_revision_id=rid,
                metadata={'calculatedBand': float(rev['calculated_band'])},
            )

    return core.j({
        'ok': True,
        'idempotent': False,
        'revisionId': str(rid),
        'status': 'approved',
        'calculatedBand': float(rev['calculated_band']),
    }, headers=PRIVATE_HEADERS)


@router.post('/api/staff/mocks/batches/{batchId}/publish')
async def publish_staff_mock_batch(req: Request, batchId: str):
    """Bulk-publish approved grades in a batch. Updates full mock overall band ONLY when all 4 sections exist."""
    user = await _auth_user(req)
    err_resp = _require_teacher_or_owner(user)
    if err_resp:
        return err_resp
    bid = core.uuid_value(batchId)
    if not bid:
        return _err('not_found', 'Batch not found.', 404)

    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            batch = await con.fetchrow('SELECT * FROM mock_grading_batches WHERE id = $1 FOR UPDATE', bid)
            if not batch:
                return _err('not_found', 'Batch not found.', 404)

            revs = await con.fetch(
                """SELECT r.*, a.user_id AS student_user_id
                   FROM mock_grading_revisions r
                   JOIN mock_attempts a ON a.id = r.attempt_id
                   WHERE r.batch_id = $1 AND r.status <> 'superseded'
                   ORDER BY r.created_at ASC FOR UPDATE OF r""",
                bid,
            )
            if not revs:
                return _err('empty_batch', 'No grading revisions found in this batch.', 409)

            all_attempt_ids = [r['attempt_id'] for r in revs]
            if not await _verify_teacher_can_access_attempts(con, user, all_attempt_ids):
                return _err('forbidden', 'One or more students in this batch are outside your assigned roster.', 403)

            published_count = 0
            skipped_unapproved: list[str] = []
            overall_completed_attempts: list[str] = []

            for rev in revs:
                aid = rev['attempt_id']
                if rev['status'] == 'published':
                    published_count += 1
                    continue
                if rev['status'] != 'approved' or rev['calculated_band'] is None:
                    skipped_unapproved.append(str(aid))
                    continue

                await con.execute(
                    """UPDATE mock_grading_revisions
                       SET status = 'published', published_by = $2, published_at = NOW()
                       WHERE id = $1""",
                    rev['id'],
                    user['id'],
                )
                await con.execute(
                    """UPDATE mock_section_submissions
                       SET status = 'published', band = $3, updated_at = NOW()
                       WHERE attempt_id = $1 AND skill = $2""",
                    aid,
                    rev['section'],
                    rev['calculated_band'],
                )

                # Check if all 4 sections of the Full Mock attempt now have valid approved/completed bands!
                sec_rows = await con.fetch(
                    'SELECT skill, status, raw_score, score_max, band FROM mock_section_submissions WHERE attempt_id = $1 FOR UPDATE',
                    aid,
                )
                bands_map: dict[str, float | None] = {}
                for s in sec_rows:
                    sk = s['skill']
                    if sk in ('listening', 'reading') and s['status'] in ('auto_graded', 'completed', 'published') and s['band'] is not None:
                        bands_map[sk] = float(s['band'])
                    elif sk in ('writing', 'speaking') and s['status'] == 'published' and s['band'] is not None:
                        bands_map[sk] = float(s['band'])
                    else:
                        bands_map[sk] = None

                overall_band = compute_overall_mock_band(bands_map)
                sec_results = [
                    {
                        'skill': s['skill'],
                        'raw': s['raw_score'],
                        'total': s['score_max'],
                        'band': bands_map.get(s['skill']),
                        'status': s['status'],
                    }
                    for s in sec_rows
                ]

                if overall_band is not None:
                    await con.execute(
                        """UPDATE mock_attempts
                           SET status = 'published',
                               finalized_at = COALESCE(finalized_at, NOW()),
                               finished_at = COALESCE(finished_at, NOW()),
                               estimated_band = $2,
                               skill_breakdown = $3::jsonb,
                               section_results = $4::jsonb
                           WHERE id = $1""",
                        aid,
                        overall_band,
                        json.dumps(bands_map),
                        json.dumps(sec_results),
                    )
                    overall_completed_attempts.append(str(aid))
                else:
                    await con.execute(
                        """UPDATE mock_attempts
                           SET skill_breakdown = $2::jsonb,
                               section_results = $3::jsonb
                           WHERE id = $1""",
                        aid,
                        json.dumps(bands_map),
                        json.dumps(sec_results),
                    )

                # Notify the student
                await con.execute(
                    """INSERT INTO notifications (user_id, type, title, body, href, payload)
                       VALUES ($1, 'MOCK_GRADE_PUBLISHED', $2, $3, $4, $5::jsonb)""",
                    rev['student_user_id'],
                    f"Mock {rev['section'].title()} result published",
                    (
                        f"Your full mock overall band ({overall_band:.1f}) and {rev['section'].title()} feedback are ready."
                        if overall_band is not None
                        else f"Your mock {rev['section'].title()} band ({float(rev['calculated_band']):.1f}) and feedback are ready."
                    ),
                    f'/app/mocks?attempt={aid}',
                    json.dumps({'attemptId': str(aid), 'section': rev['section'], 'overallBand': overall_band}),
                )

                await _log_mock_audit(
                    con,
                    actor_user_id=user['id'],
                    attempt_id=aid,
                    batch_id=bid,
                    action=f"mock.grade.{rev['section']}.published",
                    source_hash=rev['source_sha256'],
                    new_revision_id=rev['id'],
                    metadata={'band': float(rev['calculated_band']), 'overallBand': overall_band},
                )
                published_count += 1

            total_in_batch = len(revs)
            all_done = published_count == total_in_batch and len(skipped_unapproved) == 0
            new_batch_status = 'published' if all_done else ('approved' if published_count > 0 else batch['status'])
            await con.execute(
                """UPDATE mock_grading_batches
                   SET status = $2,
                       published_at = CASE WHEN $3 THEN COALESCE(published_at, NOW()) ELSE published_at END,
                       published_by = CASE WHEN $3 THEN $4 ELSE published_by END
                   WHERE id = $1""",
                bid,
                new_batch_status,
                all_done,
                user['id'],
            )

    return core.j({
        'ok': True,
        'batchId': str(bid),
        'batchCode': batch['batch_code'],
        'batchStatus': new_batch_status,
        'publishedCount': published_count,
        'totalCount': total_in_batch,
        'skippedCount': len(skipped_unapproved),
        'skippedAttemptIds': skipped_unapproved,
        'overallCompletedAttemptIds': overall_completed_attempts,
        'summaryMessage': f'{published_count} of {total_in_batch} published',
    }, headers=PRIVATE_HEADERS)


def install():
    core.app.include_router(router)
    from .mock_authoring_port import router as authoring_router
    core.app.include_router(authoring_router)
    from .mock_speaking_questions import router as question_capture_router
    core.app.include_router(question_capture_router)
