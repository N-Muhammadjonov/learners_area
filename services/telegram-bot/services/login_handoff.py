"""Short-lived website links for private Telegram menus."""

import re
from urllib.parse import urlsplit

from config import config
from services.api_client import api_client


async def website_link(telegram_user_id: str) -> tuple[str | None, str | None]:
    try:
        status, payload = await api_client.create_login_handoff(telegram_user_id)
    except Exception:
        return None, "temporary_error"

    data = payload if isinstance(payload, dict) else {}
    if status != 200 or data.get("ok") is not True:
        error = {
            "phone_required": "phone_required",
            "not_subscribed": "channels_required",
            "no_linked_account": "status_none",
            "account_unavailable": "handoff_unavailable",
        }.get(data.get("error"), "temporary_error" if status >= 500 else "handoff_unavailable")
        return None, error
    if data.get("purpose") == "register":
        return None, "status_none"

    intent_id, nonce = data.get("intentId"), data.get("browserNonce")
    if (data.get("purpose") != "login"
            or not isinstance(intent_id, str)
            or not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", intent_id)
            or not isinstance(nonce, str)
            or not re.fullmatch(r"[0-9a-f]{64}", nonce)):
        return None, "temporary_error"

    try:
        site = urlsplit(config.PUBLIC_SITE_URL)
        if (site.scheme != "https" or not site.hostname or site.username or site.password
                or site.path not in ("", "/") or site.query or site.fragment):
            return None, "temporary_error"
    except ValueError:
        return None, "temporary_error"
    return f"https://{site.netloc}/login#tg-handoff={intent_id}.{nonce}", None
