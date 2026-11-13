from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "services" / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import main as core
from app.security import SESSION_COOKIE, issue_token


STUDENT_ID = "11111111-1111-4111-8111-111111111111"
UNASSIGNED_STUDENT_ID = "99999999-9999-4999-8999-999999999999"
TEACHER_ID = "22222222-2222-4222-8222-222222222222"
ADMIN_ID = "33333333-3333-4333-8333-333333333333"
OWNER_ID = "44444444-4444-4444-8444-444444444444"


class InMemoryE2EConn:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
        self.users = {
            STUDENT_ID: {
                "id": UUID(STUDENT_ID),
                "name": "Ali Valiyev",
                "email": "student@example.test",
                "role": "student",
                "account_status": "active",
                "locale": "uz",
                "onboarding_completed_at": self.now,
                "status_reason": None,
                "auth_version": 0,
                "last_active_at": self.now,
            },
            UNASSIGNED_STUDENT_ID: {
                "id": UUID(UNASSIGNED_STUDENT_ID),
                "name": "Zarina Karimova",
                "email": "zarina@example.test",
                "role": "student",
                "account_status": "active",
                "locale": "uz",
                "onboarding_completed_at": self.now,
                "status_reason": None,
                "auth_version": 0,
                "last_active_at": self.now,
            },
            TEACHER_ID: {
                "id": UUID(TEACHER_ID),
                "name": "Teacher One",
                "email": "teacher@example.test",
                "role": "teacher",
                "account_status": "active",
                "locale": "en",
                "onboarding_completed_at": self.now,
                "status_reason": None,
                "auth_version": 0,
                "last_active_at": self.now,
            },
            ADMIN_ID: {
                "id": UUID(ADMIN_ID),
                "name": "Admin One",
                "email": "admin@example.test",
                "role": "admin",
                "account_status": "active",
                "locale": "en",
                "onboarding_completed_at": self.now,
                "status_reason": None,
                "auth_version": 0,
                "last_active_at": self.now,
            },
            OWNER_ID: {
                "id": UUID(OWNER_ID),
                "name": "Owner One",
                "email": "owner@example.test",
                "role": "owner",
                "account_status": "active",
                "locale": "en",
                "onboarding_completed_at": self.now,
                "status_reason": None,
                "auth_version": 0,
                "last_active_at": self.now,
            },
        }
        self.roster = {(TEACHER_ID, STUDENT_ID)}
        self.conversations: dict[str, dict] = {}
        self.messages: list[dict] = []
        self.knowledge_sources: dict[str, dict] = {}
        self.learning_signals: dict[str, dict] = {}
        self.security_signals: dict[str, dict] = {
            "aaaa1111-1111-4111-8111-111111111111": {
                "id": "aaaa1111-1111-4111-8111-111111111111",
                "type": "prompt_injection",
                "state": "candidate",
                "fingerprint": "fp-prompt-injection-001",
                "count": 1,
                "first_seen_at": self.now,
                "last_seen_at": self.now,
                "actor_role": "student",
                "route_class": "/api/riwi/chat",
                "sanitized_evidence": "classification=prompt_injection; route=/api/riwi/chat; raw_prompt=omitted",
                "regression_fixture_id": None,
                "reviewed_by_user_id": None,
                "reviewed_at": None,
                "created_at": self.now,
            }
        }
        self.policy_versions: dict[str, dict] = {}
        self.policy_parents = {}
        self.audits: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def acquire(self):
        return self

    def transaction(self):return self

    async def fetchval(self,sql,*args):
        if 'SELECT EXISTS(SELECT 1 FROM reading_attempts' in sql:return False
        if 'MAX(version)' in sql:
            return max((r['version'] for r in self.policy_versions.values() if r['policy_id']==args[0]),default=0)+1
        raise AssertionError(sql)

    async def fetchrow(self, sql: str, *args):
        from riwi_domain_fixtures import dictionary_row
        handled,row=dictionary_row(sql,args,'resilient','dddd1111-1111-4111-8111-111111111111',
            'Able to recover quickly from difficult conditions.','Qiyinchiliklardan tez tiklanadigan.','She is a resilient learner.')
        if handled:return row
        if 'riwi_assessment_policy_versions' in sql and 'INSERT INTO' in sql:
            from uuid import uuid4
            pid,number,overlay,source_hash,actor=args
            row={'id':str(uuid4()),'policy_id':pid,'version':number,'state':'candidate','overlay':overlay,'source_message_hash':source_hash,'created_by_user_id':actor}
            self.policy_versions[row['id']]=row
            return dict(row)
        if 'SELECT id FROM riwi_assessment_policies' in sql:
            return next(({'id':p['id']} for p in self.policy_parents.values() if p['scope']==args[0]),None)
        if 'SELECT * FROM riwi_assessment_policies' in sql:return self.policy_parents.get(str(args[0]))
        if 'SELECT policy_id FROM riwi_assessment_policy_versions' in sql:
            row=self.policy_versions.get(str(args[0]));return {'policy_id':row['policy_id']} if row else None
        if 'SELECT * FROM riwi_assessment_policy_versions' in sql:return self.policy_versions.get(str(args[0]))
        if 'WHERE v.policy_id=$1 AND v.source_message_hash=$2' in sql:
            return next(({**r,'scope':self.policy_parents[str(r['policy_id'])]['scope']} for r in self.policy_versions.values() if r['policy_id']==args[0] and r['source_message_hash']==args[1]),None)
        if "FROM users" in sql and "auth_session_revocations" in sql:
            uid = str(args[0]).lower()
            u = self.users.get(uid)
            if u and u["auth_version"] == args[1]:
                return dict(u)
            return None
        if "FROM users u" in sql and "latest_event_at" in sql:
            uid = str(args[0]).lower()
            u = self.users.get(uid)
            if not u:
                return None
            return {
                "role": u["role"],
                "account_status": u["account_status"],
                "last_active_at": u["last_active_at"],
                "latest_event_at": u.get("latest_event_at"),
            }
        if "SELECT role::text AS role, account_status::text AS account_status FROM users WHERE id =" in sql:
            uid = str(args[0]).lower()
            u = self.users.get(uid)
            return {"role": u["role"], "account_status": u["account_status"]} if u else None
        if "SELECT id::text AS id, role::text AS role, account_status::text AS account_status FROM users WHERE id =" in sql:
            uid = str(args[0]).lower()
            u = self.users.get(uid)
            return {"id": uid, "role": u["role"], "account_status": u["account_status"]} if u else None
        if "FROM teacher_student_links" in sql and "SELECT 1" in sql:
            tid, sid = str(args[0]).lower(), str(args[1]).lower()
            return {"ok": 1} if (tid, sid) in self.roster else None

        if "SELECT id::text AS id, user_id::text AS user_id" in sql and "FROM riwi_conversations" in sql:
            cid = str(args[0]).lower()
            return self.conversations.get(cid)
        if "DELETE FROM riwi_conversations" in sql and "RETURNING id" in sql:
            cid, uid, role = str(args[0]).lower(), str(args[1]).lower(), str(args[2])
            conv = self.conversations.get(cid)
            if conv and conv["user_id"] == uid and conv["role_at_creation"] == role:
                self.conversations.pop(cid, None)
                self.messages = [m for m in self.messages if m["conversation_id"] != cid]
                return {"id": cid}
            return None
        if "FROM content_versions" in sql:
            return {'content_snapshot':{'questions':[{'id':'cccc1111-1111-4111-8111-111111111111','correctAnswer':'B',
                'explanation':'Paragraph 2 states that urban trees reduce heat islands.'}]}}
        if "FROM reading_attempts a" in sql:
            return {
                "attempt_id": str(args[0]),
                "user_id": STUDENT_ID,
                "status": "submitted",
                "question_id": str(args[1]),
                "prompt_text": "What is the main idea of paragraph 2?",
                "official_answer": "B",
                "accepted_answers": ["B"],
                "authored_explanation": "Paragraph 2 states that urban trees reduce heat islands.",
                "learner_answer": "A",
                "is_correct": False,
                "content_version_id":"12345678-1234-4234-8234-123456789abc",
            }
        if "FROM riwi_knowledge_conflicts" in sql and "SELECT count(*)" in sql:
            return {"cnt": 0}
        if "FROM riwi_knowledge_sources" in sql and "checksum =" in sql:
            return None
        if "FROM riwi_knowledge_sources" in sql and "WHERE id =" in sql:
            sid = str(args[0]).lower()
            return self.knowledge_sources.get(sid)
        if "FROM riwi_learning_signals" in sql and "actor_user_id =" in sql:
            return None
        if "FROM riwi_learning_signals" in sql and "WHERE id =" in sql:
            sid = str(args[0]).lower()
            return self.learning_signals.get(sid)
        if "FROM riwi_security_signals" in sql and "WHERE id =" in sql:
            sid = str(args[0]).lower()
            return self.security_signals.get(sid)
        if "FROM riwi_usage_metrics" in sql and "SELECT count(*)" in sql:
            return {"total": 2, "succeeded": 2, "failed": 0}
        if "SELECT count(*)::int AS total FROM audit_log" in sql:
            return {"total": len(self.audits)}
        return None

    async def fetch(self, sql: str, *args):
        if "FROM teacher_student_links tsl" in sql:
            tid = str(args[0]).lower()
            rows = []
            for t, s in self.roster:
                if t == tid and s in self.users:
                    u = self.users[s]
                    rows.append({"id": s, "name": u["name"], "sort_name": u["name"].lower()})
            return rows
        if "FROM users u" in sql and "u.role = 'student'" in sql:
            rows = []
            for uid, u in sorted(self.users.items()):
                if u["role"] == "student":
                    rows.append({"id": uid, "name": u["name"], "sort_name": u["name"].lower()})
            return rows
        if "FROM riwi_conversation_messages" in sql:
            cid = str(args[0]).lower()
            return [m for m in self.messages if m["conversation_id"] == cid]
        if "FROM riwi_knowledge_units u" in sql:
            return []
        if "FROM riwi_security_signals" in sql:
            return list(self.security_signals.values())
        if "FROM riwi_learning_signals" in sql:
            return list(self.learning_signals.values())
        if "FROM riwi_knowledge_sources" in sql:
            return list(self.knowledge_sources.values())
        if "FROM riwi_assessment_policy_versions" in sql:
            return list(self.policy_versions.values())
        if "FROM audit_log" in sql:
            return list(self.audits)
        return []

    async def execute(self, sql: str, *args):
        if 'INSERT INTO riwi_assessment_policies' in sql:
            from uuid import uuid4
            if not any(p['scope']==args[0] for p in self.policy_parents.values()):
                pid=str(uuid4());self.policy_parents[pid]={'id':pid,'scope':args[0],'active_version':None}
            return 'INSERT 1'
        if "UPDATE riwi_assessment_policy_versions SET state='superseded'" in sql:
            for row in self.policy_versions.values():
                if row['policy_id']==args[0] and row['state']=='approved':row['state']='superseded'
            return 'UPDATE 1'
        if "UPDATE riwi_assessment_policy_versions SET state='approved'" in sql:
            self.policy_versions[str(args[0])]['state']='approved';return 'UPDATE 1'
        if 'UPDATE riwi_assessment_policies SET active_version' in sql:
            self.policy_parents[str(args[0])]['active_version']=args[1];return 'UPDATE 1'
        if "UPDATE users" in sql and "SET last_active_at" in sql:
            uid, ts = str(args[0]).lower(), args[1]
            if uid in self.users:
                self.users[uid]["last_active_at"] = ts
        elif "INSERT INTO riwi_conversations" in sql:
            cid, uid, role, locale, exp, created = args
            self.conversations[str(cid).lower()] = {
                "id": str(cid).lower(),
                "user_id": str(uid).lower(),
                "role_at_creation": role,
                "locale": locale,
                "expires_at": exp,
                "deleted_at": None,
                "created_at": created,
                "updated_at": created,
            }
        elif "WITH old AS" in sql or "riwiArchivedAt" in sql:
            pass  # Archive semantics have dedicated retention boundary/SQL integration tests.
        elif "UPDATE riwi_conversations" in sql:
            cid, upd, exp = str(args[0]).lower(), args[1], args[2]
            if cid in self.conversations:
                self.conversations[cid]["updated_at"] = upd
                self.conversations[cid]["expires_at"] = exp
        elif "INSERT INTO riwi_conversation_messages" in sql:
            mid, cid, content, meta, created = args
            role = "user" if "'user'" in sql else "assistant"
            self.messages.append({
                "id": str(mid).lower(),
                "conversation_id": str(cid).lower(),
                "role": role,
                "content": content,
                "metadata": meta,
                "created_at": created,
            })
        elif "INSERT INTO riwi_knowledge_sources" in sql:
            sid = str(args[0]).lower()
            self.knowledge_sources[sid] = {
                "id": sid,
                "source_type": args[1],
                "title": args[2],
                "checksum": args[3],
                "provenance": args[4],
                "rights_class": args[5],
                "authority": args[6],
                "scope": args[7],
                "scope_role": args[8],
                "scope_user_id": args[9],
                "version": 1,
                "state": "candidate",
                "unit_count": args[10],
                "created_by_user_id": str(args[11]).lower(),
                "created_at": self.now,
                "updated_at": self.now,
            }
        elif "UPDATE riwi_knowledge_sources" in sql and "state = 'approved'" in sql:
            sid = str(args[0]).lower()
            if sid in self.knowledge_sources:
                self.knowledge_sources[sid]["state"] = "approved"
        elif "UPDATE riwi_knowledge_sources" in sql and "state = 'active'" in sql:
            sid = str(args[0]).lower()
            if sid in self.knowledge_sources:
                self.knowledge_sources[sid]["state"] = "active"
        elif "UPDATE riwi_knowledge_sources SET state = 'rejected'" in sql:
            sid = str(args[0]).lower()
            if sid in self.knowledge_sources:
                self.knowledge_sources[sid]["state"] = "rejected"
        elif "INSERT INTO riwi_learning_signals" in sql:
            sid = str(args[0]).lower()
            self.learning_signals[sid] = {
                "id": sid,
                "signal_type": args[1],
                "state": "candidate",
                "actor_user_id": str(args[2]).lower(),
                "actor_role": args[3],
                "target_user_id": str(args[4]).lower() if args[4] else None,
                "source_id": args[5],
                "candidate_claim": args[10],
                "evidence_summary": args[11],
                "evidence_hash": args[12],
                "scope": args[13],
                "created_at": self.now,
                "updated_at": self.now,
            }
        elif "UPDATE riwi_learning_signals" in sql:
            sid, st = str(args[0]).lower(), args[1]
            if sid in self.learning_signals:
                self.learning_signals[sid]["state"] = st
        elif "UPDATE riwi_security_signals" in sql:
            sid, st = str(args[0]).lower(), args[1]
            if sid in self.security_signals:
                self.security_signals[sid]["state"] = st
        elif "INSERT INTO riwi_assessment_policy_versions" in sql:
            vid = str(args[0]).lower()
            self.policy_versions[vid] = {
                "id": vid,
                "scope": args[1],
                "version": 1,
                "state": "candidate",
                "overlay": args[2],
                "created_by_user_id": str(args[3]).lower(),
                "created_at": args[4],
            }
        elif "INSERT INTO audit_log" in sql:
            self.audits.append({
                "id": str(args[0]).lower(),
                "actor_user_id": str(args[1]).lower(),
                "action": args[2],
                "target_type": args[3],
                "target_id": args[4],
                "metadata": args[5],
                "created_at": self.now,
            })
        return "OK"


