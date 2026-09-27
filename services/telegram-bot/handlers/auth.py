from aiogram import Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import ChatMemberUpdated, Message

from html_text import esc
from i18n import t
from services.api_client import api_client

auth_router = Router()


def lang_of(message: Message, db_user: dict | None = None) -> str:
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = (message.from_user.language_code or "uz") if message.from_user else "uz"
    return "en" if code.startswith("en") else "uz"


@auth_router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject, db_user: dict | None = None, state: FSMContext | None = None):
    if state:
        await state.clear()
    lang = lang_of(message, db_user)
    args = (command.args or "").strip()
    telegram_id = str(message.from_user.id)
    if args:
        # The start payload is a one-time login intent, never a session token.
        if len(args) > 200 or " " in args:
            await message.answer(t(lang, "confirm_failed"))
            return
        success = await api_client.confirm_intent(token=args, telegram_user_id=telegram_id)
        await message.answer(t(lang, "confirmed" if success else "confirm_failed"))
        return
    if db_user:
        await message.answer(t(lang, "welcome_linked", name=esc(db_user.get("name") or "—")))
    else:
        await message.answer(t(lang, "welcome_new"))


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
