from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import time
from typing import Any, Awaitable, Callable

from .riwi_audit import record_riwi_audit
from .riwi_capabilities import RiwiActor, authorize_capability

RIWI_DEFAULT_TOOL_TIMEOUT_MS = 8000
RIWI_CONFIRMATION_TTL_SECONDS = 600


class RiwiToolBrokerError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class RiwiToolDefinition:
    name: str
    required_capability: str
    allowed_roles: tuple[str, ...]
    input_validator: Callable[[Any], dict[str, Any]]
    output_validator: Callable[[Any], dict[str, Any]]
    handler: Callable[[Any, RiwiActor, dict[str, Any]], Awaitable[dict[str, Any]]]
    mutating: bool = False
    requires_confirmation: bool = False
    timeout_ms: int = RIWI_DEFAULT_TOOL_TIMEOUT_MS


def _canonical_input_hash(tool_name: str, validated_input: dict[str, Any]) -> str:
    payload = json.dumps({"tool": tool_name, "input": validated_input}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class RiwiToolBroker:
    def __init__(self) -> None:
        self._tools: dict[str, RiwiToolDefinition] = {}

    def register(self, tool: RiwiToolDefinition) -> None:
        if not tool.name or tool.name in self._tools:
            raise ValueError(f"duplicate_or_invalid_tool:{tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> RiwiToolDefinition | None:
        return self._tools.get(name)

    def list_tools_for_actor(self, actor: RiwiActor) -> list[str]:
        if actor.account_status != "active":
            return []
        allowed: list[str] = []
        for name, tool in sorted(self._tools.items()):
            if actor.role in tool.allowed_roles and authorize_capability(actor, tool.required_capability).allowed:
                allowed.append(name)
        return allowed

    async def _verify_live_actor(self, conn: Any, actor: RiwiActor) -> None:
        if actor.account_status != "active":
            raise RiwiToolBrokerError("forbidden")
        if conn is not None and hasattr(conn, "fetchrow"):
            row = await conn.fetchrow(
                "SELECT role::text AS role, account_status::text AS account_status FROM users WHERE id = $1::uuid LIMIT 1",
                actor.id,
            )
            if not row or row["role"] != actor.role or row["account_status"] != "active":
                raise RiwiToolBrokerError("forbidden")

    async def prepare_confirmation(
        self,
        conn: Any,
        *,
        actor: RiwiActor,
        tool_name: str,
        raw_input: Any,
        idempotency_key: str,
        target_id: str | None = None,
        preview: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        tool = self._tools.get(tool_name)
        if tool is None:
            raise RiwiToolBrokerError("unknown_tool")
        if actor.role not in tool.allowed_roles or not authorize_capability(actor, tool.required_capability).allowed:
            raise RiwiToolBrokerError("forbidden")
        await self._verify_live_actor(conn, actor)
        try:
            validated_input = tool.input_validator(raw_input)
        except Exception as exc:
            raise RiwiToolBrokerError("invalid_input") from exc

        input_hash = _canonical_input_hash(tool.name, validated_input)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=RIWI_CONFIRMATION_TTL_SECONDS)
        confirmation_id = hashlib.sha256(f"{actor.id}:{idempotency_key}".encode("utf-8")).hexdigest()[:32]
        confirmation_uuid = f"{confirmation_id[:8]}-{confirmation_id[8:12]}-4{confirmation_id[13:16]}-8{confirmation_id[17:20]}-{confirmation_id[20:32]}"

        if conn is not None and hasattr(conn, "execute"):
            await conn.execute(
                """
                INSERT INTO riwi_action_confirmations (
                    id, actor_user_id, tool_name, target_id, input_hash, idempotency_key, preview, expires_at, created_at
                ) VALUES (
                    $1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz
                )
                ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING
                """,
                confirmation_uuid,
                actor.id,
                tool.name,
                target_id,
                input_hash,
                idempotency_key[:80],
                json.dumps(preview or {}),
                expires_at,
                now,
            )
        return {
            "confirmationId": confirmation_uuid,
            "toolName": tool.name,
            "inputHash": input_hash,
            "expiresAt": expires_at.isoformat(),
        }

    async def execute(
        self,
        conn: Any,
        *,
        actor: RiwiActor,
        tool_name: str,
        raw_input: Any,
        confirmation_id: str | None = None,
        audit_writer: Callable[..., Awaitable[str]] = record_riwi_audit,
    ) -> dict[str, Any]:
        tool = self._tools.get(tool_name)
        if tool is None:
            raise RiwiToolBrokerError("unknown_tool")
        if actor.role not in tool.allowed_roles or not authorize_capability(actor, tool.required_capability).allowed:
            try:
                await audit_writer(
                    conn,
                    actor_user_id=actor.id,
                    action="riwi.tool.denied",
                    target_type="riwi_tool",
                    target_id=tool.name,
                    metadata={"role": actor.role, "toolName": tool.name, "status": "denied"},
                )
            except Exception:
                pass
            raise RiwiToolBrokerError("forbidden")

        await self._verify_live_actor(conn, actor)

        try:
            validated_input = tool.input_validator(raw_input)
        except Exception as exc:
            raise RiwiToolBrokerError("invalid_input") from exc

        input_hash = _canonical_input_hash(tool.name, validated_input)

        if tool.requires_confirmation:
            if not confirmation_id:
                raise RiwiToolBrokerError("confirmation_required")
            if conn is not None and hasattr(conn, "fetchrow"):
                conf = await conn.fetchrow(
                    """
                    UPDATE riwi_action_confirmations
                    SET consumed_at = now()
                    WHERE id = $1::uuid
                      AND actor_user_id = $2::uuid
                      AND tool_name = $3
                      AND input_hash = $4
                      AND consumed_at IS NULL
                      AND expires_at > now()
                    RETURNING id::text AS id
                    """,
                    confirmation_id,
                    actor.id,
                    tool.name,
                    input_hash,
                )
                if not conf:
                    raise RiwiToolBrokerError("confirmation_invalid_or_expired")

        # Audit-before-execute: if the request audit cannot be persisted, fail closed
        try:
            await audit_writer(
                conn,
                actor_user_id=actor.id,
                action="riwi.tool.requested",
                target_type="riwi_tool",
                target_id=tool.name,
                metadata={
                    "role": actor.role,
                    "toolName": tool.name,
                    "inputHash": input_hash,
                    "status": "requested",
                },
            )
        except Exception as exc:
            raise RiwiToolBrokerError("audit_failed") from exc

        started = time.monotonic()
        timeout_sec = max(0.05, min(30.0, tool.timeout_ms / 1000.0))
        try:
            raw_output = await asyncio.wait_for(
                tool.handler(conn, actor, validated_input),
                timeout=timeout_sec,
            )
        except asyncio.TimeoutError as exc:
            duration_ms = int((time.monotonic() - started) * 1000)
            try:
                await audit_writer(
                    conn,
                    actor_user_id=actor.id,
                    action="riwi.tool.failed",
                    target_type="riwi_tool",
                    target_id=tool.name,
                    metadata={
                        "role": actor.role,
                        "toolName": tool.name,
                        "inputHash": input_hash,
                        "status": "timeout",
                        "durationMs": duration_ms,
                    },
                )
            except Exception:
                pass
            raise RiwiToolBrokerError("timeout") from exc
        except RiwiToolBrokerError:
            raise
        except Exception as exc:
            duration_ms = int((time.monotonic() - started) * 1000)
            try:
                await audit_writer(
                    conn,
                    actor_user_id=actor.id,
                    action="riwi.tool.failed",
                    target_type="riwi_tool",
                    target_id=tool.name,
                    metadata={
                        "role": actor.role,
                        "toolName": tool.name,
                        "inputHash": input_hash,
                        "status": "error",
                        "durationMs": duration_ms,
                    },
                )
            except Exception:
                pass
            raise RiwiToolBrokerError("tool_execution_failed") from exc

        try:
            validated_output = tool.output_validator(raw_output)
        except Exception as exc:
            raise RiwiToolBrokerError("invalid_tool_output") from exc

        duration_ms = int((time.monotonic() - started) * 1000)
        try:
            await audit_writer(
                conn,
                actor_user_id=actor.id,
                action="riwi.tool.succeeded",
                target_type="riwi_tool",
                target_id=tool.name,
                metadata={
                    "role": actor.role,
                    "toolName": tool.name,
                    "inputHash": input_hash,
                    "status": "succeeded",
                    "durationMs": duration_ms,
                },
            )
        except Exception as exc:
            raise RiwiToolBrokerError("audit_failed") from exc

        return validated_output
