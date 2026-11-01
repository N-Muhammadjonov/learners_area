"""Comprehensive unit and contract tests for the Weekly IELTS Mock System (A01–A14).

Tests deterministic Listening/Reading grading, band conversion policies,
pre-submit key secrecy, Writing DOCX & Speaking ZIP exports, Gemini la.mock.grading.v1
JSON validation, RBAC / teacher scope enforcement, append-only revisions,
two-step approval/publication, and database migration SQL integrity.
Executed with Python standard library + unittest so it runs in any offline Python environment.
"""
from __future__ import annotations

import asyncio
import io
import importlib
import json
import pathlib
import sys
import types
import unittest
import uuid
import zipfile
from datetime import datetime, timezone

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _ensure_lightweight_fastapi_stub():
    # Use installed dependencies before the offline-only fallback. Injecting
    # placeholders for not-yet-imported packages poisons the rest of pytest.
    try:
        importlib.import_module('fastapi')
    except ModuleNotFoundError as error:
        if error.name != 'fastapi':raise
    class _AutoStubModule(types.ModuleType):
        def __getattr__(self, name):
            if name.startswith('__'):
                raise AttributeError(name)
            return lambda *a, **kw: None

    if 'fastapi' not in sys.modules:
        fa = _AutoStubModule('fastapi')
        fa_resp = _AutoStubModule('fastapi.responses')

        class DummyRouter:
            def get(self, *a, **kw): return lambda fn: fn
            def post(self, *a, **kw): return lambda fn: fn
            def put(self, *a, **kw): return lambda fn: fn
            def patch(self, *a, **kw): return lambda fn: fn
            def delete(self, *a, **kw): return lambda fn: fn
            def head(self, *a, **kw): return lambda fn: fn
            def options(self, *a, **kw): return lambda fn: fn

        class DummyResponse:
            def __init__(self, content=b'', status_code=200, headers=None, media_type=None):
                self.body = content if isinstance(content, bytes) else json.dumps(content, default=str).encode('utf-8')
                self.status_code = status_code
                self.headers = headers or {}
                self.media_type = media_type

        class DummyFastAPI(DummyRouter):
            def __init__(self, *a, **kw): pass
            def middleware(self, *a, **kw): return lambda fn: fn
            def include_router(self, *a, **kw): pass

        class HTTPException(Exception):
            def __init__(self, status_code, detail=None):
                self.status_code = status_code
                self.detail = detail

        fa.APIRouter = DummyRouter
        fa.FastAPI = DummyFastAPI
        fa.Request = object
        fa.HTTPException = HTTPException
        fa_resp.JSONResponse = lambda data, status_code=200, headers=None: DummyResponse(data, status_code, headers, 'application/json')
        fa_resp.Response = DummyResponse
        fa_resp.RedirectResponse = DummyResponse
        fa_resp.StreamingResponse = DummyResponse
        fa_resp.PlainTextResponse = DummyResponse
        fa_resp.HTMLResponse = DummyResponse
        fa_resp.FileResponse = DummyResponse
        fa.__path__ = []
        sys.modules['fastapi'] = fa
        sys.modules['fastapi.responses'] = fa_resp
        st = _AutoStubModule('starlette')
        st.__path__ = []
        st_resp = _AutoStubModule('starlette.responses')
        st_req = _AutoStubModule('starlette.requests')
        st_ds = _AutoStubModule('starlette.datastructures')
        st_resp.JSONResponse = fa_resp.JSONResponse
        st_resp.Response = DummyResponse
        st_resp.RedirectResponse = DummyResponse
        st_resp.StreamingResponse = DummyResponse
        st_resp.PlainTextResponse = DummyResponse
        st_resp.HTMLResponse = DummyResponse
        st_resp.FileResponse = DummyResponse
        st_req.Request = object
        st_ds.QueryParams = dict
        sys.modules['starlette'] = st
        sys.modules['starlette.responses'] = st_resp
        sys.modules['starlette.requests'] = st_req
        sys.modules['starlette.datastructures'] = st_ds

    for mod_name in (
        'asyncpg',
        'anyio',
        'bleach',
        'bleach.css_sanitizer',
        'tinycss2',
        'bcrypt',
        'jwt',
        'boto3',
        'botocore',
        'botocore.config',
        'httpx',
        'reportlab',
        'reportlab.lib',
        'reportlab.lib.pagesizes',
        'reportlab.pdfgen',
        'reportlab.pdfgen.canvas',
        'docx',
        'rjsmin',
        'rcssmin',
    ):
        try:
            importlib.import_module(mod_name)
            continue
        except ModuleNotFoundError as error:
            if error.name not in (mod_name,mod_name.split('.')[0]):raise
        if mod_name not in sys.modules:
            class _AutoStubModule(types.ModuleType):
                def __getattr__(self, name):
                    if name.startswith('__'):
                        raise AttributeError(name)
                    return lambda *a, **kw: None
            m = _AutoStubModule(mod_name)
            m.__path__ = []
            sys.modules[mod_name] = m
    if 'regex' not in sys.modules:
        try:importlib.import_module('regex')
        except ModuleNotFoundError:
            import re as _re
            sys.modules['regex'] = _re


