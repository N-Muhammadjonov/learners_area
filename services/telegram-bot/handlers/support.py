from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from html_text import esc
from i18n import t
from middlewares.auth import allows, denial_key
from services.api_client import api_client

support_router = Router()


class SupportFlow(StatesGroup):
    user_message = State()
    staff_reply = State()


def _lang(event, db_user, contact=None) -> str:
    override = (contact or {}).get("localeOverride")
    if override in {"uz", "en"}:
        return override
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if str(code).startswith("en") else "uz"


def _home(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")]])


@support_router.message(Command("admin"))
async def cmd_support(message: Message, state: FSMContext, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    await state.set_state(SupportFlow.user_message)
    await message.answer(t(lang, "support_prompt"), reply_markup=_home(lang))


@support_router.callback_query(F.data == "m:support")
async def start_support(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    await state.set_state(SupportFlow.user_message)
    await state.update_data(mode="user")
    await callback.message.edit_text(t(lang, "support_prompt"), reply_markup=_home(lang))
    await callback.answer()


@support_router.message(SupportFlow.user_message)
async def user_support_message(message: Message, state: FSMContext, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    payload = {
        "telegramUserId": str(message.from_user.id),
        "text": message.text or message.caption,
        "messageType": "text",
    }
    if message.photo:
        payload["messageType"] = "photo"
        payload["fileId"] = message.photo[-1].file_id
    elif message.document:
        payload["messageType"] = "document"
        payload["fileId"] = message.document.file_id
        payload["fileName"] = message.document.file_name
        payload["mimeType"] = message.document.mime_type
    elif message.voice:
        payload["messageType"] = "voice"
        payload["fileId"] = message.voice.file_id
    elif message.audio:
        payload["messageType"] = "audio"
        payload["fileId"] = message.audio.file_id
    status, data = await api_client.open_support(payload)
    await state.clear()
    if status != 200:
        await message.answer(t(lang, "error"))
        return
    await message.answer(t(lang, "support_sent"))
    for telegram_id in data.get("notifyTelegramIds") or []:
        preview = data.get("preview") or {}
        try:
            await message.bot.send_message(
                int(telegram_id),
                f"{t(lang, 'menu_support')}: {esc(preview.get('name'))}\n{esc(preview.get('accountStatus') or '—')}\n{esc(preview.get('text') or preview.get('messageType'))}",
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[[InlineKeyboardButton(text=t(lang, "message"), callback_data=f"srep:{data.get('threadId')}")]]
                ),
            )
        except Exception:
            continue


@support_router.callback_query(F.data == "o:sup")
async def list_support(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "SUPPORT"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, data = await api_client.list_support(str(callback.from_user.id), "open", 1)
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"), show_alert=True)
        return
    items = data.get("items") or []
    if not items:
        await callback.message.edit_text(t(lang, "empty"), reply_markup=_home(lang))
        await callback.answer()
        return
    rows = []
    lines = [t(lang, "support_admin")]
    for item in items[:8]:
        lines.append(f"• {esc(item.get('name') or item.get('telegramUserId'))} · {esc(item.get('status'))}")
        rows.append([InlineKeyboardButton(text=str(item.get("name") or item.get("telegramUserId"))[:32], callback_data=f"sth:{item['id']}")])
    if (data.get("total") or 0) > (data.get("pageSize") or 8):
        rows.append([InlineKeyboardButton(text=t(lang, "next"), callback_data="spg:open:2")])
    rows.append([
        InlineKeyboardButton(text=t(lang, "support_open"), callback_data="sf:open"),
        InlineKeyboardButton(text=t(lang, "support_mine"), callback_data="sf:mine"),
        InlineKeyboardButton(text=t(lang, "support_closed"), callback_data="sf:closed"),
    ])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text("\n".join(lines), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@support_router.callback_query(F.data.startswith("spg:"))
async def page_support(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "SUPPORT")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    _prefix, filt, page_text = callback.data.split(":", 2)
    page = max(1, int(page_text or "1"))
    status, data = await api_client.list_support(str(callback.from_user.id), filt, page)
    if status != 200:
        await callback.answer(t(lang, "temporary_error" if status >= 500 else "no_permission"), show_alert=True)
        return
    items = (data or {}).get("items") or []
    rows = [[InlineKeyboardButton(text=str(item.get("name") or item.get("telegramUserId"))[:32], callback_data=f"sth:{item['id']}")] for item in items]
    nav = []
    if page > 1:
        nav.append(InlineKeyboardButton(text=t(lang, "prev"), callback_data=f"spg:{filt}:{page - 1}"))
    if page * (data.get("pageSize") or 10) < (data.get("total") or 0):
        nav.append(InlineKeyboardButton(text=t(lang, "next"), callback_data=f"spg:{filt}:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="o:sup")])
    await callback.message.edit_text(f"{t(lang, 'support_admin')}\n{t(lang, 'page', page=page)}", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows or [[InlineKeyboardButton(text=t(lang, "back"), callback_data="o:sup")]]))
    await callback.answer()


@support_router.callback_query(F.data.startswith("sf:"))
async def filter_support(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "SUPPORT"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    name = callback.data.split(":", 1)[1]
    status, data = await api_client.list_support(str(callback.from_user.id), name)
    items = (data or {}).get("items") or []
    if status != 200 or not items:
        await callback.message.edit_text(t(lang, "empty"), reply_markup=_home(lang))
        await callback.answer()
        return
    rows = [[InlineKeyboardButton(text=str(item.get("name") or item.get("telegramUserId"))[:32], callback_data=f"sth:{item['id']}")] for item in items[:8]]
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="o:sup")])
    await callback.message.edit_text(t(lang, "support_admin"), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@support_router.callback_query(F.data.startswith("sth:"))
async def thread_detail(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "SUPPORT"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    thread_id = callback.data.split(":", 1)[1]
    status, data = await api_client.support_detail(str(callback.from_user.id), thread_id)
    if status != 200:
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    account = data.get("account") or {}
    thread = data.get("thread") or {}
    lines = [
        f"{esc(account.get('name') or thread.get('telegramUserId'))}",
        f"{esc(account.get('accountStatus') or '—')} · {esc(thread.get('status'))}",
        f"assigned: {esc(thread.get('assignedTelegramId') or '—')}",
    ]
    for message in (data.get("messages") or [])[-6:]:
        lines.append(f"{esc(message.get('senderType'))}: {esc(message.get('text') or message.get('messageType'))}")
    markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=t(lang, "message"), callback_data=f"srep:{thread_id}")],
            [
                InlineKeyboardButton(text=t(lang, "close"), callback_data=f"sact:close:{thread_id}"),
                InlineKeyboardButton(text=t(lang, "reopen"), callback_data=f"sact:reopen:{thread_id}"),
            ],
            [InlineKeyboardButton(text=t(lang, "back"), callback_data="o:sup")],
        ]
    )
    await callback.message.edit_text("\n".join(lines), reply_markup=markup)
    await callback.answer()


@support_router.callback_query(F.data.startswith("srep:"))
async def begin_reply(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "SUPPORT"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    thread_id = callback.data.split(":", 1)[1]
    status, data = await api_client.support_detail(str(callback.from_user.id), thread_id)
    if status != 200:
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    name = ((data.get("account") or {}).get("name")) or (data.get("thread") or {}).get("telegramUserId")
    await state.set_state(SupportFlow.staff_reply)
    await state.update_data(thread_id=thread_id, target_name=name)
    await callback.message.edit_text(t(lang, "reply_banner", name=esc(name)), reply_markup=_home(lang))
    await callback.answer()


@support_router.message(SupportFlow.staff_reply)
async def preview_staff_reply(message: Message, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    data = await state.get_data()
    thread_id = data.get("thread_id")
    denied = denial_key(bot_access, backend_error, "SUPPORT")
    if not thread_id or denied:
        await state.clear()
        await message.answer(t(lang, denied or "no_permission"))
        return
    payload = {
        "threadId": thread_id,
        "text": message.text or message.caption,
        "messageType": "text",
    }
    if message.photo:
        payload["messageType"] = "photo"
        payload["fileId"] = message.photo[-1].file_id
    elif message.document:
        payload["messageType"] = "document"
        payload["fileId"] = message.document.file_id
    elif message.voice:
        payload["messageType"] = "voice"
        payload["fileId"] = message.voice.file_id
    elif message.audio:
        payload["messageType"] = "audio"
        payload["fileId"] = message.audio.file_id
    status, draft = await api_client.save_draft(str(message.from_user.id), "support_reply", payload)
    await state.clear()
    if status != 200 or not draft.get("id"):
        await message.answer(t(lang, "temporary_error" if status >= 500 else "error"))
        return
    await message.answer(
        t(lang, "reply_banner", name=esc(data.get("target_name") or thread_id)),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=t(lang, "send"), callback_data=f"src:{draft['id']}"),
            InlineKeyboardButton(text=t(lang, "back"), callback_data="o:sup"),
        ]]),
    )


