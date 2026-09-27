from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from html_text import esc
from i18n import t
from middlewares.auth import allows
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


def _lang(event, db_user) -> str:
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if str(code).startswith("en") else "uz"


def _back(lang: str, target: str = "m:owner") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=t(lang, "back"), callback_data=target)]])


@panel_router.callback_query(F.data == "o:users")
async def users_home(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    if not allows(bot_access, "VIEW_USERS"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    await state.set_state(PanelFlow.search)
    await callback.message.edit_text(t(lang, "search_prompt"), reply_markup=_back(lang))
    await callback.answer()


@panel_router.message(PanelFlow.search)
async def users_search(message: Message, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(message, db_user)
    if not allows(bot_access, "VIEW_USERS"):
        await state.clear()
        await message.answer(t(lang, "no_permission"))
        return
    status, data = await api_client.search_users(str(message.from_user.id), message.text or "")
    await state.clear()
    if status != 200:
        await message.answer(t(lang, "no_permission"))
        return
    items = data.get("items") or []
    if not items:
        await message.answer(t(lang, "empty"))
        return
    rows = [[InlineKeyboardButton(text=f"{item.get('name')} · {item.get('accountStatus')}"[:40], callback_data=f"usr:{item['id']}")] for item in items[:8]]
    rows.append([InlineKeyboardButton(text=t(lang, "home"), callback_data="m:owner")])
    await message.answer(t(lang, "users"), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))


def _user_actions(user_id: str, bot_access: dict | None) -> list[list[InlineKeyboardButton]]:
    rows = []
    if allows(bot_access, "DIRECT_MESSAGE"):
        rows.append([InlineKeyboardButton(text="Message", callback_data=f"dm:{user_id}")])
    if allows(bot_access, "ADMISSIONS"):
        rows.append([
            InlineKeyboardButton(text="Approve", callback_data=f"ust:approve:{user_id}"),
            InlineKeyboardButton(text="Reject", callback_data=f"ust:reject:{user_id}"),
        ])
    if allows(bot_access, "MANAGE_USERS"):
        rows.append([
            InlineKeyboardButton(text="Suspend", callback_data=f"ust:suspend:{user_id}"),
            InlineKeyboardButton(text="Unsuspend", callback_data=f"ust:unsuspend:{user_id}"),
        ])
        rows.append([
            InlineKeyboardButton(text="Unlink", callback_data=f"ust:unlink:{user_id}"),
            InlineKeyboardButton(text="Remove bot", callback_data=f"ust:remove:{user_id}"),
        ])
    if allows(bot_access, "DANGEROUS_USER_DELETE"):
        rows.append([InlineKeyboardButton(text="Delete account", callback_data=f"ust:delete:{user_id}")])
    rows.append([InlineKeyboardButton(text="Back", callback_data="o:users")])
    return rows


@panel_router.callback_query(F.data.startswith("usr:"))
async def user_card(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
    await callback.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=_user_actions(user_id, bot_access)))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("ust:"))
async def user_status_action(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
async def confirm_delete(message: Message, state: FSMContext, bot_access: dict | None = None, db_user: dict | None = None):
    lang = _lang(message, db_user)
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
    await message.answer("Hisob anonimlashtirildi." if status == 200 else t(lang, "error"))


@panel_router.callback_query(F.data.startswith("dm:"))
async def begin_dm(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    if not allows(bot_access, "DIRECT_MESSAGE"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    user_id = callback.data.split(":", 1)[1]
    status, data = await api_client.user_detail(str(callback.from_user.id), user_id)
    name = ((data or {}).get("user") or {}).get("name") or user_id
    await state.set_state(PanelFlow.dm_compose)
    await state.update_data(user_id=user_id, target_name=name)
    await callback.message.edit_text(f"Message: {esc(name)}\n/cancel", reply_markup=_back(lang))
    await callback.answer()
    del status


@panel_router.message(PanelFlow.dm_compose)
async def preview_dm(message: Message, state: FSMContext, db_user: dict | None = None):
    lang = _lang(message, db_user)
    data = await state.get_data()
    await state.set_state(PanelFlow.dm_preview)
    await state.update_data(text=message.text or "")
    await message.answer(
        f"Preview → {esc(data.get('target_name'))}\n{esc(message.text)}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="Send", callback_data="dmok"),
            InlineKeyboardButton(text="Cancel", callback_data="m:home"),
        ]]),
    )


