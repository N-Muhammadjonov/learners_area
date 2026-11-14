"""Mock access controls and feedback must respect the complete exam boundary."""
from __future__ import annotations

import asyncio
import json
import pathlib
import sys
import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from tests.test_mock_critical_repairs import FakeRequest, InMemoryMockDB
from app import mock_authoring_port as author
from app import mock_system_port as mock
from app.mock_scoring_engine import build_objective_review, sanitize_section_payload_for_exam


class AccessDB(InMemoryMockDB):
    def __init__(self):
        super().__init__(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4())
        self.owner_id = uuid.uuid4()
        self.mock_tests[self.mock_test_id]['created_by_user_id'] = self.owner_id
        self.writes: list[tuple] = []
        self.material_reads = 0
        self.material = {'questions': [{'id': '1', 'order': 1, 'questionText': 'Actual question',
                         'correctAnswer': 'A', 'type': 'multiple_choice',
                         'explanation': 'Matnda sabab berilgan.', 'evidenceQuote': 'Exact evidence.'}]}

    async def fetchrow(self, sql, *args):
        if 'FROM mock_tests' in sql:
            return self.mock_tests.get(args[0])
        if 'FROM content_versions' in sql:
            self.material_reads += 1
            return {'content_snapshot': self.material}
        return await super().fetchrow(sql, *args)

    async def execute(self, sql, *args):
        self.writes.append((sql, args))
        if 'accessLocked' in sql:
            self.mock_tests[args[0]]['provenance'] = {'accessLocked': args[1]}
        return await super().execute(sql, *args)


class AccessAndReviewTests(unittest.TestCase):
    def setUp(self):
        self.db = AccessDB()

    def call(self, route, body=None, *, role='owner', user_id=None, test_id=None):
        user = {'id': user_id or self.db.owner_id, 'role': role}
        with patch.object(mock, '_auth_user', AsyncMock(return_value=user)), \
             patch.object(mock.core, 'pool', AsyncMock(return_value=self.db)):
            return asyncio.run(route(FakeRequest(body), str(test_id or self.db.mock_test_id)))

    def test_locked_direct_start_creates_no_attempt(self):
        self.db.mock_tests[self.db.mock_test_id]['provenance'] = {'accessLocked': True}
        response = self.call(mock.start_or_resume_mock_attempt, role='student', user_id=self.db.student_id)
        self.assertEqual(response.status_code, 403)
        self.assertIn(b'mock_locked', response.body)
        self.assertEqual(self.db.writes, [])

    def test_owner_can_toggle_access_without_rewriting_materials(self):
        for locked in (True, False, True):
            response = self.call(author.set_mock_access, {'locked': locked})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.body)['locked'], locked)
        self.assertEqual(len(self.db.writes), 3)
        self.assertTrue(all('UPDATE mock_tests' in sql for sql, _ in self.db.writes))

    def test_teacher_scope_and_student_admin_access(self):
        self.assertEqual(self.call(author.set_mock_access, {'locked': False}, role='teacher').status_code, 200)
        for route in (author.set_mock_access, author.preview_mock_materials):
            for role in ('student', 'admin'):
                self.assertEqual(self.call(route, {'locked': False}, role=role).status_code, 403)
            self.assertEqual(self.call(route, {'locked': False}, role='teacher', user_id=uuid.uuid4()).status_code, 403)

    def test_access_rejects_invalid_and_draft_updates(self):
        for body in ({'locked': 'false'}, {'locked': 0}, {}, []):
            self.assertEqual(self.call(author.set_mock_access, body).status_code, 422)
        self.db.mock_tests[self.db.mock_test_id]['publication_state'] = 'draft'
        self.assertEqual(self.call(author.set_mock_access, {'locked': False}).status_code, 409)

    def test_publication_is_locked_by_default_in_the_same_update(self):
        rows = [{'id': uuid.uuid4(), 'title': slot, 'module': 'mock', 'track': 'academic',
                 'source_ref': slot, 'publication_state': 'published', 'created_by_user_id': self.db.owner_id,
                 'content_type': subtype or skill, 'content_snapshot': {'speakingMode': 'fixed'}}
                for slot, skill, subtype, _, _ in author.SLOTS]
        body = {'title': 'Mock 1', 'track': 'academic', 'publish': True,
                'sections': {slot: str(row['id']) for (slot, *_), row in zip(author.SLOTS, rows)}}
        user = {'id': self.db.owner_id, 'role': 'owner'}
        with patch.object(mock, '_auth_user', AsyncMock(return_value=user)), \
             patch.object(mock.core, 'pool', AsyncMock(return_value=self.db)), \
             patch.object(self.db, 'fetch', AsyncMock(return_value=rows)), \
             patch.object(self.db, 'fetchval', AsyncMock(return_value=self.db.mock_test_id)), \
             patch.object(mock, '_verify_section_material_integrity', AsyncMock(return_value=(True, None, None, None))):
            response = asyncio.run(author.save_mock_draft(FakeRequest(body)))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.body)['locked'])
        publications = [(sql, args) for sql, args in self.db.writes if "publication_state = 'published'" in sql]
        self.assertEqual(len(publications), 1)
        self.assertIn('accessLocked', publications[0][0])
        self.assertIs(publications[0][1][1], True)

    def test_review_is_withheld_until_every_skill_is_submitted(self):
        attempt = self.db.attempts[self.db.attempt_id]
        now = datetime.now(timezone.utc)
        for definition in attempt['mock_snapshot']['sections']:
            definition['contentVersionId'] = str(uuid.uuid4())
        for (aid, skill), row in self.db.section_submissions.items():
            row['answers_json'] = {'1': 'A'}
            row['submitted_at'] = now if skill != 'speaking' else None
        attempt['submitted_at'] = now
        response = self.call(mock.get_mock_attempt_results, role='student', user_id=self.db.student_id, test_id=self.db.attempt_id)
        self.assertNotIn('review', json.loads(response.body)['sections']['reading'])
        self.assertEqual(self.db.material_reads, 0)
        self.db.section_submissions[(self.db.attempt_id, 'speaking')]['submitted_at'] = now
        response = self.call(mock.get_mock_attempt_results, role='student', user_id=self.db.student_id, test_id=self.db.attempt_id)
        review = json.loads(response.body)['sections']['reading']['review'][0]
        self.assertTrue(review['isCorrect'])
        self.assertEqual(review['explanation'], 'Matnda sabab berilgan.')
        self.assertEqual(self.db.material_reads, 2)

    def test_feedback_uses_pair_grading_and_exam_payload_stays_secret(self):
        material = {'groups': [], 'questions': [
            {'id': str(n), 'order': n, 'correctAnswer': key, 'type': 'multiple_choice',
             'pair': [1, 2], 'explanation': 'Private rationale.', 'evidenceQuote': 'Private quote.',
             'evidence': {'quote': 'Private quote.'}} for n, key in [(1, 'C'), (2, 'E')]]}
        self.assertTrue(all(r['isCorrect'] for r in build_objective_review(material, {'1': 'E', '2': 'C'}, 'reading')))
        self.assertEqual(sum(r['isCorrect'] for r in build_objective_review(material, {'1': 'C', '2': 'C'}, 'reading')), 1)
        exam = json.dumps(sanitize_section_payload_for_exam(material))
        self.assertNotIn('Private', exam)
        self.assertNotIn('correctAnswer', exam)


if __name__ == '__main__':
    unittest.main()
