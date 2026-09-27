from aiogram import Bot
from aiogram.types import BotCommand


def command_set(language: str) -> list[BotCommand]:
    if language == "en":
        return [
            BotCommand(command="start", description="Open the menu"),
            BotCommand(command="menu", description="Main menu"),
            BotCommand(command="help", description="Help"),
            BotCommand(command="support", description="Support"),
            BotCommand(command="status", description="Account status"),
            BotCommand(command="settings", description="Settings"),
            BotCommand(command="cancel", description="Cancel"),
        ]
    return [
        BotCommand(command="start", description="Menyuni ochish"),
        BotCommand(command="menu", description="Asosiy menyu"),
        BotCommand(command="help", description="Yordam"),
        BotCommand(command="support", description="Qo'llab-quvvatlash"),
        BotCommand(command="status", description="Hisob holati"),
        BotCommand(command="settings", description="Sozlamalar"),
        BotCommand(command="cancel", description="Bekor qilish"),
    ]


async def install_commands(bot: Bot) -> None:
    await bot.set_my_commands(command_set("en"))
    await bot.set_my_commands(command_set("uz"), language_code="uz")
    await bot.set_my_commands(command_set("en"), language_code="en")
