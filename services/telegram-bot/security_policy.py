"""Pure checks the bot can unit-test without Telegram or the website."""

import re

WEBHOOK_SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{1,256}$")
OWNER_ID_RE = re.compile(r"^[0-9]{1,20}$")

SENSITIVE_CALLBACK_PREFIXES = (
    "m:login",
    "lang:",
    "decide_",
    "auth:retry_channels",
    "ust:",
    "dmok",
    "bcok",
    "bctest",
    "dmc:",
    "bcc:",
    "src:",
    "adm",
    "srep:",
    "sact:",
    "apt:",
    "aps:",
    "set:",
    "df:",
    "wta:",
    "wtr:",
    "bhc:",
    "bha:",
    "bhr:",
)


def webhook_secret_problem(secret: str | None) -> str | None:
    if not secret:
        return "WEBHOOK_SECRET is required in webhook mode"
    if not WEBHOOK_SECRET_RE.fullmatch(secret):
        return "WEBHOOK_SECRET format is invalid"
    return None


def owner_id_problem(value: str | None) -> str | None:
    if value is None or value == "":
        return "TELEGRAM_OWNER_ID is required in webhook mode"
    if not OWNER_ID_RE.fullmatch(value):
        return "TELEGRAM_OWNER_ID format is invalid"
    return None


def is_sensitive_update(callback_data: str | None, text: str | None) -> bool:
    if text and text.startswith("/start "):
        return True
    if not callback_data:
        return False
    if callback_data in {"dmok", "bcok", "bctest"}:
        return True
    return callback_data.startswith(SENSITIVE_CALLBACK_PREFIXES)
