"""People browsing, search, navigation and permission regressions."""
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from handlers import panel

ACCESS = {"permissions": ["VIEW_USERS"]}


def person(index, telegram=False, **extra):
    return {
        "id": f"account-{index}",
        "entryType": "telegram_contact" if telegram else "website_user",
        "telegramUserId": str(5000 + index),
        "name": f"Person {index}",
        "username": f"person_{index:02}",
        **extra,
    }


def page(number=1, total=23):
    start = (number - 1) * 10
    return {
        "items": [person(i, telegram=i % 2 == 0) for i in range(start + 1, min(start + 10, total) + 1)],
        "page": number,
        "pageSize": 10,
        "total": total,
    }


def callback(data="o:users"):
    return SimpleNamespace(
        data=data,
        from_user=SimpleNamespace(id=12345, language_code="uz"),
        message=SimpleNamespace(edit_text=AsyncMock()),
        answer=AsyncMock(),
    )


@pytest.mark.parametrize("number,expected_range,arrows", [
    (1, "1 - 10", ["→"]),
    (2, "11 - 20", ["←", "→"]),
    (3, "21 - 23", ["←"]),
])
def test_numbered_pages_and_range_navigation(number, expected_range, arrows):
    _, markup = panel._directory_view(page(number), "uz")
    people, nav = markup.inline_keyboard[:-2], markup.inline_keyboard[-2]
    assert len(people) == (3 if number == 3 else 10)
    assert people[0][0].text.startswith(f"{(number - 1) * 10 + 1}. ")
    assert [b.text for b in nav if b.callback_data != "users:range"] == arrows
    assert [b.text for b in nav if b.callback_data == "users:range"] == [expected_range]


