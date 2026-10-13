"""Owner-only management for up to four mandatory Telegram channels."""
from aiogram import Bot, F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from html_text import esc
from i18n import t
from services.api_client import api_client

channels_router = Router()


class ChannelFlow(StatesGroup):
    awaiting_channel = State()


def _lang(event) -> str:
    code = getattr(getattr(event, "from_user", None), "language_code", None) or "uz"
    return "en" if code.startswith("en") else "uz"


def _is_owner(access: dict | None) -> bool:
    return bool((access or {}).get("isPrimaryOwner"))


def _back(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")
    ]])


async def show_required_channels(callback: CallbackQuery, bot_access: dict | None):
    lang = _lang(callback)
    if not _is_owner(bot_access):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    try:
        status, data = await api_client.required_channels(str(callback.from_user.id))
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    channels = data.get("channels") or []
    lines = [t(lang, "channels_title")]
    rows = []
    for item in channels:
        cid = str(item.get("id") or "")
        label = str(item.get("title") or cid)
        lines.append(f"• {esc(label)}")
        rows.append([InlineKeyboardButton(
            text=f"❌ {label}"[:50], callback_data=f"ch:del:{cid}"
        )])
    if not channels:
        lines.append(t(lang, "channels_empty"))
    if len(channels) < 4:
        rows.append([InlineKeyboardButton(text=t(lang, "channels_add"), callback_data="ch:add")])
    rows.append([InlineKeyboardButton(text=t(lang, "back"), callback_data="m:owner")])
    await callback.message.edit_text(
        "\n".join(lines), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows)
    )
    await callback.answer()


@channels_router.callback_query(F.data == "o:channels")
async def channels_home(callback: CallbackQuery, bot_access: dict | None = None):
    await show_required_channels(callback, bot_access)


@channels_router.callback_query(F.data == "ch:add")
async def channels_add_prompt(
    callback: CallbackQuery, state: FSMContext, bot_access: dict | None = None
):
    lang = _lang(callback)
    if not _is_owner(bot_access):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    await state.set_state(ChannelFlow.awaiting_channel)
    await callback.message.edit_text(t(lang, "channels_add_prompt"), reply_markup=_back(lang))
    await callback.answer()


@channels_router.message(ChannelFlow.awaiting_channel)
async def channel_received(
    message: Message, state: FSMContext, bot: Bot, bot_access: dict | None = None
):
    lang = _lang(message)
    if not _is_owner(bot_access):
        await state.clear()
        await message.answer(t(lang, "no_permission"))
        return
    value = (message.text or "").strip()
    # Usernames are allowed only if Telegram resolves them to a genuine channel.
    if not (value.startswith("@") or (value.startswith("-100") and value[1:].isdigit())):
        await message.answer(t(lang, "channels_invalid"))
        return
    try:
        chat = await bot.get_chat(value)
        if chat.type != "channel" or not str(chat.id).startswith("-100"):
            raise ValueError("not a channel")
        myself = await bot.get_me()
        member = await bot.get_chat_member(chat.id, myself.id)
        if member.status not in {"administrator", "creator"}:
            raise ValueError("bot is not channel admin")
        url = ("https://t.me/" + chat.username) if chat.username else chat.invite_link
        if not url or not url.startswith("https://t.me/"):
            raise ValueError("channel has no accessible invite link")
        status, data = await api_client.change_required_channels(
            str(message.from_user.id), "add",
            {"id": str(chat.id), "title": chat.title[:120], "url": url},
        )
    except Exception:
        await message.answer(t(lang, "channels_invalid"))
        return
    if status != 200:
        key = "channels_full" if data.get("error") == "max_channels" else "channels_invalid"
        await message.answer(t(lang, key))
        return
    await state.clear()
    await message.answer(t(lang, "channels_added"), reply_markup=_back(lang))


@channels_router.callback_query(F.data.startswith("ch:del:"))
async def channel_removed(callback: CallbackQuery, bot_access: dict | None = None):
    lang = _lang(callback)
    if not _is_owner(bot_access):
        await callback.answer(t(lang, "no_permission"), show_alert=True)
        return
    channel_id = (callback.data or "").split(":", 2)[2]
    try:
        status, data = await api_client.change_required_channels(
            str(callback.from_user.id), "remove", {"id": channel_id}
        )
    except Exception:
        status, data = 503, {}
    if status != 200:
        await callback.answer(t(lang, "temporary_error"), show_alert=True)
        return
    await show_required_channels(callback, bot_access)
