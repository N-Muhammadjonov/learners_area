from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from copy_format import format_audit, format_settings, format_stats
from html_text import esc
from i18n import t
from middlewares.auth import allows, denial_key
from services.api_client import api_client

panel_router = Router()


class PanelFlow(StatesGroup):
    search = State()
    dm_compose = State()
    dm_preview = State()
    broadcast_compose = State()
    broadcast_preview = State()
    delete_code = State()
    admin_add = State()


def _lang(event, db_user, contact=None) -> str:
    override = (contact or {}).get("localeOverride")
    if override in {"uz", "en"}:
        return override
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if str(code).startswith("en") else "uz"


def _back(lang: str, target: str = "m:owner") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=t(lang, "back"), callback_data=target)]])


def _directory_button(item: dict) -> InlineKeyboardButton:
    if item.get("entryType") == "telegram_contact":
        telegram_id = str(item.get("telegramUserId") or "")
        name = str(item.get("name") or item.get("username") or telegram_id)
        username = str(item.get("username") or "").lstrip("@")
        label = f"{name} - @{username}" if username and name.lstrip("@") != username else name
        return InlineKeyboardButton(text=label[:64], callback_data=f"tgc:{telegram_id}")

    name = str(item.get("name") or "—")
    username = str(item.get("username") or "").lstrip("@")
    label = f"{name} - @{username}" if username else name
    return InlineKeyboardButton(text=label[:64], callback_data=f"usr:{item['id']}")


