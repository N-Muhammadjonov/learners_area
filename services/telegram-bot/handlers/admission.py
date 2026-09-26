from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from typing import Optional, Dict, Any
from services.api_client import api_client

admission_router = Router()


@admission_router.message(Command("apply"))
async def cmd_apply(message: Message, db_user: Optional[Dict[str, Any]] = None):
    """User requests access to the platform via Telegram."""
    if db_user:
        status = db_user.get("accountStatus")
        if status == "active":
            await message.answer("Siz allaqachon platformaga kirishingiz tasdiqlangan.")
            return
        if status == "pending":
            await message.answer("Sizning arizangiz allaqachon ko'rib chiqilmoqda. Iltimos, kuting.")
            return
        if status == "suspended":
            await message.answer("Sizning hisobingiz to'xtatilgan. Iltimos, admin bilan bog'laning.")
            return

    name = message.from_user.full_name
    telegram_id = str(message.from_user.id)

    try:
        req_id = await api_client.create_access_request(
            telegram_id, name, "Telegram orqali ariza"
        )
        await message.answer(
            "✅ Arizangiz muvaffaqiyatli qabul qilindi.\n"
            "Administratorlar ko'rib chiqishini kuting."
        )
    except Exception:
        await message.answer(
            "❌ Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring."
        )


@admission_router.message(Command("pending"))
async def cmd_pending(message: Message, db_user: Optional[Dict[str, Any]] = None):
    """OWNER/admin views pending access requests."""
    if not db_user or db_user.get("role") not in ("admin", "owner"):
        await message.answer("Sizda bu buyruqdan foydalanish uchun ruxsat yo'q.")
        return

    try:
        requests = await api_client.list_pending_requests()
    except Exception:
        await message.answer("❌ Arizalarni yuklashda xatolik yuz berdi.")
        return

    if not requests:
        await message.answer("Hozircha kutilayotgan arizalar yo'q.")
        return

    for req in requests[:20]:  # limit to 20 in one batch
        name = req.get("applicantName", "Noma'lum")
        email = req.get("applicantEmail", "—")
        msg = req.get("message") or "—"
        rid = req.get("id", "")
        created = req.get("createdAt", "")[:10]

        text = (
            f"👤 Ism: {name}\n"
            f"📧 Email: {email}\n"
            f"💬 Xabar: {msg}\n"
            f"📅 Sana: {created}"
        )

        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="✅ Tasdiqlash",
                        callback_data=f"decide_approve_{rid}",
                    ),
                    InlineKeyboardButton(
                        text="❌ Rad etish",
                        callback_data=f"decide_reject_{rid}",
                    ),
                ]
            ]
        )

        await message.answer(text, reply_markup=keyboard)


@admission_router.callback_query(F.data.startswith("decide_"))
async def handle_decision(
    callback: CallbackQuery, db_user: Optional[Dict[str, Any]] = None
):
    """Handle approve/reject inline button press from OWNER/admin."""
    if not db_user or db_user.get("role") not in ("admin", "owner"):
        await callback.answer(
            "Sizda bu amalni bajarish uchun ruxsat yo'q.", show_alert=True
        )
        return

    parts = callback.data.split("_", 2)
    if len(parts) < 3:
        await callback.answer("Noto'g'ri buyruq formati.", show_alert=True)
        return

    decision = parts[1]  # "approve" or "reject"
    request_id = parts[2]
    actor_telegram_id = str(callback.from_user.id)

    if decision not in ("approve", "reject"):
        await callback.answer("Noto'g'ri qaror turi.", show_alert=True)
        return

    try:
        success = await api_client.decide_access_request(
            actor_telegram_id, request_id, decision
        )
    except Exception:
        await callback.answer(
            "Server xatoligi yuz berdi.", show_alert=True
        )
        return

    if success:
        label = "✅ Tasdiqlandi" if decision == "approve" else "❌ Rad etildi"
        original = callback.message.text or ""
        await callback.message.edit_text(
            f"{original}\n\n{label}",
            reply_markup=None,
        )
        await callback.answer(label)
    else:
        await callback.answer(
            "Ariza allaqachon ko'rib chiqilgan yoki topilmadi.",
            show_alert=True,
        )
