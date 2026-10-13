from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from i18n import t
from owner_callbacks import numeric_target
from services.api_client import api_client

owner_router = Router()


class OwnerFlow(StatesGroup):
    target_id = State()


def _lang(event, db_user) -> str:
    if db_user and db_user.get("locale") in {"uz", "en"}:
        return db_user["locale"]
    code = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if str(code).startswith("en") else "uz"


def _result_key(status: int, data: dict | None) -> str:
    error = (data or {}).get("error")
    if status == 200 and (data or {}).get("already"):
        return "owner_already"
    if status == 200 and (data or {}).get("rejected"):
        return "owner_rejected"
    if status == 200 and ((data or {}).get("committed") or (data or {}).get("confirmed")):
        return "owner_accepted"
    if error in {"expired", "replay", "cancelled", "rejected", "stale_owner", "not_ready"}:
        return "owner_stale"
    if error == "wrong_actor":
        return "owner_wrong_user"
    if status == 403:
        return "no_permission"
    return "error"


async def _answer(callback: CallbackQuery, lang: str, status: int, data: dict | None) -> None:
    await callback.answer(t(lang, _result_key(status, data)), show_alert=True)
    if callback.message and status in {200, 409}:
        try:
            await callback.message.edit_reply_markup(reply_markup=None)
        except Exception:
            return


@owner_router.callback_query(F.data == "o:bown")
async def begin_handover(callback: CallbackQuery, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(callback, db_user)
    if not (bot_access or {}).get("isPrimaryOwner"):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    status, data = await api_client.owner_summary(str(callback.from_user.id))
    if status != 200:
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    await state.set_state(OwnerFlow.target_id)
    text = t(
        lang,
        "bot_owner_prompt",
        telegram_id=data.get("telegramUserId"),
        source=data.get("source"),
    )
    await callback.message.edit_text(text)
    await callback.answer()


@owner_router.message(OwnerFlow.target_id)
async def receive_target(message: Message, state: FSMContext, db_user: dict | None = None, bot_access: dict | None = None):
    lang = _lang(message, db_user)
    await state.clear()
    if not (bot_access or {}).get("isPrimaryOwner"):
        await message.answer(t(lang, "no_permission"))
        return
    target = numeric_target(message.text)
    if not target:
        await message.answer(t(lang, "bot_owner_id_rejected"))
        return
    status, data = await api_client.start_owner_handover(str(message.from_user.id), target)
    if status != 202:
        key = "bot_owner_unknown" if (data or {}).get("error") == "target_unknown" else "error"
        if (data or {}).get("error") == "already_owner":
            key = "owner_already"
        await message.answer(t(lang, key))
        return
    await message.answer(t(lang, "bot_owner_started"))


async def _decide_website(callback: CallbackQuery, decision: str, db_user: dict | None) -> None:
    lang = _lang(callback, db_user)
    challenge_id = (callback.data or "").split(":", 1)[1]
    status, data = await api_client.decide_website_transfer(str(callback.from_user.id), challenge_id, decision)
    await _answer(callback, lang, status, data if isinstance(data, dict) else None)


async def _decide_handover(callback: CallbackQuery, step: str, db_user: dict | None) -> None:
    lang = _lang(callback, db_user)
    handover_id = (callback.data or "").split(":", 1)[1]
    status, data = await api_client.decide_owner_handover(str(callback.from_user.id), handover_id, step)
    await _answer(callback, lang, status, data if isinstance(data, dict) else None)


@owner_router.callback_query(F.data.startswith("wta:"))
async def approve_website(callback: CallbackQuery, db_user: dict | None = None):
    await _decide_website(callback, "approve", db_user)


@owner_router.callback_query(F.data.startswith("wtr:"))
async def reject_website(callback: CallbackQuery, db_user: dict | None = None):
    await _decide_website(callback, "reject", db_user)


@owner_router.callback_query(F.data.startswith("bhc:"))
async def confirm_handover(callback: CallbackQuery, db_user: dict | None = None):
    await _decide_handover(callback, "current_confirm", db_user)


@owner_router.callback_query(F.data.startswith("bha:"))
async def accept_handover(callback: CallbackQuery, db_user: dict | None = None):
    await _decide_handover(callback, "target_accept", db_user)


@owner_router.callback_query(F.data.startswith("bhr:"))
async def reject_handover(callback: CallbackQuery, db_user: dict | None = None):
    await _decide_handover(callback, "reject", db_user)
