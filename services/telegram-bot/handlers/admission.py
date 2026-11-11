from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from copy_format import admission_text
from html_text import esc
from i18n import t
from middlewares.auth import allows, denial_key
from services.api_client import api_client

admission_router = Router()


def _lang(event: Message | CallbackQuery, db_user: dict | None) -> str:
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = event.from_user.language_code if event.from_user else "uz"
    return "en" if (code or "").startswith("en") else "uz"


async def cmd_apply(message: Message, db_user: dict | None = None):
    lang = _lang(message, db_user)
    if db_user:
        status = db_user.get("accountStatus")
        if status == "active":
            await message.answer(t(lang, "apply_active"))
            return
        if status == "pending":
            await message.answer(t(lang, "apply_pending"))
            return
        if status == "suspended":
            await message.answer(t(lang, "apply_suspended"))
            return
    try:
        raw = await api_client.create_access_request(
            str(message.from_user.id),
            message.from_user.full_name,
            "Telegram orqali ariza",
            username=message.from_user.username,
            chatId=str(message.chat.id),
            languageCode=message.from_user.language_code,
        )
        await message.answer(admission_text(lang, raw))
    except Exception:
        await message.answer(t(lang, "error"))


async def cmd_pending(message: Message, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False):
    lang = _lang(message, db_user)
    denied = denial_key(bot_access, backend_error, "ADMISSIONS")
    if denied:
        await message.answer(t(lang, denied))
        return
    try:
        requests = await api_client.list_pending_requests(str(message.from_user.id))
    except Exception:
        await message.answer(t(lang, "error"))
        return
    if not requests:
        await message.answer(t(lang, "empty"))
        return
    for req in requests[:10]:
        rid = req.get("id", "")
        text = (
            f"👤 {esc(req.get('applicantName') or '—')}\n"
            f"📧 {esc(req.get('applicantEmail') or '—')}\n"
            f"💬 {esc(req.get('message') or '—')}"
        )
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[[
                InlineKeyboardButton(text="✅", callback_data=f"decide_approve_{rid}"),
                InlineKeyboardButton(text="❌", callback_data=f"decide_reject_{rid}"),
            ]]
        )
        await message.answer(text, reply_markup=keyboard)


@admission_router.callback_query(F.data.startswith("decide_"))
async def handle_decision(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False):
    lang = _lang(callback, db_user)
    denied = denial_key(bot_access, backend_error, "ADMISSIONS")
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    parts = (callback.data or "").split("_", 2)
    if len(parts) < 3 or parts[1] not in {"approve", "reject"} or not parts[2]:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    decision, request_id = parts[1], parts[2]
    actor_id = str(callback.from_user.id)
    try:
        success = await api_client.decide_access_request(actor_id, request_id, decision)
    except Exception:
        await callback.answer(t(lang, "error"), show_alert=True)
        return
    if not success:
        await callback.answer(t(lang, "decide_conflict"), show_alert=True)
        return
    label = f"✅ {t(lang, 'approved')}" if decision == "approve" else f"❌ {t(lang, 'rejected')}"
    original = callback.message.text or ""
    await callback.message.edit_text(f"{original}\n\n{label}", reply_markup=None)
    await callback.answer(label)
