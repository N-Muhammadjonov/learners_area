"""Regression coverage for bot-driven website login handoff and simplified user menu."""
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiogram.types import Chat, User

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from commands import command_set
from handlers.menu import cb_login, main_keyboard, show_home
from handlers.admission import registration_name


def test_user_menu_has_exactly_three_buttons():
    markup = main_keyboard("uz", None)
    assert [row[0].callback_data for row in markup.inline_keyboard] == [
        "m:apply", "m:support", "m:lang",
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
    with patch("services.login_handoff.api_client") as client, patch("services.login_handoff.config") as config:
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
    assert sum(bool(button.url) for row in markup.inline_keyboard for button in row) == 1
    assert markup.inline_keyboard[1][0].callback_data == "m:login"


@pytest.mark.asyncio
async def test_no_handoff_link_when_account_blocked():
    callback = MagicMock()
    callback.from_user = User(id=12345, is_bot=False, first_name="Test", language_code="uz")
    callback.message.chat = Chat(id=12345, type="private")
    callback.message.edit_text = AsyncMock()
    callback.answer = AsyncMock()

    with patch("services.login_handoff.api_client") as client:
        client.create_login_handoff = AsyncMock(return_value=(403, {"error": "account_unavailable"}))
        await cb_login(callback)
    callback.message.edit_text.assert_not_awaited()
    callback.answer.assert_awaited_once()


def private_message():
    message=MagicMock()
    message.from_user=User(id=12345,is_bot=False,first_name="Test",language_code="uz")
    message.chat=Chat(id=12345,type="private")
    message.answer=AsyncMock()
    return message


@pytest.mark.asyncio
async def test_old_login_button_of_unregistered_user_starts_registration_in_bot():
    callback=MagicMock()
    callback.message=private_message()
    callback.from_user=callback.message.from_user
    callback.message.edit_text=AsyncMock()
    callback.answer=AsyncMock()
    state=MagicMock(set_state=AsyncMock())
    with patch("services.login_handoff.api_client") as client:
        client.create_login_handoff=AsyncMock(return_value=(404,{"error":"no_linked_account"}))
        await cb_login(callback,state=state)
    state.set_state.assert_awaited_once()
    assert "familiya" in callback.message.answer.await_args.args[0].lower()
    callback.message.edit_text.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("role",["student","guardian","owner"])
async def test_private_home_opens_website_on_the_first_click(role):
    message=private_message()
    link="https://learnersarea.uz/login#tg-handoff=fixture"
    with patch("handlers.menu.website_link",AsyncMock(return_value=(link,None))) as issue:
        await show_home(message,"uz",None,{"name":"Test Name","role":role,"accountStatus":"active"})
    issue.assert_awaited_once_with("12345")
    markup=message.answer.await_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[0][0].url==link
    assert markup.inline_keyboard[0][0].callback_data is None
    assert sum(bool(button.url) for row in markup.inline_keyboard for button in row)==1
    assert message.answer.await_args.kwargs["protect_content"] is True


@pytest.mark.asyncio
async def test_bot_registration_uses_the_submitted_name_and_sends_a_direct_link():
    message=private_message()
    message.text="Chosen Lastname"
    state=MagicMock(clear=AsyncMock())
    link="https://learnersarea.uz/login#tg-handoff=fixture"
    with patch("handlers.admission.api_client") as client, patch(
            "handlers.admission.website_link",AsyncMock(return_value=(link,None))):
        client.create_access_request=AsyncMock(return_value={"success":True,"status":"already_active"})
        await registration_name(message,state)
    assert client.create_access_request.await_args.args[:2]==("12345","Chosen Lastname")
    assert message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].url==link
    state.clear.assert_awaited_once()
