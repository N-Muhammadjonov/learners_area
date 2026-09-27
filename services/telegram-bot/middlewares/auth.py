from collections import OrderedDict
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject, Update

from services.api_client import api_client

_SEEN: OrderedDict[int, None] = OrderedDict()


def _remember(update_id: int) -> bool:
    if update_id in _SEEN:
        return False
    _SEEN[update_id] = None
    if len(_SEEN) > 5000:
        _SEEN.popitem(last=False)
    return True


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
            if fresh is False:
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
        from_user = getattr(event, "from_user", None)
        if isinstance(event, (Message, CallbackQuery)) and from_user:
            telegram_user_id = str(from_user.id)
            try:
                payload = await api_client.get_user(telegram_user_id)
            except Exception:
                payload = None
            if payload:
                user = payload.get("user")
                bot_access = payload.get("botAccess") or bot_access
                contact = payload.get("contact")
            if isinstance(event, Message) and event.chat:
                try:
                    await api_client.sync_contact(
                        {
                            "telegramUserId": telegram_user_id,
                            "chatId": str(event.chat.id),
                            "username": from_user.username,
                            "firstName": from_user.first_name,
                            "lastName": from_user.last_name,
                            "languageCode": from_user.language_code,
                            "restarted": bool(event.text and event.text.startswith("/start")),
                        }
                    )
                except Exception:
                    pass
        data["db_user"] = user
        data["bot_access"] = bot_access
        data["contact"] = contact
        return await handler(event, data)


def allows(bot_access: dict | None, permission: str) -> bool:
    if not bot_access:
        return False
    if bot_access.get("isPrimaryOwner"):
        return True
    return permission in (bot_access.get("permissions") or [])
