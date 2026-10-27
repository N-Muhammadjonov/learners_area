from urllib.parse import urlsplit

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import ChatMemberUpdated, Message, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove, InlineKeyboardButton, InlineKeyboardMarkup, CallbackQuery

from handlers.menu import show_home
from i18n import t
from services.api_client import api_client

auth_router = Router()

class PhoneFlow(StatesGroup):
    awaiting_own_contact = State()

def phone_keyboard(lang: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=t(lang, "share_phone_button"), request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=False,
        is_persistent=True,
    )


def lang_of(message: Message, db_user: dict | None = None) -> str:
    code = (message.from_user.language_code or "uz") if message.from_user else "uz"
    return "en" if code.startswith("en") else "uz"



def _channel_keyboard(lang: str, channels: list | None = None) -> InlineKeyboardMarkup:
    rows = []
    for channel in (channels or [])[:4]:
        if not isinstance(channel, dict):
            continue
        url = channel.get("url")
        if not isinstance(url, str):
            continue
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.hostname != "t.me"
            or parsed.username or parsed.password or not parsed.path.strip("/")):
            continue
        title = str(channel.get("title") or "Telegram")[:55]
        rows.append([InlineKeyboardButton(text=f"📢 {title}", url=url)])
    rows.append([InlineKeyboardButton(text=t(lang, "channels_retry"), callback_data="auth:retry_channels")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _complete_pending_intent(message: Message, state: FSMContext | None,
                                   telegram_user_id: str, display_name: str, lang: str, *, retry: bool = False) -> bool:
    data = await state.get_data() if state else {}
    token = data.get("pending_token") if isinstance(data, dict) else None
    token = token if isinstance(token, str) else ""
    try:
        status, result = await api_client.preflight_intent(token, telegram_user_id)
    except Exception:
        status, result = 503, {}
    result = result if isinstance(result, dict) else {}
    error = result.get("error")
    if status == 403 and error == "not_subscribed":
        await message.answer(t(lang, "channels_still_required" if retry else "channels_required"),
                             reply_markup=_channel_keyboard(lang, result.get("requiredChannels")))
        return False
    if status == 503 and error == "membership_unavailable":
        await message.answer(t(lang, "channels_error"),
                             reply_markup=_channel_keyboard(lang, result.get("requiredChannels")))
        return False
    if status == 403 and error == "phone_required":
        await message.answer(t(lang, "phone_required"), reply_markup=phone_keyboard(lang))
        return False
    if status == 404 and error == "intent_invalid":
        if state:
            await state.clear()
        await message.answer(t(lang, "confirm_failed"))
        return False
    if status != 200 or result.get("ok") is not True:
        await message.answer(t(lang, "temporary_error"), reply_markup=_channel_keyboard(lang))
        return False
    if not token:
        if state:
            await state.clear()
        return True
    try:
        confirmed = await api_client.confirm_intent(
            token=token, telegram_user_id=telegram_user_id,
            displayName=display_name, languageCode=lang,
        )
    except Exception:
        confirmed = False
    if not confirmed:
        await message.answer(t(lang, "confirm_failed"))
        return False
    if state:
        await state.clear()
    await message.answer(t(lang, "confirmed"))
    return True


@auth_router.message(CommandStart())
async def cmd_start(
    message: Message,
    command: CommandObject,
    db_user: dict | None = None,
    bot_access: dict | None = None,
    state: FSMContext | None = None,
    backend_error: bool = False,
):
    lang = lang_of(message, db_user)
    args = (command.args or "").strip()
    if len(args) > 200 or " " in args:
        await message.answer(t(lang, "confirm_failed"))
        return
    if backend_error:
        await message.answer(t(lang, "temporary_error"))
        return
    # An intent token is not consumed until the user's OWN contact is verified.
    if state:
        await state.clear()
        await state.set_state(PhoneFlow.awaiting_own_contact)
        await state.update_data(pending_token=args)
    await message.answer(t(lang, "share_phone"), reply_markup=phone_keyboard(lang))


@auth_router.message(F.contact)
async def receive_own_contact(
    message: Message,
    state: FSMContext | None = None,
    db_user: dict | None = None,
    bot_access: dict | None = None,
    backend_error: bool = False,
):
    lang = lang_of(message, db_user)
    sender = message.from_user
    contact = message.contact
    # A forwarded/contact-picker card can name a different person or have NO
    # user_id. Only Telegram's native self-contact with exact numeric binding works.
    if (backend_error or sender is None or contact is None
        or not message.chat or message.chat.type != "private"
        or getattr(message, "forward_origin", None)
        or contact.user_id is None or contact.user_id != sender.id):
        await message.answer(t(lang, "phone_invalid"), reply_markup=phone_keyboard(lang))
        return
    try:
        saved = await api_client.save_verified_phone(
            str(sender.id), str(contact.user_id), contact.phone_number
        )
    except Exception:
        saved = False
    if not saved:
        await message.answer(t(lang, "channels_error"), reply_markup=phone_keyboard(lang))
        return
    await message.answer(t(lang, "phone_saved"), reply_markup=ReplyKeyboardRemove())
    if not await _complete_pending_intent(message, state, str(sender.id), sender.full_name, lang):
        return
    await show_home(message, lang, bot_access, db_user)



@auth_router.callback_query(F.data == "auth:retry_channels")
async def retry_required_channels(callback: CallbackQuery, state: FSMContext,
                                  db_user: dict | None = None, bot_access: dict | None = None,
                                  backend_error: bool = False):
    lang = "en" if (callback.from_user and (callback.from_user.language_code or "").startswith("en")) else "uz"
    if (backend_error or callback.from_user is None or not callback.message
        or not callback.message.chat or callback.message.chat.type != "private"
        or not hasattr(callback.message, "answer")):
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    await callback.answer()
    success = await _complete_pending_intent(
        callback.message, state, str(callback.from_user.id), callback.from_user.full_name, lang, retry=True
    )
    if success:
        await show_home(callback.message, lang, bot_access, db_user)


@auth_router.my_chat_member()
async def membership(event: ChatMemberUpdated):
    # Channel bot-admin updates must NOT replace an owner\'s private chat ID.
    if not event.chat or event.chat.type != "private":
        return
    status = event.new_chat_member.status
    blocked = status in {"kicked", "left"}
    await api_client.sync_contact({
        "telegramUserId": str(event.from_user.id),
        "chatId": str(event.chat.id),
        "blocked": blocked,
        "sync": False,
    })


@auth_router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext, db_user: dict | None = None):
    await state.clear()
    await message.answer(t(lang_of(message, db_user), "cancelled"))


@auth_router.message(Command("help"))
async def cmd_help(message: Message, db_user: dict | None = None, bot_access: dict | None = None, backend_error: bool = False):
    lang = lang_of(message, db_user)
    await message.answer(t(lang, "help"))
    await show_home(message, lang, bot_access, db_user, backend_error=backend_error)

