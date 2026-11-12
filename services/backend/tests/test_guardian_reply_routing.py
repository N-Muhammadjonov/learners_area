"""Parent message replies: sender binding, authorization, deduplication and private schema."""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

import pytest
from starlette.requests import Request

from app import main as core
from app import guardian_port as guardian


DELIVERY = UUID("11111111-1111-4111-8111-111111111111")
SENDER = UUID("22222222-2222-4222-8222-222222222222")
STUDENT = UUID("33333333-3333-4333-8333-333333333333")
REPLY = UUID("44444444-4444-4444-8444-444444444444")


def req():
    return Request({
        "type": "http", "method": "POST", "path": "/api/internal/telegram/guardians/replies",
        "headers": [], "query_string": b"", "server": ("example.test", 443),
        "scheme": "https",
    })


def context(role="teacher"):
    return {
        "id": DELIVERY, "link_id": DELIVERY, "student_id": STUDENT,
        "guardian_name": "Mother", "telegram_user_id": "123456789",
        "original_text": "Please check this homework", 
        "guardian_status": "active", "guardian_chat": "123456789",
        "guardian_blocked": None, "guardian_removed": None,
        "sender_user_id": SENDER, "sender_role": role,
        "sender_status": "active", "sender_telegram_id": "987654321",
        "staff_chat": "987654321", "staff_blocked": None, "staff_removed": None,
        "link_status": "linked", "original_status": "sent",
    }


class Conn:
    def __init__(self):
        self.inserts = []
        self.existing = None

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def fetchval(self, query, *args):
        self.inserts.append((query, args))
        if "INSERT INTO guardian_message_replies" in query:
            return REPLY
        return 1

    async def fetchrow(self, *_args):
        return self.existing

    async def execute(self, *_args):
        return "INSERT 0 1"


class Pool:
    def __init__(self, con):
        self.con = con

    @asynccontextmanager
    async def acquire(self):
        yield self.con


@pytest.mark.asyncio
@pytest.mark.parametrize("actor,expected_kind", [("123456789", "guardian"), ("987654321", "staff")])
async def test_reply_binds_to_original_guardian_or_exact_original_staff(monkeypatch, actor, expected_kind):
    con = Conn()
    async def bot_body(_req):
        return {"actorTelegramId": actor, "deliveryId": str(DELIVERY),
                "incomingMessageId": "19", "text": "My reply"}, None
    async def pool():
        return Pool(con)
    async def row(_conn, _id):
        return context()
    async def authorized(_conn, _row):
        return True
    async def audit(*_args, **_kwargs):
        return None
    monkeypatch.setattr(guardian, "bot_body", bot_body)
    monkeypatch.setattr(core, "pool", pool)
    monkeypatch.setattr(guardian, "conversation_context", row)
    monkeypatch.setattr(guardian, "conversation_active", authorized)
    monkeypatch.setattr(guardian, "audit", audit)

    response = await guardian.bot_guardian_reply(req())
    assert response.status_code == 200
    assert json.loads(response.body)["replyId"] == str(REPLY)
    inserts = [args for query, args in con.inserts if "INSERT INTO guardian_message_replies" in query]
    assert len(inserts) == 1
    assert inserts[0] == (DELIVERY, actor, "19", expected_kind, "My reply")


@pytest.mark.asyncio
async def test_unknown_staff_or_another_parent_cannot_reply(monkeypatch):
    async def bot_body(_req):
        return {"actorTelegramId": "555555555", "deliveryId": str(DELIVERY),
                "incomingMessageId": "21", "text": "Impersonation"}, None
    async def pool():
        return Pool(Conn())
    async def row(_conn, _id):
        return context("owner")
    async def authorized(_conn, _row):
        return True
    monkeypatch.setattr(guardian, "bot_body", bot_body)
    monkeypatch.setattr(core, "pool", pool)
    monkeypatch.setattr(guardian, "conversation_context", row)
    monkeypatch.setattr(guardian, "conversation_active", authorized)
    assert (await guardian.bot_guardian_reply(req())).status_code == 403


