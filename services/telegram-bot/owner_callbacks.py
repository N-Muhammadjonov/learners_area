"""Opaque owner-handover callbacks. No password, token, or username is accepted."""

import re

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
PREFIXES = {"wta", "wtr", "bhc", "bha", "bhr"}
NOTICE_BUTTONS = {
    "website.owner_transfer": (("✅ Approve", "wta"), ("❌ Reject", "wtr")),
    "telegram.owner_handover_current": (("✅ Confirm", "bhc"), ("❌ Reject", "bhr")),
    "telegram.owner_handover_target": (("✅ Accept", "bha"), ("❌ Reject", "bhr")),
}


def opaque_callback(prefix: str, correlation_id: str | None) -> str | None:
    if prefix not in PREFIXES or not correlation_id or not UUID_RE.fullmatch(correlation_id):
        return None
    data = f"{prefix}:{correlation_id}"
    if len(data.encode()) > 64:
        return None
    return data


def notice_button_specs(notice_type: str | None, correlation_id: str | None) -> list[tuple[str, str]]:
    buttons = NOTICE_BUTTONS.get(notice_type or "")
    if not buttons:
        return []
    specs = []
    for label, prefix in buttons:
        data = opaque_callback(prefix, correlation_id)
        if data:
            specs.append((label, data))
    return specs


def numeric_target(value: str | None) -> str | None:
    text = (value or "").strip()
    if text.startswith("@") or not text.isdigit() or len(text) > 20:
        return None
    return text
