import asyncio
import logging
from aiogram import Bot, Dispatcher
from config import config
from middlewares.auth import AuthMiddleware
from handlers.auth import auth_router
from handlers.admission import admission_router

logging.basicConfig(level=logging.INFO)

async def main():
    bot = Bot(token=config.TELEGRAM_BOT_TOKEN.get_secret_value())
    dp = Dispatcher()

    # Register middlewares
    dp.update.outer_middleware(AuthMiddleware())

    # Register routers
    dp.include_router(auth_router)
    dp.include_router(admission_router)

    logging.info("Starting bot...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
