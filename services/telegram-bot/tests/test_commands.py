import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import AsyncMock

from aiogram.types import MenuButtonCommands

from commands import command_set, install_commands


def test_command_sets_preserve_uz_and_en():
    en = command_set("en")
    assert [c.command for c in en] == [
        "start",
        "menu",
        "help",
        "support",
        "status",
        "settings",
        "cancel",
    ]
    uz = command_set("uz")
    assert [c.command for c in uz] == [c.command for c in en]
    assert [c.description for c in uz] != [c.description for c in en]


async def test_install_commands_registers_commands_and_native_menu_button():
    bot = AsyncMock()
    await install_commands(bot)

    languages = [call.kwargs.get("language_code") for call in bot.set_my_commands.await_args_list]
    assert languages == [None, "uz", "en"]

    menu_button = bot.set_chat_menu_button.await_args.kwargs["menu_button"]
    assert isinstance(menu_button, MenuButtonCommands)
