from aiogram import Router
from aiogram.filters import CommandStart, CommandObject
from aiogram.types import Message
from typing import Optional, Dict, Any
from services.api_client import api_client

auth_router = Router()

@auth_router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject, db_user: Optional[Dict[str, Any]] = None):
    args = command.args
    telegram_id = str(message.from_user.id)

    if args:
        # It's an intent token
        success = await api_client.confirm_intent(token=args, telegram_user_id=telegram_id)
        if success:
            await message.answer("✅ Muvaffaqiyatli tasdiqlandi! Endi brauzeringizdagi sahifaga qaytishingiz mumkin.")
        else:
            await message.answer("❌ Havola eskirgan yoki yaroqsiz. Iltimos, saytdan qayta urinib ko'ring.")
        return

    # Regular start
    if db_user:
        name = db_user.get("name", "Foydalanuvchi")
        await message.answer(f"Xush kelibsiz, {name}! Sizning hisobingiz tizimga ulangan.")
    else:
        await message.answer(
            "Assalomu alaykum! Learners Area botiga xush kelibsiz.\n\n"
            "Botdan to'liq foydalanish uchun sayt orqali profilingizni ulang yoki "
            "adminga murojaat qilib platformaga kirish ruxsatini so'rang."
        )
