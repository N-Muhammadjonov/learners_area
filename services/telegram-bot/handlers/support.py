from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from html_text import esc
from i18n import t
from middlewares.auth import allows
from services.api_client import api_client

support_router = Router()


class SupportFlow(StatesGroup):
    user_message = State()
    staff_reply = State()


def _lang(event, db_user) -> str:
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if str(code).startswith("en") else "uz"


def _home(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")]])


@support_router.callback_query(F.data == "m:support")
async def start_support(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None):
    lang = _lang(callback, db_user)
    await state.set_state(SupportFlow.user_message)
    await state.update_data(mode="user")
    await callback.message.edit_text(t(lang, "support_prompt"), reply_markup=_home(lang))
    await callback.answer()


@support_router.message(SupportFlow.user_message)
async def user_support_message(message: Message, state: FSMContext, db_user: dict | None = None):
    lang = _lang(message, db_user)
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
                f"Yordam: {esc(preview.get('name'))}\n{esc(preview.get('accountStatus') or '—')}\n{esc(preview.get('text') or preview.get('messageType'))}",
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[[InlineKeyboardButton(text="Javob", callback_data=f"srep:{data.get('threadId')}")]]
                ),
            )
        except Exception:
            continue


@support_router.callback_query(F.data == "o:sup")
async def list_support(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    if not allows(bot_access, "SUPPORT"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, data = await api_client.list_support(str(callback.from_user.id), "open")
    if status != 200:
        await callback.answer(t(lang, "no_permission"), show_alert=True)
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
    rows.append([
        InlineKeyboardButton(text="Open", callback_data="sf:open"),
        InlineKeyboardButton(text="Mine", callback_data="sf:mine"),
        InlineKeyboardButton(text="Closed", callback_data="sf:closed"),
    ])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text("\n".join(lines), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@support_router.callback_query(F.data.startswith("sf:"))
async def filter_support(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
async def thread_detail(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
            [InlineKeyboardButton(text="Reply", callback_data=f"srep:{thread_id}")],
            [
                InlineKeyboardButton(text="Close", callback_data=f"sact:close:{thread_id}"),
                InlineKeyboardButton(text="Reopen", callback_data=f"sact:reopen:{thread_id}"),
            ],
            [InlineKeyboardButton(text=t(lang, "back"), callback_data="o:sup")],
        ]
    )
    await callback.message.edit_text("\n".join(lines), reply_markup=markup)
    await callback.answer()


@support_router.callback_query(F.data.startswith("srep:"))
async def begin_reply(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
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
async def send_reply(message: Message, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(message, db_user)
    data = await state.get_data()
    thread_id = data.get("thread_id")
    target = data.get("target_name") or thread_id
    if not thread_id or not allows(bot_access, "SUPPORT"):
        await state.clear()
        await message.answer(t(lang, "no_permission"))
        return
    await message.answer(t(lang, "reply_banner", name=esc(target)))
    payload = {
        "actorTelegramId": str(message.from_user.id),
        "text": message.text or message.caption,
        "messageType": "text",
    }
    file_id = None
    if message.photo:
        payload["messageType"] = "photo"
        file_id = message.photo[-1].file_id
    elif message.document:
        payload["messageType"] = "document"
        file_id = message.document.file_id
    elif message.voice:
        payload["messageType"] = "voice"
        file_id = message.voice.file_id
    elif message.audio:
        payload["messageType"] = "audio"
        file_id = message.audio.file_id
    if file_id:
        payload["fileId"] = file_id
    status, result = await api_client.support_reply(thread_id, payload)
    await state.clear()
    if status != 200:
        await message.answer(t(lang, "reply_failed"))
        return
    if result.get("delivery") != "queued" or not result.get("chatId"):
        await message.answer(t(lang, "reply_blocked"))
        return
    try:
        sent = await message.bot.send_message(int(result["chatId"]), esc(result.get("text") or ""))
        if file_id and payload["messageType"] != "text":
            sender = {
                "photo": message.bot.send_photo,
                "document": message.bot.send_document,
                "voice": message.bot.send_voice,
                "audio": message.bot.send_audio,
            }[payload["messageType"]]
            sent = await sender(int(result["chatId"]), file_id)
        await api_client.support_action(thread_id, {"action": "delivery", "messageId": result.get("messageId"), "status": "sent"})
        await message.answer(t(lang, "reply_sent"))
        del sent
    except Exception as exc:
        blocked = "blocked" in str(exc).lower() or "chat not found" in str(exc).lower()
        await api_client.support_action(
            thread_id,
            {"action": "delivery", "messageId": result.get("messageId"), "status": "blocked" if blocked else "failed", "error": "delivery_failed"},
        )
        await message.answer(t(lang, "reply_blocked" if blocked else "reply_failed"))


@support_router.callback_query(F.data.startswith("sact:"))
async def support_action(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    if not allows(bot_access, "SUPPORT"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    _prefix, action, thread_id = callback.data.split(":", 2)
    status, _data = await api_client.support_action(thread_id, {"action": action, "actorTelegramId": str(callback.from_user.id)})
    await callback.answer(t(lang, "support_closed") if status == 200 and action == "close" else t(lang, "error" if status != 200 else "confirmed"))
