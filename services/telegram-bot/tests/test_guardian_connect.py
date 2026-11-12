import re
from handlers.menu import main_keyboard
from commands import command_set
from guardian_i18n import GUARDIAN_STRINGS, RELATIONS
from i18n import t


def texts(markup):
    return [b.text for row in markup.inline_keyboard for b in row]


def datas(markup):
    return [b.callback_data for row in markup.inline_keyboard for b in row]


def test_student_gets_connect_button_only_when_active():
    assert "m:guardian" in datas(main_keyboard("uz", None, "student", "active"))
    assert "m:guardian" not in datas(main_keyboard("uz", None, "student", "pending"))
    assert "m:guardian" not in datas(main_keyboard("uz", None, None, None))


def test_guardian_menu_has_exactly_the_four_entries():
    kb = main_keyboard("uz", None, "guardian", "active")
    assert datas(kb) == ["m:login", "m:login", "m:support", "m:lang"]


def test_public_commands_unchanged():
    for lang in ("uz", "en"):
        assert [c.command for c in command_set(lang)] == ["start", "admin", "lang"]


def test_copy_complete_and_formattable():
    assert set(GUARDIAN_STRINGS["uz"]) == set(GUARDIAN_STRINGS["en"])
    for r in RELATIONS:
        assert t("uz", "g_rel_" + r) and t("en", "g_rel_" + r)
    assert "Ali" in t("en", "g_who", student="Ali")


def test_callback_data_fits_telegram_limit():
    link = "0" * 36
    for data in (f"gd:ok:{link}", f"gd:r:{link}:7", f"gd:c:{link}"):
        assert len(data.encode()) <= 64


def test_invite_payload_shape_never_matches_login_tokens():
    assert re.fullmatch(r"g_[0-9a-f]{24}", "g_" + "a" * 24)
    assert not re.fullmatch(r"g_[0-9a-f]{24}", "a" * 64)
