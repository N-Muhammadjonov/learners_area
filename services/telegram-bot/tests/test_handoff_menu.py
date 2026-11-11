"""Regression coverage for bot-driven website login handoff and simplified user menu."""
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiogram.types import Chat, User

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from commands import command_set
from handlers.menu import cb_login, main_keyboard


def test_user_menu_has_exactly_three_buttons():
    markup = main_keyboard("uz", None)
    assert [row[0].callback_data for row in markup.inline_keyboard] == [
        "m:login", "m:support", "m:lang",
    ]


def test_staff_management_is_preserved():
    markup = main_keyboard("en", {"isPrimaryOwner": True})
    assert markup.inline_keyboard[-1][0].callback_data == "m:owner"


def test_public_commands_are_start_admin_lang():
    for locale in ("uz", "en"):
        assert [item.command for item in command_set(locale)] == ["start", "admin", "lang"]


@pytest.mark.asyncio
async def test_login_button_issues_bot_bound_fragment_only():
    callback = MagicMock()
    callback.from_user = User(id=12345, is_bot=False, first_name="Test", language_code="uz")
    callback.message.chat = Chat(id=12345, type="private")
    callback.message.edit_text = AsyncMock()
    callback.answer = AsyncMock()

    nonce = "a" * 64
    with patch("handlers.menu.api_client") as client, patch("handlers.menu.config") as config:
        config.PUBLIC_SITE_URL = "https://learnersarea.uz"
        client.create_login_handoff = AsyncMock(return_value=(
            200, {
                "ok": True,
                "intentId": "11111111-1111-4111-8111-111111111111",
                "browserNonce": nonce,
                "purpose": "login",
            },
        ))
        await cb_login(callback)
        client.create_login_handoff.assert_awaited_once_with("12345")

    markup = callback.message.edit_text.await_args.kwargs["reply_markup"]
    link = markup.inline_keyboard[0][0].url
    assert link == "https://learnersarea.uz/login#tg-handoff=11111111-1111-4111-8111-111111111111." + nonce
    assert "?" not in link
    assert len(markup.inline_keyboard) == 2


@pytest.mark.asyncio
async def test_no_handoff_link_when_account_blocked():
    callback = MagicMock()
    callback.from_user = User(id=12345, is_bot=False, first_name="Test", language_code="uz")
    callback.message.chat = Chat(id=12345, type="private")
    callback.message.edit_text = AsyncMock()
    callback.answer = AsyncMock()

    with patch("handlers.menu.api_client") as client:
        client.create_login_handoff = AsyncMock(return_value=(403, {"error": "account_unavailable"}))
        await cb_login(callback)
    callback.message.edit_text.assert_not_awaited()
    callback.answer.assert_awaited_once()


@pytest.mark.asyncio
async def test_first_time_user_receives_registration_handoff():
    callback = MagicMock()
    callback.from_user = User(id=12345, is_bot=False, first_name="Test", language_code="uz")
    callback.message.chat = Chat(id=12345, type="private")
    callback.message.edit_text = AsyncMock()
    callback.answer = AsyncMock()
    with patch("handlers.menu.api_client") as client, patch("handlers.menu.config") as config:
        config.PUBLIC_SITE_URL = "https://learnersarea.uz"
        client.create_login_handoff = AsyncMock(return_value=(
            200, {
                "ok": True,
                "intentId": "11111111-1111-4111-8111-111111111111",
                "browserNonce": "b" * 64,
                "purpose": "register",
            },
        ))
        await cb_login(callback)
    link = callback.message.edit_text.await_args.kwargs["reply_markup"].inline_keyboard[0][0].url
    assert link.startswith("https://learnersarea.uz/register#tg-handoff=")
