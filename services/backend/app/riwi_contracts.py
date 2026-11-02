from __future__ import annotations

from dataclasses import dataclass
import os
import re
from typing import Any, Final, Literal

RIWI_CONVERSATION_TTL_DAYS: Final[int] = 30
RIWI_INACTIVE_OFFLINE_DAYS: Final[int] = 7
RIWI_OFFLINE_DELETE_DAY: Final[int] = 8
RIWI_MAX_MESSAGE_CHARS: Final[int] = 4000
RIWI_MAX_ANSWER_CHARS: Final[int] = 6000
RIWI_TARGET_CURSOR_MAX_LENGTH: Final[int] = 512

RIWI_PROVENANCE: Final[tuple[str, ...]] = (
    "canonical_dictionary",
    "canonical_grammar",
    "approved_knowledge",
    "deterministic_learning_data",
    "deterministic_report",
    "external_provider",
    "policy_refusal",
    "unavailable",
)

RIWI_INTENTS: Final[tuple[str, ...]] = (
    "dictionary_lookup",
    "grammar_help",
    "progress_self",
    "report_self",
    "evaluate_submission",
    "knowledge_candidate",
    "provider_admin",
    "general_learning_question",
)

UUID_RE: Final[re.Pattern[str]] = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

PROMPT_INJECTION_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:ignore|disregard|forget|bypass|override)\s+(?:all\s+)?(?:previous|prior|system|developer|safety|security)\s+(?:instructions?|rules?|prompts?)\b|"
    r"\b(?:system\s+prompt|developer\s+prompt|hidden\s+instructions?)\b|"
    r"(?:oldingi|avvalgi|tizim)\s+(?:ko'rsatmalarni|qoidalarni)\s+(?:inobatga\s+olmang|unut|chetlab\s+o't))",
    re.IGNORECASE,
)

SECRET_EXTRACTION_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:reveal|show|print|dump|leak|output|read)\b.{0,50}\b(?:api[_ -]?key|secret|password|database_url|jwt_secret|env|environment\s+variables?|private\s+key|credentials?)\b|"
    r"\b(?:process\.env|os\.environ|/etc/passwd|\.env)\b|"
    r"(?:maxfiy\s+kalit|parol|api\s+kalit).{0,40}(?:ko'rsat|oshkor\s+qil|chiqar))",
    re.IGNORECASE,
)

ROLE_SPOOF_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:i\s+am\s+(?:the\s+)?owner|act\s+as\s+owner|grant\s+me\s+owner|elevate\s+my\s+role|switch\s+role\s+to\s+owner)\b|"
    r"\b(?:sudo\s+owner|role\s*[:=]\s*['\"]?owner)\b)",
    re.IGNORECASE,
)

TOOL_INJECTION_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:call|invoke|execute|run)\s+tool\b|\b(?:drop\s+table|delete\s+from\s+users|select\s+\*\s+from\s+users|pg_sleep)\b)",
    re.IGNORECASE,
)

SSRF_INJECTION_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:https?://(?:127\.0\.0\.1|localhost|169\.254\.169\.254|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)|file:///|gopher://)",
    re.IGNORECASE,
)

DICTIONARY_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:what\s+does\s+['\"]?[\w-]+['\"]?\s+mean|define\s+['\"]?[\w-]+['\"]?|meaning\s+of\s+['\"]?[\w-]+['\"]?|dictionary\s+lookup)\b|"
    r"\b[\w-]+\s+so'zining\s+ma'nosi\b|\bso'zini\s+izohla\b|\blug'at(?:dan)?\b)",
    re.IGNORECASE,
)

REPORT_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:report|cohort\s+report|roster\s+report|centre\s+report|personal\s+report|show\s+my\s+report)\b|"
    r"\b(?:hisobot|hisobotimni|hisobotni|guruh\s+hisoboti|markaz\s+hisoboti)\b)",
    re.IGNORECASE,
)

PROGRESS_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:how\s+am\s+i\s+doing|my\s+progress|learner'?s\s+progress|student'?s\s+progress|weaknesses|my\s+weaknesses)\b|"
    r"\b(?:rivojlanishim|rivojlanishi|natijalarim|zaif\s+tomonlarim)\b)",
    re.IGNORECASE,
)

GRAMMAR_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:grammar|tense|present\s+perfect|past\s+simple|articles?\b|conditionals?|passive\s+voice|modal\s+verbs?|relative\s+clauses?)\b|"
    r"\b(?:grammatika|artikllar|zamonlar|qoidasini\s+tushuntir)\b)",
    re.IGNORECASE,
)

EVALUATE_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:evaluate\s+my\s+(?:essay|writing|speaking)|grade\s+my\s+essay|score\s+my\s+task)\b|"
    r"\b(?:inshoimni\s+bahola|yozganimni\s+tekshir)\b)",
    re.IGNORECASE,
)

PROVIDER_ADMIN_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\b(?:provider\s+lab|configure\s+provider|switch\s+ai\s+provider|enable\s+openai|enable\s+gemini)\b|"
    r"\b(?:provayderni\s+sozla|tashqi\s+ai\s+yoq)\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class IntentAssessment:
    intent: str
    is_adversarial: bool
    attack_type: str | None
    extracted_term: str | None = None


