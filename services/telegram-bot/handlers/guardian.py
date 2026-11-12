"""Parent Connect in the EXISTING bot: student invite + approval, guardian registration. No new slash commands.

Every handler is private-chat only. Identity comes from Telegram's own user id; the backend decides everything.
"""
import re
from urllib.parse import quote

from aiogram import Bot, F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton,
                           Message, ReplyKeyboardMarkup, ReplyKeyboardRemove)

from guardian_i18n import RELATIONS
from handlers.menu import _lang
from html_text import esc
from i18n import t
from services.api_client import api_client

guardian_router = Router()
UUID = r"[0-9a-fA-F-]{36}"


class GuardianFlow(StatesGroup):
    awaiting_contact = State()


def _private(event) -> bool:
    msg = event.message if isinstance(event, CallbackQuery) else event
    return bool(msg and msg.chat and msg.chat.type == "private" and event.from_user)


def _home_row(lang: str):
    return [InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")]


def _error_key(status: int, code) -> str:
    return {"invitation_invalid": "g_err_invalid", "invitation_used": "g_err_used", "invitation_expired": "g_err_expired",
            "self_link": "g_err_self", "account_conflict": "g_err_conflict",
            "student_required": "g_err_student"}.get(code, "g_err_generic")


# ───────────── student side ─────────────
@guardian_router.callback_query(F.data == "m:guardian")
async def student_menu(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not _private(callback):
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)
        return
    tg = str(callback.from_user.id)
    try:
        status, data = await api_client.guardian_student_links(tg)
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, _error_key(status, (data or {}).get("error"))), show_alert=True)
        return
    rows, lines = [], []
    for link in data.get("links", []):
        relation = t(lang, "g_rel_" + link["relationship"]).lstrip("👩👨 ") if link.get("relationship") else "—"
        lines.append(t(lang, "g_link_line", name=esc(link.get("guardianName") or "—"), relation=esc(relation),
                       status=t(lang, "g_st_" + link["status"])))
        if link["status"] == "awaiting_student":
            rows.append([InlineKeyboardButton(text=t(lang, "g_approve"), callback_data=f"gd:ok:{link['linkId']}"),
                         InlineKeyboardButton(text=t(lang, "g_reject"), callback_data=f"gd:no:{link['linkId']}")])
        else:
            rows.append([InlineKeyboardButton(text=t(lang, "g_revoke") + " · " + (link.get("guardianName") or "")[:20],
                                              callback_data=f"gd:rv:{link['linkId']}")])
    rows.append([InlineKeyboardButton(text=t(lang, "g_btn_connect"), callback_data="gd:new")])
    rows.append(_home_row(lang))
    text = t(lang, "g_links_title") + "\n\n" + ("\n".join(lines) if lines else t(lang, "g_links_empty"))
    await callback.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@guardian_router.callback_query(F.data == "gd:new")
async def student_new_invite(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not _private(callback):
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)
        return
    try:
        status, data = await api_client.guardian_invite(str(callback.from_user.id))
    except Exception:
        status, data = 503, {}
    if status != 200 or not data.get("url"):
        key = "g_invite_no_url" if status == 200 else _error_key(status, (data or {}).get("error"))
        await callback.answer(t(lang, key), show_alert=True)
        return
    share = "https://t.me/share/url?url=" + quote(data["url"], safe="")
    markup = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t(lang, "g_invite_share"), url=share)],
        [InlineKeyboardButton(text=t(lang, "home"), callback_data="m:guardian")]])
    await callback.message.edit_text(t(lang, "g_invite_ready"), reply_markup=markup)
    await callback.answer()


@guardian_router.callback_query(F.data.regexp(rf"^gd:(ok|no|rv):{UUID}$"))
async def student_decide(callback: CallbackQuery, bot: Bot, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not _private(callback):
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)
        return
    _, action, link_id = callback.data.split(":")
    decision = {"ok": "approve", "no": "reject", "rv": "revoke"}[action]
    try:
        status, data = await api_client.guardian_decide(str(callback.from_user.id), link_id, decision)
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)
        return
    done = {"approve": "g_approved", "reject": "g_rejected", "revoke": "g_revoked"}[decision]
    await callback.message.edit_text(t(lang, done), reply_markup=InlineKeyboardMarkup(inline_keyboard=[_home_row(lang)]))
    await callback.answer()
    if decision == "approve" and data.get("guardianChatId"):
        glang = data.get("guardianLanguage") if data.get("guardianLanguage") in ("uz", "en") else "uz"
        try:
            await bot.send_message(int(data["guardianChatId"]), t(glang, "g_linked_parent", student=esc(data.get("studentName") or "")),
                                   reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                                       [InlineKeyboardButton(text=t(glang, "g_btn_results"), callback_data="m:login")]]))
        except Exception:
            pass  # the guardian can still open the menu; delivery failure never undoes the decision


