"""Regression tests for manual guardian replies and uniform Telegram contact messaging."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiogram.types import Chat, User

from handlers.guardian import begin_guardian_message_reply, send_guardian_message_reply
from handlers.panel import begin_dm, send_dm
from bot import _delivery_loop

DELIVERY = "11111111-1111-4111-8111-111111111111"


def callback(data: str):
    event = MagicMock()
    event.data = data
    event.from_user = User(id=123456789, first_name="Parent", is_bot=False, language_code="uz")
    event.message.chat = Chat(id=123456789, type="private")
    event.message.answer = AsyncMock()
    event.message.edit_text = AsyncMock()
    event.answer = AsyncMock()
    return event


def message(text="I have a question"):
    event = MagicMock()
    event.text = text
    event.from_user = User(id=123456789, first_name="Parent", is_bot=False, language_code="uz")
    event.chat = Chat(id=123456789, type="private")
    event.message_id = 1001
    event.answer = AsyncMock()
    return event


@pytest.mark.asyncio
async def test_reply_button_records_delivery_without_trusting_username():
    event = callback("gmr:" + DELIVERY)
    state = MagicMock()
    state.set_state = AsyncMock()
    state.update_data = AsyncMock()
    with patch("handlers.guardian._private", return_value=True):
        await begin_guardian_message_reply(event, state)
    state.set_state.assert_awaited_once()
    state.update_data.assert_awaited_once_with(guardian_reply_delivery=DELIVERY)
    assert "Javobingizni yozing" in event.message.answer.await_args.args[0]


@pytest.mark.asyncio
async def test_parent_reply_uses_telegram_actor_identity_and_server_original_delivery():
    event = message()
    state = MagicMock()
    state.get_data = AsyncMock(return_value={"guardian_reply_delivery": DELIVERY})
    state.clear = AsyncMock()
    with patch("handlers.guardian.api_client.submit_guardian_reply",
               AsyncMock(return_value=(200, {"ok": True, "replyId": DELIVERY}))) as submit:
        await send_guardian_message_reply(event, state)
    submit.assert_awaited_once_with("123456789", DELIVERY, "1001", "I have a question")
    state.clear.assert_awaited_once()
    assert "navbatga" in event.answer.await_args.args[0]


@pytest.mark.asyncio
async def test_reply_refused_if_conversation_no_longer_authorized():
    event = message()
    state = MagicMock()
    state.get_data = AsyncMock(return_value={"guardian_reply_delivery": DELIVERY})
    state.clear = AsyncMock()
    with patch("handlers.guardian.api_client.submit_guardian_reply",
               AsyncMock(return_value=(403, {"error": "forbidden"}))):
        await send_guardian_message_reply(event, state)
    state.clear.assert_awaited_once()
    assert "mavjud emas" in event.answer.await_args.args[0]


@pytest.mark.asyncio
async def test_unlinked_contact_can_start_direct_message_compose():
    event = callback("dmt:123456789")
    state = MagicMock()
    state.set_state = AsyncMock()
    state.update_data = AsyncMock()
    with patch("handlers.panel.api_client.get_user",
               AsyncMock(return_value={"contact": {"firstName": "Parent", "username": "parent"}})):
        await begin_dm(event, state, bot_access={"isPrimaryOwner": True})
    state.update_data.assert_awaited_once_with(
        user_id=None, contact_id="123456789", target_name="Parent")


@pytest.mark.asyncio
async def test_contact_direct_message_goes_through_backend_queue():
    event = callback("dmc:" + DELIVERY)
    state = MagicMock()
    draft = {"payload": {"contactTelegramId": "123456789", "text": "Hello"}}
    with patch("handlers.panel.api_client.claim_draft", AsyncMock(return_value=(200, draft))), \
         patch("handlers.panel.api_client.send_contact_message",
               AsyncMock(return_value=(200, {"ok": True}))) as submit:
        await send_dm(event, bot_access={"isPrimaryOwner": True})
    submit.assert_awaited_once_with("123456789", "123456789", "Hello")
    assert event.message.edit_text.await_args is not None


def test_bot_worker_attaches_reply_controls_to_original_and_replies():
    import inspect
    from bot import _deliver_guardian_messages, _deliver_guardian_replies
    parent = inspect.getsource(_deliver_guardian_messages)
    replies = inspect.getsource(_deliver_guardian_replies)
    assert "claim_guardian_replies()" in replies
    assert "report_guardian_replies(reply_results)" in replies
    assert "claim_guardian_deliveries()" in parent
    assert "report_guardian_deliveries(parent_results)" in parent
    assert parent.count('callback_data=f"gmr:{item[\'deliveryId\']}"') == 1
    assert replies.count('callback_data=f"gmr:{item[\'deliveryId\']}"') == 1
    assert "log.exception" in inspect.getsource(_delivery_loop)


@pytest.mark.asyncio
async def test_worker_failure_in_one_queue_does_not_skip_other_queues():
    import asyncio
    stop = asyncio.Event()
    calls = []

    async def broadcasts(_bot):
        calls.append("broadcasts")
        raise RuntimeError("simulated API failure")

    async def guardian_messages(_bot):
        calls.append("guardian-messages")

    async def guardian_replies(_bot):
        calls.append("guardian-replies")

    async def notices(_bot):
        calls.append("notices")
        stop.set()

    with patch("bot._deliver_broadcasts", broadcasts), \
         patch("bot._deliver_guardian_messages", guardian_messages), \
         patch("bot._deliver_guardian_replies", guardian_replies), \
         patch("bot._deliver_notices", notices), \
         patch("bot.log.exception") as errors:
        await _delivery_loop(MagicMock(), stop)
    assert calls == ["broadcasts", "guardian-messages", "guardian-replies", "notices"]
    errors.assert_called_once_with("delivery stage failed: %s", "broadcasts")


@pytest.mark.parametrize("status,payload", [(401, {}), (503, {}), (200, None)])
def test_failed_queue_api_response_cannot_masquerade_as_an_empty_queue(status, payload):
    from services.api_client import ApiClient
    with pytest.raises(RuntimeError, match="guardian replies claim"):
        ApiClient._require_worker_success(status, payload, "guardian replies claim")
