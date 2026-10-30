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
async def test_start_requests_native_contact_immediately():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api:
        api.auth_context = AsyncMock(return_value=(200, {"ok": True}))
        await cmd_start(message, CommandObject(command="start", args=None), state=state)
    state.set_state.assert_awaited_once()
    keyboard = message.answer.await_args.kwargs["reply_markup"]
    assert keyboard.keyboard[0][0].request_contact is True
    assert "Telefon" in message.answer.await_args.args[0]


@pytest.mark.asyncio
async def test_only_own_native_contact_persists():
    message = message_with_contact(sender_id=100, contact_user_id=100)
    state = AsyncMock()
    state.get_data.return_value = {}
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.save_verified_phone = AsyncMock(return_value=True)
        api.preflight_intent = AsyncMock(return_value=(200, {"ok": True}))
        await receive_own_contact(message, state=state)
        api.preflight_intent.assert_awaited_once_with("", "100")
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
async def test_web_login_intent_waits_for_contact():
    message = message_with_contact()
    state = AsyncMock()
    with patch("handlers.auth.api_client") as api:
        api.auth_context = AsyncMock(return_value=(200, {"ok": True}))
        await cmd_start(message, CommandObject(command="start", args="safe-deeplink"), state=state)
        api.confirm_intent.assert_not_called()
        api.auth_context.assert_awaited_once_with("12345", "safe-deeplink")
        state.update_data.assert_not_awaited()


def test_only_primary_owner_can_manage_channels():
    assert _is_owner({"isPrimaryOwner": True}) is True
    assert _is_owner({"isPrimaryOwner": False, "permissions": ["BOT_SETTINGS"]}) is False
    assert _is_owner({"isPrimaryOwner": False, "permissions": ["VIEW_USERS"]}) is False
    assert _is_owner(None) is False


@pytest.mark.asyncio
async def test_registration_missing_channel_retains_intent_and_shows_join_retry():
    message = message_with_contact()
    state = AsyncMock()
    state.get_data.return_value = {"pending_token": "token-private"}
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.save_verified_phone = AsyncMock(return_value=True)
        api.preflight_intent = AsyncMock(return_value=(403, {
            "error": "not_subscribed",
            "requiredChannels": [{"id": "-1001234567890", "title": "English Club", "url": "https://t.me/englishclub"}],
        }))
        await receive_own_contact(message, state=state)
        api.confirm_intent.assert_not_called()
        state.clear.assert_not_awaited()
        home.assert_not_awaited()
        markup = message.answer.await_args.kwargs["reply_markup"]
        assert markup.inline_keyboard[0][0].url == "https://t.me/englishclub"
        assert markup.inline_keyboard[-1][0].callback_data == "auth:retry_channels"
        assert [row[0].text for row in markup.inline_keyboard] == ["Obuna bo'lish", "Tekshirish"]


@pytest.mark.asyncio
async def test_retry_after_join_confirms_and_clears_token():
    from handlers.auth import retry_required_channels
    callback = MagicMock()
    callback.from_user = User(id=12345, is_bot=False, first_name="Test", language_code="uz")
    callback.message = message_with_contact()
    callback.answer = AsyncMock()
    state = AsyncMock()
    state.get_data.return_value = {"pending_token": "token-private"}
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.preflight_intent = AsyncMock(return_value=(200, {"ok": True}))
        api.confirm_intent = AsyncMock(return_value=True)
        await retry_required_channels(callback, state)
        api.confirm_intent.assert_awaited_once()
        state.clear.assert_awaited_once()
        home.assert_awaited_once()


@pytest.mark.asyncio
async def test_expired_intent_clears_pending_token():
    from handlers.auth import _complete_pending_intent
    message = message_with_contact()
    state = AsyncMock()
    state.get_data.return_value = {"pending_token": "expired"}
    with patch("handlers.auth.api_client") as api:
        api.preflight_intent = AsyncMock(return_value=(404, {"error": "intent_invalid"}))
        assert not await _complete_pending_intent(message, state, "12345", "Test User", "uz")
        api.confirm_intent.assert_not_called()
        state.clear.assert_awaited_once()


def test_only_telegram_channel_join_links_allowed():
    from handlers.auth import _channel_keyboard
    markup = _channel_keyboard("uz", [
        {"title": "Bad link", "url": "https://evil.example/join"},
        {"title": "Good", "url": "https://t.me/joinchat/test_code"},
    ])
    assert len(markup.inline_keyboard) == 2
    assert markup.inline_keyboard[0][0].url == "https://t.me/joinchat/test_code"



@pytest.mark.asyncio
async def test_direct_bot_start_also_blocks_home_until_membership_passes():
    message = message_with_contact()
    state = AsyncMock()
    state.get_data.return_value = {"pending_token": ""}
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.save_verified_phone = AsyncMock(return_value=True)
        api.preflight_intent = AsyncMock(return_value=(403, {"error": "not_subscribed", "requiredChannels": [{"title": "Club", "url": "https://t.me/learners_area"}]}))
        await receive_own_contact(message, state=state)
        home.assert_not_awaited()
        api.confirm_intent.assert_not_called()
        state.clear.assert_not_awaited()
        assert message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].url == "https://t.me/learners_area"


@pytest.mark.asyncio
async def test_retry_without_join_keeps_join_and_check_buttons_and_does_not_confirm():
    from handlers.auth import retry_required_channels
    callback = MagicMock()
    callback.from_user = User(id=12345, is_bot=False, first_name="Test", language_code="uz")
    callback.message = message_with_contact()
    callback.answer = AsyncMock()
    state = AsyncMock()
    state.get_data.return_value = {"pending_token": "token-private"}
    with patch("handlers.auth.api_client") as api, patch("handlers.auth.show_home", new_callable=AsyncMock) as home:
        api.preflight_intent = AsyncMock(return_value=(403, {"error": "not_subscribed", "requiredChannels": [{"title": "Club", "url": "https://t.me/learners_area"}]}))
        await retry_required_channels(callback, state)
        assert "Hali obuna" in callback.message.answer.await_args.args[0]
        rows = callback.message.answer.await_args.kwargs["reply_markup"].inline_keyboard
        assert rows[0][0].url == "https://t.me/learners_area"
        assert rows[-1][0].callback_data == "auth:retry_channels"
        api.confirm_intent.assert_not_called()
        state.clear.assert_not_awaited()
        home.assert_not_awaited()
