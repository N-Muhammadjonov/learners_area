import asyncio
import logging
import signal
from contextlib import suppress

from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application

from commands import install_commands
from config import config
from html_text import esc as _esc
from handlers.admission import admission_router
from handlers.channels import channels_router
from handlers.auth import auth_router
from handlers.menu import menu_router
from handlers.owner import owner_router
from handlers.panel import panel_router
from handlers.support import support_router
from middlewares.auth import AuthMiddleware, DedupMiddleware
from owner_callbacks import notice_button_specs
from services.api_client import api_client

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logging.getLogger("aiogram").setLevel(logging.WARNING)
logging.getLogger("aiogram.event").setLevel(logging.WARNING)
log = logging.getLogger("learners-bot")

ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"]


def _notice_markup(notice: dict) -> InlineKeyboardMarkup | None:
    specs = notice_button_specs(notice.get("type"), notice.get("correlationId"))
    if not specs:
        return None
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=label, callback_data=data) for label, data in specs]]
    )


def build_dispatcher() -> Dispatcher:
    # Chat compose state may live in memory. Outbound confirms do not: they are
    # server drafts bound to the actor, target and expiry.
    dp = Dispatcher(storage=MemoryStorage())
    dp.update.outer_middleware(DedupMiddleware())
    dp.message.outer_middleware(AuthMiddleware())
    dp.callback_query.outer_middleware(AuthMiddleware())
    dp.include_router(auth_router)
    dp.include_router(owner_router)
    dp.include_router(channels_router)
    dp.include_router(menu_router)
    dp.include_router(admission_router)
    dp.include_router(support_router)
    dp.include_router(panel_router)
    return dp


async def _delivery_loop(bot: Bot, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            deliveries = await api_client.claim_broadcasts()
            results = []
            for item in deliveries:
                try:
                    sent = await bot.send_message(int(item["chatId"]), _esc(item.get("text") or ""))
                    results.append({"deliveryId": item["deliveryId"], "status": "sent", "telegramMessageId": str(sent.message_id)})
                except Exception as exc:
                    text = str(exc).lower()
                    retry = getattr(exc, "retry_after", None)
                    blocked = "blocked" in text or "chat not found" in text or "user is deactivated" in text
                    results.append({
                        "deliveryId": item["deliveryId"],
                        "status": "blocked" if blocked else "failed",
                        "error": "delivery_failed",
                        "retryAfterSeconds": retry,
                    })
            if results:
                await api_client.report_broadcasts(results)
            notices = await api_client.claim_notices()
            notice_results = []
            for notice in notices:
                if notice.get("unavailable") or not notice.get("chatId"):
                    notice_results.append({"id": notice["id"], "status": "blocked", "error": "unavailable"})
                    continue
                try:
                    body = notice.get("body") or ""
                    markup = _notice_markup(notice)
                    await bot.send_message(
                        int(notice["chatId"]),
                        f"{_esc(notice.get('title'))}\n{_esc(body)}".strip(),
                        reply_markup=markup,
                    )
                    notice_results.append({"id": notice["id"], "status": "sent"})
                except Exception as exc:
                    blocked = "blocked" in str(exc).lower()
                    notice_results.append({"id": notice["id"], "status": "blocked" if blocked else "failed", "error": "delivery_failed"})
            if notice_results:
                await api_client.report_notices(notice_results)
        except Exception:
            log.warning("delivery loop failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=3)
        except TimeoutError:
            continue


def health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "service": "learners-area-telegram-bot"})


async def ready(_request: web.Request) -> web.Response:
    try:
        ok = await api_client.ready()
    except Exception:
        ok = False
    if not ok:
        return web.json_response({"ok": False}, status=503)
    return web.json_response({"ok": True})


async def _install_webhook(bot: Bot) -> None:
    secret = config.WEBHOOK_SECRET.get_secret_value() if config.WEBHOOK_SECRET else None
    await bot.set_webhook(
        url=f"{config.WEBHOOK_BASE_URL.rstrip('/')}{config.WEBHOOK_PATH}",
        secret_token=secret,
        allowed_updates=ALLOWED_UPDATES,
        drop_pending_updates=False,
    )


async def main() -> None:
    config.validate_startup()
    bot = Bot(token=config.TELEGRAM_BOT_TOKEN.get_secret_value(), default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = build_dispatcher()
    stop = asyncio.Event()
    worker: asyncio.Task | None = None
    runner: web.AppRunner | None = None
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
    try:
        if config.BOT_MODE == "webhook":
            await _install_webhook(bot)
        await install_commands(bot)
        worker = asyncio.create_task(_delivery_loop(bot, stop))
        app = web.Application()
        app.router.add_get("/health", health)
        app.router.add_get("/ready", ready)
        if config.BOT_MODE == "webhook":
            secret = config.WEBHOOK_SECRET.get_secret_value() if config.WEBHOOK_SECRET else None
            SimpleRequestHandler(dispatcher=dp, bot=bot, secret_token=secret).register(app, path=config.WEBHOOK_PATH)
            setup_application(app, dp, bot=bot)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, config.HOST, config.PORT).start()
        log.info("listening")
        if config.BOT_MODE == "webhook":
            await stop.wait()
        else:
            await dp.start_polling(bot, allowed_updates=ALLOWED_UPDATES)
    finally:
        stop.set()
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
        if runner:
            await runner.cleanup()
        await api_client.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
