from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from typing import Any, Final

EMAIL_RE: Final[re.Pattern[str]] = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)
PHONE_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\+?\d[\d\s().-]{7,}\d)"
)
UUID_INLINE_RE: Final[re.Pattern[str]] = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
TELEGRAM_HANDLE_RE: Final[re.Pattern[str]] = re.compile(
    r"(?<![A-Za-z0-9._%+-])@[A-Za-z][A-Za-z0-9_]{3,31}\b"
)
SECRET_PATTERN_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\bsk-[A-Za-z0-9_-]{12,}\b|"
    r"\bAIza[0-9A-Za-z_-]{20,}\b|"
    r"\bBearer\s+[A-Za-z0-9._-]{16,}\b|"
    r"\bpostgres(?:ql)?://[^\s'\"]+|"
    r"\b(?:DATABASE_URL|JWT_SECRET|OPENAI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|R2_SECRET_ACCESS_KEY)\s*=\s*[^\s]+)",
    re.IGNORECASE,
)
CONTROL_CHARS_RE: Final[re.Pattern[str]] = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

ALLOWED_EXTERNAL_TASK_KEYS: Final[dict[str, frozenset[str]]] = {
    "chat": frozenset({"language", "message", "history", "knowledge", "instructions"}),
    "evaluation": frozenset({"language", "taskType", "prompt", "content", "transcript", "studentAnswer", "studentSentence", "studentResponse", "instructions"}),
}

FORBIDDEN_IDENTITY_KEYS: Final[frozenset[str]] = frozenset({
    "userId",
    "user_id",
    "actorUserId",
    "email",
    "phone",
    "telegramId",
    "googleSub",
    "passwordHash",
    "sessionToken",
    "apiKey",
    "secret",
})


def contains_secret_material(value: str) -> bool:
    return bool(SECRET_PATTERN_RE.search(value or ""))


def redact_external_text(value: str, max_chars: int = 4000) -> str:
    if not isinstance(value, str):
        return ""
    normalized = unicodedata.normalize("NFC", value)
    cleaned = CONTROL_CHARS_RE.sub(" ", normalized)
    cleaned = SECRET_PATTERN_RE.sub("[redacted-secret]", cleaned)
    cleaned = EMAIL_RE.sub("[redacted-email]", cleaned)
    cleaned = PHONE_RE.sub("[redacted-phone]", cleaned)
    cleaned = UUID_INLINE_RE.sub("[redacted-id]", cleaned)
    cleaned = TELEGRAM_HANDLE_RE.sub("[redacted-handle]", cleaned)
    return cleaned[:max_chars]


@dataclass(frozen=True)
class OutboundGuardResult:
    ok: bool
    payload: dict[str, Any] | None
    reason: str | None = None


def guard_external_payload(task: str, payload: Any) -> OutboundGuardResult:
    if task not in ALLOWED_EXTERNAL_TASK_KEYS or not isinstance(payload, dict):
        return OutboundGuardResult(ok=False, payload=None, reason="invalid_task_or_payload")
    allowed_keys = ALLOWED_EXTERNAL_TASK_KEYS[task]
    for key in payload.keys():
        if key in FORBIDDEN_IDENTITY_KEYS or key not in allowed_keys:
            return OutboundGuardResult(ok=False, payload=None, reason=f"forbidden_external_field:{key}")

    sanitized: dict[str, Any] = {}
    for key, val in payload.items():
        if isinstance(val, str):
            if contains_secret_material(val):
                return OutboundGuardResult(ok=False, payload=None, reason="secret_material_detected")
            sanitized[key] = redact_external_text(val, 20000 if key in ("content", "instructions") else 4000)
        elif key == "history" and isinstance(val, list):
            history_items = []
            for item in val[:12]:
                if not isinstance(item, dict) or set(item.keys()) - {"role", "content"}:
                    return OutboundGuardResult(ok=False, payload=None, reason="invalid_history_item")
                role = item.get("role")
                content = item.get("content")
                if role not in ("user", "assistant") or not isinstance(content, str):
                    return OutboundGuardResult(ok=False, payload=None, reason="invalid_history_item")
                if contains_secret_material(content):
                    return OutboundGuardResult(ok=False, payload=None, reason="secret_material_detected")
                history_items.append({"role": role, "content": redact_external_text(content, 2000)})
            sanitized[key] = history_items
        elif key == "knowledge" and isinstance(val, list):
            knowledge_items = []
            for item in val[:5]:
                if not isinstance(item, dict) or set(item.keys()) - {"ref", "text", "authority", "version"}:
                    return OutboundGuardResult(ok=False, payload=None, reason="invalid_knowledge_item")
                text_val = item.get("text")
                if not isinstance(text_val, str) or contains_secret_material(text_val):
                    return OutboundGuardResult(ok=False, payload=None, reason="invalid_knowledge_item")
                knowledge_items.append({
                    "ref": str(item.get("ref") or "K1")[:8],
                    "text": redact_external_text(text_val, 4000),
                    "authority": int(item.get("authority") or 0),
                    "version": int(item.get("version") or 1),
                })
            sanitized[key] = knowledge_items
        else:
            sanitized[key] = val
    return OutboundGuardResult(ok=True, payload=sanitized, reason=None)