@pytest.mark.parametrize("total", [0, 1, 10, 20])
def test_last_page_has_no_next_arrow(total):
    number = max(1, (total + 9) // 10)
    _, markup = panel._directory_view(page(number, total), "en")
    assert "→" not in [b.text for b in markup.inline_keyboard[-2]]
    if not total:
        assert markup.inline_keyboard[-2][0].text == "0 - 0"


def test_name_and_username_label_keeps_details_inside_profile():
    button = panel._directory_button(person(1, name="Nurmuhammad", username="@uzriw", email="private@example.com"), 1)
    assert button.text == "1. Nurmuhammad - @uzriw"
    assert button.callback_data == "usr:account-1"
    assert "account-1" not in button.text
    assert "private" not in button.text
    contact = panel._directory_button(person(2, telegram=True, name="A★ B", username="hello"), 12)
    assert contact.text == "12. A★ B - @hello"
    assert contact.callback_data == "tgc:5002"


def test_missing_username_shows_name_without_id():
    button = panel._directory_button(person(1, name="Nurmuhammad", username=None), 21)
    assert button.text == "21. Nurmuhammad"
    assert "account-1" not in button.text


def test_long_name_keeps_username_visible():
    button = panel._directory_button(person(1, name="A" * 100, username="u" * 32), 100)
    assert len(button.text) <= 64
    assert button.text.endswith(" - @" + "u" * 32)


@pytest.mark.asyncio
async def test_home_opens_first_page_without_search():
    event, state = callback(), AsyncMock()
    with patch.object(panel.api_client, "search_users", AsyncMock(return_value=(200, page()))) as search:
        await panel.users_home(event, state, bot_access=ACCESS)
    search.assert_awaited_once_with("12345", "", 1)
    markup = event.message.edit_text.await_args.kwargs["reply_markup"]
    assert len(markup.inline_keyboard[:-2]) == 10
    state.update_data.assert_awaited_once_with(users_return="usp:1")


@pytest.mark.asyncio
@pytest.mark.parametrize("home", [True, False])
@pytest.mark.parametrize("backend_error", [False, True])
async def test_directory_access_fails_closed(home, backend_error):
    event, state = callback("o:users" if home else "usp:2"), AsyncMock()
    with patch.object(panel.api_client, "search_users", AsyncMock()) as search:
        handler = panel.users_home if home else panel.users_page
        await handler(event, state, bot_access=None, backend_error=backend_error)
    search.assert_not_awaited()
    event.message.edit_text.assert_not_awaited()
    assert event.answer.await_args.kwargs["show_alert"] is True


@pytest.mark.asyncio
async def test_browse_second_page_and_profile_return():
    event, state = callback("usp:2"), AsyncMock()
    with patch.object(panel.api_client, "search_users", AsyncMock(return_value=(200, page(2)))):
        await panel.users_page(event, state, bot_access=ACCESS)
    state.update_data.assert_awaited_once_with(users_return="usp:2")
    state.get_data.return_value = {"users_return": "usp:2"}
    event = callback("usr:account-11")
    with patch.object(panel.api_client, "user_detail", AsyncMock(return_value=(200, {"user": {"name": "Person 11"}}))):
        await panel.user_card(event, state, bot_access=ACCESS)
    markup = event.message.edit_text.await_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[-1][0].callback_data == "usp:2"
    state.set_state.assert_awaited_with(None)


@pytest.mark.asyncio
async def test_telegram_contact_opens_detail_and_returns_to_same_page():
    event, state = callback("tgc:5002"), AsyncMock()
    state.get_data.return_value = {"users_return": "usp:2"}
    detail = {"contact": {"firstName": "Nurmuhammad", "username": "uzriw"}}
    with patch.object(panel.api_client, "get_user", AsyncMock(return_value=detail)):
        await panel.telegram_contact_card(event, state, bot_access=ACCESS)
    assert "Nurmuhammad" in event.message.edit_text.await_args.args[0]
    markup = event.message.edit_text.await_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[-1][0].callback_data == "usp:2"


@pytest.mark.asyncio
async def test_search_results_still_paginate_with_actor_bound_draft():
    event, state = callback("usq:draft-1:2"), AsyncMock()
    with patch.object(panel.api_client, "read_draft", AsyncMock(return_value=(200, {"kind": "search", "payload": {"q": "abc"}}))) as draft:
        with patch.object(panel.api_client, "search_users", AsyncMock(return_value=(200, page(2)))) as search:
            await panel.users_page(event, state, bot_access=ACCESS)
    draft.assert_awaited_once_with("12345", "draft-1")
    search.assert_awaited_once_with("12345", "abc", 2)
    nav = event.message.edit_text.await_args.kwargs["reply_markup"].inline_keyboard[-2]
    assert [b.callback_data for b in nav] == ["usq:draft-1:1", "users:range", "usq:draft-1:3"]


@pytest.mark.asyncio
async def test_typed_search_shows_numbered_name_username_results():
    message, state = callback(), AsyncMock()
    message.text, message.answer = "abc", AsyncMock()
    with patch.object(panel.api_client, "search_users", AsyncMock(return_value=(200, page()))):
        with patch.object(panel.api_client, "save_draft", AsyncMock(return_value=(200, {"id": "draft-1"}))):
            await panel.users_search(message, state, bot_access=ACCESS)
    markup = message.answer.await_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[0][0].text == "1. Person 1 - @person_01"
    assert markup.inline_keyboard[-2][-1].callback_data == "usq:draft-1:2"


@pytest.mark.asyncio
@pytest.mark.parametrize("data", ["usp:bad", "usp:0", "usp:-1", "usp:1:2", "usq:broken"])
async def test_invalid_page_callback_does_not_query_directory(data):
    event = callback(data)
    with patch.object(panel.api_client, "search_users", AsyncMock()) as search:
        await panel.users_page(event, AsyncMock(), bot_access=ACCESS)
    search.assert_not_awaited()
    event.message.edit_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_expired_search_draft_does_not_query_directory():
    event = callback("usq:expired:2")
    with patch.object(panel.api_client, "read_draft", AsyncMock(return_value=(404, {}))):
        with patch.object(panel.api_client, "search_users", AsyncMock()) as search:
            await panel.users_page(event, AsyncMock(), bot_access=ACCESS)
    search.assert_not_awaited()


@pytest.mark.asyncio
async def test_removed_last_page_falls_back_to_existing_page():
    replies = [(200, page(3, 10)), (200, page(1, 10))]
    with patch.object(panel.api_client, "search_users", AsyncMock(side_effect=replies)) as search:
        status, data = await panel._directory_page("12345", "", 3)
    assert status == 200 and data["page"] == 1
    assert search.await_args.args == ("12345", "", 1)


@pytest.mark.asyncio
async def test_range_button_only_acknowledges_callback():
    event = callback("users:range")
    await panel.users_range(event, bot_access=ACCESS)
    event.answer.assert_awaited_once_with()
    event.message.edit_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_directory_outage_shows_error_without_replacing_list():
    event = callback()
    with patch.object(panel.api_client, "search_users", AsyncMock(side_effect=RuntimeError("offline"))):
        await panel.users_home(event, AsyncMock(), bot_access=ACCESS)
    event.message.edit_text.assert_not_awaited()
    assert event.answer.await_args.kwargs["show_alert"] is True


def _raw_people_page(number, entries, page_size=10):
    start = (number - 1) * page_size
    return {
        "items": entries[start:start + page_size],
        "page": number,
        "pageSize": page_size,
        "total": len(entries),
    }


@pytest.mark.asyncio
async def test_rejected_accounts_are_omitted_from_people_pages():
    from services.api_client import api_client

    entries = [person(i, accountStatus="rejected" if i in {2, 5, 11, 19} else "active")
               for i in range(1, 24)]
    rejected = [item for item in entries if item["accountStatus"] == "rejected"]

    async def raw(actor, query, number, status, role):
        assert actor == "12345"
        if status == "rejected":
            return 200, _raw_people_page(number, rejected)
        assert status == ""
        return 200, _raw_people_page(number, entries)

    with patch.object(api_client, "_raw_search_users", AsyncMock(side_effect=raw)) as mocked:
        code1, first = await api_client.search_users("12345", "", 1)
        code2, second = await api_client.search_users("12345", "", 2)

    assert code1 == code2 == 200
    assert first["total"] == second["total"] == 19
    assert len(first["items"]) == 10
    assert len(second["items"]) == 9
    assert all(row["accountStatus"] != "rejected" for row in first["items"] + second["items"])
    assert [row["id"] for row in first["items"] + second["items"]] == [
        row["id"] for row in entries if row["accountStatus"] != "rejected"
    ]
    assert mocked.await_count >= 4


@pytest.mark.asyncio
async def test_rejected_directory_search_is_filtered_and_counts_correctly():
    from services.api_client import api_client

    entries = [person(1, accountStatus="rejected"), person(2, telegram=True),
               person(3, accountStatus="active")]
    rejected = [entries[0]]

    async def raw(actor, query, number, status, role):
        assert query == "abc"
        return 200, _raw_people_page(number, rejected if status == "rejected" else entries)

    with patch.object(api_client, "_raw_search_users", AsyncMock(side_effect=raw)):
        code, result = await api_client.search_users("12345", "abc", 1)

    assert code == 200
    assert result["total"] == 2
    assert [item["id"] for item in result["items"]] == ["account-2", "account-3"]


@pytest.mark.asyncio
async def test_directory_rejected_filter_failure_does_not_show_users():
    from services.api_client import api_client

    async def raw(actor, query, number, status, role):
        if status == "rejected":
            return 503, {"error": "database_unavailable"}
        return 200, _raw_people_page(number, [person(1, accountStatus="rejected")])

    with patch.object(api_client, "_raw_search_users", AsyncMock(side_effect=raw)):
        code, result = await api_client.search_users("12345", "", 1)

    assert code == 503
    assert not result.get("items")


@pytest.mark.asyncio
async def test_directory_no_rejected_accounts_preserves_backend_page():
    from services.api_client import api_client

    entries = [person(i, accountStatus="active") for i in range(1, 24)]

    async def raw(actor, query, number, status, role):
        return 200, _raw_people_page(number, [] if status == "rejected" else entries)

    with patch.object(api_client, "_raw_search_users", AsyncMock(side_effect=raw)) as raw_mock:
        code, result = await api_client.search_users("12345", "", 2)

    assert code == 200
    assert result == _raw_people_page(2, entries)
    assert raw_mock.await_count == 3


def test_people_action_buttons_match_account_state():
    access = {"permissions": ["VIEW_USERS", "MANAGE_USERS", "ADMISSIONS"]}
    owner = {"role": "owner", "accountStatus": "active"}
    pending = {"accountStatus": "pending", "role": "student", "telegramId": "12345"}
    active = {"accountStatus": "active", "role": "student", "telegramId": "12345"}
    suspended = {"accountStatus": "suspended", "role": "student", "telegramId": "12345"}
    from functools import partial

    def actions(user):
        rows = panel._user_actions("account-1", user, access, owner, "uz")
        return [button.callback_data for row in rows for button in row]

    pending_controls = actions(pending)
    assert "ust:approve:account-1" in pending_controls
    assert "ust:reject:account-1" in pending_controls
    assert "ust:suspend:account-1" not in pending_controls
    assert "ust:delete:account-1" not in pending_controls

    active_controls = actions(active)
    assert "ust:suspend:account-1" in active_controls
    assert "ust:approve:account-1" not in active_controls
    assert "ust:unsuspend:account-1" not in active_controls
    assert "ust:unlink:account-1" in active_controls
    assert "ust:remove:account-1" in active_controls

    suspended_controls = actions(suspended)
    assert "ust:unsuspend:account-1" in suspended_controls
    assert "ust:suspend:account-1" not in suspended_controls


def test_restricted_bot_admin_cannot_view_academic_results():
    student = {"role": "student", "accountStatus": "active", "telegramId": "42"}
    bot_admin = {"role": "admin", "accountStatus": "active"}
    bot_access = {"permissions": ["VIEW_USERS", "MANAGE_USERS", "ADMISSIONS"]}
    rows = panel._user_actions("account-1", student, bot_access, bot_admin, "uz")
    assert not any(btn.callback_data.startswith("upr:") for row in rows for btn in row)
    owner_access = {"permissions": ["VIEW_USERS"], "isPrimaryOwner": True}
    owner = {"role": "owner", "accountStatus": "active"}
    rows = panel._user_actions("account-1", student, owner_access, owner, "uz")
    assert any(btn.callback_data == "upr:account-1" for row in rows for btn in row)
    teacher = {"role": "teacher", "accountStatus": "active"}
    rows = panel._user_actions("account-1", student, bot_access, teacher, "uz")
    assert any(btn.callback_data == "upr:account-1" for row in rows for btn in row)
    # Actual teacher/student scope is rechecked server-side on every result request.


@pytest.mark.asyncio
async def test_pending_decision_requires_pending_status():
    event, state = callback("ust:approve:account-1"), AsyncMock()
    with patch.object(panel.api_client, "user_detail", AsyncMock(return_value=(200, {"user": {"accountStatus": "active"}}))):
        with patch.object(panel.api_client, "decide_access_request", AsyncMock()) as decide:
            await panel.user_status_action(event, state, bot_access={"permissions": ["ADMISSIONS"]})
    decide.assert_not_awaited()
    assert event.answer.await_args.kwargs["show_alert"]


@pytest.mark.asyncio
async def test_telegram_contact_removal_does_not_call_website_unlink():
    event, state = callback("tgr:5002"), AsyncMock()
    state.get_data.return_value = {"users_return": "usp:1"}
    access = {"permissions": ["MANAGE_USERS"]}
    with patch.object(panel.api_client, "remove_telegram_contact", AsyncMock(return_value=(200, {"ok": True}))) as remove:
        with patch.object(panel.api_client, "user_action", AsyncMock()) as website_action:
            await panel.remove_telegram_only_contact(event, state, bot_access=access)
    remove.assert_awaited_once_with("12345", "5002")
    website_action.assert_not_awaited()
    assert "Botdan chiqarildi" in event.message.edit_text.await_args.args[0]


@pytest.mark.asyncio
async def test_academic_results_never_render_in_group_chat():
    event = callback("upr:11111111-1111-4111-8111-111111111111")
    event.message.chat = SimpleNamespace(type="supergroup")
    owner_access = {"permissions": ["VIEW_USERS"], "isPrimaryOwner": True}
    owner = {"role": "owner", "accountStatus": "active"}
    with patch.object(panel.api_client, "student_results", AsyncMock()) as request:
        await panel.user_results(event, db_user=owner, bot_access=owner_access)
    request.assert_not_awaited()
    event.message.edit_text.assert_not_awaited()
    assert event.answer.await_args.kwargs["show_alert"] is True


@pytest.mark.asyncio
async def test_academic_documents_never_send_to_group_chat():
    event = callback("upf:pdf:11111111-1111-4111-8111-111111111111")
    event.message.chat = SimpleNamespace(type="group")
    event.message.answer_document = AsyncMock()
    owner_access = {"permissions": ["VIEW_USERS"], "isPrimaryOwner": True}
    owner = {"role": "owner", "accountStatus": "active"}
    with patch.object(panel.api_client, "student_results_document", AsyncMock()) as request:
        await panel.download_user_results(event, db_user=owner, bot_access=owner_access)
    request.assert_not_awaited()
    event.message.answer_document.assert_not_awaited()
    assert event.answer.await_args.kwargs["show_alert"] is True
