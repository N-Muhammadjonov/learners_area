from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import ChatMemberUpdated, Message, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove, InlineKeyboardButton, InlineKeyboardMarkup

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


def required_channels_keyboard(channels: list[dict]) -> InlineKeyboardMarkup | None:
    buttons = []
    for channel in channels[:4]:
        url = channel.get("url")
        if isinstance(url, str) and url.startswith("https://t.me/"):
            buttons.append([InlineKeyboardButton(text=str(channel.get("title") or "Channel")[:50], url=url)])
    return InlineKeyboardMarkup(inline_keyboard=buttons) if buttons else None


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
    if backend_error or not message.from_user:
        await message.answer(t(lang, "temporary_error"))
        return

    # Server-side preflight reads phone_verified_at from Supabase. A stored
    # self-contact is valid across /start, bot restarts and new deployments.
    try:
        status, result = await api_client.auth_preflight(str(message.from_user.id), args)
    except Exception:
        await message.answer(t(lang, "temporary_error"))
        return
    result = result if isinstance(result, dict) else {}
    if status == 403 and result.get("error") == "phone_required":
        # Preserve the deep link until the sender provides their own native contact.
        if state:
            await state.clear()
            await state.set_state(PhoneFlow.awaiting_own_contact)
            await state.update_data(pending_token=args)
        await message.answer(t(lang, "share_phone"), reply_markup=phone_keyboard(lang))
        return
    if status == 403 and result.get("error") == "not_subscribed":
        await message.answer(t(lang, "channels_required"),
                             reply_markup=required_channels_keyboard(result.get("requiredChannels") or []))
        return
    if status != 200 or result.get("ok") is not True:
        await message.answer(t(lang, "confirm_failed") if status in {404, 409} and args
                             else t(lang, "temporary_error"))
        return

    # The phone was already verified; remove any stale phone-sharing keyboard.
    if state:
        await state.clear()
    if args:
        try:
            confirmed = await api_client.confirm_intent(
                token=args, telegram_user_id=str(message.from_user.id),
                displayName=message.from_user.full_name, languageCode=lang,
            )
        except Exception:
            confirmed = False
        await message.answer(t(lang, "confirmed" if confirmed else "confirm_failed"),
                             reply_markup=ReplyKeyboardRemove())
    else:
        # Removing the persistent contact keyboard is important on mobile.
        await message.answer(t(lang, "phone_saved"), reply_markup=ReplyKeyboardRemove())
    await show_home(message, lang, bot_access, db_user)


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
    data = await state.get_data() if state else {}
    token = data.get("pending_token") if isinstance(data, dict) else None
    if state:
        await state.clear()
    await message.answer(t(lang, "phone_saved"), reply_markup=ReplyKeyboardRemove())
    if token:
        try:
            confirmed = await api_client.confirm_intent(
                token=token,
                telegram_user_id=str(sender.id),
                displayName=sender.full_name,
                languageCode=lang,
            )
        except Exception:
            confirmed = False
        await message.answer(t(lang, "confirmed" if confirmed else "confirm_failed"))
    await show_home(message, lang, bot_access, db_user)


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


