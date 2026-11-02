from __future__ import annotations

import asyncio
import base64
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "services" / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.riwi_portability import (
    RiwiPortabilityError,
    create_portable_archive,
    import_portable_archive,
)
from scripts.riwi_chat_retention_worker import run_retention_worker

TEST_SIGNING_SECRET = "riwi-test-portable-manifest-signing-secret-32b"


class RiwiPhase7PortabilityRetentionTest(unittest.TestCase):
    def test_portability_modes_a_b_c_encryption_tamper_detection_and_dry_run(self):
        from copy import deepcopy
        sample = {
            "riwi_knowledge_sources": [
                {"id":"k1","title":"Approved","state":"active","scope":"global","created_by_user_id":"u1"},
                {"id":"k2","title":"Private","state":"active","scope":"user","scope_user_id":"u1"},
                {"id":"k3","title":"Unapproved","state":"candidate","scope":"global"}],
            "riwi_knowledge_units":[{"id":"unit1","source_id":"k1","content":"Grammar"},
                                    {"id":"unit2","source_id":"k2","content":"private canary"}],
            "riwi_conversations":[{"id":"c1","user_id":"u1","locale":"uz","expires_at":"2099-01-01T00:00:00Z"},
                                  {"id":"expired","user_id":"u1","expires_at":"2000-01-01T00:00:00Z"}],
            "users":[{"id":"u1","name":"Learner","password_hash":"secret-canary"}],
            "mock_speaking_question_captures":[{"id":"capture1","transcript_capture":{"text":"private speech canary","status":"browser_unverified"}}],
            "riwi_action_confirmations":[{"id":"confirmation"}],
        }
        key=base64.b64encode(bytes(range(32))).decode()
        def export(mode):
            return create_portable_archive(mode=mode,tables_data=sample,encryption_key_b64=key,signing_secret=TEST_SIGNING_SECRET)
        def load(archive,**kwargs):
            return import_portable_archive(archive,encryption_key_b64=key,signing_secret=TEST_SIGNING_SECRET,**kwargs)
        for mode in ('A','B','C'):
            with self.assertRaises(RiwiPortabilityError):
                create_portable_archive(mode=mode,tables_data=sample,signing_secret=TEST_SIGNING_SECRET)
            archive=export(mode);store={}
            self.assertTrue(archive['manifest']['encrypted'])
            self.assertFalse(load(archive,target_store=store)['applied']);self.assertEqual(store,{})
            self.assertTrue(load(archive,dry_run=False,target_store=store)['applied'])
            self.assertNotIn('riwi_action_confirmations',store)
            if mode=='A':
                self.assertIn('mock_speaking_question_captures',store)
                self.assertEqual(len(store['riwi_knowledge_sources']),3)
                self.assertEqual([x['id'] for x in store['riwi_conversations']],['c1'])
                self.assertNotIn('password_hash',store['users'][0])
            elif mode=='B':
                self.assertNotIn('mock_speaking_question_captures',store)
                self.assertNotIn('users',store);self.assertNotIn('riwi_conversations',store)
                self.assertEqual([x['id'] for x in store['riwi_knowledge_sources']],['k1'])
                self.assertEqual(store['riwi_knowledge_sources'][0]['state'],'candidate')
                self.assertIsNone(store['riwi_knowledge_sources'][0]['created_by_user_id'])
                self.assertEqual([x['id'] for x in store['riwi_knowledge_units']],['unit1'])
            else:
                self.assertIn('mock_speaking_question_captures',store)
                self.assertIn('users',store)
                self.assertFalse(any(x.startswith('riwi_') for x in store))
            # Idempotent fixture reapply; conflicting destination remains untouched.
            self.assertTrue(load(archive,dry_run=False,target_store=store)['applied'])
            conflict={**deepcopy(store),next(iter(store)):[{'id':'conflicting-row'}]};before=deepcopy(conflict)
            with self.assertRaises(RiwiPortabilityError):load(archive,dry_run=False,target_store=conflict)
            self.assertEqual(conflict,before)
            bad=deepcopy(archive);raw=bytearray(base64.b64decode(bad['envelopeB64']));raw[-1]^=1
            bad['envelopeB64']=base64.b64encode(raw).decode()
            with self.assertRaises(RiwiPortabilityError):load(bad)
            with self.assertRaises(RiwiPortabilityError):load(archive,dry_run=False)
        with self.assertRaises(RiwiPortabilityError):
            create_portable_archive(mode='B',tables_data={'future_private_table':[]},encryption_key_b64=key,signing_secret=TEST_SIGNING_SECRET)
        with self.assertRaises(RiwiPortabilityError):
            create_portable_archive(mode='A',tables_data={'users':[{'id':'u','new_credential':'secret'}]},encryption_key_b64=key,signing_secret=TEST_SIGNING_SECRET)
        with self.assertRaisesRegex(RiwiPortabilityError,'legacy_archive'):
            load({'manifest':{'format':'RIWI-PORTABLE-v1','mode':'C'},'tables':{}})
        with patch.dict(os.environ,{'RIWI_PORTABLE_SIGNING_SECRET':'','AUTH_SECRET':'','JWT_SECRET':''}):
            with self.assertRaisesRegex(RiwiPortabilityError,'signing_secret_required'):
                create_portable_archive(mode='A',tables_data=sample,encryption_key_b64=key)

    def test_retention_worker_enforces_dry_run_unless_explicitly_enabled(self) -> None:
        async def run_worker_checks():
            # Even with execute=True, if RIWI_CHAT_RETENTION_DELETE_ENABLED is not true, dryRun remains True
            res_safe = await run_retention_worker(execute=True, conn=None, env={"RIWI_CHAT_RETENTION_DELETE_ENABLED": "false"})
            self.assertTrue(res_safe["dryRun"])
            self.assertFalse(res_safe["deleteEnabledGate"])

            res_enabled = await run_retention_worker(execute=True, conn=None, env={"RIWI_CHAT_RETENTION_DELETE_ENABLED": "true"})
            self.assertFalse(res_enabled["dryRun"])
            self.assertTrue(res_enabled["deleteEnabledGate"])

        asyncio.run(run_worker_checks())


if __name__ == "__main__":
    unittest.main()