_ensure_lightweight_fastapi_stub()

from app.mock_scoring_engine import (
    SCORE_POLICIES,
    canonical_json_sha256,
    compute_attempt_schedule_plan,
    compute_overall_mock_band,
    compute_speaking_band,
    compute_speaking_source_sha256,
    compute_writing_bands,
    compute_writing_source_sha256,
    convert_raw_to_band,
    count_words,
    current_weekly_slot,
    grade_mock_question,
    grade_mock_section,
    round_half_or_whole,
    sanitize_question_for_exam,
    sanitize_section_payload_for_exam,
    sha256_hex,
)
from app.mock_exports_and_prompts import (
    BATCH_SCHEMA_VERSION,
    GRADING_SCHEMA_VERSION,
    JSON_REPAIR_GEMINI_PROMPT,
    SPEAKING_GEMINI_PROMPT,
    WRITING_GEMINI_PROMPT,
    make_student_alias,
    render_speaking_batch_zip,
    render_writing_batch_docx,
    split_into_stable_batches,
    validate_gemini_grading_json,
)


class TestMockScoringEngine(unittest.TestCase):
    def test_section_11_band_edge_cases(self):
        # L=6.5 R=6.5 W=5.0 S=7.0 -> 6.25 -> 6.5
        self.assertEqual(
            compute_overall_mock_band({'listening': 6.5, 'reading': 6.5, 'writing': 5.0, 'speaking': 7.0}),
            6.5,
        )
        # L=6.5 R=6.5 W=5.5 S=6.0 -> 6.125 -> 6.0
        self.assertEqual(
            compute_overall_mock_band({'listening': 6.5, 'reading': 6.5, 'writing': 5.5, 'speaking': 6.0}),
            6.0,
        )
        # Writing Task1 5.75, Task2 6.50 -> weighted 6.25 -> 6.5
        w = compute_writing_bands(
            {'task_achievement': 6, 'coherence_cohesion': 6, 'lexical_resource': 6, 'grammar_accuracy': 5},
            {'task_response': 7, 'coherence_cohesion': 6, 'lexical_resource': 7, 'grammar_accuracy': 6},
        )
        self.assertEqual(w['task1Band'], 5.75)
        self.assertEqual(w['task2Band'], 6.5)
        self.assertEqual(w['weightedRaw'], 6.25)
        self.assertEqual(w['band'], 6.5)

        # Speaking criteria = 6,7,6,5 -> Mean 6.0
        s = compute_speaking_band(
            {'fluency_coherence': 6, 'lexical_resource': 7, 'grammar_accuracy': 6, 'pronunciation': 5}
        )
        self.assertEqual(s['meanRaw'], 6.0)
        self.assertEqual(s['band'], 6.0)

        # Writing pending -> Overall = None (never 0)
        self.assertIsNone(
            compute_overall_mock_band({'listening': 7.5, 'reading': 8.0, 'writing': None, 'speaking': 7.0})
        )
        self.assertIsNone(
            compute_overall_mock_band({'listening': 7.5, 'reading': 8.0, 'speaking': 7.0})
        )

    def test_listening_and_reading_40q_conversion_tables(self):
        self.assertEqual(convert_raw_to_band('listening', 39, 40, 'academic')['band'], 9.0)
        self.assertEqual(convert_raw_to_band('listening', 30, 40, 'academic')['band'], 7.0)
        self.assertEqual(convert_raw_to_band('listening', 23, 40, 'academic')['band'], 6.0)
        self.assertEqual(convert_raw_to_band('listening', 0, 40, 'academic')['band'], 0.0)

        self.assertEqual(convert_raw_to_band('reading', 30, 40, 'academic')['band'], 7.0)
        self.assertEqual(convert_raw_to_band('reading', 30, 40, 'general_training')['band'], 6.0)
        self.assertEqual(convert_raw_to_band('reading', 40, 40, 'general_training')['band'], 9.0)
        self.assertEqual(convert_raw_to_band('reading', 39, 40, 'general_training')['band'], 8.5)

        self.assertIsNone(convert_raw_to_band('reading', 41, 40, 'academic'))
        self.assertIsNone(convert_raw_to_band('reading', -1, 40, 'academic'))
        self.assertIsNone(convert_raw_to_band('reading', 25, 30, 'academic'))
        self.assertIsNone(convert_raw_to_band('reading', 25, 40, 'unknown_track'))

    def test_question_type_validators_and_word_limits(self):
        q_tfng = {'type_code': 'true_false_not_given', 'correct_answer': 'NOT GIVEN'}
        self.assertTrue(grade_mock_question(q_tfng, 'not_given'))
        self.assertTrue(grade_mock_question(q_tfng, '  Not Given '))
        self.assertFalse(grade_mock_question(q_tfng, 'YES'))

        q_ynng = {'type_code': 'yes_no_not_given', 'correct_answer': 'YES'}
        self.assertTrue(grade_mock_question(q_ynng, 'yes'))
        self.assertFalse(grade_mock_question(q_ynng, 'TRUE'))

        q_mcq = {
            'type_code': 'multiple_choice',
            'correct_answer': 'B',
            'options': ['A) Solar energy', 'B) Wind turbines', 'C) Hydropower'],
        }
        self.assertTrue(grade_mock_question(q_mcq, 'b'))
        self.assertTrue(grade_mock_question(q_mcq, 'Wind turbines'))
        self.assertFalse(grade_mock_question(q_mcq, 'A'))

        q_multi = {
            'type_code': 'multiple_choice_multi',
            'correct_answer': 'B, D',
            'answer_constraint': {'selection_count': 2},
        }
        self.assertTrue(grade_mock_question(q_multi, 'D, B'))
        self.assertFalse(grade_mock_question(q_multi, 'B, B'))
        self.assertFalse(grade_mock_question(q_multi, 'B'))

        q_comp = {
            'type_code': 'sentence_completion',
            'correct_answer': 'carbon dioxide',
            'accepted_answers': ['CO2'],
            'answer_constraint': {'max_words': 2},
        }
        self.assertTrue(grade_mock_question(q_comp, 'Carbon Dioxide.'))
        self.assertTrue(grade_mock_question(q_comp, 'co2'))
        self.assertFalse(grade_mock_question(q_comp, 'greenhouse gas'))
        self.assertFalse(grade_mock_question(q_comp, 'excessive carbon dioxide emissions'))

        questions = [
            {'id': 'q1', 'order': 1, 'type_code': 'completion', 'key': 'library', 'pair': [1, 2]},
            {'id': 'q2', 'order': 2, 'type_code': 'completion', 'key': 'museum', 'pair': [1, 2]},
        ] + [
            {'id': f'q{i}', 'order': i, 'type_code': 'completion', 'key': f'ans{i}'}
            for i in range(3, 41)
        ]
        dup_res = grade_mock_section('listening', questions, {'q1': 'library', 'q2': 'library'})
        self.assertTrue(dup_res['items'][0]['isCorrect'])
        self.assertFalse(dup_res['items'][1]['isCorrect'])
        self.assertEqual(dup_res['rawScore'], 1)

    def test_pre_submit_key_secrecy(self):
        raw_payload = {
            'title': 'Mock 1 Listening',
            'transcript': 'Secret transcript text',
            'questions': [
                {
                    'id': 'q1',
                    'order': 1,
                    'questionText': 'Where is the lecture?',
                    'correctAnswer': 'Hall B',
                    'acceptedAnswers': ['B'],
                    'explanation': 'Mentioned at 01:15',
                    'evidenceQuote': 'It is in Hall B',
                }
            ],
        }
        sanitized = sanitize_section_payload_for_exam(raw_payload)
        serialized = json.dumps(sanitized)
        self.assertNotIn('Hall B', serialized)
        self.assertNotIn('Secret transcript text', serialized)
        self.assertNotIn('correctAnswer', serialized)
        self.assertNotIn('acceptedAnswers', serialized)
        self.assertNotIn('explanation', serialized)
        self.assertEqual(sanitized['questions'][0]['questionText'], 'Where is the lecture?')


