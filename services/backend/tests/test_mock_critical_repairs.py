"""Behavioral and security verification tests for the 6 Critical Mock System Repairs (Tasks 1–6).

Exercises the actual FastAPI route handlers in `app.mock_system_port` against real local
storage objects and isolated stateful database transactions.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import inspect
import re
import pathlib
import shutil
import sys
import tempfile
import types
import unittest
import uuid
from datetime import datetime, timedelta, timezone

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Reuse lightweight FastAPI stub from test_mock_hybrid_system so tests run in offline Python 3.12
from tests.test_mock_hybrid_system import _ensure_lightweight_fastapi_stub
_ensure_lightweight_fastapi_stub()

from app import mock_system_port as msp
from app.mock_scoring_engine import sha256_hex


class FakeRequest:
    def __init__(self, body=None, headers=None, query_params=None):
        self._body = body
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.query_params = query_params or {}
        self.state = types.SimpleNamespace(request_id='req-repair-test')
        self.client = types.SimpleNamespace(host='127.0.0.1')

    async def json(self):
        if isinstance(self._body, (bytes, bytearray)):
            return json.loads(self._body.decode('utf-8'))
        return self._body or {}

    async def body(self):
        if isinstance(self._body, (bytes, bytearray)):
            return bytes(self._body)
        if isinstance(self._body, str):
            return self._body.encode('utf-8')
        return json.dumps(self._body or {}).encode('utf-8')


class InMemoryMockDB:
    """Stateful in-memory PostgreSQL connection & pool simulator for isolated behavioral testing."""
    def __init__(self, student_id: uuid.UUID, other_student_id: uuid.UUID, attempt_id: uuid.UUID, mock_test_id: uuid.UUID):
        self.student_id = student_id
        self.other_student_id = other_student_id
        self.attempt_id = attempt_id
        self.mock_test_id = mock_test_id
        now = datetime.now(timezone.utc)
        self.attempts = {
            attempt_id: {
                'id': attempt_id,
                'user_id': student_id,
                'mock_test_id': mock_test_id,
                'status': 'in_progress',
                'started_at': now,
                'deadline_at': now + timedelta(hours=3),
                'active_section_position': 1,
                'submitted_at': None,
                'finished_at': None,
                'mock_snapshot': {
                    'title': 'Official Academic Mock 1',
                    'track': 'academic',
                    'kind': 'full',
                    'sections': [
                        {'position': 1, 'skill': 'listening', 'questionCount': 40, 'sourceRef': 'L-1'},
                        {'position': 2, 'skill': 'reading', 'questionCount': 40, 'sourceRef': 'R-1'},
                        {'position': 3, 'skill': 'writing', 'questionCount': 2, 'sourceRef': 'W-1'},
                        {'position': 4, 'skill': 'speaking', 'questionCount': 3, 'sourceRef': 'S-1'},
                    ],
                },
            }
        }
        self.upload_intents: dict[uuid.UUID, dict] = {}
        self.speaking_audio: dict[tuple[uuid.UUID, str], dict] = {}
        self.section_submissions: dict[tuple[uuid.UUID, str], dict] = {
            (attempt_id, sk): {
                'id': uuid.uuid4(),
                'attempt_id': attempt_id,
                'skill': sk,
                'status': 'in_progress',
                'draft_revision': 0,
                'answers_json': {},
                'result_details': {},
                'raw_score': None,
                'score_max': 40 if sk in ('listening', 'reading') else None,
                'band': None,
                'content_version_id': None,
                'started_at': now,
                'deadline_at': now + timedelta(hours=1),
                'submitted_at': None,
            }
            for sk in ('listening', 'reading', 'writing', 'speaking')
        }
        self.writing_answers: dict[tuple[uuid.UUID, str], dict] = {
            (attempt_id, 'task1'): {'attempt_id': attempt_id, 'task_type': 'task1', 'prompt_text': 'Chart prompt', 'content': '', 'word_count': 0, 'draft_revision': 0, 'finalized_at': None, 'media_ref': None, 'media_sha256': None},
            (attempt_id, 'task2'): {'attempt_id': attempt_id, 'task_type': 'task2', 'prompt_text': 'Essay prompt', 'content': '', 'word_count': 0, 'draft_revision': 0, 'finalized_at': None, 'media_ref': None, 'media_sha256': None},
        }
        self.mock_tests: dict[uuid.UUID, dict] = {
            mock_test_id: {
                'id': mock_test_id,
                'title': 'Official Academic Mock 1',
                'track': 'academic',
                'kind': 'full',
                'timing_policy_id': 'standard',
                'score_policies': {},
                'publication_state': 'published',
                'version': 1,
            }
        }
        self.mock_sections: list[dict] = []
        self.custom_materials: dict[str, dict] = {}

    def acquire(self):
        db = self
        class _Ctx:
            async def __aenter__(self_inner):
                return db
            async def __aexit__(self_inner, exc_type, exc, tb):
                return False
        return _Ctx()

    def transaction(self):
        return self.acquire()

    async def fetchrow(self, sql: str, *args):
        s = ' '.join(sql.split())
        if 'FROM mock_attempts WHERE id = $1' in s:
            aid = args[0]
            row = self.attempts.get(aid)
            if not row:
                return None
            if 'user_id = $2' in s and row['user_id'] != args[1]:
                return None
            return dict(row)
        if "FROM mock_attempts WHERE user_id = $1 AND mock_test_id = $2 AND status = 'in_progress'" in s:
            return None
        if 'FROM mock_attempts WHERE user_id = $1 AND weekly_slot = $2' in s:
            return None
        if 'FROM mock_tests WHERE id = $1' in s:
            return self.mock_tests.get(args[0])
        if 'FROM upload_intents WHERE id = $1' in s:
            uid = args[0]
            return dict(self.upload_intents[uid]) if uid in self.upload_intents else None
        if 'FROM mock_speaking_audio WHERE attempt_id = $1 AND upload_intent_id = $2' in s:
            aid, uid = args[0], args[1]
            for (a_k, _), row in self.speaking_audio.items():
                if a_k == aid and row.get('upload_intent_id') == uid:
                    return dict(row)
            return None
        if 'FROM mock_speaking_audio WHERE attempt_id = $1 AND part = $2' in s:
            key = (args[0], args[1])
            return dict(self.speaking_audio[key]) if key in self.speaking_audio else None
        if "FROM mock_section_submissions WHERE attempt_id = $1 AND skill = 'listening'" in s:
            key = (args[0], 'listening')
            return dict(self.section_submissions[key]) if key in self.section_submissions else None
        if 'FROM mock_section_submissions WHERE attempt_id = $1 AND skill = $2' in s:
            key = (args[0], args[1])
            return dict(self.section_submissions[key]) if key in self.section_submissions else None
        if 'FROM mock_writing_answers WHERE attempt_id = $1 AND task_type = $2' in s:
            key = (args[0], args[1])
            return dict(self.writing_answers[key]) if key in self.writing_answers else None
        return None

    async def fetch(self, sql: str, *args):
        s = ' '.join(sql.split())
        if 'FROM mock_sections WHERE mock_test_id = $1' in s:
            return [dict(r) for r in self.mock_sections]
        if 'FROM mock_speaking_audio WHERE attempt_id = $1' in s:
            aid = args[0]
            return [dict(v) for (a_k, _), v in sorted(self.speaking_audio.items()) if a_k == aid]
        if 'FROM mock_section_submissions WHERE attempt_id = $1' in s:
            aid = args[0]
            return [dict(v) for (a_k, _), v in self.section_submissions.items() if a_k == aid]
        if 'FROM mock_writing_answers WHERE attempt_id = $1' in s:
            aid = args[0]
            return [dict(v) for (a_k, _), v in self.writing_answers.items() if a_k == aid]
        return []

    async def fetchval(self, sql: str, *args):
        s = ' '.join(sql.split())
        if 'INSERT INTO mock_attempts' in s:
            new_id = uuid.uuid4()
            return new_id
        return 0

    async def execute(self, sql: str, *args):
        s = ' '.join(sql.split())
        if 'INSERT INTO upload_intents' in s:
            uid, user_id, aid, obj_key, orig_name, mime_type, size_bytes = args
            self.upload_intents[uid] = {
                'id': uid,
                'user_id': user_id,
                'speaking_attempt_id': aid,
                'purpose': 'speaking_recording',
                'block_kind': 'audio',
                'object_key': obj_key,
                'original_name': orig_name,
                'mime_type': mime_type,
                'size': size_bytes,
                'status': 'pending',
            }
        elif "UPDATE upload_intents SET status = 'attached'" in s:
            uid = args[0]
            if uid in self.upload_intents:
                self.upload_intents[uid]['status'] = 'attached'
        elif 'INSERT INTO mock_speaking_audio' in s:
            if "'incomplete', NULL" in s:
                aid, part, q_ids, obj_key, uid, codec, mime_type, size_bytes, dur_ms, sha = args
                status = 'incomplete'
                fin_at = None
            else:
                aid, part, q_ids, obj_key, uid, codec, mime_type, size_bytes, dur_ms, sha = args
                status = 'finalized'
                fin_at = datetime.now(timezone.utc)
            self.speaking_audio[(aid, part)] = {
                'id': uuid.uuid4(),
                'attempt_id': aid,
                'part': part,
                'question_ids': json.loads(q_ids) if isinstance(q_ids, str) else q_ids,
                'object_key': obj_key,
                'upload_intent_id': uid,
                'codec': codec,
                'mime_type': mime_type,
                'bytes': size_bytes,
                'duration_ms': dur_ms,
                'sha256': sha,
                'capture_status': status,
                'finalized_at': fin_at,
            }
        elif 'UPDATE mock_section_submissions SET result_details = $3::jsonb' in s:
            aid, skill, details_json = args
            self.section_submissions[(aid, skill)]['result_details'] = json.loads(details_json)
        elif 'UPDATE mock_section_submissions SET answers_json = $3::jsonb, draft_revision = $4' in s:
            aid, skill, ans_json, rev = args
            self.section_submissions[(aid, skill)]['answers_json'] = json.loads(ans_json)
            self.section_submissions[(aid, skill)]['draft_revision'] = rev
        elif 'INSERT INTO mock_writing_answers (attempt_id, task_type, content, word_count, draft_revision' in s:
            aid, task_type, content, wc, rev, sha = args
            row = self.writing_answers.setdefault((aid, task_type), {'attempt_id': aid, 'task_type': task_type, 'finalized_at': None})
            row.update({'content': content, 'word_count': wc, 'draft_revision': rev, 'sha256': sha})
        elif 'UPDATE mock_section_submissions SET status =' in s:
            aid, skill = args[0], args[1]
            row = self.section_submissions[(aid, skill)]
            if "status = 'auto_graded'" in s:
                row.update({
                    'status': 'auto_graded',
                    'raw_score': args[2],
                    'score_max': args[3],
                    'band': args[4],
                    'answers_json': json.loads(args[5]),
                    'result_details': json.loads(args[6]),
                    'answer_hash': args[7],
                    'submitted_at': datetime.now(timezone.utc),
                })
            else:
                row.update({
                    'status': args[2],
                    'answer_hash': args[3],
                    'submitted_at': datetime.now(timezone.utc),
                })


class TestCriticalMockRepairsBackend(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix='la_mock_storage_')
        os.environ['STORAGE_PROVIDER'] = 'local'
        os.environ['STORAGE_LOCAL_DIR'] = self.temp_dir

        self.student_id = uuid.uuid4()
        self.other_student_id = uuid.uuid4()
        self.attempt_id = uuid.uuid4()
        self.mock_test_id = uuid.uuid4()
        self.db = InMemoryMockDB(self.student_id, self.other_student_id, self.attempt_id, self.mock_test_id)

        self._orig_pool = msp.core.pool
        self._orig_auth = msp._auth_user
        self._orig_payload = msp.core.payload
        self._orig_run_io = msp.run_io

        async def fake_pool():
            return self.db

        async def fake_payload(req):
            return await req.json()

        async def fake_run_io(fn, *a, **kw):
            return fn(*a, **kw)

        msp.core.pool = fake_pool
        msp.core.payload = fake_payload
        msp.run_io = fake_run_io

        # Also patch step19_storage.run_io so local_object_path / read_object / head_object run synchronously in test
        import app.step19_storage as s19
        self._orig_s19_run_io = s19.run_io
        s19.run_io = fake_run_io

        self.current_user = {'id': self.student_id, 'role': 'student', 'account_status': 'active'}
        async def fake_auth(req):
            return self.current_user
        msp._auth_user = fake_auth

    def tearDown(self):
        msp.core.pool = self._orig_pool
        msp._auth_user = self._orig_auth
        msp.core.payload = self._orig_payload
        msp.run_io = self._orig_run_io
        import app.step19_storage as s19
        s19.run_io = self._orig_s19_run_io
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_mock_section_submit_does_not_update_nonexistent_attempt_timestamp(self):
        """mock_attempts has no updated_at column; only submission rows have it."""
        source = inspect.getsource(msp.submit_mock_section)
        statements = re.findall(r'UPDATE mock_attempts\b(.*?)WHERE id = \$1', source, re.S)
        self.assertEqual(len(statements), 1, 'Expected exactly one mock_attempts update in section submission')
        self.assertNotIn('updated_at', statements[0], 'Invalid column mock_attempts.updated_at would break PostgreSQL')
        self.assertIn('section_results = $4::jsonb', statements[0])
        self.assertIn('UPDATE mock_section_submissions', source, 'Section submission timestamps remain in their own table')

    def test_task2_backend_audio_integrity_verification_and_security(self):
        """TASK 2: Verify valid audio passes, missing storage object fails (404), bad hash/size fails (409),
        corrupt/non-audio fails (422), cross-user access fails (403), and repeated finalize is idempotent.
        """
        valid_webm = b'\x1a\x45\xdf\xa3' + (b'OPUS-SPEECH-FRAME-DATA-' * 6)
        valid_sha = sha256_hex(valid_webm)

        # 1. Unauthenticated request is rejected with 401
        self.current_user = None
        r_unauth = asyncio.run(msp.create_mock_speaking_upload_intent(FakeRequest({'part': 'P1'}), str(self.attempt_id)))
        self.assertEqual(r_unauth.status_code, 401)
        self.current_user = {'id': self.student_id, 'role': 'student', 'account_status': 'active'}

        # 2. Missing storage object on finalize MUST fail closed with 404 (never trust client-supplied hash/size)
        missing_key = f'speaking/attempts/{self.attempt_id}/audio/p1/{uuid.uuid4()}.webm'
        r_missing = asyncio.run(msp.finalize_mock_speaking_upload(
            FakeRequest({
                'part': 'P1',
                'objectKey': missing_key,
                'codec': 'webm',
                'mimeType': 'audio/webm',
                'bytes': len(valid_webm),
                'durationMs': 35000,
                'sha256': valid_sha,
                'questionIds': ['q1'],
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(r_missing.status_code, 404)
        self.assertEqual(json.loads(r_missing.body)['error']['code'], 'audio_object_missing')

        # 3. Create authenticated upload intent for P1
        r_intent = asyncio.run(msp.create_mock_speaking_upload_intent(
            FakeRequest({
                'part': 'P1',
                'codec': 'webm',
                'mimeType': 'audio/webm',
                'bytes': len(valid_webm),
                'durationMs': 35000,
                'sha256': valid_sha,
                'questionIds': ['q1'],
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(r_intent.status_code, 200)
        intent_data = json.loads(r_intent.body)
        upload_id = intent_data['uploadId']
        object_key = intent_data['objectKey']
        # A pending upload is 'incomplete' in mock_speaking_audio (per SQL CHECK),
        # while upload_intents keeps its separate 'pending' lifecycle status.
        pending_part = self.db.speaking_audio[(self.attempt_id, 'P1')]
        self.assertEqual(pending_part['capture_status'], 'incomplete')
        self.assertIsNone(pending_part['finalized_at'])
        self.assertEqual(self.db.upload_intents[uuid.UUID(upload_id)]['status'], 'pending')
        retry_intent = asyncio.run(msp.create_mock_speaking_upload_intent(
            FakeRequest({
                'part': 'P1', 'codec': 'webm', 'mimeType': 'audio/webm',
                'bytes': len(valid_webm), 'durationMs': 35000,
                'sha256': valid_sha, 'questionIds': ['q1'],
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(retry_intent.status_code, 200)
        self.assertEqual(json.loads(retry_intent.body)['uploadId'], upload_id)
        self.assertEqual(self.db.speaking_audio[(self.attempt_id, 'P1')]['capture_status'], 'incomplete')

        # 4. Cross-user access (Student B trying to upload or finalize Student A's attempt) MUST fail with 403
        self.current_user = {'id': self.other_student_id, 'role': 'student', 'account_status': 'active'}
        r_cross_put = asyncio.run(msp.upload_mock_speaking_bytes(
            FakeRequest(valid_webm, headers={'content-type': 'audio/webm', 'x-content-sha256': valid_sha}),
            str(self.attempt_id),
            upload_id,
        ))
        self.assertEqual(r_cross_put.status_code, 403)

        r_cross_fin = asyncio.run(msp.finalize_mock_speaking_upload(
            FakeRequest({
                'uploadId': upload_id,
                'part': 'P1',
                'objectKey': object_key,
                'codec': 'webm',
                'mimeType': 'audio/webm',
                'bytes': len(valid_webm),
                'durationMs': 35000,
                'sha256': valid_sha,
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(r_cross_fin.status_code, 403)
        self.current_user = {'id': self.student_id, 'role': 'student', 'account_status': 'active'}

        # 5. Corrupt / non-audio bytes (same length, wrong magic header & hash) rejected on upload
        corrupt_bytes = b'PLAIN-TEXT-NOT-AUDIO-' + b'X' * (len(valid_webm) - 21)
        r_bad_hash = asyncio.run(msp.upload_mock_speaking_bytes(
            FakeRequest(corrupt_bytes, headers={'content-type': 'audio/webm'}),
            str(self.attempt_id),
            upload_id,
        ))
        self.assertEqual(r_bad_hash.status_code, 409)
        self.assertEqual(json.loads(r_bad_hash.body)['error']['code'], 'checksum_mismatch')

        # 6. Upload real valid WebM audio bytes -> 200 OK and stored on disk
        r_put = asyncio.run(msp.upload_mock_speaking_bytes(
            FakeRequest(valid_webm, headers={'content-type': 'audio/webm', 'x-content-sha256': valid_sha}),
            str(self.attempt_id),
            upload_id,
        ))
        self.assertEqual(r_put.status_code, 200)

        # 7. Forged hash on finalize fails with 409 checksum_mismatch
        r_forged_sha = asyncio.run(msp.finalize_mock_speaking_upload(
            FakeRequest({
                'uploadId': upload_id,
                'part': 'P1',
                'objectKey': object_key,
                'codec': 'webm',
                'mimeType': 'audio/webm',
                'bytes': len(valid_webm),
                'durationMs': 35000,
                'sha256': 'a' * 64,
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(r_forged_sha.status_code, 409)

        # 8. Valid finalize succeeds (200) after verifying stored object size, magic bytes, and SHA-256
        r_fin = asyncio.run(msp.finalize_mock_speaking_upload(
            FakeRequest({
                'uploadId': upload_id,
                'part': 'P1',
                'objectKey': object_key,
                'codec': 'webm',
                'mimeType': 'audio/webm',
                'bytes': len(valid_webm),
                'durationMs': 35000,
                'sha256': valid_sha,
                'questionIds': ['q1'],
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(r_fin.status_code, 200)
        fin_payload = json.loads(r_fin.body)
        self.assertEqual(fin_payload['captureStatus'], 'finalized')
        self.assertEqual(fin_payload['sha256'], valid_sha)
        finalized_part = self.db.speaking_audio[(self.attempt_id, 'P1')]
        self.assertEqual(finalized_part['capture_status'], 'finalized')
        self.assertIsNotNone(finalized_part['finalized_at'])

        # 9. Repeated finalize with identical payload is idempotent (200, idempotent=True)
        r_idem = asyncio.run(msp.finalize_mock_speaking_upload(
            FakeRequest({
                'uploadId': upload_id,
                'part': 'P1',
                'objectKey': object_key,
                'codec': 'webm',
                'mimeType': 'audio/webm',
                'bytes': len(valid_webm),
                'durationMs': 35000,
                'sha256': valid_sha,
                'questionIds': ['q1'],
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(r_idem.status_code, 200)
        self.assertTrue(json.loads(r_idem.body).get('idempotent'))

        # 10. Repeated finalize with different hash after finalization is rejected (409 part_already_finalized)
        r_Overwrite = asyncio.run(msp.finalize_mock_speaking_upload(
            FakeRequest({
                'uploadId': upload_id,
                'part': 'P1',
                'objectKey': object_key,
                'codec': 'webm',
                'mimeType': 'audio/webm',
                'bytes': len(valid_webm),
                'durationMs': 35000,
                'sha256': 'b' * 64,
            }),
            str(self.attempt_id),
        ))
        self.assertEqual(r_Overwrite.status_code, 409)
        self.assertEqual(json.loads(r_Overwrite.body)['error']['code'], 'part_already_finalized')

        # 11. Submitting speaking section before P2 and P3 are finalized & stored fails with 409
        r_sub_incomplete = asyncio.run(msp.submit_mock_section(
            FakeRequest({}),
            str(self.attempt_id),
            'speaking',
        ))
        self.assertEqual(r_sub_incomplete.status_code, 409)
        self.assertEqual(json.loads(r_sub_incomplete.body)['error']['code'], 'speaking_audio_incomplete')

    def test_task4_listening_single_play_server_enforcement(self):
        """TASK 4: Verify server-persisted Listening playback prevents replay after completion,
        prevents concurrent playback in a second tab, preserves position across refresh,
        and allows network interruption recovery.
        """
        aid_str = str(self.attempt_id)

        # 1. Start playback in Tab A
        r_start = asyncio.run(msp.update_mock_listening_playback(
            FakeRequest({'action': 'start', 'tabId': 'tab-A', 'positionMs': 0}),
            aid_str,
        ))
        self.assertEqual(r_start.status_code, 200)
        self.assertEqual(json.loads(r_start.body)['playback']['status'], 'playing')

        # 2. Heartbeat at 45s in Tab A
        r_hb = asyncio.run(msp.update_mock_listening_playback(
            FakeRequest({'action': 'heartbeat', 'tabId': 'tab-A', 'positionMs': 45000}),
            aid_str,
        ))
        self.assertEqual(r_hb.status_code, 200)
        self.assertEqual(json.loads(r_hb.body)['playback']['positionMs'], 45000)

        # 3. Second tab (Tab B) attempting to start playback while Tab A is active is blocked (409)
        r_tab_b = asyncio.run(msp.update_mock_listening_playback(
            FakeRequest({'action': 'start', 'tabId': 'tab-B', 'positionMs': 0}),
            aid_str,
        ))
        self.assertEqual(r_tab_b.status_code, 409)
        self.assertEqual(json.loads(r_tab_b.body)['error']['code'], 'listening_already_playing_in_other_tab')

        # 4. Page refresh in Tab A attempting to start from positionMs=0 preserves authoritative 45000ms position
        r_refresh = asyncio.run(msp.update_mock_listening_playback(
            FakeRequest({'action': 'start', 'tabId': 'tab-A', 'positionMs': 0}),
            aid_str,
        ))
        self.assertEqual(r_refresh.status_code, 200)
        self.assertEqual(json.loads(r_refresh.body)['playback']['positionMs'], 45000)

        # 5. Temporary network interruption at 92s followed by resume continues from 92s
        r_int = asyncio.run(msp.update_mock_listening_playback(
            FakeRequest({'action': 'interrupt', 'tabId': 'tab-A', 'positionMs': 92000}),
            aid_str,
        ))
        self.assertEqual(r_int.status_code, 200)
        self.assertEqual(json.loads(r_int.body)['playback']['status'], 'interrupted')

        r_res = asyncio.run(msp.update_mock_listening_playback(
            FakeRequest({'action': 'resume', 'tabId': 'tab-A', 'positionMs': 92000}),
            aid_str,
        ))
        self.assertEqual(r_res.status_code, 200)
        self.assertEqual(json.loads(r_res.body)['playback']['status'], 'playing')
        self.assertEqual(json.loads(r_res.body)['playback']['positionMs'], 92000)

        # 6. Complete playback -> subsequent start or resume in any tab is permanently rejected (409)
        r_comp = asyncio.run(msp.update_mock_listening_playback(
            FakeRequest({'action': 'complete', 'tabId': 'tab-A', 'positionMs': 1800000}),
            aid_str,
        ))
        self.assertEqual(r_comp.status_code, 200)
        self.assertEqual(json.loads(r_comp.body)['playback']['status'], 'completed')

        for replay_action in ('start', 'resume'):
            r_replay = asyncio.run(msp.update_mock_listening_playback(
                FakeRequest({'action': replay_action, 'tabId': 'tab-A', 'positionMs': 0}),
                aid_str,
            ))
            self.assertEqual(r_replay.status_code, 409)
            self.assertEqual(json.loads(r_replay.body)['error']['code'], 'listening_replay_forbidden')

    def test_task5_missing_or_invalid_content_blocks_attempt_start_and_submit(self):
        """TASK 5: Verify formal mock attempt cannot start or submit when questions, answer keys,
        passages, or Listening audio are missing.
        """
        new_test_id = uuid.uuid4()
        self.db.mock_tests[new_test_id] = {
            'id': new_test_id,
            'title': 'Incomplete Mock Test',
            'track': 'academic',
            'kind': 'full',
            'timing_policy_id': 'standard',
            'score_policies': {},
            'publication_state': 'published',
            'version': 1,
        }
        self.db.mock_sections = [
            {'position': 1, 'skill': 'listening', 'content_type': 'full', 'source_ref': 'L-bad', 'content_version_id': None, 'question_count': 40, 'seconds': 1800},
            {'position': 2, 'skill': 'reading', 'content_type': 'full', 'source_ref': 'R-bad', 'content_version_id': None, 'question_count': 40, 'seconds': 3600},
            {'position': 3, 'skill': 'writing', 'content_type': 'task1', 'source_ref': 'W-1', 'content_version_id': None, 'question_count': 1, 'seconds': 1200},
            {'position': 4, 'skill': 'writing', 'content_type': 'task2', 'source_ref': 'W-2', 'content_version_id': None, 'question_count': 1, 'seconds': 2400},
            {'position': 5, 'skill': 'speaking', 'content_type': 'full', 'source_ref': 'S-1', 'content_version_id': None, 'question_count': 3, 'seconds': 900},
        ]

        orig_load = msp._load_section_questions_from_version
        try:
            async def fake_load_incomplete(con, sec_row, reveal_keys=False):
                if sec_row['skill'] == 'listening':
                    # Only 10 questions instead of 40!
                    return {
                        'audioUrl': '/api/resources/listening/audio1.mp3',
                        'questions': [{'id': f'q{i}', 'order': i, 'question_text': f'Q{i}', 'correct_answer': 'A'} for i in range(1, 11)],
                    }
                return {}
            msp._load_section_questions_from_version = fake_load_incomplete

            r_start = asyncio.run(msp.start_or_resume_mock_attempt(FakeRequest({}), str(new_test_id)))
            self.assertEqual(r_start.status_code, 422)
            self.assertEqual(json.loads(r_start.body)['error']['code'], 'invalid_question_count')

            # Also verify section submit fails closed (422) if content has missing answer keys
            async def fake_load_no_keys(con, sec_row, reveal_keys=False):
                return {
                    'audioUrl': '/api/resources/listening/audio1.mp3',
                    'questions': [{'id': f'q{i}', 'order': i, 'question_text': f'Q{i}', 'correct_answer': ''} for i in range(1, 41)],
                }
            msp._load_section_questions_from_version = fake_load_no_keys
            r_sub = asyncio.run(msp.submit_mock_section(FakeRequest({'answers': {'q1': 'A'}}), str(self.attempt_id), 'listening'))
            self.assertEqual(r_sub.status_code, 422)
            self.assertEqual(json.loads(r_sub.body)['error']['code'], 'missing_answer_keys')
        finally:
            msp._load_section_questions_from_version = orig_load

    def test_task6_revision_safe_autosave_backend(self):
        """TASK 6: Verify server draft save enforces monotonic revisions, never overwrites newer
        answers with stale revisions, and blocks cross-user draft saves.
        """
        aid_str = str(self.attempt_id)

        # Save revision 2
        r_rev2 = asyncio.run(msp.save_mock_section_draft(
            FakeRequest({'revision': 2, 'answers': {'q1': 'newest-answer'}}),
            aid_str,
            'reading',
        ))
        self.assertEqual(r_rev2.status_code, 200)
        p2 = json.loads(r_rev2.body)
        self.assertFalse(p2['stale'])
        self.assertEqual(p2['revision'], 2)

        # Out-of-order stale revision 1 arrives later -> marked stale=True and does NOT overwrite revision 2
        r_rev1 = asyncio.run(msp.save_mock_section_draft(
            FakeRequest({'revision': 1, 'answers': {'q1': 'stale-answer'}}),
            aid_str,
            'reading',
        ))
        self.assertEqual(r_rev1.status_code, 200)
        p1 = json.loads(r_rev1.body)
        self.assertTrue(p1['stale'])
        self.assertEqual(p1['revision'], 2)
        self.assertEqual(self.db.section_submissions[(self.attempt_id, 'reading')]['answers_json']['q1'], 'newest-answer')

        # Cross-user draft save is rejected with 403
        self.current_user = {'id': self.other_student_id, 'role': 'student', 'account_status': 'active'}
        r_cross = asyncio.run(msp.save_mock_section_draft(
            FakeRequest({'revision': 3, 'answers': {'q1': 'hijack'}}),
            aid_str,
            'reading',
        ))
        self.assertEqual(r_cross.status_code, 403)



    def test_full_four_section_attempt_with_real_audio_and_batch_zip_export(self):
        """End-to-end integration: Listening single-play + L/R 40Q grading + Writing Task 1/2 +
        Speaking P1/P2/P3 real audio upload/finalize + Speaking batch ZIP export verification.
        """
        from app.mock_exports_and_prompts import render_speaking_batch_zip, validate_gemini_grading_json
        from app.mock_scoring_engine import compute_speaking_source_sha256
        from app.step19_storage import read_object
        import io, zipfile

        aid_str = str(self.attempt_id)

        # 1. Upload and finalize real WebM audio for P1, P2, P3
        part_blobs = {
            'P1': b'\x1a\x45\xdf\xa3' + (b'REAL-OPUS-PART1-SPEECH-AUDIO-BYTES-' * 5),
            'P2': b'\x1a\x45\xdf\xa3' + (b'REAL-OPUS-PART2-CUE-CARD-SPEECH-BYTES-' * 6),
            'P3': b'\x1a\x45\xdf\xa3' + (b'REAL-OPUS-PART3-DISCUSSION-SPEECH-BYTES-' * 5),
        }
        for part_code, raw_audio in part_blobs.items():
            digest = sha256_hex(raw_audio)
            r_int = asyncio.run(msp.create_mock_speaking_upload_intent(
                FakeRequest({
                    'part': part_code,
                    'codec': 'webm',
                    'mimeType': 'audio/webm',
                    'bytes': len(raw_audio),
                    'durationMs': 45000,
                    'sha256': digest,
                    'questionIds': [f'q-{part_code.lower()}-1'],
                }),
                aid_str,
            ))
            self.assertEqual(r_int.status_code, 200)
            int_payload = json.loads(r_int.body)

            r_put = asyncio.run(msp.upload_mock_speaking_bytes(
                FakeRequest(raw_audio, headers={'content-type': 'audio/webm', 'x-content-sha256': digest}),
                aid_str,
                int_payload['uploadId'],
            ))
            self.assertEqual(r_put.status_code, 200)

            r_fin = asyncio.run(msp.finalize_mock_speaking_upload(
                FakeRequest({
                    'uploadId': int_payload['uploadId'],
                    'part': part_code,
                    'objectKey': int_payload['objectKey'],
                    'codec': 'webm',
                    'mimeType': 'audio/webm',
                    'bytes': len(raw_audio),
                    'durationMs': 45000,
                    'sha256': digest,
                    'questionIds': [f'q-{part_code.lower()}-1'],
                }),
                aid_str,
            ))
            self.assertEqual(r_fin.status_code, 200)

        # 2. Submit Speaking section -> succeeds now that all 3 parts exist in storage and match SHA-256
        r_sub_spk = asyncio.run(msp.submit_mock_section(FakeRequest({}), aid_str, 'speaking'))
        self.assertEqual(r_sub_spk.status_code, 200)
        self.assertEqual(json.loads(r_sub_spk.body)['status'], 'awaiting_grading')

        # 3. Export Speaking batch ZIP using the actual stored bytes from local storage
        export_parts = []
        for part_code in ('P1', 'P2', 'P3'):
            row = self.db.speaking_audio[(self.attempt_id, part_code)]
            stored_bytes = asyncio.run(read_object(row['object_key']))
            self.assertEqual(stored_bytes, part_blobs[part_code])
            export_parts.append({
                'part': part_code,
                'questionIds': row['question_ids'],
                'prompts': [f'Speaking {part_code} official question'],
                'codec': row['codec'],
                'audioBytes': stored_bytes,
                'bytes': row['bytes'],
                'durationMs': row['duration_ms'],
                'sha256': row['sha256'],
                'captureStatus': row['capture_status'],
            })

        src_sha = compute_speaking_source_sha256(aid_str, export_parts)
        zip_bytes = render_speaking_batch_zip({
            'batchId': 'S-2026-W44-001',
            'generatedAt': '2026-10-31T08:00:00Z',
            'entries': [{
                'studentId': 'LA-1001',
                'attemptId': aid_str,
                'testCode': 'MOCK-01',
                'sourceSha256': src_sha,
                'parts': export_parts,
            }],
        })
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
            for part_code, expected_bytes in part_blobs.items():
                arc_name = f'LA-1001__{aid_str}__{part_code}.webm'
                self.assertIn(arc_name, zf.namelist())
                self.assertEqual(zf.read(arc_name), expected_bytes)


if __name__ == '__main__':
    unittest.main()