def _user_page_markup(lang: str, data: dict, page: int, draft_id: str | None = None) -> InlineKeyboardMarkup:
    items = data.get("items") or []
    total = max(0, int(data.get("total") or 0))
    size = 10
    rows = [[_directory_button(item)] for item in items]
    navigation = []
    prefix = f"usq:{draft_id}:" if draft_id else "usp:"
    if page > 1:
        navigation.append(InlineKeyboardButton(text=t(lang, "prev"), callback_data=f"{prefix}{page - 1}"))
    first = (page - 1) * size + 1 if total else 0
    last = min(total, page * size)
    navigation.append(InlineKeyboardButton(text=f"{first} - {last}", callback_data="us:noop"))
    if page * size < total:
        navigation.append(InlineKeyboardButton(text=t(lang, "next"), callback_data=f"{prefix}{page + 1}"))
    rows.append(navigation)
    rows.append([InlineKeyboardButton(text=t(lang, "search"), callback_data="us:search")])
    rows.append([InlineKeyboardButton(text=t(lang, "home"), callback_data="m:owner")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


@panel_router.callback_query(F.data == "us:noop")
async def user_page_counter(callback: CallbackQuery):
    await callback.answer()


@panel_router.callback_query(F.data == "o:users")
async def users_home(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    try:
        status, data = await api_client.search_users(str(callback.from_user.id), "", 1)
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"), show_alert=True)
        return
    await state.clear()
    await callback.message.edit_text(t(lang, "users"), reply_markup=_user_page_markup(lang, data, 1))
    await callback.answer()


@panel_router.callback_query(F.data == "us:search")
async def users_search_start(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    await state.set_state(PanelFlow.search)
    await callback.message.edit_text(t(lang, "search_prompt"), reply_markup=_back(lang, "o:users"))
    await callback.answer()


@panel_router.message(PanelFlow.search)
async def users_search(message: Message, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await state.clear()
        await message.answer(t(lang, "no_permission"))
        return
    query = (message.text or "").strip()
    try:
        status, data = await api_client.search_users(str(message.from_user.id), query, 1)
    except Exception:
        status, data = 503, {}
    await state.clear()
    if status != 200:
        await message.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"))
        return
    draft_id = None
    if (data.get("total") or 0) > 10:
        try:
            draft_status, draft = await api_client.save_draft(str(message.from_user.id), "search", {"q": query})
            if draft_status == 200:
                draft_id = draft.get("id")
        except Exception:
            pass
    await message.answer(t(lang, "users"), reply_markup=_user_page_markup(lang, data, 1, draft_id))


@panel_router.callback_query(F.data.regexp(r"^usp:[1-9][0-9]{0,4}$"))
async def users_plain_page(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    page = int(callback.data.split(":")[1])
    try:
        status, data = await api_client.search_users(str(callback.from_user.id), "", page)
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    await callback.message.edit_text(t(lang, "users"), reply_markup=_user_page_markup(lang, data, page))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("usq:"))
async def users_page(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "VIEW_USERS")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    try:
        _, draft_id, page_text = callback.data.split(":", 2)
        page = max(1, min(10000, int(page_text)))
    except (TypeError, ValueError):
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    draft_status, draft = await api_client.read_draft(str(callback.from_user.id), draft_id)
    if draft_status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    query = ((draft.get("payload") or {}).get("q")) or ""
    try:
        status, data = await api_client.search_users(str(callback.from_user.id), query, page)
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"), show_alert=True)
        return
    await callback.message.edit_text(t(lang, "users"), reply_markup=_user_page_markup(lang, data, page, draft_id))
    await callback.answer()


def _user_actions(user_id: str, bot_access: dict | None, lang: str,
                  show_parents: bool = False) -> list[list[InlineKeyboardButton]]:
    rows = []
    if allows(bot_access, "DIRECT_MESSAGE"):
        rows.append([InlineKeyboardButton(text=t(lang, "message"), callback_data=f"dm:{user_id}")])
    if allows(bot_access, "MANAGE_USERS"):
        rows.append([
            InlineKeyboardButton(text=t(lang, "unlink"), callback_data=f"ust:unlink:{user_id}"),
            InlineKeyboardButton(text=t(lang, "remove_bot"), callback_data=f"ust:remove:{user_id}"),
        ])
    if allows(bot_access, "DANGEROUS_USER_DELETE"):
        rows.append([InlineKeyboardButton(text=t(lang, "delete_account"), callback_data=f"ust:delete:{user_id}")])
    if show_parents:
        rows.insert(0, [InlineKeyboardButton(text=t(lang, "linked_parents"), callback_data=f"stdp:{user_id}")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="o:users")])
    return rows


@panel_router.callback_query(F.data.startswith("usr:"))
async def user_card(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    user_id = callback.data.split(":", 1)[1]
    status, data = await api_client.user_detail(str(callback.from_user.id), user_id)
    if status != 200:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    user = data.get("user") or {}
    text = "\n".join([
        esc(user.get("name")),
        esc(user.get("email") or "—"),
        f"{esc(user.get('role'))} · {esc(user.get('accountStatus'))}",
        f"telegram: {esc(user.get('telegramId') or '—')}",
    ])
    if user.get("role") == "student" and not user.get("hasLinkedParent"):
        text += "\n👨‍👩‍👧 Hali ota-ona ulanmagan" if lang == "uz" else "\n👨‍👩‍👧 No parent connected yet"
    if (bot_access or {}).get("isPrimaryOwner") and user.get("telegramId"):
        phone_status, phone = await api_client.owner_contact_detail(
            str(callback.from_user.id), str(user["telegramId"])
        )
        if phone_status == 200:
            username = phone.get("username")
            text += f"\n📱 @{esc(username)}" if username else "\n📱 —"
            text += f"\n📞 {esc(phone.get('phoneNumber') or '—')}"
    await callback.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=_user_actions(
        user_id, bot_access, lang, show_parents=user.get("role") == "student" and bool(user.get("hasLinkedParent")))))
    await callback.answer()



@panel_router.callback_query(F.data.startswith("tgc:"))
async def telegram_contact_card(
    callback: CallbackQuery,
    db_user: dict | None = None,
    bot_access: dict | None = None,
    contact: dict | None = None,
):
    lang = _lang(callback, db_user, contact)

    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return

    telegram_id = (callback.data or "").split(":", 1)[1]

    try:
        data = await api_client.get_user(telegram_id)
    except Exception:
        data = None

    if not data or not data.get("contact"):
        await callback.answer(t(lang, "error"), show_alert=True)
        return

    target_contact = data.get("contact") or {}
    linked_user = data.get("user")

    full_name = " ".join(
        part
        for part in [
            target_contact.get("firstName"),
            target_contact.get("lastName"),
        ]
        if part
    ).strip()

    username = target_contact.get("username")

    display_name = (
        full_name
        or (f"@{username}" if username else None)
        or telegram_id
    )

    if target_contact.get("removed"):
        bot_state = "🚫 Botdan chiqarilgan" if lang == "uz" else "🚫 Removed from bot"
    elif target_contact.get("blocked"):
        bot_state = "⛔ Bot bloklangan" if lang == "uz" else "⛔ Bot blocked"
    else:
        bot_state = "✅ Bot faol" if lang == "uz" else "✅ Bot active"

    lines = [
        f"👤 {esc(display_name)}",
        f"📱 @{esc(username)}" if username else "📱 —",
        f"🆔 Telegram ID: {esc(telegram_id)}",
        bot_state,
    ]

    if (bot_access or {}).get("isPrimaryOwner"):
        phone_status, phone = await api_client.owner_contact_detail(
            str(callback.from_user.id), telegram_id
        )
        if phone_status == 200:
            lines.append(f"📞 {esc(phone.get('phoneNumber') or '—')}")

    rows = []
    if linked_user:
        lines.append(
            f"🌐 {esc(linked_user.get('name') or '—')} · "
            f"{esc(linked_user.get('accountStatus') or '—')}"
        )
        if linked_user.get("id"):
            rows.append([InlineKeyboardButton(text=t(lang, "linked_user"), callback_data=f"usr:{linked_user['id']}")])
    else:
        lines.append(f"🌐 {t(lang, 'status_none')}")
        lines.append("👨‍👩‍👧 Hali ota-ona ulanmagan" if lang == "uz" else "👨‍👩‍👧 No parent connected yet")
        if allows(bot_access, "DIRECT_MESSAGE"):
            rows.append([InlineKeyboardButton(text=t(lang, "message"), callback_data=f"dmt:{telegram_id}")])
        if allows(bot_access, "MANAGE_USERS"):
            rows.append([InlineKeyboardButton(text=t(lang, "remove_bot"), callback_data=f"tgr:{telegram_id}")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="o:users")])
    await callback.message.edit_text("\n".join(lines),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data.regexp(r"^tgr:[0-9]{1,20}$"))
async def remove_unlinked_contact(callback: CallbackQuery, bot_access: dict | None = None,
                                  db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "MANAGE_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    target = callback.data.split(":", 1)[1]
    status, result = await api_client.remove_contact(str(callback.from_user.id), target)
    await callback.answer(t(lang, "sent") if status == 200 else
                          t(lang, "temporary_error") if status >= 500 else t(lang, "no_permission"), show_alert=True)


@panel_router.callback_query(F.data.startswith("ust:"))
async def user_status_action(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    _prefix, action, user_id = callback.data.split(":", 2)
    actor = str(callback.from_user.id)
    if action in {"approve", "reject"}:
        if not allows(bot_access, "ADMISSIONS"):
            await callback.answer(t(lang, "no_permission"), show_alert=True)
            return
        success = await api_client.decide_access_request(actor, user_id, "approve" if action == "approve" else "reject")
        await callback.answer("OK" if success else t(lang, "error"), show_alert=True)
        return
    if action == "delete":
        if not allows(bot_access, "DANGEROUS_USER_DELETE"):
            await callback.answer(t(lang, "no_permission"), show_alert=True)
            return
        status, data = await api_client.user_action(user_id, "delete", {"actorTelegramId": actor})
        if status != 200:
            await callback.answer(t(lang, "no_permission"), show_alert=True)
            return
        await state.set_state(PanelFlow.delete_code)
        await state.update_data(user_id=user_id, code=data.get("code"))
        await callback.message.edit_text(f"Tasdiqlash kodi: {esc(data.get('code'))}\nKodni yuboring. /cancel", reply_markup=_back(lang))
        await callback.answer()
        return
    permission = "MANAGE_USERS"
    if not allows(bot_access, permission):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    path = {"suspend": "status", "unsuspend": "status", "unlink": "unlink", "remove": "remove"}[action]
    payload = {"actorTelegramId": actor}
    if action == "suspend":
        payload["status"] = "suspended"
    if action == "unsuspend":
        payload["status"] = "active"
    status, data = await api_client.user_action(user_id, path, payload)
    await callback.answer("OK" if status == 200 else esc((data or {}).get("error") or "error"), show_alert=True)


@panel_router.message(PanelFlow.delete_code)
async def confirm_delete(message: Message, state: FSMContext, bot_access: dict | None = None, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    data = await state.get_data()
    await state.clear()
    if not allows(bot_access, "DANGEROUS_USER_DELETE"):
        await message.answer(t(lang, "no_permission"))
        return
    status, _body = await api_client.user_action(
        data.get("user_id"),
        "delete",
        {"actorTelegramId": str(message.from_user.id), "confirm": True, "code": (message.text or "").strip()},
    )
    await message.answer(t(lang, "anonymized") if status == 200 else t(lang, "error"))


@panel_router.callback_query(F.data.startswith("dm:") | F.data.startswith("dmt:"))
async def begin_dm(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "DIRECT_MESSAGE"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    is_contact = callback.data.startswith("dmt:")
    target_id = callback.data.split(":", 1)[1]
    if is_contact:
        if not target_id.isdigit() or len(target_id) > 20:
            await callback.answer(t(lang, "error"), show_alert=True)
            return
        try:
            contact_data = await api_client.get_user(target_id)
        except Exception:
            contact_data = None
        target = (contact_data or {}).get("contact") or {}
        if not target:
            await callback.answer(t(lang, "error"), show_alert=True)
            return
        name = " ".join(filter(None, [target.get("firstName"), target.get("lastName")])).strip() or target.get("username") or target_id
    else:
        status, data = await api_client.user_detail(str(callback.from_user.id), target_id)
        if status != 200:
            await callback.answer(t(lang, "error"), show_alert=True)
            return
        name = ((data or {}).get("user") or {}).get("name") or target_id
    await state.set_state(PanelFlow.dm_compose)
    await state.update_data(user_id=None if is_contact else target_id,
                            contact_id=target_id if is_contact else None, target_name=name)
    await callback.message.edit_text(t(lang, "compose_for", name=esc(name)), reply_markup=_back(lang))
    await callback.answer()


@panel_router.message(PanelFlow.dm_compose)
async def preview_dm(message: Message, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    data = await state.get_data()
    denied = denial_key(bot_access, backend_error, "DIRECT_MESSAGE")
    if denied or not (data.get("user_id") or data.get("contact_id")):
        await state.clear()
        await message.answer(t(lang, denied or "error"))
        return
    status, draft = await api_client.save_draft(str(message.from_user.id), "dm", {
        "userId": data.get("user_id"),
        "contactTelegramId": data.get("contact_id"),
        "text": message.text or "",
        "targetName": data.get("target_name"),
    })
    await state.clear()
    if status != 200 or not draft.get("id"):
        await message.answer(t(lang, "temporary_error" if status >= 500 else "error"))
        return
    await message.answer(
        f"{t(lang, 'preview')} → {esc(data.get('target_name'))}\n{esc(message.text)}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=t(lang, "send"), callback_data=f"dmc:{draft['id']}"),
            InlineKeyboardButton(text=t(lang, "back"), callback_data="m:home"),
        ]]),
    )


@panel_router.callback_query(F.data == "dmok")
async def stale_dm(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None):
    await callback.answer(t(_lang(callback, db_user, contact), "stale_confirm"), show_alert=True)


@panel_router.callback_query(F.data.startswith("dmc:"))
async def send_dm(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "DIRECT_MESSAGE")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    status, claimed = await api_client.claim_draft(str(callback.from_user.id), callback.data.split(":", 1)[1], "dm")
    if status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    data = claimed.get("payload") or {}
    if data.get("contactTelegramId"):
        status, result = await api_client.send_contact_message(
            str(callback.from_user.id), data["contactTelegramId"], data.get("text") or "")
        await callback.message.edit_text(t(lang, "sent") if status == 200 and result.get("ok") else t(lang, "error"))
        await callback.answer()
        return
    status, result = await api_client.user_action(
        data.get("userId"),
        "message",
        {"actorTelegramId": str(callback.from_user.id), "text": data.get("text")},
    )
    if status != 200 or not result.get("chatId"):
        reason = (result or {}).get("reason") or (result or {}).get("error") or "unavailable"
        await callback.message.edit_text(t(lang, "not_sent_reason", reason=esc(reason)))
        await callback.answer()
        return
    try:
        sent = await callback.bot.send_message(int(result["chatId"]), esc(result.get("text")))
        await api_client.user_action(
            data.get("userId"),
            "message",
            {"report": True, "messageId": result.get("messageId"), "status": "sent", "telegramMessageId": str(sent.message_id)},
        )
        await callback.message.edit_text(t(lang, "sent"))
    except Exception as exc:
        blocked = "blocked" in str(exc).lower() or "chat not found" in str(exc).lower()
        await api_client.user_action(
            data.get("userId"),
            "message",
            {"report": True, "messageId": result.get("messageId"), "status": "blocked" if blocked else "failed", "error": "delivery_failed"},
        )
        await callback.message.edit_text(t(lang, "not_sent_blocked") if blocked else t(lang, "error"))
    await callback.answer()


@panel_router.callback_query(F.data == "o:adm")
async def admissions(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "ADMISSIONS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    try:
        requests = await api_client.list_pending_requests(str(callback.from_user.id))
    except Exception:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    if not requests:
        await callback.message.edit_text(t(lang, "empty"), reply_markup=_back(lang))
        await callback.answer()
        return
    lines = [t(lang, "admissions")]
    rows = []
    for req in requests[:8]:
        lines.append(f"• {esc(req.get('applicantName'))}")
        rows.append([
            InlineKeyboardButton(text=f"✅ {req.get('applicantName')}"[:32], callback_data=f"decide_approve_{req.get('id')}"),
            InlineKeyboardButton(text="❌", callback_data=f"decide_reject_{req.get('id')}"),
        ])
    if len(requests) == 8:
        rows.append([InlineKeyboardButton(text=t(lang, "next"), callback_data="apg:2")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text("\n".join(lines), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("apg:"))
async def admissions_page(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "ADMISSIONS")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    page = max(1, int(callback.data.split(":", 1)[1] or "1"))
    try:
        requests = await api_client.list_pending_requests(str(callback.from_user.id), page)
    except Exception:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    if not requests:
        await callback.message.edit_text(t(lang, "empty"), reply_markup=_back(lang))
        await callback.answer()
        return
    lines = [t(lang, "admissions"), t(lang, "page", page=page)]
    rows = []
    for req in requests[:8]:
        lines.append(f"• {esc(req.get('applicantName'))}")
        rows.append([
            InlineKeyboardButton(text=f"✅ {req.get('applicantName')}"[:32], callback_data=f"decide_approve_{req.get('id')}"),
            InlineKeyboardButton(text="❌", callback_data=f"decide_reject_{req.get('id')}"),
        ])
    nav = []
    if page > 1:
        nav.append(InlineKeyboardButton(text=t(lang, "prev"), callback_data=f"apg:{page - 1}"))
    if len(requests) == 8:
        nav.append(InlineKeyboardButton(text=t(lang, "next"), callback_data=f"apg:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text("\n".join(lines), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data == "o:bc")
async def broadcast_start(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "BROADCAST"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    rows = [
        [InlineKeyboardButton(text=label, callback_data=f"bc:{key}")]
        for key, label in [
            ("all_bot_users", t(lang, "audience_all")),
            ("active_students", t(lang, "audience_active")),
            ("pending_applicants", t(lang, "audience_pending")),
            ("teachers", t(lang, "audience_teachers")),
            ("admins", t(lang, "audience_admins")),
        ]
    ]
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text(t(lang, "broadcast"), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("bc:"))
async def broadcast_audience(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "BROADCAST"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    audience = callback.data.split(":", 1)[1]
    status, data = await api_client.broadcast({"actorTelegramId": str(callback.from_user.id), "audience": audience, "preview": True})
    if status != 200:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    await state.set_state(PanelFlow.broadcast_compose)
    await state.update_data(audience=audience, count=data.get("recipientCount"))
    await callback.message.edit_text(f"{esc(audience)}: {data.get('recipientCount')}\nMatnni yuboring. /cancel", reply_markup=_back(lang))
    await callback.answer()


@panel_router.message(PanelFlow.broadcast_compose)
async def broadcast_preview(message: Message, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    data = await state.get_data()
    denied = denial_key(bot_access, backend_error, "BROADCAST")
    if denied or not data.get("audience"):
        await state.clear()
        await message.answer(t(lang, denied or "error"))
        return
    status, draft = await api_client.save_draft(str(message.from_user.id), "broadcast", {
        "audience": data.get("audience"),
        "content": message.text or "",
        "count": data.get("count"),
    })
    await state.clear()
    if status != 200 or not draft.get("id"):
        await message.answer(t(lang, "temporary_error" if status >= 500 else "error"))
        return
    await message.answer(
        f"{t(lang, 'preview')} ({data.get('count')}): {esc(message.text)}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=t(lang, "test_to_me"), callback_data=f"bct:{draft['id']}"),
            InlineKeyboardButton(text=t(lang, "confirm"), callback_data=f"bcc:{draft['id']}"),
            InlineKeyboardButton(text=t(lang, "back"), callback_data="m:home"),
        ]]),
    )


@panel_router.callback_query(F.data.in_({"bctest", "bcok"}))
async def stale_broadcast(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None):
    await callback.answer(t(_lang(callback, db_user, contact), "stale_confirm"), show_alert=True)


@panel_router.callback_query(F.data.startswith("bct:"))
async def broadcast_test(callback: CallbackQuery, bot_access: dict | None = None, db_user: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "BROADCAST")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    status, draft = await api_client.read_draft(str(callback.from_user.id), callback.data.split(":", 1)[1])
    if status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    content = ((draft.get("payload") or {}).get("content")) or ""
    await callback.bot.send_message(callback.from_user.id, f"{t(lang, 'test_to_me')}\n{esc(content)}")
    await callback.answer(t(lang, "sent"))


@panel_router.callback_query(F.data.startswith("bcc:"))
async def broadcast_confirm(callback: CallbackQuery, bot_access: dict | None = None, db_user: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "BROADCAST")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    status, claimed = await api_client.claim_draft(str(callback.from_user.id), callback.data.split(":", 1)[1], "broadcast")
    if status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    data = claimed.get("payload") or {}
    status, result = await api_client.broadcast({
        "actorTelegramId": str(callback.from_user.id),
        "audience": data.get("audience"),
        "content": data.get("content"),
    })
    if status != 200:
        await callback.message.edit_text(t(lang, "not_sent"))
    else:
        await callback.message.edit_text(f"{t(lang, 'queued')} {result.get('recipientCount')}")
    await callback.answer()


@panel_router.callback_query(F.data == "o:admins")
async def admins(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, data = await api_client.admins(str(callback.from_user.id))
    if status != 200:
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    lines = [t(lang, "admins")]
    rows = []
    for admin in data.get("admins") or []:
        lines.append(f"• {admin.get('telegramUserId')} {'on' if admin.get('isActive') else 'off'} {','.join(admin.get('permissions') or [])}")
        if admin.get("isActive"):
            rows.append([InlineKeyboardButton(text=f"Remove {admin.get('telegramUserId')}"[:40], callback_data=f"admrm:{admin.get('telegramUserId')}")])
    rows.append([InlineKeyboardButton(text=t(lang, "add_admin"), callback_data="admadd")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text("\n".join(lines)[:3500], reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data == "admadd")
async def admin_add_prompt(callback: CallbackQuery, state: FSMContext, bot_access: dict | None = None, db_user: dict | None = None, contact: dict | None = None):
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(_lang(callback, db_user, contact), "no_permission"), show_alert=True)
        return
    await state.set_state(PanelFlow.admin_add)
    await callback.message.edit_text(t(_lang(callback, db_user, contact), "admin_id_prompt"))
    await callback.answer()


ADMIN_PERMS = [
    ("SUPPORT", "sup"),
    ("VIEW_USERS", "vu"),
    ("ADMISSIONS", "ad"),
    ("DIRECT_MESSAGE", "dm"),
    ("BROADCAST", "bc"),
    ("VIEW_STATS", "st"),
    ("VIEW_AUDIT", "au"),
    ("MANAGE_USERS", "mu"),
]
_PERM_BY_CODE = {code: name for name, code in ADMIN_PERMS}


def _admin_keyboard(lang: str, draft_id: str, selected: list[str]) -> InlineKeyboardMarkup:
    rows = []
    for name, code in ADMIN_PERMS:
        mark = "✓ " if name in selected else ""
        rows.append([InlineKeyboardButton(text=f"{mark}{name}", callback_data=f"apt:{draft_id}:{code}")])
    rows.append([InlineKeyboardButton(text=t(lang, "save"), callback_data=f"aps:{draft_id}")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="o:admins")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


@panel_router.message(PanelFlow.admin_add)
async def admin_add(message: Message, state: FSMContext, bot_access: dict | None = None, db_user: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    await state.clear()
    if backend_error:
        await message.answer(t(lang, "temporary_error"))
        return
    if not (bot_access or {}).get("isPrimaryOwner"):
        await message.answer(t(lang, "no_permission"))
        return
    telegram_id = (message.text or "").strip()
    if not telegram_id.isdigit():
        await message.answer(t(lang, "admin_id_prompt"))
        return
    status, draft = await api_client.save_draft(str(message.from_user.id), "admin", {
        "telegramUserId": telegram_id,
        "permissions": ["SUPPORT"],
    })
    if status != 200 or not draft.get("id"):
        await message.answer(t(lang, "temporary_error" if status >= 500 else "error"))
        return
    await message.answer(telegram_id, reply_markup=_admin_keyboard(lang, draft["id"], ["SUPPORT"]))


@panel_router.callback_query(F.data.startswith("admrm:"))
async def admin_remove(callback: CallbackQuery, bot_access: dict | None = None, db_user: dict | None = None, contact: dict | None = None):
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(_lang(callback, db_user, contact), "no_permission"), show_alert=True)
        return
    telegram_id = callback.data.split(":", 1)[1]
    status, _data = await api_client.patch_admin(telegram_id, {"actorTelegramId": str(callback.from_user.id), "active": False})
    await callback.answer("Olib tashlandi." if status == 200 else t("uz", "error"), show_alert=True)


@panel_router.callback_query(F.data.in_({"o:stats", "o:audit", "o:set"}))
async def ops_view(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    view = {"o:stats": "stats", "o:audit": "audit", "o:set": "settings"}[callback.data]
    permission = {"stats": "VIEW_STATS", "audit": "VIEW_AUDIT", "settings": "BOT_SETTINGS"}[view]
    if not allows(bot_access, permission):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, data = await api_client.ops(str(callback.from_user.id), view)
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"), show_alert=True)
        return
    if view == "stats":
        text = format_stats(data, lang)
    elif view == "audit":
        text = format_audit(data, lang)
    else:
        text = format_settings(data, lang)
    rows = []
    if view == "audit":
        page = int(data.get("page") or 1)
        nav = []
        if page > 1:
            nav.append(InlineKeyboardButton(text=t(lang, "prev"), callback_data=f"aug:{page - 1}"))
        nav.append(InlineKeyboardButton(text=t(lang, "next"), callback_data=f"aug:{page + 1}"))
        rows.append(nav)
    if view == "settings":
        rows.append([InlineKeyboardButton(text=t(lang, "menu_support"), callback_data="set:support_enabled")])
        rows.append([InlineKeyboardButton(text=t(lang, "broadcast"), callback_data="set:broadcasts_enabled")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text(esc(text)[:3500], reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("aug:"))
async def audit_page(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "VIEW_AUDIT")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    page = int(callback.data.split(":", 1)[1] or "1")
    status, data = await api_client.ops(str(callback.from_user.id), "audit", page)
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"), show_alert=True)
        return
    nav = []
    if page > 1:
        nav.append(InlineKeyboardButton(text=t(lang, "prev"), callback_data=f"aug:{page - 1}"))
    if data.get("entries"):
        nav.append(InlineKeyboardButton(text=t(lang, "next"), callback_data=f"aug:{page + 1}"))
    rows = [nav] if nav else []
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text(esc(format_audit(data, lang)), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("set:"))
async def toggle_setting(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "BOT_SETTINGS")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    key = callback.data.split(":", 1)[1]
    status, current = await api_client.ops(str(callback.from_user.id), "settings")
    if status != 200:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    value = not bool(current.get(key, True))
    saved, _data = await api_client.save_setting({"actorTelegramId": str(callback.from_user.id), "key": key, "value": value})
    if saved != 200:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    status, fresh = await api_client.ops(str(callback.from_user.id), "settings")
    text = format_settings(fresh if status == 200 else current, lang)
    rows = [
        [InlineKeyboardButton(text=t(lang, "menu_support"), callback_data="set:support_enabled")],
        [InlineKeyboardButton(text=t(lang, "broadcast"), callback_data="set:broadcasts_enabled")],
        [InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")],
    ]
    await callback.message.edit_text(esc(text), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer(t(lang, "language_set"))


@panel_router.callback_query(F.data.startswith("apt:"))
async def toggle_admin_perm(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if backend_error:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    _prefix, draft_id, code = callback.data.split(":", 2)
    name = _PERM_BY_CODE.get(code)
    if not name:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    status, draft = await api_client.read_draft(str(callback.from_user.id), draft_id)
    if status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    payload = dict(draft.get("payload") or {})
    selected = set(payload.get("permissions") or [])
    if name in selected:
        selected.remove(name)
    else:
        selected.add(name)
    payload["permissions"] = sorted(selected)
    updated, _row = await api_client.update_draft(str(callback.from_user.id), draft_id, payload)
    if updated != 200:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    await callback.message.edit_reply_markup(reply_markup=_admin_keyboard(lang, draft_id, payload["permissions"]))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("aps:"))
async def save_admin(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if backend_error:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, claimed = await api_client.claim_draft(str(callback.from_user.id), callback.data.split(":", 1)[1], "admin")
    if status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    payload = claimed.get("payload") or {}
    saved, _data = await api_client.add_admin({
        "actorTelegramId": str(callback.from_user.id),
        "telegramUserId": payload.get("telegramUserId"),
        "permissions": payload.get("permissions") or [],
    })
    await callback.message.edit_text(t(lang, "language_set" if saved == 200 else "error"))
    await callback.answer()