class RiwiPhase9E2EIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._env_patch = patch.dict(
            os.environ,
            {
                "AUTH_SECRET": "e2e-test-auth-secret-32-characters-minimum",
                "RIWI_CURSOR_SECRET": "e2e-test-cursor-secret-32-characters-minimum",
                "RIWI_PORTABLE_SIGNING_SECRET": "e2e-test-portable-secret-32-characters-minimum",
                "RIWI_ENABLED": "true",
            },
        )
        self._env_patch.start()
        self.conn = InMemoryE2EConn()

        async def fake_pool():
            return self.conn

        self._pool_patch = patch.object(core, "pool", fake_pool)
        self._pool_patch.start()
        self.client = TestClient(core.app)

    def tearDown(self) -> None:
        self._pool_patch.stop()
        self._env_patch.stop()

    def _auth_header(self, user_id: str) -> dict[str, str]:
        u = self.conn.users[user_id]
        token = issue_token(u)
        return {"Cookie": f"{SESSION_COOKIE}={token}"}

    def test_end_to_end_student_teacher_admin_and_owner_flows_over_http(self) -> None:
        student_headers = self._auth_header(STUDENT_ID)
        teacher_headers = self._auth_header(TEACHER_ID)
        admin_headers = self._auth_header(ADMIN_ID)
        owner_headers = self._auth_header(OWNER_ID)

        # 1. Student chat (dictionary lookup), conversation read, feedback, objective explanation, presence, delete
        r_chat = self.client.post(
            "/api/riwi/chat",
            json={"message": "What does resilient mean?"},
            headers=student_headers,
        )
        self.assertEqual(r_chat.status_code, 200)
        chat_data = r_chat.json()
        self.assertTrue(chat_data["ok"])
        self.assertEqual(chat_data["provenance"], "canonical_dictionary")
        self.assertIn("resilient", chat_data["answer"].lower())
        conv_id = chat_data["conversationId"]

        r_conv = self.client.get(f"/api/riwi/conversations/{conv_id}", headers=student_headers)
        self.assertEqual(r_conv.status_code, 200)
        self.assertEqual(len(r_conv.json()["messages"]), 2)

        r_pres = self.client.post("/api/riwi/presence", json={}, headers=student_headers)
        self.assertEqual(r_pres.status_code, 200)
        self.assertTrue(r_pres.json()["ok"])

        r_fb = self.client.post(
            "/api/riwi/feedback",
            json={"conversationId": conv_id, "helpful": False, "reason": "Want more Uzbek examples"},
            headers=student_headers,
        )
        self.assertEqual(r_fb.status_code, 200)
        self.assertTrue(r_fb.json()["signal"]["recorded"])

        r_obj = self.client.post(
            "/api/riwi/objective-explanation",
            json={
                "module": "reading",
                "attemptId": "bbbb1111-1111-4111-8111-111111111111",
                "questionId": "cccc1111-1111-4111-8111-111111111111",
                "locale": "en",
            },
            headers=student_headers,
        )
        self.assertEqual(r_obj.status_code, 200)
        self.assertEqual(r_obj.json()["officialAnswer"], "")
        self.assertTrue(r_obj.json()['teachingOnly'])
        self.assertNotIn('urban trees', r_obj.json()['explanation'])

        # Student is forbidden from /api/riwi/targets and /api/riwi/owner/*
        self.assertEqual(self.client.get("/api/riwi/targets", headers=student_headers).status_code, 403)
        self.assertEqual(self.client.get("/api/riwi/owner/diagnostics", headers=student_headers).status_code, 403)

        # 2. Teacher can list assigned student targets and query assigned student progress, but not unassigned student
        r_targets = self.client.get("/api/riwi/targets", headers=teacher_headers)
        self.assertEqual(r_targets.status_code, 200)
        self.assertEqual(len(r_targets.json()["items"]), 1)
        self.assertEqual(r_targets.json()["items"][0]["id"], STUDENT_ID)

        r_teacher_ok = self.client.post(
            "/api/riwi/chat",
            json={"message": "How is my student doing?", "targetUserId": STUDENT_ID},
            headers=teacher_headers,
        )
        self.assertEqual(r_teacher_ok.status_code, 200)

        r_teacher_unassigned = self.client.post(
            "/api/riwi/chat",
            json={"message": "How is my student doing?", "targetUserId": UNASSIGNED_STUDENT_ID},
            headers=teacher_headers,
        )
        self.assertEqual(r_teacher_unassigned.status_code, 403)

        # 3. Admin can list targets in cohort scope, but is forbidden from Owner governance routes
        r_admin_targets = self.client.get("/api/riwi/targets", headers=admin_headers)
        self.assertEqual(r_admin_targets.status_code, 200)
        self.assertEqual(len(r_admin_targets.json()["items"]), 2)
        self.assertEqual(self.client.get("/api/riwi/owner/diagnostics", headers=admin_headers).status_code, 403)
        self.assertEqual(self.client.get("/api/riwi/owner/audit", headers=admin_headers).status_code, 403)

        # 4. Owner full governance workflow: diagnostics, knowledge lifecycle, learning signals, security signals, provider lab, assessment policies, audit
        r_diag = self.client.get("/api/riwi/owner/diagnostics", headers=owner_headers)
        self.assertEqual(r_diag.status_code, 200)
        self.assertTrue(r_diag.json()["ok"])

        # Create, approve, and promote a Knowledge candidate
        r_k_create = self.client.post(
            "/api/riwi/owner/knowledge",
            json={
                "sourceType": "writing_material",
                "title": "IELTS Task 2 Paragraphing Rule",
                "provenance": "Centre Academic Board",
                "rightsClass": "internal_permission",
                "scope": {"kind": "global"},
                "content": "Every Task 2 essay requires a clear thesis statement and topic sentences.",
            },
            headers=owner_headers,
        )
        self.assertEqual(r_k_create.status_code, 200)
        source_id = r_k_create.json()["source"]["id"]
        self.assertEqual(r_k_create.json()["source"]["state"], "candidate")

        r_k_approve = self.client.post(f"/api/riwi/owner/knowledge/{source_id}/approve", json={}, headers=owner_headers)
        self.assertEqual(r_k_approve.status_code, 200)
        self.assertEqual(r_k_approve.json()["source"]["state"], "approved")

        r_k_promote = self.client.post(
            f"/api/riwi/owner/knowledge/{source_id}/promote",
            json={"regressionFixtureId": "retrieval-active-scope-only-v1"},
            headers=owner_headers,
        )
        self.assertEqual(r_k_promote.status_code, 200)
        self.assertEqual(r_k_promote.json()["source"]["state"], "active")

        # Create an owner manual_qa_finding learning signal, approve it, and promote to knowledge candidate
        r_sig_create = self.client.post(
            "/api/riwi/learning-signals",
            json={
                "signalType": "manual_qa_finding",
                "sourceId": "ffff1111-1111-4111-8111-111111111111",
                "scope": "global",
                "candidateClaim": "Present perfect connects a past action to a present result.",
                "evidenceSummary": "Verified during owner curriculum audit.",
            },
            headers=owner_headers,
        )
        self.assertEqual(r_sig_create.status_code, 200)
        qa_sig_id = r_sig_create.json()["signal"]["id"]

        r_sig_rev = self.client.post(
            f"/api/riwi/learning-signals/{qa_sig_id}/review",
            json={
                "decision": "approve",
                "reason": "Confirmed helpful grammar rule",
                "regressionFixtureId": "policy-deny-default-v1",
            },
            headers=owner_headers,
        )
        self.assertEqual(r_sig_rev.status_code, 200)
        self.assertEqual(r_sig_rev.json()["signal"]["state"], "accepted")

        r_sig_know = self.client.post(f"/api/riwi/learning-signals/{qa_sig_id}/knowledge", json={}, headers=owner_headers)
        self.assertEqual(r_sig_know.status_code, 200)
        self.assertEqual(r_sig_know.json()["source"]["state"], "candidate")

        # Security signal listing and review
        r_sec_list = self.client.get("/api/riwi/owner/security-signals", headers=owner_headers)
        self.assertEqual(r_sec_list.status_code, 200)
        sec_id = r_sec_list.json()["items"][0]["id"]

        r_sec_rev = self.client.post(
            f"/api/riwi/owner/security-signals/{sec_id}/review",
            json={"state": "approved_regression", "regressionFixtureId": "policy-deny-default-v1"},
            headers=owner_headers,
        )
        self.assertEqual(r_sec_rev.status_code, 200)
        self.assertEqual(r_sec_rev.json()["signal"]["state"], "approved_regression")

        # Provider Lab fixed-fixture experiment
        r_lab = self.client.post(
            "/api/riwi/owner/provider-lab",
            json={
                "fixtureId": "safe-grammar-explanation-v1",
                "providerIds": ["openai"],
                "idempotencyKey": "eeee1111-1111-4111-8111-111111111111",
            },
            headers=owner_headers,
        )
        self.assertEqual(r_lab.status_code, 200)
        self.assertIn(r_lab.json()["experiment"]["state"], ("completed", "failed", "partial"))

        # Assessment Policy preview & create
        r_pol_prev = self.client.post(
            "/api/riwi/owner/assessment-policies/preview",
            json={
                "scope": "writing.task2.*",
                "overlay": {
                    "maxWeaknesses": 3,
                    "feedbackStyle": "step_by_step",
                },
            },
            headers=owner_headers,
        )
        self.assertEqual(r_pol_prev.status_code, 200)
        self.assertTrue(r_pol_prev.json()["regression"]["passed"])

        r_pol_create = self.client.post(
            "/api/riwi/owner/assessment-policies",
            json={
                "scope": "writing.task2.*",
                "overlay": {
                    "maxWeaknesses": 3,
                    "feedbackStyle": "step_by_step",
                },
            },
            headers=owner_headers,
        )
        self.assertEqual(r_pol_create.status_code, 200)
        pol_vid = r_pol_create.json()["policyVersion"]["id"]

        r_pol_app = self.client.post(f"/api/riwi/owner/assessment-policies/{pol_vid}/approve", json={"contentHash":r_pol_create.json()["policyVersion"]["contentHash"]}, headers=owner_headers)
        self.assertEqual(r_pol_app.status_code, 200)
        self.assertEqual(r_pol_app.json()["state"], "approved")

        # Owner audit log pagination
        r_audit = self.client.get("/api/riwi/owner/audit?limit=5", headers=owner_headers)
        self.assertEqual(r_audit.status_code, 200)
        self.assertTrue(r_audit.json()["ok"])

        # Delete student conversation
        r_del = self.client.delete(f"/api/riwi/conversations/{conv_id}", headers=student_headers)
        self.assertEqual(r_del.status_code, 200)
        self.assertTrue(r_del.json()["deleted"])


if __name__ == "__main__":
    unittest.main()