# ───────────── guardian side ─────────────
def _channel_markup(lang: str, url: str | None, link_id: str) -> InlineKeyboardMarkup:
    rows = []
    if url and url.startswith("https://t.me/"):
        rows.append([InlineKeyboardButton(text=t(lang, "g_join"), url=url)])
    rows.append([InlineKeyboardButton(text=t(lang, "g_check"), callback_data=f"gd:c:{link_id}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def proceed(message: Message, state: FSMContext | None, lang: str, tg: str, link_id: str, student: str = "") -> None:
    """Show the next missing step for this guardian link, read from the database (never from chat memory)."""
    try:
        status, data = await api_client.guardian_state(tg)
    except Exception:
        status, data = 503, {}
    link = next((x for x in (data or {}).get("links", []) if x["linkId"] == link_id), None) if status == 200 else None
    if not link:
        await message.answer(t(lang, "g_err_generic"))
        return
    student = student or link.get("studentName") or ""
    if not link.get("relationship"):
        rows = [[InlineKeyboardButton(text=t(lang, "g_rel_" + r), callback_data=f"gd:r:{link_id}:{i}")]
                for i, r in enumerate(RELATIONS)]
        await message.answer(t(lang, "g_who", student=esc(student)), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    elif not data.get("phoneVerified"):
        if state:
            await state.set_state(GuardianFlow.awaiting_contact)
            await state.update_data(guardian_link=link_id)
        kb = ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=t(lang, "g_phone_btn"), request_contact=True)]],
                                 resize_keyboard=True, one_time_keyboard=True)
        await message.answer(t(lang, "g_need_phone"), reply_markup=kb)  # asked only when not verified before
    elif not data.get("channelVerified") and link["status"] == "awaiting_guardian":
        await message.answer(t(lang, "g_need_channel"), reply_markup=_channel_markup(lang, data.get("channelUrl"), link_id))
    elif link["status"] == "awaiting_student":
        await message.answer(t(lang, "g_waiting", student=esc(student)))
    elif link["status"] == "linked":
        await message.answer(t(lang, "g_linked_parent", student=esc(student)), reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text=t(lang, "g_btn_results"), callback_data="m:login")]]))


async def start_invite(message: Message, state: FSMContext | None, token: str, lang: str) -> None:
    """Called from /start g_<token>. Never touches the student admission flow."""
    tg = str(message.from_user.id)
    try:
        status, data = await api_client.guardian_redeem(tg, token, message.from_user.full_name, lang)
    except Exception:
        status, data = 503, {}
    if status != 200 or not data.get("ok"):
        await message.answer(t(lang, _error_key(status, (data or {}).get("error"))))
        return
    await proceed(message, state, lang, tg, data["linkId"], data.get("studentName") or "")


@guardian_router.callback_query(F.data.regexp(rf"^gd:r:{UUID}:[0-7]$"))
async def pick_relationship(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not _private(callback):
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)
        return
    _, _, link_id, idx = callback.data.split(":")
    tg = str(callback.from_user.id)
    try:
        status, data = await api_client.guardian_relationship(tg, link_id, RELATIONS[int(idx)])
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_reply_markup(reply_markup=None)
    await proceed(callback.message, state, lang, tg, link_id)


@guardian_router.message(GuardianFlow.awaiting_contact, F.contact)
async def guardian_contact(message: Message, state: FSMContext, db_user: dict | None = None):
    lang = "en" if (message.from_user and (message.from_user.language_code or "").startswith("en")) else "uz"
    sender, card = message.from_user, message.contact
    # Same rule as the student flow: Telegram's native self-contact only, never a forwarded/picked card.
    if (sender is None or not message.chat or message.chat.type != "private" or getattr(message, "forward_origin", None)
            or card.user_id is None or card.user_id != sender.id):
        await message.answer(t(lang, "phone_invalid"))
        return
    try:
        saved = await api_client.save_verified_phone(str(sender.id), str(card.user_id), card.phone_number)
    except Exception:
        saved = False
    if not saved:
        await message.answer(t(lang, "g_err_generic"))
        return
    link_id = (await state.get_data()).get("guardian_link")
    await state.clear()
    await message.answer(t(lang, "phone_saved"), reply_markup=ReplyKeyboardRemove())
    if link_id:
        await proceed(message, state, lang, str(sender.id), link_id)


