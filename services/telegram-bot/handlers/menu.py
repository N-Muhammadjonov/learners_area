from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from handlers.admission import begin_apply

from copy_format import admission_text
from html_text import esc
from i18n import t
from middlewares.auth import allows, denial_key
from services.api_client import api_client
from services.login_handoff import website_link

menu_router = Router()


def _lang(event, db_user, contact=None) -> str:
    override = (contact or {}).get("localeOverride")
    if override in {"uz", "en"}:
        return override
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if str(code).startswith("en") else "uz"


def main_keyboard(lang: str, bot_access: dict | None, role: str | None = None,
                  account_status: str | None = None, *, site_link: str | None = None) -> InlineKeyboardMarkup:
    if site_link:
        label = "g_btn_results" if role == "guardian" else "handoff_open"
        rows = [[InlineKeyboardButton(text=t(lang, label), url=site_link)],
                [InlineKeyboardButton(text=t(lang, "handoff_refresh"), callback_data="m:login")]]
    elif account_status in {None, "rejected"} and role != "guardian":
        rows = [[InlineKeyboardButton(text=t(lang, "register_in_bot"), callback_data="m:apply")]]
    else:
        rows = [[InlineKeyboardButton(text=t(lang, "menu_login"), callback_data="m:login")]]
    if role == "student" and account_status == "active":
        rows.append([InlineKeyboardButton(text=t(lang, "g_btn_connect"), callback_data="m:guardian")])
        rows.append([InlineKeyboardButton(
            text="👥 Do‘st taklif qilish" if lang == "uz" else "👥 Invite friends",
            callback_data="m:invite")])
    rows += [
        [InlineKeyboardButton(text=t(lang, "menu_support"), callback_data="m:support")],
        [InlineKeyboardButton(text=t(lang, "menu_language"), callback_data="m:lang")],
    ]
    if role != "guardian" and bot_access and (bot_access.get("isPrimaryOwner") or bot_access.get("permissions")):
        rows.append([InlineKeyboardButton(text=t(lang, "menu_owner"), callback_data="m:owner")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def owner_keyboard(lang: str, bot_access: dict | None) -> InlineKeyboardMarkup:
    access = bot_access or {}
    owner = bool(access.get("isPrimaryOwner"))
    perms = set(access.get("permissions") or [])
    rows = []
    if owner or "VIEW_USERS" in perms:
        rows.append([InlineKeyboardButton(text=t(lang, "users"), callback_data="o:users")])
        rows.append([InlineKeyboardButton(text=t(lang, "parents"), callback_data="o:parents")])
    if owner or "ADMISSIONS" in perms:
        rows.append([InlineKeyboardButton(text=t(lang, "admissions"), callback_data="o:adm")])
    if owner or "SUPPORT" in perms:
        rows.append([InlineKeyboardButton(text=t(lang, "support_admin"), callback_data="o:sup")])
    if owner or "BROADCAST" in perms:
        rows.append([InlineKeyboardButton(text=t(lang, "broadcast"), callback_data="o:bc")])
    if owner:
        rows.append([InlineKeyboardButton(text=t(lang, "admins"), callback_data="o:admins")])
        rows.append([InlineKeyboardButton(text=t(lang, "channels_title"), callback_data="o:channels")])
        rows.append([InlineKeyboardButton(text=t(lang, "bot_owner_transfer"), callback_data="o:bown")])
        rows.append([InlineKeyboardButton(text=t(lang, "settings"), callback_data="o:set")])
    if owner or "VIEW_STATS" in perms:
        rows.append([InlineKeyboardButton(text=t(lang, "stats"), callback_data="o:stats")])
    if owner or "VIEW_AUDIT" in perms:
        rows.append([InlineKeyboardButton(text=t(lang, "audit"), callback_data="o:audit")])
    rows.append([InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def show_home(event: Message | CallbackQuery, lang: str, bot_access: dict | None, db_user: dict | None, backend_error: bool = False):
    if backend_error and not db_user:
        text = t(lang, "temporary_error")
    else:
        name = (db_user or {}).get("name") or (event.from_user.full_name if event.from_user else "")
        text = t(lang, "welcome_linked", name=esc(name)) if db_user else t(lang, "welcome_new")
    role, status = (db_user or {}).get("role"), (db_user or {}).get("accountStatus")
    is_callback = isinstance(event, CallbackQuery)
    chat_message = event.message if is_callback else event
    link = None
    if (not backend_error and event.from_user and chat_message and chat_message.chat
            and chat_message.chat.type == "private" and status in {"active", "pending"}):
        link, _error = await website_link(str(event.from_user.id))
    markup = main_keyboard(lang, bot_access, role, status, site_link=link)
    if is_callback and event.message:
        await event.message.edit_text(text, reply_markup=markup)
        await event.answer()
    else:
        await event.answer(text, reply_markup=markup, **({"protect_content": True} if link else {}))


@menu_router.callback_query(F.data == "m:home")
async def cb_home(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None, state: FSMContext | None = None):
    if state:
        await state.clear()
    await show_home(callback, _lang(callback, db_user, contact), bot_access, db_user)


@menu_router.message(Command("lang"))
async def cmd_lang(message: Message, db_user: dict | None = None, contact: dict | None = None):
    await cb_settings(message, db_user, contact)


@menu_router.callback_query(F.data == "m:owner")
async def cb_owner(callback: CallbackQuery, db_user: dict | None = None, bot_access: dict | None = None, contact: dict | None = None, backend_error: bool = False):
    lang = _lang(callback, db_user, contact)
    denied = denial_key(bot_access, backend_error) if backend_error else None
    if denied:
        await callback.answer(t(lang, denied), show_alert=True)
        return
    if not (bot_access and (bot_access.get("isPrimaryOwner") or bot_access.get("permissions"))):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    await callback.message.edit_text(t(lang, "owner_title"), reply_markup=owner_keyboard(lang, bot_access))
    await callback.answer()


@menu_router.callback_query(F.data == "m:invite")
async def cb_coin_invite(callback: CallbackQuery, db_user: dict | None = None,
                         contact: dict | None = None, backend_error: bool = False):
    lang = _lang(callback, db_user, contact)
    if (backend_error or callback.from_user is None or not db_user
            or db_user.get("role") != "student" or db_user.get("accountStatus") != "active"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    try:
        status, result = await api_client.coin_referral_link(str(callback.from_user.id))
    except Exception:
        status, result = 503, {}
    if status != 200 or not isinstance(result, dict) or not isinstance(result.get("url"), str):
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    message = (
        "👥 Do‘stingizga quyidagi havolani yuboring. U yangi Learners Area hisobini yaratib, "
        "tasdiqlangach sizga +10 tanga qo‘shiladi.\\n\\n"
        if lang == "uz" else
        "👥 Send this link to a new friend. You get +10 coins after their new "
        "Learners Area student account becomes active.\\n\\n"
    )
    await callback.message.answer(message + result["url"])
    await callback.answer()


@menu_router.callback_query(F.data == "m:login")
async def cb_login(callback: CallbackQuery, db_user: dict | None = None,
                   contact: dict | None = None, backend_error: bool = False,
                   state: FSMContext | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if (backend_error or not callback.from_user or not callback.message
            or not callback.message.chat or callback.message.chat.type != "private"):
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    link, error = await website_link(str(callback.from_user.id))
    if error == "status_none":
        await callback.answer()
        await begin_apply(callback.message, state, None, lang)
        return
    if not link:
        await callback.answer(t(lang, error or "temporary_error"), show_alert=True)
        return
    account = db_user or {}
    markup = main_keyboard(lang, bot_access, account.get("role"), account.get("accountStatus"), site_link=link)
    await callback.message.edit_text(t(lang, "handoff_ready"), reply_markup=markup)
    await callback.answer()


@menu_router.callback_query(F.data == "m:status")
async def cb_status(callback: CallbackQuery | Message, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    status = (db_user or {}).get("accountStatus")
    key = {
        "pending": "status_pending",
        "active": "status_active",
        "rejected": "status_rejected",
        "suspended": "status_suspended",
    }.get(status, "status_none")
    rows = [[InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")]]
    if status in {None, "rejected"}:
        rows.insert(0, [InlineKeyboardButton(text=t(lang, "apply"), callback_data="m:apply")])
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    if isinstance(callback, CallbackQuery) and callback.message:
        await callback.message.edit_text(t(lang, key), reply_markup=markup)
        await callback.answer()
    else:
        await callback.answer(t(lang, key), reply_markup=markup)


@menu_router.callback_query(F.data == "m:apply")
async def cb_apply(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, contact: dict | None = None):
    await begin_apply(callback.message, state, db_user, _lang(callback, db_user, contact))
    await callback.answer()


@menu_router.callback_query(F.data == "m:account")
async def cb_account(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    if not db_user:
        text = t(lang, "status_none")
    else:
        text = (
            f"{esc(db_user.get('name'))}\n"
            f"{esc(db_user.get('email') or '—')}\n"
            f"{esc(db_user.get('accountStatus'))} · {esc(db_user.get('role'))}"
        )
    await callback.message.edit_text(
        text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")]]),
    )
    await callback.answer()


@menu_router.callback_query(F.data == "m:notes")
async def cb_notes(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    status, data = await api_client.notification_prefs(str(callback.from_user.id))
    if status != 200:
        if status >= 500:
            await callback.answer(t(lang, "temporary_error"), show_alert=True)
            return
        data = {}
    text = (
        f"{t(lang, 'menu_notes')}\n"
        f"{t(lang, 'account_notices')}\n"
        f"{t(lang, 'announcements')}: {'on' if data.get('announcements') else 'off'}\n"
        f"{t(lang, 'reminders')}: {'on' if data.get('reminders') else 'off'}"
    )
    markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=t(lang, "announcements"), callback_data="n:ann")],
            [InlineKeyboardButton(text=t(lang, "reminders"), callback_data="n:rem")],
            [InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")],
        ]
    )
    await callback.message.edit_text(text, reply_markup=markup)
    await callback.answer()


@menu_router.callback_query(F.data.in_({"n:ann", "n:rem"}))
async def cb_toggle_note(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None):
    status, data = await api_client.notification_prefs(str(callback.from_user.id))
    current = data if status == 200 else {}
    payload = {"actorTelegramId": str(callback.from_user.id)}
    if callback.data == "n:ann":
        payload["announcements"] = not bool(current.get("announcements"))
    else:
        payload["reminders"] = not bool(current.get("reminders"))
    await api_client.save_notification_prefs(payload)
    await cb_notes(callback, db_user, contact)


@menu_router.callback_query(F.data.in_({"m:settings", "m:lang"}))
async def cb_settings(callback: CallbackQuery | Message, db_user: dict | None = None, contact: dict | None = None):
    lang = _lang(callback, db_user, contact)
    markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🇺🇿 O'zbek", callback_data="lang:uz"),
                InlineKeyboardButton(text="🇬🇧 English", callback_data="lang:en"),
            ],
            [InlineKeyboardButton(text=t(lang, "home"), callback_data="m:home")],
        ]
    )
    if isinstance(callback, CallbackQuery) and callback.message:
        await callback.message.edit_text(t(lang, "language"), reply_markup=markup)
        await callback.answer()
    else:
        await callback.answer(t(lang, "language"), reply_markup=markup)


@menu_router.callback_query(F.data.startswith("lang:"))
async def cb_lang(callback: CallbackQuery, db_user: dict | None = None, contact: dict | None = None, bot_access: dict | None = None):
    locale = "en" if callback.data.endswith("en") else "uz"
    await api_client.save_notification_prefs({"actorTelegramId": str(callback.from_user.id), "locale": locale})
    if contact is not None:
        contact["localeOverride"] = locale
    await callback.answer(t(locale, "language_set"))
    await show_home(callback, locale, bot_access, db_user)
