"""Authorized guardian directory and bidirectional student–parent navigation.

All data comes from the server-authorized bot directory. No account details are
trusted from callback payloads. Searches never mutate guardian links.
"""
from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from html_text import esc
from i18n import t
from middlewares.auth import allows
from services.api_client import api_client

parents_router = Router()


class ParentsFlow(StatesGroup):
    search = State()


def _lang(event, db_user: dict | None, contact: dict | None) -> str:
    override = (contact or {}).get("localeOverride")
    if override in ("uz", "en"):
        return override
    if db_user and db_user.get("locale") in ("uz", "en"):
        return db_user["locale"]
    language = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if language.startswith("en") else "uz"


def _button_text(item: dict) -> str:
    name = str(item.get("name") or "—")
    username = str(item.get("username") or "").lstrip("@")
    return (f"{name} - @{username}" if username else name)[:64]


def _parent_list(lang: str, data: dict, page: int, draft: str | None = None) -> InlineKeyboardMarkup:
    total = max(0, int(data.get("total") or 0))
    rows = [
        [InlineKeyboardButton(text=_button_text(item), callback_data=f"pc:{item['profileId']}")]
        for item in (data.get("items") or [])
    ]
    nav = []
    prefix = f"pq:{draft}:" if draft else "pp:"
    if page > 1:
        nav.append(InlineKeyboardButton(text=t(lang, "prev"), callback_data=f"{prefix}{page - 1}"))
    first = (page - 1) * 10 + 1 if total else 0
    nav.append(InlineKeyboardButton(text=f"{first} - {min(total, page * 10)}", callback_data="p:noop"))
    if page * 10 < total:
        nav.append(InlineKeyboardButton(text=t(lang, "next"), callback_data=f"{prefix}{page + 1}"))
    rows.append(nav)
    rows.append([InlineKeyboardButton(text=t(lang, "search"), callback_data="p:search")])
    rows.append([InlineKeyboardButton(text=t(lang, "home"), callback_data="m:owner")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _query_parents(actor: str, query: str, page: int):
    try:
        status, data = await api_client.search_parents(actor, query, page)
    except Exception:
        return 503, {}
    return status, data if isinstance(data, dict) else {}


@parents_router.callback_query(F.data == "p:noop")
async def noop(callback: CallbackQuery):
    await callback.answer()


@parents_router.callback_query(F.data == "o:parents")
async def parents_home(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None,
                       bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, data = await _query_parents(str(callback.from_user.id), "", 1)
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"), show_alert=True)
        return
    await state.clear()
    await callback.message.edit_text(t(lang, "parents"),
                                     reply_markup=_parent_list(lang, data, 1))
    await callback.answer()


@parents_router.callback_query(F.data == "p:search")
async def parents_search_start(callback: CallbackQuery, state: FSMContext,
                               db_user: dict | None = None, bot_access: dict | None = None,
                               contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    await state.set_state(ParentsFlow.search)
    markup = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=t(lang, "back"), callback_data="o:parents"),
    ]])
    await callback.message.edit_text(t(lang, "search_prompt"), reply_markup=markup)
    await callback.answer()


@parents_router.message(ParentsFlow.search)
async def parents_search(message: Message, state: FSMContext, db_user: dict | None = None,
                         bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await state.clear()
        await message.answer(t(lang, "no_permission"))
        return
    query = (message.text or "").strip()
    status, data = await _query_parents(str(message.from_user.id), query, 1)
    await state.clear()
    if status != 200:
        await message.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"))
        return
    draft = None
    if int(data.get("total") or 0) > 10:
        try:
            saved_status, result = await api_client.save_draft(str(message.from_user.id), "search", {"q": query})
            if saved_status == 200:
                draft = result.get("id")
        except Exception:
            pass
    await message.answer(t(lang, "parents"), reply_markup=_parent_list(lang, data, 1, draft))


@parents_router.callback_query(F.data.regexp(r"^pp:[1-9][0-9]{0,4}$"))
async def parents_page(callback: CallbackQuery, db_user: dict | None = None,
                       bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    page = int(callback.data.split(":")[1])
    status, data = await _query_parents(str(callback.from_user.id), "", page)
    if status != 200:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    await callback.message.edit_text(t(lang, "parents"), reply_markup=_parent_list(lang, data, page))
    await callback.answer()


@parents_router.callback_query(F.data.regexp(r"^pq:[0-9a-fA-F-]{36}:[1-9][0-9]{0,4}$"))
async def parents_search_page(callback: CallbackQuery, db_user: dict | None = None,
                              bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    _, draft_id, index = callback.data.split(":")
    status, draft = await api_client.read_draft(str(callback.from_user.id), draft_id)
    if status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    page = int(index)
    query = (draft.get("payload") or {}).get("q") or ""
    status, data = await _query_parents(str(callback.from_user.id), query, page)
    if status != 200:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    await callback.message.edit_text(t(lang, "parents"),
                                     reply_markup=_parent_list(lang, data, page, draft_id))
    await callback.answer()


@parents_router.callback_query(F.data.regexp(r"^pc:[0-9a-fA-F-]{36}$"))
async def parent_card(callback: CallbackQuery, db_user: dict | None = None,
                      bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    profile_id = callback.data.split(":", 1)[1]
    try:
        status, data = await api_client.parent_detail(str(callback.from_user.id), profile_id)
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "error"), show_alert=True)
        return
    parent = data.get("parent") or {}
    username = parent.get("username")
    bot_state = "🚫" if parent.get("botRemoved") else "⛔" if parent.get("botBlocked") else "✅"
    lines = [
        f"👤 {esc(parent.get('name') or '—')}",
        f"📱 @{esc(username)}" if username else "📱 —",
        f"🆔 Telegram ID: {esc(parent.get('telegramId') or '—')}",
        f"{bot_state} Telegram",
    ]
    if parent.get("phone"):
        lines.append(f"📞 {esc(parent['phone'])}")
    rows = []
    students = data.get("students") or []
    if not students:
        lines.append(t(lang, "no_links"))
    else:
        lines.append(t(lang, "linked_students") + ":")
        for student in students:
            status_text = "" if student.get("status") == "linked" else f" · {student.get('status')}"
            rows.append([InlineKeyboardButton(
                text=(str(student.get("name") or "—") + status_text)[:64],
                callback_data=f"usr:{student['userId']}",
            )])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="o:parents")])
    await callback.message.edit_text("\n".join(lines),
                                     reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@parents_router.callback_query(F.data.regexp(r"^stdp:[0-9a-fA-F-]{36}$"))
async def student_parent_links(callback: CallbackQuery, db_user: dict | None = None,
                               bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    student_id = callback.data.split(":", 1)[1]
    try:
        status, data = await api_client.student_parents(str(callback.from_user.id), student_id)
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "error"), show_alert=True)
        return
    items = data.get("items") or []
    rows = [[InlineKeyboardButton(
        text=(str(item.get("name") or "—") + (" - @" + item["username"] if item.get("username") else ""))[:64],
        callback_data=f"pc:{item['profileId']}",
    )] for item in items]
    if not rows:
        title = t(lang, "no_links")
    else:
        title = t(lang, "linked_parents")
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data=f"usr:{student_id}")])
    await callback.message.edit_text(title, reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()
