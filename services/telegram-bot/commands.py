from aiogram import Bot
from aiogram.types import BotCommand, MenuButtonCommands


def command_set(language: str) -> list[BotCommand]:
    if language == "en":
        return [
            BotCommand(command="start", description="🚀 Start the bot"),
            BotCommand(command="menu", description="🏠 Main menu"),
            BotCommand(command="help", description="❓ Commands and help"),
            BotCommand(command="support", description="💬 Support"),
            BotCommand(command="status", description="📊 Account status"),
            BotCommand(command="settings", description="⚙️ Settings"),
            BotCommand(command="cancel", description="❌ Cancel"),
        ]
    return [
        BotCommand(command="start", description="🚀 Botni boshlash"),
        BotCommand(command="menu", description="🏠 Asosiy menyu"),
        BotCommand(command="help", description="❓ Buyruqlar va yordam"),
        BotCommand(command="support", description="💬 Yordam"),
        BotCommand(command="status", description="📊 Hisob holati"),
        BotCommand(command="settings", description="⚙️ Sozlamalar"),
        BotCommand(command="cancel", description="❌ Bekor qilish"),
    ]


async def install_commands(bot: Bot) -> None:
    await bot.set_my_commands(command_set("en"))
    await bot.set_my_commands(command_set("uz"), language_code="uz")
    await bot.set_my_commands(command_set("en"), language_code="en")
    # Native persistent menu button (left of the input field) that opens the
    # command list. Must be MenuButtonCommands, not a Web App / reply keyboard.
    await bot.set_chat_menu_button(menu_button=MenuButtonCommands())
