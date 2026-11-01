from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

Role = Literal["student", "teacher", "admin", "owner"]
AccountStatus = Literal["pending", "active", "rejected", "suspended"]

RIWI_CAPABILITIES: Final[tuple[str, ...]] = (
    "riwi.chat.self",
    "riwi.dictionary.lookup",
    "riwi.grammar.explain",
    "riwi.vocabulary.explain",
    "riwi.writing.evaluate",
    "riwi.speaking.evaluate",
    "riwi.reading.explain",
    "riwi.listening.explain",
    "riwi.progress.read_self",
    "riwi.progress.read_assigned_student",
    "riwi.report.read_self",
    "riwi.report.read_assigned_roster",
    "riwi.report.read_admin_scope",
    "riwi.report.read_centre",
    "riwi.knowledge.read_approved",
    "riwi.knowledge.submit_candidate",
    "riwi.knowledge.review",
    "riwi.knowledge.approve",
    "riwi.knowledge.promote",
    "riwi.provider.read_status",
    "riwi.provider.configure",
    "riwi.provider.live_test",
    "riwi.audit.read_all",
    "riwi.feedback.student",
    "riwi.feedback.teacher",
)

ROLE_CAPABILITIES: Final[dict[str, tuple[str, ...]]] = {
    "student": (
        "riwi.chat.self",
        "riwi.dictionary.lookup",
        "riwi.grammar.explain",
        "riwi.vocabulary.explain",
        "riwi.writing.evaluate",
        "riwi.speaking.evaluate",
        "riwi.reading.explain",
        "riwi.listening.explain",
        "riwi.progress.read_self",
        "riwi.report.read_self",
        "riwi.knowledge.read_approved",
        "riwi.knowledge.submit_candidate",
        "riwi.feedback.student",
    ),
    "teacher": (
        "riwi.chat.self",
        "riwi.dictionary.lookup",
        "riwi.grammar.explain",
        "riwi.vocabulary.explain",
        "riwi.reading.explain",
        "riwi.listening.explain",
        "riwi.progress.read_assigned_student",
        "riwi.report.read_assigned_roster",
        "riwi.knowledge.read_approved",
        "riwi.knowledge.submit_candidate",
        "riwi.feedback.teacher",
    ),
    "admin": (
        "riwi.chat.self",
        "riwi.dictionary.lookup",
        "riwi.grammar.explain",
        "riwi.vocabulary.explain",
        "riwi.report.read_admin_scope",
        "riwi.knowledge.read_approved",
    ),
    "owner": RIWI_CAPABILITIES,
}


@dataclass(frozen=True)
class RiwiActor:
    id: str
    role: str
    account_status: str = "active"
    locale: str = "uz"

    @property
    def accountStatus(self) -> str:
        return self.account_status


@dataclass(frozen=True)
class CapabilityDecision:
    allowed: bool
    reason: Literal["allowed", "actor_not_active", "unknown_capability", "role_denied"]


def is_riwi_capability(value: str) -> bool:
    return isinstance(value, str) and value in RIWI_CAPABILITIES


def authorize_capability(actor: RiwiActor | dict[str, str] | None, capability: str) -> CapabilityDecision:
    if actor is None:
        return CapabilityDecision(allowed=False, reason="actor_not_active")
    if isinstance(actor, dict):
        role = str(actor.get("role") or "")
        status = str(actor.get("accountStatus") or actor.get("account_status") or "")
        actor_id = str(actor.get("id") or "")
    else:
        role = actor.role
        status = actor.account_status
        actor_id = actor.id

    if not actor_id or status != "active":
        return CapabilityDecision(allowed=False, reason="actor_not_active")
    if not is_riwi_capability(capability):
        return CapabilityDecision(allowed=False, reason="unknown_capability")
    allowed_for_role = ROLE_CAPABILITIES.get(role, ())
    if capability not in allowed_for_role:
        return CapabilityDecision(allowed=False, reason="role_denied")
    return CapabilityDecision(allowed=True, reason="allowed")