@guardian_router.callback_query(F.data.regexp(rf"^gd:c:{UUID}$"))
async def check_channel(callback: CallbackQuery, bot: Bot, state: FSMContext, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not _private(callback):
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)
        return
    link_id = callback.data.split(":")[2]
    tg = str(callback.from_user.id)
    try:
        status, data = await api_client.guardian_check_channel(tg, link_id)
    except Exception:
        status, data = 503, {}
    data = data if isinstance(data, dict) else {}
    if status == 403 and data.get("error") == "not_subscribed":
        await callback.answer(t(lang, "g_not_member"), show_alert=True)
        return
    if status == 503 and data.get("error") == "channel_not_configured":
        await callback.answer(t(lang, "g_channel_off"), show_alert=True)
        return
    if status != 200:
        await callback.answer(t(lang, "g_err_generic"), show_alert=True)  # fail closed, can retry
        return
    await callback.answer()
    notify = data.get("notifyStudent")
    if notify and notify.get("chatId"):
        slang = notify.get("locale") if notify.get("locale") in ("uz", "en") else "uz"
        relation = t(slang, "g_rel_" + notify["relationship"]).lstrip("👩👨 ")
        username = f" (@{esc(notify['guardianUsername'])})" if notify.get("guardianUsername") else ""
        try:
            await bot.send_message(
                int(notify["chatId"]),
                t(slang, "g_student_request", guardian=esc(notify.get("guardianName") or "—"), relation=esc(relation), username=username),
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text=t(slang, "g_approve"), callback_data=f"gd:ok:{notify['linkId']}"),
                    InlineKeyboardButton(text=t(slang, "g_reject"), callback_data=f"gd:no:{notify['linkId']}")]]))
        except Exception:
            pass  # the student still sees the request under "Connect a parent"
    await proceed(callback.message, state, lang, tg, link_id)


class GuardianMessageReplyFlow(StatesGroup):
    awaiting_reply = State()


@guardian_router.callback_query(F.data.regexp(r"^gmr:[0-9a-fA-F-]{36}$"))
async def begin_guardian_message_reply(callback: CallbackQuery, state: FSMContext,
                                       db_user: dict | None = None, contact: dict | None = None):
    """Start a human-authored reply; backend rechecks the original sender on submission."""
    lang = _lang(callback, db_user, contact)
    if not _private(callback):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    delivery_id = callback.data.split(":", 1)[1]
    await state.set_state(GuardianMessageReplyFlow.awaiting_reply)
    await state.update_data(guardian_reply_delivery=delivery_id)
    prompt = ("Javobingizni yozing. Bekor qilish: /cancel" if lang == "uz"
              else "Write your reply. Cancel: /cancel")
    await callback.message.answer(prompt)
    await callback.answer()


@guardian_router.message(GuardianMessageReplyFlow.awaiting_reply)
async def send_guardian_message_reply(message: Message, state: FSMContext,
                                      db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(message, db_user, contact)
    if not _private(message):
        await state.clear()
        return
    text = (message.text or "").strip()
    if text == "/cancel":
        await state.clear()
        await message.answer(t(lang, "cancelled"))
        return
    if not 1 <= len(text) <= 1500:
        await message.answer("1–1500 belgilik matn yuboring." if lang == "uz"
                             else "Send a text message of 1–1500 characters.")
        return
    data = await state.get_data()
    delivery_id = data.get("guardian_reply_delivery")
    if not isinstance(delivery_id, str):
        await state.clear()
        await message.answer(t(lang, "error"))
        return
    try:
        status, result = await api_client.submit_guardian_reply(
            str(message.from_user.id), delivery_id, str(message.message_id), text)
    except Exception:
        status, result = 503, {}
    if status == 200 and isinstance(result, dict) and result.get("ok"):
        await state.clear()
        await message.answer("Javob navbatga qo‘yildi." if lang == "uz" else "Reply queued.")
    elif status in (403, 404, 409):
        await state.clear()
        await message.answer("Suhbat mavjud emas yoki ruxsat bekor qilingan."
                             if lang == "uz" else "This conversation is unavailable.")
    else:
        await message.answer(t(lang, "temporary_error"))
