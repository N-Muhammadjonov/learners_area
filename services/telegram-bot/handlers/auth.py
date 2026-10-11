from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import ChatMemberUpdated, Message, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove

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
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = (message.from_user.language_code or "uz") if message.from_user else "uz"
    return "en" if code.startswith("en") else "uz"


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
