"""Parent Connect bot directory behavior and owner menu regression tests."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from aiogram.types import Chat, User

from handlers.menu import owner_keyboard
from handlers.panel import users_home, _user_actions
from handlers.parents import parents_home, parent_card, student_parent_links
from i18n import t


STUDENT_ID = "11111111-1111-4111-8111-111111111111"
PROFILE_ID = "22222222-2222-4222-8222-222222222222"
OWNER_ACCESS = {"isPrimaryOwner": True, "permissions": []}


def callback(data):
    target = MagicMock()
    target.data = data
    target.from_user = User(id=123456, first_name="Owner", is_bot=False, language_code="uz")
    target.message.chat = Chat(id=123456, type="private")
    target.message.edit_text = AsyncMock()
    target.answer = AsyncMock()
    return target


def sample_students():
    return [{"entryType": "website_user", "id": str(UUID(int=i + 1)),
             "name": f"Student {i + 1}", "username": f"student_{i + 1}",
             "accountStatus": "active"} for i in range(10)]


def test_owner_panel_has_separate_parent_directory():
    actions = [btn.callback_data for row in owner_keyboard("uz", OWNER_ACCESS).inline_keyboard
               for btn in row]
    assert actions.index("o:parents") == actions.index("o:users") + 1
    assert len([x for x in actions if x == "o:parents"]) == 1


@pytest.mark.asyncio
async def test_users_button_immediately_shows_ten_accounts_without_requesting_search():
    event = callback("o:users")
    state = MagicMock()
    state.clear = AsyncMock()
    state.set_state = AsyncMock()
    data = {"items": sample_students(), "total": 27, "pageSize": 10, "page": 1}
    with patch("handlers.panel.api_client.search_users", AsyncMock(return_value=(200, data))) as search:
        await users_home(event, state, bot_access=OWNER_ACCESS)
    search.assert_awaited_once_with("123456", "", 1)
    state.clear.assert_awaited_once()
    state.set_state.assert_not_awaited()
    markup = event.message.edit_text.await_args.kwargs["reply_markup"]
    rows = markup.inline_keyboard
    assert [row[0].callback_data for row in rows[:10]] == [
        "usr:" + item["id"] for item in data["items"]
    ]
    assert rows[10][0].text == "1 - 10"
    assert rows[10][-1].callback_data == "usp:2"
    assert rows[11][0].callback_data == "us:search"
    assert rows[12][0].callback_data == "m:owner"


@pytest.mark.asyncio
async def test_users_button_does_not_open_directory_if_view_permission_missing():
    event = callback("o:users")
    state = MagicMock()
    state.clear = AsyncMock()
    state.set_state = AsyncMock()
    with patch("handlers.panel.api_client.search_users", AsyncMock()) as search:
        await users_home(event, state, bot_access={"permissions": [], "isPrimaryOwner": False})
    search.assert_not_awaited()
    event.message.edit_text.assert_not_awaited()
    state.set_state.assert_not_awaited()


@pytest.mark.asyncio
async def test_parent_directory_shows_separate_ten_and_search():
    event = callback("o:parents")
    state = MagicMock()
    state.clear = AsyncMock()
    state.set_state = AsyncMock()
    items = [{"profileId": str(UUID(int=i + 1)), "name": f"Parent {i}",
              "username": f"parent_{i}"} for i in range(10)]
    data = {"items": items, "total": 21, "pageSize": 10, "page": 1}
    with patch("handlers.parents.api_client.search_parents", AsyncMock(return_value=(200, data))) as search:
        await parents_home(event, state, bot_access=OWNER_ACCESS)
    search.assert_awaited_once_with("123456", "", 1)
    state.set_state.assert_not_awaited()
    markup = event.message.edit_text.await_args.kwargs["reply_markup"]
    assert len([row for row in markup.inline_keyboard if row[0].callback_data.startswith("pc:")]) == 10
    assert any(button.callback_data == "pp:2" for row in markup.inline_keyboard for button in row)
    assert any(button.callback_data == "p:search" for row in markup.inline_keyboard for button in row)


@pytest.mark.asyncio
async def test_parent_card_links_only_authorized_backend_students():
    event = callback("pc:" + PROFILE_ID)
    result = {
        "parent": {"name": "Father", "username": "father_01", "telegramId": "12345",
                   "botRemoved": False, "botBlocked": False},
        "students": [{"userId": STUDENT_ID, "name": "Student", "relationship": "father", "status": "linked"}],
    }
    with patch("handlers.parents.api_client.parent_detail", AsyncMock(return_value=(200, result))) as detail:
        await parent_card(event, bot_access=OWNER_ACCESS)
    detail.assert_awaited_once_with("123456", PROFILE_ID)
    markup = event.message.edit_text.await_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[0][0].callback_data == "usr:" + STUDENT_ID
    assert markup.inline_keyboard[-1][0].callback_data == "o:parents"


@pytest.mark.asyncio
async def test_student_profile_links_to_verified_parent_profile():
    event = callback("stdp:" + STUDENT_ID)
    result = {"items": [{"profileId": PROFILE_ID, "name": "Mother",
                         "username": "mother_01", "relationship": "mother", "status": "linked"}]}
    with patch("handlers.parents.api_client.student_parents", AsyncMock(return_value=(200, result))) as parents:
        await student_parent_links(event, bot_access=OWNER_ACCESS)
    parents.assert_awaited_once_with("123456", STUDENT_ID)
    markup = event.message.edit_text.await_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[0][0].callback_data == "pc:" + PROFILE_ID
    assert markup.inline_keyboard[-1][0].callback_data == "usr:" + STUDENT_ID


def test_existing_user_management_actions_remain_available():
    data = [button.callback_data for row in _user_actions(STUDENT_ID, OWNER_ACCESS, "uz", show_parents=True)
            for button in row]
    for action in ("dm:", "ust:approve:", "ust:reject:", "ust:suspend:", "ust:unsuspend:",
                   "ust:unlink:", "ust:remove:", "ust:delete:", "stdp:"):
        assert any(item.startswith(action) for item in data), action