class TestExportsAndGeminiImport(unittest.TestCase):
    def setUp(self):
        self.png_bytes = bytes.fromhex(
            '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
            '0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082'
        )
        self.attempt_1 = '8f4c0000-0000-4000-8000-000000000001'
        self.attempt_2 = '8f4c0000-0000-4000-8000-000000000002'
        self.digests_1 = compute_writing_source_sha256(
            self.attempt_1,
            'The chart below shows energy consumption.',
            'Untouched student Task 1 essay with typo teh.',
            sha256_hex(self.png_bytes),
            'Some people think university should be free.',
            'Untouched student Task 2 essay.',
        )
        self.digests_2 = compute_writing_source_sha256(
            self.attempt_2,
            'The chart below shows energy consumption.',
            'Second student Task 1 essay.',
            sha256_hex(self.png_bytes),
            'Some people think university should be free.',
            'Second student Task 2 essay.',
        )

    def test_writing_docx_export_fidelity_and_privacy(self):
        docx_bytes = render_writing_batch_docx({
            'batchId': 'W-2026-W44-001',
            'scope': 'assigned',
            'generatedAt': '2026-10-30T12:00:00Z',
            'entries': [
                {
                    'studentId': 'LA-1001',
                    'attemptId': self.attempt_1,
                    'testCode': 'MOCK-01',
                    'track': 'academic',
                    'submittedAt': '2026-10-30T11:00:00Z',
                    'task1Prompt': 'The chart below shows energy consumption.',
                    'task1Answer': 'Untouched student Task 1 essay with typo teh.',
                    'task1MediaBytes': self.png_bytes,
                    'task1MediaMime': 'image/png',
                    'task1MediaSha256': sha256_hex(self.png_bytes),
                    'task1Sha256': self.digests_1['task1Sha256'],
                    'task2Prompt': 'Some people think university should be free.',
                    'task2Answer': 'Untouched student Task 2 essay.',
                    'task2Sha256': self.digests_1['task2Sha256'],
                    'sourceSha256': self.digests_1['sourceSha256'],
                },
                {
                    'studentId': 'LA-1002',
                    'attemptId': self.attempt_2,
                    'testCode': 'MOCK-01',
                    'track': 'academic',
                    'submittedAt': '2026-10-30T11:05:00Z',
                    'task1Prompt': 'The chart below shows energy consumption.',
                    'task1Answer': 'Second student Task 1 essay.',
                    'task1Sha256': self.digests_2['task1Sha256'],
                    'task2Prompt': 'Some people think university should be free.',
                    'task2Answer': 'Second student Task 2 essay.',
                    'task2Sha256': self.digests_2['task2Sha256'],
                    'sourceSha256': self.digests_2['sourceSha256'],
                },
            ],
        })
        with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zf:
            self.assertIn('word/document.xml', zf.namelist())
            self.assertIn('word/media/task1_figure_1.png', zf.namelist())
            self.assertEqual(zf.read('word/media/task1_figure_1.png'), self.png_bytes)
            xml_text = zf.read('word/document.xml').decode('utf-8')
            self.assertIn('LA-1001', xml_text)
            self.assertIn('LA-1002', xml_text)
            self.assertIn('Untouched student Task 1 essay with typo teh.', xml_text)
            self.assertIn(self.digests_1['sourceSha256'], xml_text)
            self.assertIn('<w:br w:type="page"/>', xml_text)

    def test_speaking_zip_export_and_manifest(self):
        parts = [
            {'part': 'P1', 'questionIds': ['q1', 'q2'], 'prompts': ['Where do you live?'], 'codec': 'webm', 'audioBytes': b'WEBM-P1-BYTES', 'bytes': 13, 'durationMs': 40000, 'sha256': sha256_hex(b'WEBM-P1-BYTES'), 'captureStatus': 'finalized'},
            {'part': 'P2', 'questionIds': ['q3'], 'prompts': ['Describe a book.'], 'codec': 'webm', 'audioBytes': b'WEBM-P2-BYTES', 'bytes': 13, 'durationMs': 110000, 'sha256': sha256_hex(b'WEBM-P2-BYTES'), 'captureStatus': 'finalized'},
            {'part': 'P3', 'questionIds': ['q4'], 'prompts': ['Why do people read?'], 'codec': 'webm', 'audioBytes': b'WEBM-P3-BYTES', 'bytes': 13, 'durationMs': 60000, 'sha256': sha256_hex(b'WEBM-P3-BYTES'), 'captureStatus': 'finalized'},
        ]
        src_sha = compute_speaking_source_sha256(self.attempt_1, parts)
        zip_bytes = render_speaking_batch_zip({
            'batchId': 'S-2026-W44-001',
            'generatedAt': '2026-10-30T12:00:00Z',
            'entries': [{
                'studentId': 'LA-1001',
                'attemptId': self.attempt_1,
                'testCode': 'MOCK-01',
                'sourceSha256': src_sha,
                'parts': parts,
            }],
        })
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            self.assertIn('manifest.json', names)
            self.assertIn('questions.txt', names)
            for p_code, expected_raw in [('P1', b'WEBM-P1-BYTES'), ('P2', b'WEBM-P2-BYTES'), ('P3', b'WEBM-P3-BYTES')]:
                fname = f'LA-1001__{self.attempt_1}__{p_code}.webm'
                self.assertIn(fname, names)
                self.assertEqual(zf.read(fname), expected_raw)
            manifest = json.loads(zf.read('manifest.json').decode('utf-8'))
            self.assertEqual(manifest['batch_id'], 'S-2026-W44-001')
            self.assertEqual(manifest['attempts'][0]['source_sha256'], src_sha)
            self.assertTrue(manifest['attempts'][0]['capture_complete'])

    def test_gemini_json_import_validator_edge_cases(self):
        batch_record = {
            'batchCode': 'W-2026-W44-001',
            'section': 'writing',
            'studentAliasMap': {
                'LA-1001': {'studentUserId': 'u-1', 'attemptId': self.attempt_1, 'sourceSha256': self.digests_1['sourceSha256']},
                'LA-1002': {'studentUserId': 'u-2', 'attemptId': self.attempt_2, 'sourceSha256': self.digests_2['sourceSha256']},
            },
        }

        bad_payload = {
            'schema_version': GRADING_SCHEMA_VERSION,
            'batch_id': 'W-2026-W44-001',
            'section': 'writing',
            'results': [
                {
                    'student_id': 'LA-9999',
                    'attempt_id': self.attempt_1,
                    'status': 'graded',
                    'source_sha256': self.digests_1['sourceSha256'],
                    'rubric_version': 'ielts-writing-v1',
                    'tasks': {},
                    'overall_feedback': 'ok',
                    'review_reason': None,
                },
                {
                    'student_id': 'LA-1001',
                    'attempt_id': self.attempt_1,
                    'status': 'graded',
                    'source_sha256': 'f' * 64,
                    'rubric_version': 'ielts-writing-v1',
                    'tasks': {},
                    'overall_feedback': 'ok',
                    'review_reason': None,
                },
            ],
        }
        rep_bad = validate_gemini_grading_json(bad_payload, batch_record)
        self.assertFalse(rep_bad['ok'])
        self.assertEqual(rep_bad['counts']['outOfScope'], 1)
        self.assertEqual(rep_bad['counts']['hashMismatch'], 1)
        self.assertEqual(rep_bad['counts']['missing'], 1)

        good_payload = {
            'schema_version': GRADING_SCHEMA_VERSION,
            'batch_id': 'W-2026-W44-001',
            'section': 'writing',
            'results': [
                {
                    'student_id': 'LA-1001',
                    'attempt_id': self.attempt_1,
                    'status': 'graded',
                    'source_sha256': self.digests_1['sourceSha256'],
                    'rubric_version': 'ielts-writing-v1',
                    'tasks': {
                        'task1': {
                            'criteria': {'task_achievement': 6, 'coherence_cohesion': 6, 'lexical_resource': 6, 'grammar_accuracy': 6},
                            'feedback': '<script>alert(1)</script>Clear overview.',
                            'explanations': ['Good key features'],
                            'errors': [{'quote': 'teh', 'issue': 'Spelling', 'fix': 'the'}],
                        },
                        'task2': {
                            'criteria': {'task_response': 7, 'coherence_cohesion': 7, 'lexical_resource': 6, 'grammar_accuracy': 6},
                            'feedback': 'Well developed essay.',
                            'explanations': ['Coherent paragraphs'],
                            'errors': [],
                        },
                    },
                    'overall_feedback': 'Strong writing.',
                    'review_reason': None,
                },
                {
                    'student_id': 'LA-1002',
                    'attempt_id': self.attempt_2,
                    'status': 'needs_review',
                    'source_sha256': self.digests_2['sourceSha256'],
                    'rubric_version': 'ielts-writing-v1',
                    'tasks': {
                        'task1': {
                            'criteria': {'task_achievement': None, 'coherence_cohesion': None, 'lexical_resource': None, 'grammar_accuracy': None},
                            'feedback': '',
                            'explanations': [],
                            'errors': [],
                        },
                        'task2': {
                            'criteria': {'task_response': None, 'coherence_cohesion': None, 'lexical_resource': None, 'grammar_accuracy': None},
                            'feedback': '',
                            'explanations': [],
                            'errors': [],
                        },
                    },
                    'overall_feedback': '',
                    'review_reason': 'Task 1 chart was unreadable.',
                },
            ],
        }
        rep_good = validate_gemini_grading_json(good_payload, batch_record)
        self.assertTrue(rep_good['ok'])
        self.assertTrue(rep_good['completeCoverage'])
        self.assertEqual(rep_good['counts']['valid'], 1)
        self.assertEqual(rep_good['counts']['needsReview'], 1)
        self.assertNotIn('<script>', rep_good['validRows'][0]['payloadJson']['tasks']['task1']['feedback'])
        self.assertIsNone(rep_good['validRows'][1]['calculatedBand'])

        first_sha = rep_good['validRows'][0]['payloadSha256']
        rep_dup = validate_gemini_grading_json(good_payload, batch_record, existing_payload_hashes={first_sha})
        self.assertTrue(rep_dup['ok'])
        self.assertEqual(rep_dup['counts']['idempotentDuplicate'], 1)

    def test_migrations_and_prompts_present(self):
        drizzle_sql = (PROJECT_ROOT / 'drizzle' / '0074_mock_hybrid_grading_system.sql').read_text(encoding='utf-8')
        supa_sql = (PROJECT_ROOT / 'supabase' / 'migrations' / '20261030230000_mock_hybrid_grading_system.sql').read_text(encoding='utf-8')
        down_sql = (PROJECT_ROOT / 'drizzle' / 'rollback' / '0074_mock_hybrid_grading_system_down.sql').read_text(encoding='utf-8')
        for required_table in (
            'mock_schedules',
            'mock_section_submissions',
            'mock_writing_answers',
            'mock_speaking_audio',
            'mock_grading_batches',
            'mock_grading_revisions',
            'mock_audit_events',
            'mock_grading_import_issues',
        ):
            self.assertIn(required_table, drizzle_sql)
            self.assertIn(required_table, supa_sql)
            self.assertIn(required_table, down_sql)
        self.assertIn('la.mock.grading.v1', WRITING_GEMINI_PROMPT)
        self.assertIn('la.mock.grading.v1', SPEAKING_GEMINI_PROMPT)
        self.assertIn('la.mock.grading.v1', JSON_REPAIR_GEMINI_PROMPT)