@panel_router.callback_query(F.data == "dmok")
async def send_dm(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    data = await state.get_data()
    await state.clear()
    if not allows(bot_access, "DIRECT_MESSAGE"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, result = await api_client.user_action(
        data.get("user_id"),
        "message",
        {"actorTelegramId": str(callback.from_user.id), "text": data.get("text")},
    )
    if status != 200 or not result.get("chatId"):
        reason = (result or {}).get("reason") or (result or {}).get("error") or "unavailable"
        await callback.message.edit_text(f"Yuborilmadi: {esc(reason)}")
        await callback.answer()
        return
    try:
        sent = await callback.bot.send_message(int(result["chatId"]), esc(result.get("text")))
        await api_client.user_action(
            data.get("user_id"),
            "message",
            {"report": True, "messageId": result.get("messageId"), "status": "sent", "telegramMessageId": str(sent.message_id)},
        )
        await callback.message.edit_text("Yuborildi.")
    except Exception as exc:
        blocked = "blocked" in str(exc).lower() or "chat not found" in str(exc).lower()
        await api_client.user_action(
            data.get("user_id"),
            "message",
            {"report": True, "messageId": result.get("messageId"), "status": "blocked" if blocked else "failed", "error": "delivery_failed"},
        )
        await callback.message.edit_text("Yuborilmadi: chat mavjud emas yoki bloklangan." if blocked else t(lang, "error"))
    await callback.answer()


@panel_router.callback_query(F.data == "o:adm")
async def admissions(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text("\n".join(lines), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data == "o:bc")
async def broadcast_start(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    if not allows(bot_access, "BROADCAST"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    rows = [
        [InlineKeyboardButton(text=label, callback_data=f"bc:{key}")]
        for key, label in [
            ("all_bot_users", "All bot users"),
            ("active_students", "Active students"),
            ("pending_applicants", "Pending"),
            ("teachers", "Teachers"),
            ("admins", "Admins"),
        ]
    ]
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text(t(lang, "broadcast"), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data.startswith("bc:"))
async def broadcast_audience(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
async def broadcast_preview(message: Message, state: FSMContext, db_user: dict | None = None):
    data = await state.get_data()
    await state.set_state(PanelFlow.broadcast_preview)
    await state.update_data(content=message.text or "")
    await message.answer(
        f"Preview ({data.get('count')}): {esc(message.text)}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="Test to me", callback_data="bctest"),
            InlineKeyboardButton(text="Confirm", callback_data="bcok"),
            InlineKeyboardButton(text="Cancel", callback_data="m:home"),
        ]]),
    )


@panel_router.callback_query(F.data == "bctest")
async def broadcast_test(callback: CallbackQuery, state: FSMContext, bot_access: dict | None = None, db_user: dict | None = None):
    lang = _lang(callback, db_user)
    if not allows(bot_access, "BROADCAST"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    data = await state.get_data()
    await callback.bot.send_message(callback.from_user.id, f"TEST\n{esc(data.get('content'))}")
    await callback.answer("Test yuborildi")


@panel_router.callback_query(F.data == "bcok")
async def broadcast_confirm(callback: CallbackQuery, state: FSMContext, bot_access: dict | None = None, db_user: dict | None = None):
    lang = _lang(callback, db_user)
    data = await state.get_data()
    await state.clear()
    if not allows(bot_access, "BROADCAST"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, result = await api_client.broadcast({
        "actorTelegramId": str(callback.from_user.id),
        "audience": data.get("audience"),
        "content": data.get("content"),
    })
    if status != 200:
        await callback.message.edit_text(t(lang, "error"))
    else:
        await callback.message.edit_text(f"Queued: {result.get('recipientCount')} · {esc(result.get('status'))}")
    await callback.answer()


@panel_router.callback_query(F.data == "o:admins")
async def admins(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
    rows.append([InlineKeyboardButton(text="Add", callback_data="admadd")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text("\n".join(lines)[:3500], reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@panel_router.callback_query(F.data == "admadd")
async def admin_add_prompt(callback: CallbackQuery, state: FSMContext, bot_access: dict | None = None, db_user: dict | None = None):
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(_lang(callback, db_user), "no_permission"), show_alert=True)
        return
    await state.set_state(PanelFlow.admin_add)
    await callback.message.edit_text("Telegram ID va ruxsatlar: 12345 SUPPORT,VIEW_USERS")
    await callback.answer()


@panel_router.message(PanelFlow.admin_add)
async def admin_add(message: Message, state: FSMContext, bot_access: dict | None = None):
    await state.clear()
    if not (bot_access or {}).get("isPrimaryOwner"):
        await message.answer(t("uz", "no_permission"))
        return
    parts = (message.text or "").split()
    if len(parts) < 1 or not parts[0].isdigit():
        await message.answer(t("uz", "error"))
        return
    permissions = parts[1].split(",") if len(parts) > 1 else ["SUPPORT"]
    status, _data = await api_client.add_admin({
        "actorTelegramId": str(message.from_user.id),
        "telegramUserId": parts[0],
        "permissions": permissions,
    })
    await message.answer("Qo'shildi." if status == 200 else t("uz", "error"))


@panel_router.callback_query(F.data.startswith("admrm:"))
async def admin_remove(callback: CallbackQuery, bot_access: dict | None = None, db_user: dict | None = None):
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(_lang(callback, db_user), "no_permission"), show_alert=True)
        return
    telegram_id = callback.data.split(":", 1)[1]
    status, _data = await api_client.patch_admin(telegram_id, {"actorTelegramId": str(callback.from_user.id), "active": False})
    await callback.answer("Olib tashlandi." if status == 200 else t("uz", "error"), show_alert=True)


@panel_router.callback_query(F.data.in_({"o:stats", "o:audit", "o:set"}))
async def ops_view(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    view = {"o:stats": "stats", "o:audit": "audit", "o:set": "settings"}[callback.data]
    permission = {"stats": "VIEW_STATS", "audit": "VIEW_AUDIT", "settings": "BOT_SETTINGS"}[view]
    if not allows(bot_access, permission):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, data = await api_client.ops(str(callback.from_user.id), view)
    if status != 200:
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    await callback.message.edit_text(esc(str(data))[:3500], reply_markup=_back(lang))
    await callback.answer()
