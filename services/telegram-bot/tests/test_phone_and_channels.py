"""Regression checks: contact must be self-bound and owner channel permissions are not UI-only."""
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from aiogram.filters.command import CommandObject
from aiogram.types import Chat, Contact, Message, User

from handlers.auth import cmd_start, receive_own_contact
from handlers.channels import _is_owner


def message_with_contact(sender_id=12345, contact_user_id=12345, phone="998901234567"):
    message = MagicMock(spec=Message)
    message.from_user = User(
        id=sender_id, is_bot=False, first_name="Test", language_code="uz"
    )
    message.chat = Chat(id=sender_id, type="private")
    message.contact = Contact(phone_number=phone, first_name="Test", user_id=contact_user_id)
    message.forward_origin = None
    message.answer = AsyncMock()
    return message


@pytest.mark.asyncio
async def test_start_requests_own_contact_only_when_phone_not_verified():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api:
        api.auth_preflight = AsyncMock(return_value=(403, {"error": "phone_required"}))
        await cmd_start(message, CommandObject(command="start", args=None), state=state)
        api.auth_preflight.assert_awaited_once_with("12345", "")
    state.set_state.assert_awaited_once()
    keyboard = message.answer.await_args.kwargs["reply_markup"]
    assert keyboard.keyboard[0][0].request_contact is True
    assert "Telefon" in message.answer.await_args.args[0]


@pytest.mark.asyncio
async def test_repeated_start_preserves_verified_phone_and_shows_home():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.auth_preflight = AsyncMock(return_value=(200, {"ok": True}))
        await cmd_start(message, CommandObject(command="start", args=None), state=state)
        api.save_verified_phone.assert_not_called()
        home.assert_awaited_once()
        state.set_state.assert_not_called()
        assert message.answer.await_args.kwargs["reply_markup"].remove_keyboard is True


@pytest.mark.asyncio
async def test_start_with_verified_phone_confirms_login_intent_without_contact():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.auth_preflight = AsyncMock(return_value=(200, {"ok": True}))
        api.confirm_intent = AsyncMock(return_value=True)
        await cmd_start(message, CommandObject(command="start", args="safe-deeplink"), state=state)
        api.confirm_intent.assert_awaited_once()
        state.set_state.assert_not_called()
        home.assert_awaited_once()


@pytest.mark.asyncio
async def test_start_unverified_backend_does_not_reset_verification():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api:
        api.auth_preflight = AsyncMock(return_value=(503, {"error": "membership_unavailable"}))
        await cmd_start(message, CommandObject(command="start", args=None), state=state)
    assert "Telefon" not in message.answer.await_args.args[0]
    state.set_state.assert_not_called()


@pytest.mark.asyncio
async def test_start_requires_channels_but_not_phone_for_verified_contact():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api:
        api.auth_preflight = AsyncMock(return_value=(403, {"error": "not_subscribed", "requiredChannels": [
            {"id": "-100123456", "title": "Learners", "url": "https://t.me/learners"}
        ]}))
        await cmd_start(message, CommandObject(command="start", args=None), state=state)
    assert "📢" in message.answer.await_args.args[0]
    state.set_state.assert_not_called()
    assert message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].url == "https://t.me/learners"


@pytest.mark.asyncio
async def test_only_own_native_contact_persists():
    message = message_with_contact(sender_id=100, contact_user_id=100)
    state = AsyncMock()
    state.get_data.return_value = {}
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.save_verified_phone = AsyncMock(return_value=True)
        await receive_own_contact(message, state=state)
        api.save_verified_phone.assert_awaited_once_with("100", "100", "998901234567")
        home.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("contact_owner", [None, 222])
async def test_third_party_contact_cannot_persist(contact_owner):
    message = message_with_contact(sender_id=100, contact_user_id=contact_owner)
    with patch("handlers.auth.api_client") as api:
        api.save_verified_phone = AsyncMock(return_value=True)
        await receive_own_contact(message)
        api.save_verified_phone.assert_not_called()
        assert "Faqat" in message.answer.await_args.args[0]


@pytest.mark.asyncio
async def test_forwarded_contact_rejected_even_when_id_matches():
    message = message_with_contact(sender_id=100, contact_user_id=100)
    message.forward_origin = MagicMock()
    with patch("handlers.auth.api_client") as api:
        await receive_own_contact(message)
        api.save_verified_phone.assert_not_called()


@pytest.mark.asyncio
async def test_web_login_intent_waits_for_unverified_contact():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api:
        api.auth_preflight = AsyncMock(return_value=(403, {"error": "phone_required"}))
        await cmd_start(message, CommandObject(command="start", args="safe-deeplink"), state=state)
        api.confirm_intent.assert_not_called()
        state.update_data.assert_awaited_once_with(pending_token="safe-deeplink")


def test_only_primary_owner_can_manage_channels():
    assert _is_owner({"isPrimaryOwner": True}) is True
    assert _is_owner({"isPrimaryOwner": False, "permissions": ["BOT_SETTINGS"]}) is False
    assert _is_owner({"isPrimaryOwner": False, "permissions": ["VIEW_USERS"]}) is False
    assert _is_owner(None) is False
