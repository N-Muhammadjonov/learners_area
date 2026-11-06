from collections import OrderedDict
from time import monotonic
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject, Update

from i18n import t
from security_policy import is_sensitive_update
from services.api_client import api_client

_SEEN: OrderedDict[int, None] = OrderedDict()
_CONTACT_SYNCED_AT: OrderedDict[str, float] = OrderedDict()
_CONTACT_SYNC_INTERVAL = 300.0  # Preserve last_seen on active users, not every message.


def _remember(update_id: int) -> bool:
    if update_id in _SEEN:
        return False
    _SEEN[update_id] = None
    if len(_SEEN) > 5000:
        _SEEN.popitem(last=False)
    return True


def _callback_data(event: TelegramObject) -> str | None:
    if isinstance(event, Update) and event.callback_query:
        return event.callback_query.data
    if isinstance(event, CallbackQuery):
        return event.data
    return None


def _text(event: TelegramObject) -> str | None:
    if isinstance(event, Update) and event.message:
        return event.message.text
    if isinstance(event, Message):
        return event.text
    return None


class DedupMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        update_id = getattr(event, "update_id", None)
        if isinstance(event, Update):
            update_id = event.update_id
        if isinstance(update_id, int):
            if not _remember(update_id):
                return None
            fresh = await api_client.claim_update(update_id)
            sensitive = is_sensitive_update(_callback_data(event), _text(event))
            if fresh is False or (fresh is None and sensitive):
                if fresh is None and isinstance(event, Update) and event.callback_query:
                    try:
                        code = event.callback_query.from_user.language_code if event.callback_query.from_user else "uz"
                        lang = "en" if (code or "").startswith("en") else "uz"
                        await event.callback_query.answer(t(lang, "temporary_error"), show_alert=True)
                    except Exception:
                        pass
                return None
        return await handler(event, data)


class AuthMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = None
        bot_access = {"isPrimaryOwner": False, "permissions": [], "active": False}
        contact = None
        backend_error = False
        from_user = getattr(event, "from_user", None)
        if isinstance(event, (Message, CallbackQuery)) and from_user:
            telegram_user_id = str(from_user.id)
            try:
                payload = await api_client.get_user(telegram_user_id)
            except Exception:
                payload = None
                backend_error = True
            if payload:
                user = payload.get("user")
                bot_access = payload.get("botAccess") or bot_access
                contact = payload.get("contact")
            # Avoid an extra database write for every command and button-like
            # message. Only refresh contact metadata when absent, changed, or
            # when /start explicitly reactivates the bot relationship.
            if isinstance(event, Message) and event.chat and not backend_error:
                is_start = bool(event.text and event.text.split(maxsplit=1)[0].split("@")[0] == "/start")
                now = monotonic()
                last_sync = _CONTACT_SYNCED_AT.get(telegram_user_id)
                needs_sync = (
                    is_start or contact is None or last_sync is None
                    or now - last_sync >= _CONTACT_SYNC_INTERVAL
                    or str(contact.get("chatId") or "") != str(event.chat.id)
                    or (contact.get("username") or None) != (from_user.username or None)
                    or (contact.get("firstName") or None) != (from_user.first_name or None)
                    or (contact.get("lastName") or None) != (from_user.last_name or None)
                    or (contact.get("languageCode") or None) != (from_user.language_code or None)
                )
                if needs_sync:
                    try:
                        await api_client.sync_contact(
                            {
                                "telegramUserId": telegram_user_id,
                                "chatId": str(event.chat.id),
                                "username": from_user.username,
                                "firstName": from_user.first_name,
                                "lastName": from_user.last_name,
                                "languageCode": from_user.language_code,
                                "restarted": is_start,
                            }
                        )
                        _CONTACT_SYNCED_AT[telegram_user_id] = now
                        _CONTACT_SYNCED_AT.move_to_end(telegram_user_id)
                        while len(_CONTACT_SYNCED_AT) > 5000:
                            _CONTACT_SYNCED_AT.popitem(last=False)
                    except Exception:
                        pass
        data["db_user"] = user
        data["bot_access"] = bot_access
        data["contact"] = contact
        data["backend_error"] = backend_error
        return await handler(event, data)


def allows(bot_access: dict | None, permission: str) -> bool:
    if not bot_access or bot_access.get("backendError"):
        return False
    if bot_access.get("isPrimaryOwner"):
        return True
    return permission in (bot_access.get("permissions") or [])


def denial_key(bot_access: dict | None, backend_error: bool, permission: str | None = None) -> str | None:
    if backend_error:
        return "temporary_error"
    if permission and not allows(bot_access, permission):
        return "no_permission"
    return None