class TestRBACAndEndpointContracts(unittest.TestCase):
    """Verify RBAC, Teacher roster scope, and endpoint contracts on mock_system_port."""

    def test_rbac_role_guards_and_teacher_scope_sql(self):
        from app import mock_system_port as msp

        r_anon = msp._require_teacher_or_owner(None)
        self.assertEqual(r_anon.status_code, 401)

        r_admin = msp._require_teacher_or_owner({'id': uuid.uuid4(), 'role': 'admin', 'account_status': 'active'})
        self.assertEqual(r_admin.status_code, 403)

        r_student = msp._require_teacher_or_owner({'id': uuid.uuid4(), 'role': 'student', 'account_status': 'active'})
        self.assertEqual(r_student.status_code, 403)

        teacher_id = uuid.uuid4()
        self.assertIsNone(msp._require_teacher_or_owner({'id': teacher_id, 'role': 'teacher', 'account_status': 'active'}))
        self.assertIsNone(msp._require_teacher_or_owner({'id': uuid.uuid4(), 'role': 'owner', 'account_status': 'active'}))

        sql_t, args_t = msp._teacher_scope_sql({'id': teacher_id, 'role': 'teacher'}, 'a.user_id', 1)
        self.assertIn('teacher_student_links', sql_t)
        self.assertEqual(args_t, [teacher_id])

        sql_o, args_o = msp._teacher_scope_sql({'id': uuid.uuid4(), 'role': 'owner'}, 'a.user_id', 1)
        self.assertEqual(sql_o, 'TRUE')
        self.assertEqual(args_o, [])

        for internal_st in ('awaiting_export', 'exported', 'imported_draft', 'needs_review', 'approved'):
            self.assertEqual(msp._student_visible_status(internal_st), 'awaiting_grading')
        self.assertEqual(msp._student_visible_status('published'), 'published')
        self.assertEqual(msp._student_visible_status('in_progress'), 'in_progress')

    def test_teacher_unassigned_during_review_is_blocked(self):
        from app import mock_system_port as msp

        class FakeCon:
            def __init__(self, unassigned_count):
                self.unassigned_count = unassigned_count

            async def fetchval(self, sql, *args):
                assert 'teacher_student_links' in sql
                return self.unassigned_count

        teacher = {'id': uuid.uuid4(), 'role': 'teacher'}
        owner = {'id': uuid.uuid4(), 'role': 'owner'}
        aid = uuid.uuid4()

        self.assertTrue(asyncio.run(msp._verify_teacher_can_access_attempts(FakeCon(0), teacher, [aid])))
        self.assertFalse(asyncio.run(msp._verify_teacher_can_access_attempts(FakeCon(1), teacher, [aid])))
        self.assertTrue(asyncio.run(msp._verify_teacher_can_access_attempts(FakeCon(1), owner, [aid])))

    def test_existing_browser_activity_mocks_truncation(self):
        import tests.test_browser_activity_mocks as bam
        bam.test_mock_list_and_staff_results_cap_rows_and_report_truncation()



    def test_endpoint_handlers_prompts_and_rbac_blocking(self):
        from app import mock_system_port as msp

        class FakeReq:
            def __init__(self, body=None, headers=None, params=None):
                self._body = body or {}
                self.headers = headers or {}
                self.query_params = params or {}
                self.state = types.SimpleNamespace(request_id='req-test-1')
                self.client = types.SimpleNamespace(host='127.0.0.1')

            async def json(self):
                return self._body

            async def body(self):
                return self._body if isinstance(self._body, bytes) else json.dumps(self._body).encode('utf-8')

        # Monkeypatch _auth_user for RBAC verification on endpoints
        orig_auth = msp._auth_user
        try:
            async def fake_student_auth(req):
                return {'id': uuid.uuid4(), 'role': 'student', 'account_status': 'active'}
            msp._auth_user = fake_student_auth

            # Student calling staff queue/prompts/export/publish must receive 403
            for handler, extra in (
                (msp.get_staff_gemini_prompts, ()),
                (msp.get_staff_mock_queue, ()),
                (msp.create_staff_mock_export_batch, ()),
                (msp.validate_staff_grade_import, ()),
                (msp.commit_staff_grade_import, ()),
                (msp.revise_staff_mock_grade, (str(uuid.uuid4()),)),
                (msp.approve_staff_mock_grade, (str(uuid.uuid4()),)),
                (msp.publish_staff_mock_batch, ('W-2026-W44-001',)),
            ):
                resp = asyncio.run(handler(FakeReq(), *extra))
                self.assertEqual(resp.status_code, 403)

            # Teacher calling staff prompts succeeds (200) and returns all 3 official Gemini prompts
            async def fake_teacher_auth(req):
                return {'id': uuid.uuid4(), 'role': 'teacher', 'account_status': 'active'}
            msp._auth_user = fake_teacher_auth
            resp_prompts = asyncio.run(msp.get_staff_gemini_prompts(FakeReq()))
            self.assertEqual(resp_prompts.status_code, 200)
            payload = json.loads(resp_prompts.body.decode('utf-8'))
            self.assertEqual(payload['schemaVersion'], 'la.mock.grading.v1')
            self.assertIn('writing', payload['prompts'])
            self.assertIn('speaking', payload['prompts'])
            self.assertIn('repair', payload['prompts'])
        finally:
            msp._auth_user = orig_auth


if __name__ == '__main__':
    unittest.main()
