from i18n import t


def admission_text(lang: str, raw: object) -> str:
    status = raw.get("status") if isinstance(raw, dict) else "pending"
    key = {
        "pending": "apply_ok",
        "reopened": "apply_reopened",
        "already_pending": "apply_pending",
        "already_active": "apply_active",
        "suspended": "apply_suspended",
    }.get(str(status), "error")
    return t(lang, key)


def format_stats(data: dict, lang: str = "uz") -> str:
    accounts = data.get("accounts") or {}
    contacts = data.get("contacts") or {}
    support = data.get("support") or {}
    if lang == "en":
        labels = ["Statistics", "Pending", "Active", "Rejected", "Suspended", "Contacts", "Blocked", "Removed", "Open support"]
    else:
        labels = ["Statistika", "Kutilmoqda", "Faol", "Rad etilgan", "To'xtatilgan", "Kontaktlar", "Bloklangan", "Chiqarilgan", "Ochiq yordam"]
    values = [
        accounts.get("pending", 0),
        accounts.get("active", 0),
        accounts.get("rejected", 0),
        accounts.get("suspended", 0),
        contacts.get("contacts", 0),
        contacts.get("blocked", 0),
        contacts.get("removed", 0),
        support.get("open", 0),
    ]
    return "\n".join([labels[0], *[f"{label}: {value}" for label, value in zip(labels[1:], values)]])


def format_audit(data: dict, lang: str) -> str:
    lines = [t(lang, "audit"), t(lang, "page", page=data.get("page") or 1)]
    for entry in data.get("entries") or []:
        when = entry.get("createdAt") or ""
        lines.append(f"• {entry.get('action')} · {entry.get('targetType') or '—'} · {when}")
    if len(lines) == 2:
        lines.append(t(lang, "empty"))
    return "\n".join(lines)[:3500]


def format_settings(data: dict, lang: str) -> str:
    return "\n".join([
        t(lang, "settings"),
        f"{t(lang, 'language')}: {data.get('default_locale', 'uz')}",
        f"{t(lang, 'menu_support')}: {'on' if data.get('support_enabled', True) else 'off'}",
        f"{t(lang, 'broadcast')}: {'on' if data.get('broadcasts_enabled', True) else 'off'}",
    ])