def _extract_dictionary_term(message: str) -> str | None:
    text = message.strip()
    patterns = (
        r"what\s+does\s+['\"]?([A-Za-z][A-Za-z -]{1,58})['\"]?\s+mean",
        r"define\s+['\"]?([A-Za-z][A-Za-z -]{1,58})['\"]?",
        r"meaning\s+of\s+['\"]?([A-Za-z][A-Za-z -]{1,58})['\"]?",
        r"['\"]?([A-Za-z][A-Za-z -]{1,58})['\"]?\s+so'zining\s+ma'nosi",
        r"['\"]?([A-Za-z][A-Za-z -]{1,58})['\"]?\s+so'zini\s+izohla",
    )
    for pat in patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip(" '\",.?!:;").lower()
            if 1 <= len(candidate) <= 60:
                return candidate
    return None


def assess_riwi_intent(message: str) -> IntentAssessment:
    normalized = (message or "").strip()
    if SECRET_EXTRACTION_RE.search(normalized):
        return IntentAssessment(intent="general_learning_question", is_adversarial=True, attack_type="secret_extraction")
    if SSRF_INJECTION_RE.search(normalized):
        return IntentAssessment(intent="general_learning_question", is_adversarial=True, attack_type="ssrf")
    if ROLE_SPOOF_RE.search(normalized):
        return IntentAssessment(intent="general_learning_question", is_adversarial=True, attack_type="role_spoof")
    if TOOL_INJECTION_RE.search(normalized):
        return IntentAssessment(intent="general_learning_question", is_adversarial=True, attack_type="tool_injection")
    if PROMPT_INJECTION_RE.search(normalized):
        return IntentAssessment(intent="general_learning_question", is_adversarial=True, attack_type="prompt_injection")

    if DICTIONARY_RE.search(normalized):
        return IntentAssessment(
            intent="dictionary_lookup",
            is_adversarial=False,
            attack_type=None,
            extracted_term=_extract_dictionary_term(normalized),
        )
    if REPORT_RE.search(normalized):
        return IntentAssessment(intent="report_self", is_adversarial=False, attack_type=None)
    if PROGRESS_RE.search(normalized):
        return IntentAssessment(intent="progress_self", is_adversarial=False, attack_type=None)
    if EVALUATE_RE.search(normalized):
        return IntentAssessment(intent="evaluate_submission", is_adversarial=False, attack_type=None)
    if PROVIDER_ADMIN_RE.search(normalized):
        return IntentAssessment(intent="provider_admin", is_adversarial=False, attack_type=None)
    if GRAMMAR_RE.search(normalized):
        return IntentAssessment(intent="grammar_help", is_adversarial=False, attack_type=None)
    return IntentAssessment(intent="general_learning_question", is_adversarial=False, attack_type=None)


def riwi_presentation_locale(cookie_locale: str | None = None, user_locale: str | None = None) -> Literal["uz", "en"]:
    for candidate in (cookie_locale, user_locale):
        if isinstance(candidate, str) and candidate.strip().lower() in ("en", "uz"):
            return "en" if candidate.strip().lower() == "en" else "uz"
    return "uz"


class RiwiContractError(ValueError):
    def __init__(self, code: str = "invalid_input") -> None:
        super().__init__(code)
        self.code = code


FORBIDDEN_REQUEST_KEYS: Final[frozenset[str]] = frozenset({
    "role",
    "userId",
    "user_id",
    "actorId",
    "actor_id",
    "accountStatus",
    "account_status",
    "systemPrompt",
    "system_prompt",
    "developerPrompt",
    "promptOverride",
    "providerKey",
    "apiKey",
    "toolCall",
    "sql",
    "answerKey",
})


def validate_riwi_chat_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RiwiContractError("invalid_input")
    allowed_keys = {"message", "conversationId", "targetUserId", "occurrenceId", "topicId", "lessonId", "attemptId", "replyLocale", "material"}
    extra_keys = set(payload.keys()) - allowed_keys
    if extra_keys & FORBIDDEN_REQUEST_KEYS:
        raise RiwiContractError("forbidden_override_field")
    if extra_keys:
        raise RiwiContractError("invalid_input")

    message = payload.get("message")
    if not isinstance(message, str):
        raise RiwiContractError("invalid_input")
    trimmed = message.strip()
    if not trimmed or len(trimmed) > RIWI_MAX_MESSAGE_CHARS:
        raise RiwiContractError("invalid_input")

    result: dict[str, Any] = {"message": trimmed}
    if 'material' in payload:
        from .riwi_materials import validate_reference
        try: result['material'] = validate_reference(payload['material'])
        except ValueError as exc: raise RiwiContractError('invalid_material_reference') from exc
        if any(payload.get(k) is not None for k in ('targetUserId','occurrenceId','topicId','lessonId','attemptId')):
            raise RiwiContractError('ambiguous_learning_context')
    if 'replyLocale' in payload:
        if payload['replyLocale'] not in ('uz', 'en'):
            raise RiwiContractError("invalid_input")
        result['replyLocale'] = payload['replyLocale']
    for uuid_field in ("conversationId", "targetUserId", "occurrenceId", "topicId", "lessonId", "attemptId"):
        val = payload.get(uuid_field)
        if val is not None:
            if not isinstance(val, str) or not UUID_RE.match(val):
                raise RiwiContractError("invalid_input")
            result[uuid_field] = val.lower()
    return result
