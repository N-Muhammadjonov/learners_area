from aiogram import Bot
from aiogram.types import BotCommand, MenuButtonCommands


def command_set(language: str) -> list[BotCommand]:
    if language == "en":
        return [
            BotCommand(command="start", description="Start the bot"),
            BotCommand(command="admin", description="Contact admin"),
            BotCommand(command="lang", description="Choose language"),
        ]
    return [
        BotCommand(command="start", description="Botni boshlash"),
        BotCommand(command="admin", description="Admin bilan bog'lanish"),
        BotCommand(command="lang", description="Tilni tanlash"),
    ]


async def install_commands(bot: Bot) -> None:
    await bot.set_my_commands(command_set("en"))
    await bot.set_my_commands(command_set("uz"), language_code="uz")
    await bot.set_my_commands(command_set("en"), language_code="en")
    # Native persistent menu button (left of the input field) that opens the
    # command list. Must be MenuButtonCommands, not a Web App / reply keyboard.
    await bot.set_chat_menu_button(menu_button=MenuButtonCommands())