async def _send_once(bot, chat_id: int, message_type: str, file_id: str | None, text: str):
    if file_id and message_type in {"photo", "document", "voice", "audio"}:
        sender = {
            "photo": bot.send_photo,
            "document": bot.send_document,
            "voice": bot.send_voice,
            "audio": bot.send_audio,
        }[message_type]
        return await sender(chat_id, file_id, caption=esc(text) or None)
    return await bot.send_message(chat_id, esc(text))


@support_router.callback_query(F.data.startswith("src:"))
async def send_staff_reply(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error, "SUPPORT")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    draft_id = callback.data.split(":", 1)[1]
    status, claimed = await api_client.claim_draft(str(callback.from_user.id), draft_id, "support_reply")
    if status != 200:
        await callback.answer(t(lang, "stale_confirm"), show_alert=True)
        return
    payload = claimed.get("payload") or {}
    thread_id = payload.get("threadId")
    reply_status, result = await api_client.support_reply(thread_id, {
        "actorTelegramId": str(callback.from_user.id),
        "text": payload.get("text"),
        "messageType": payload.get("messageType") or "text",
        "fileId": payload.get("fileId"),
    })
    if reply_status != 200 or result.get("delivery") != "queued" or not result.get("chatId"):
        await callback.message.edit_text(t(lang, "reply_blocked" if reply_status == 200 else "reply_failed"))
        await callback.answer()
        return
    try:
        await _send_once(callback.bot, int(result["chatId"]), payload.get("messageType") or "text", payload.get("fileId"), result.get("text") or "")
        await api_client.support_action(thread_id, {"action": "delivery", "messageId": result.get("messageId"), "status": "sent"})
        await callback.message.edit_text(t(lang, "reply_sent"))
    except Exception as exc:
        blocked = "blocked" in str(exc).lower() or "chat not found" in str(exc).lower()
        await api_client.support_action(thread_id, {
            "action": "delivery",
            "messageId": result.get("messageId"),
            "status": "blocked" if blocked else "failed",
            "error": "delivery_failed",
        })
        await callback.message.edit_text(t(lang, "reply_blocked" if blocked else "reply_failed"))
    await callback.answer()


@support_router.callback_query(F.data.startswith("sact:"))
async def support_action(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not allows(bot_access, "SUPPORT"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    _prefix, action, thread_id = callback.data.split(":", 2)
    status, _data = await api_client.support_action(thread_id, {"action": action, "actorTelegramId": str(callback.from_user.id)})
    await callback.answer(t(lang, "support_closed") if status == 200 and action == "close" else t(lang, "error" if status != 200 else "confirmed"))
