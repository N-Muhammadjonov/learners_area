"""Role-gated, non-destructive Weekly IELTS Mock authoring.

A mock binds existing published content versions, never fabricates assessments.
Teacher can edit only own unpublished drafts; Owner can edit all drafts.
Publication is blocked until the existing runner's integrity validator accepts all five materials.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Request

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
    if row['publication_state'] != 'published' or row['module'] != skill or not row['content_snapshot']:
        return False
    if subtype and row['content_type'] != subtype:
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
        # Metadata only. Never send private answer keys or snapshots to staff catalogue.
        versions = await con.fetch(
            """SELECT id, title, module, content_type, track, source_ref, version_no
               FROM content_versions
               WHERE publication_state = 'published' AND content_snapshot IS NOT NULL
                 AND module IN ('listening','reading','writing','speaking')
               ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 1000"""
        )
    by_test: dict[str, dict[str, str]] = {}
    for s in sections:
        key = 'writingTask1' if s['skill'] == 'writing' and s['content_type'] == 'task1' else (
            'writingTask2' if s['skill'] == 'writing' and s['content_type'] == 'task2' else s['skill'])
        if key in SLOT_BY_KEY and s['content_version_id']:
            by_test.setdefault(str(s['mock_test_id']), {})[key] = str(s['content_version_id'])
    return core.j({'ok': True,
        'tests': [{'id': str(t['id']), 'title': t['title'], 'track': t['track'],
                   'status': t['publication_state'], 'version': t['version'],
                   'sections': by_test.get(str(t['id']), {})} for t in rows],
        'versions': [{'id': str(v['id']), 'title': v['title'], 'module': v['module'],
                      'contentType': v['content_type'], 'track': v['track'] or 'unspecified',
                      'version': v['version_no']} for v in versions],
    }, headers=mock.PRIVATE_HEADERS)


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
    if publish and any(not selected.get(key) for key in SLOT_BY_KEY):
        return mock._err('missing_sections', 'All five published materials are required before publishing.', 422)
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
            source_rows = await con.fetch(
                """SELECT id, title, module, content_type, track, source_ref,
                          publication_state, content_snapshot
                   FROM content_versions WHERE id = ANY($1::uuid[]) FOR SHARE""",
                list(bindings.values()),
            ) if bindings else []
            source_map = {r['id']: dict(r) for r in source_rows}
            new_sections = []
            for position, (key, skill, subtype, count, seconds) in enumerate(SLOTS, 1):
                vid = bindings.get(key)
                if not vid:
                    continue
                source = source_map.get(vid)
                if not source or not _eligible_version(source, skill, subtype, track):
                    return mock._err('unpublished_or_mismatched_material',
                                     f'{key} must reference a published {track} content version.', 422)
                ref = str(source['source_ref'] or vid)
                if len(ref) > 80:
                    return mock._err('invalid_source_ref', f'{key} source reference is too long.', 422)
                new_sections.append({'position': position, 'skill': skill, 'module': skill,
                                     'content_type': subtype or source['content_type'],
                                     'source_ref': ref, 'content_version_id': vid,
                                     'question_count': count, 'seconds': seconds})
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
                   'status': 'published' if publish else 'draft'}, headers=mock.PRIVATE_HEADERS)
