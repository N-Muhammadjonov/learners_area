from aiogram import Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import ChatMemberUpdated, Message

from handlers.menu import show_home
from i18n import t
from services.api_client import api_client

auth_router = Router()


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
    if state:
        await state.clear()
    lang = lang_of(message, db_user)
    args = (command.args or "").strip()
    if backend_error and not args:
        await message.answer(t(lang, "temporary_error"))
        return
    if args:
        if len(args) > 200 or " " in args:
            await message.answer(t(lang, "confirm_failed"))
            return
        user = message.from_user
        success = await api_client.confirm_intent(
            token=args,
            telegram_user_id=str(user.id),
            displayName=user.full_name,
            languageCode="en" if (user.language_code or "").startswith("en") else "uz",
        )
        await message.answer(t(lang, "confirmed" if success else "confirm_failed"))
    await show_home(message, lang, bot_access, db_user, backend_error=backend_error)


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
