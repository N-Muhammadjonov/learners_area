from typing import Callable, Dict, Any, Awaitable
from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery, TelegramObject
from services.api_client import api_client

class AuthMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any]
    ) -> Any:
        
        user = None
        if isinstance(event, (Message, CallbackQuery)) and event.from_user:
            telegram_user_id = str(event.from_user.id)
            try:
                user = await api_client.get_user(telegram_user_id)
            except Exception as e:
                # Log error and continue without user
                pass
        
        data["db_user"] = user
        return await handler(event, data)
