from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Mapping


@dataclass(frozen=True)
class RiwiRoleRollout:
    student: bool
    teacher: bool
    admin: bool
    owner: bool

    def enabled_for(self, role: str) -> bool:
        return bool(getattr(self, role, False))


@dataclass(frozen=True)
class RiwiRollout:
    enabled: bool
    roles: RiwiRoleRollout
    external_ai: bool
    knowledge_ingestion: bool
    provider_lab: bool

    @property
    def externalAi(self) -> bool:
        return self.external_ai

    @property
    def knowledgeIngestion(self) -> bool:
        return self.knowledge_ingestion

    @property
    def providerLab(self) -> bool:
        return self.provider_lab


def _flag_default_true(env: Mapping[str, str], name: str) -> bool:
    raw = (env.get(name) or "").strip().lower()
    if raw in ("0", "false", "off", "no"):
        return False
    return True


def _flag_default_false(env: Mapping[str, str], name: str) -> bool:
    raw = (env.get(name) or "").strip().lower()
    return raw in ("1", "true", "on", "yes")


def read_riwi_rollout(env: Mapping[str, str] | None = None) -> RiwiRollout:
    source = env if env is not None else os.environ
    master = _flag_default_true(source, "RIWI_ENABLED")
    roles = RiwiRoleRollout(
        student=master and _flag_default_true(source, "RIWI_STUDENT_ENABLED"),
        teacher=master and _flag_default_true(source, "RIWI_TEACHER_ENABLED"),
        admin=master and _flag_default_true(source, "RIWI_ADMIN_ENABLED"),
        owner=master and _flag_default_true(source, "RIWI_OWNER_ENABLED"),
    )
    return RiwiRollout(
        enabled=master,
        roles=roles,
        external_ai=master and _flag_default_false(source, "RIWI_EXTERNAL_AI_ENABLED") and _flag_default_false(source, "AI_EXTERNAL_ENABLED"),
        knowledge_ingestion=master and _flag_default_true(source, "RIWI_KNOWLEDGE_INGESTION_ENABLED"),
        provider_lab=master and _flag_default_true(source, "RIWI_PROVIDER_LAB_ENABLED"),
    )


def riwi_enabled_for_role(role: str, env: Mapping[str, str] | None = None) -> bool:
    rollout = read_riwi_rollout(env)
    return rollout.enabled and rollout.roles.enabled_for(role)