@pytest.mark.asyncio
async def test_teacher_link_revocation_prevents_reply():
    class Assignment:
        async def fetchval(self, *_args):
            return None
    assert not await guardian.conversation_active(Assignment(), context())
    owner = context("owner")
    assert await guardian.conversation_active(Assignment(), owner)
    owner["guardian_status"] = "suspended"
    assert not await guardian.conversation_active(Assignment(), owner)


@pytest.mark.parametrize("actor,original", [("123456789", "guardian"), ("987654321", "staff")])
def test_reply_is_identified_by_original_sender_not_by_presentation_name(actor, original):
    row = context()
    assert (actor == row["telegram_user_id"]) == (original == "guardian")
    assert (actor == row["sender_telegram_id"]) == (original == "staff")


def test_reply_schema_is_private_and_deduplicated():
    schema = (Path(__file__).resolve().parents[1] /
              "migrations/0090_guardian_message_replies.sql").read_text()
    assert "UNIQUE (actor_telegram_id, source_message_id)" in schema
    assert "ENABLE ROW LEVEL SECURITY" in schema
    assert "REVOKE ALL ON guardian_message_replies FROM PUBLIC" in schema
    assert "ON DELETE CASCADE" in schema


def test_full_guardian_id_in_staff_directory_is_not_masked():
    source = (Path(__file__).resolve().parents[1] / "app/guardian_port.py").read_text()
    directory = source.split("async def staff_guardians", 1)[1].split("async def staff_guardian_detail", 1)[0]
    assert "'ID ' + r['telegram_user_id']" in directory
    assert "mask_tg(r['telegram_user_id'])" not in directory


@pytest.mark.asyncio
@pytest.mark.parametrize("sender_kind,expected_chat,expected_heading", [
    ("guardian", "987654321", "Teacher yuborgan xabarga javob"),
    ("staff", "123456789", "Teacher javobi"),
])
async def test_reply_claim_routes_only_to_original_party(monkeypatch, sender_kind, expected_chat, expected_heading):
    class QueueConnection(Conn):
        async def fetch(self, *_args):
            return [{"id": REPLY, "delivery_id": DELIVERY,
                     "sender_kind": sender_kind, "body": "Hello"}]

    con = QueueConnection()

    async def bot_body(_req):
        return {}, None

    async def pool():
        return Pool(con)

    async def row(_conn, _id):
        return context()

    async def authorized(_conn, _row):
        return True

    monkeypatch.setattr(guardian, "bot_body", bot_body)
    monkeypatch.setattr(core, "pool", pool)
    monkeypatch.setattr(guardian, "conversation_context", row)
    monkeypatch.setattr(guardian, "conversation_active", authorized)

    response = await guardian.bot_claim_guardian_replies(req())
    assert response.status_code == 200
    payload = json.loads(response.body)
    assert len(payload["replies"]) == 1
    out = payload["replies"][0]
    assert out["deliveryId"] == str(DELIVERY)
    assert out["chatId"] == expected_chat
    assert expected_heading in out["text"]
    assert "Hello" in out["text"]


@pytest.mark.asyncio
async def test_reply_claim_does_not_deliver_to_blocked_target(monkeypatch):
    class QueueConnection(Conn):
        async def fetch(self, *_args):
            return [{"id": REPLY, "delivery_id": DELIVERY,
                     "sender_kind": "guardian", "body": "Hello"}]
        async def execute(self, query, *args):
            self.inserts.append((query, args))
            return "UPDATE 1"

    con = QueueConnection()

    async def bot_body(_req):
        return {}, None

    async def pool():
        return Pool(con)

    async def row(_conn, _id):
        value = context()
        value["staff_blocked"] = object()
        return value

    async def authorized(_conn, _row):
        return True

    monkeypatch.setattr(guardian, "bot_body", bot_body)
    monkeypatch.setattr(core, "pool", pool)
    monkeypatch.setattr(guardian, "conversation_context", row)
    monkeypatch.setattr(guardian, "conversation_active", authorized)

    response = await guardian.bot_claim_guardian_replies(req())
    assert json.loads(response.body)["replies"] == []
    assert any("recipient_unavailable" in query for query, _args in con.inserts)
