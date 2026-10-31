"""Real-source, attempt-scoped Speaking mode and Part2->Part3 mapping checks."""
import asyncio
import pathlib
import sys
import unittest
import uuid
from unittest.mock import patch
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_mock_hybrid_system import _ensure_lightweight_fastapi_stub
_ensure_lightweight_fastapi_stub()
from app import mock_authoring_port as author
from app import mock_system_port as mock


def prompt(part, topic, text, followups=None, external_id=None):
    return {'id':uuid.uuid4(),'part':part,'topic':topic,'prompt_text':text,
            'cue_card':None,'follow_ups':followups,'external_id':external_id}

class FakeConnection:
    def __init__(self, rows): self.rows=rows; self.inserts=[]
    async def fetch(self, query):
        assert 'speaking_prompts' in query
        assert "publication_state='published'" in query
        return self.rows
    async def execute(self, query, *params):
        assert 'INSERT INTO content_versions' in query
        self.inserts.append(params)

class SpeakingAutoTests(unittest.TestCase):
    def setUp(self):
        self.p1a=prompt('part1','Hometown','What do you like about your hometown?')
        self.p1b=prompt('part1','Books','Do you enjoy reading?')
        self.p2a=prompt('part2','Travel','Describe a trip', ['Why do people travel?','How is travel changing?'], 's166-001-part2-00')
        self.p2b=prompt('part2','Plants','Describe a garden', ['Why grow flowers?'], 's166-002-part2-00')
        self.p3a=prompt('part3','Tourism','Why do people travel?', external_id='s166-001-part3-01')
        self.p3b=prompt('part3','Tourism','How is travel changing?', external_id='s166-001-part3-02')
        self.p3c=prompt('part3','Environment','Why grow flowers?', external_id='s166-002-part3-01')
        self.p3duplicate=prompt('part3','Unrelated','Why do people travel?', external_id='s166-077-part3-01')
        self.con=FakeConnection([self.p1a,self.p1b,self.p2a,self.p2b,self.p3a,self.p3b,self.p3c,self.p3duplicate])
        self.user={'id':uuid.uuid4(),'role':'teacher'}

    def test_auto_pool_frozen_with_real_exact_follow_up_links(self):
        vid=asyncio.run(author._auto_speaking_version(self.con,self.user,'academic','Weekly'))
        self.assertIsNotNone(vid)
        self.assertEqual(len(self.con.inserts),1)
        import json
        pool=json.loads(self.con.inserts[0][-1])
        self.assertTrue(mock._valid_auto_speaking_pool(pool))
        self.assertEqual(pool['speakingMode'],'auto')
        pairs={p['part2']['topic']:p for p in pool['part2Pairs']}
        self.assertEqual({x['questionId'] for x in pairs['Travel']['part3']},
                         {str(self.p3a['id']),str(self.p3b['id'])})
        self.assertEqual([x['questionId'] for x in pairs['Plants']['part3']],
                         [str(self.p3c['id'])])
        # No unrelated Part 3 topic can appear in a given Part 2 selection.
        with patch('secrets.choice',side_effect=lambda x:x[-1]):
            material=mock.select_attempt_speaking_material(pool)
        self.assertEqual([p['part'] for p in material['parts']],['P1','P2','P3'])
        self.assertEqual(material['parts'][2]['questionId'],str(self.p3c['id']))

    def test_choice_differs_with_different_random_selections(self):
        asyncio.run(author._auto_speaking_version(self.con,self.user,'academic','Weekly'))
        import json
        pool=json.loads(self.con.inserts[0][-1])
        with patch('secrets.choice',side_effect=lambda x:x[0]):
            first=mock.select_attempt_speaking_material(pool)
        with patch('secrets.choice',side_effect=lambda x:x[-1]):
            second=mock.select_attempt_speaking_material(pool)
        self.assertNotEqual(first['parts'],second['parts'])
        self.assertTrue(all('questionId' in q for q in first['parts']))

    def test_absent_links_block_auto_pool(self):
        self.con.rows=[self.p1a,self.p2a,self.p3c]
        self.assertIsNone(asyncio.run(author._auto_speaking_version(self.con,self.user,'academic','Weekly')))
        with self.assertRaises(ValueError):
            mock.select_attempt_speaking_material({'speakingMode':'auto','part1Pool':[], 'part2Pairs':[]})

    def test_published_pool_is_valid_but_private_until_assigned(self):
        asyncio.run(author._auto_speaking_version(self.con,self.user,'general','Weekly'))
        import json
        pool=json.loads(self.con.inserts[0][-1])
        with patch.object(mock,'_load_section_questions_from_version',return_value=pool):
            class Db:
                async def fetchrow(self,query,vid):
                    return {'id':vid,'track':'general','publication_state':'published','content_snapshot':pool}
            is_valid,code,_,returned=asyncio.run(mock._verify_section_material_integrity(
                Db(),{'skill':'speaking','content_version_id':uuid.uuid4()},expected_track='general'))
        self.assertTrue(is_valid,(code,returned))
        self.assertEqual(returned,pool)
        self.assertNotIn('parts',returned)

    def test_unknown_mode_rejected_before_db(self):
        class Req:
            async def json(self):
                return {'title':'Weekly IELTS','track':'academic','sections':{},'speakingMode':'invalid'}
        async def auth(_):return self.user
        with patch.object(mock,'_auth_user',auth):
            response=asyncio.run(author.save_mock_draft(Req()))
        self.assertEqual(response.status_code,422)

if __name__=='__main__':unittest.main()
