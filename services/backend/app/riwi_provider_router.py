from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import ipaddress
import json
import os
import re
import time
from typing import Any, Awaitable, Callable, Final, Mapping
from urllib.parse import urlparse
import weakref

from .riwi_audit import record_riwi_audit, record_riwi_usage_metric
from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_outbound_guard import guard_external_payload, redact_external_text
from .riwi_rollout import read_riwi_rollout

RIWI_EXTERNAL_TIMEOUT_MS: Final[int] = 18_000
RIWI_CHAT_MAX_OUTPUT_TOKENS: Final[int] = 900
RIWI_DEFAULT_MAX_CONCURRENT_EXTERNAL_REQUESTS: Final[int] = 4

MODEL_ID_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$")
CITATION_REF_RE: Final[re.Pattern[str]] = re.compile(r"^K[1-5]$")

PROVIDER_ALLOWED_HOSTS: Final[dict[str, frozenset[str]]] = {
    "openai": frozenset({"api.openai.com"}),
    "gemini": frozenset({"generativelanguage.googleapis.com"}),
    "anthropic": frozenset({"api.anthropic.com"}),
}


@dataclass(frozen=True)
class RegisteredProviderSpec:
    id: str
    display_name: str
    type: str  # "internal" | "external"
    default_model: str | None
    model_env_var: str | None
    required_secrets: tuple[str, ...]
    capabilities: tuple[str, ...]
    allowed_hosts: frozenset[str]


REGISTERED_PROVIDERS: Final[tuple[RegisteredProviderSpec, ...]] = (
    RegisteredProviderSpec(
        id="riwi",
        display_name="RIWI Deterministic Engine",
        type="internal",
        default_model="riwi-deterministic-v1",
        model_env_var=None,
        required_secrets=(),
        capabilities=("writing", "speaking", "grammar", "vocabulary", "assignment", "riwi-assistant"),
        allowed_hosts=frozenset(),
    ),
    RegisteredProviderSpec(
        id="openai",
        display_name="OpenAI",
        type="external",
        default_model="gpt-4.1-mini",
        model_env_var="OPENAI_MODEL",
        required_secrets=("OPENAI_API_KEY",),
        capabilities=("writing", "speaking", "grammar", "vocabulary", "assignment", "riwi-assistant"),
        allowed_hosts=PROVIDER_ALLOWED_HOSTS["openai"],
    ),
    RegisteredProviderSpec(
        id="gemini",
        display_name="Google Gemini",
        type="external",
        default_model="gemini-2.5-flash",
        model_env_var="GEMINI_MODEL",
        required_secrets=("GEMINI_API_KEY",),
        capabilities=("writing", "speaking", "grammar", "vocabulary", "assignment", "riwi-assistant"),
        allowed_hosts=PROVIDER_ALLOWED_HOSTS["gemini"],
    ),
    RegisteredProviderSpec(
        id="anthropic",
        display_name="Anthropic Claude",
        type="external",
        default_model="claude-sonnet-4-20250514",
        model_env_var="ANTHROPIC_MODEL",
        required_secrets=("ANTHROPIC_API_KEY",),
        capabilities=("writing", "speaking", "grammar", "vocabulary", "assignment", "riwi-assistant"),
        allowed_hosts=PROVIDER_ALLOWED_HOSTS["anthropic"],
    ),
)

PROVIDER_MAP: Final[dict[str, RegisteredProviderSpec]] = {p.id: p for p in REGISTERED_PROVIDERS}

# Per-event-loop bounded concurrency semaphore and in-flight paid request deduplication map
_LOOP_SEMAPHORES: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[int, asyncio.Semaphore]] = weakref.WeakKeyDictionary()
_LOOP_INFLIGHT: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[str, asyncio.Future[dict[str, Any]]]] = weakref.WeakKeyDictionary()


class RiwiProviderRouterError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _resolve_provider_model(spec: RegisteredProviderSpec, source: Mapping[str, str]) -> str | None:
    model_val = spec.default_model
    if spec.model_env_var and (source.get(spec.model_env_var) or "").strip():
        candidate = source[spec.model_env_var].strip()
        if MODEL_ID_RE.match(candidate):
            model_val = candidate
    return model_val


def _max_concurrent_external_requests(source: Mapping[str, str]) -> int:
    raw = (source.get("RIWI_MAX_CONCURRENT_EXTERNAL_REQUESTS") or "").strip()
    if raw:
        try:
            parsed = int(raw)
            if 1 <= parsed <= 64:
                return parsed
        except ValueError:
            pass
    return RIWI_DEFAULT_MAX_CONCURRENT_EXTERNAL_REQUESTS


def _get_concurrency_semaphore(limit: int) -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    by_limit = _LOOP_SEMAPHORES.setdefault(loop, {})
    sem = by_limit.get(limit)
    if sem is None:
        sem = asyncio.Semaphore(limit)
        by_limit[limit] = sem
    return sem


def _get_inflight_map() -> dict[str, asyncio.Future[dict[str, Any]]]:
    loop = asyncio.get_running_loop()
    inflight = _LOOP_INFLIGHT.get(loop)
    if inflight is None:
        inflight = {}
        _LOOP_INFLIGHT[loop] = inflight
    return inflight


def _paid_request_dedupe_key(
    actor_id: str,
    provider_id: str,
    model: str | None,
    task_profile: str,
    guarded_payload: dict[str, Any],
) -> str:
    canonical = json.dumps(
        {
            "u": actor_id.lower(),
            "p": provider_id,
            "m": model or "",
            "t": task_profile,
            "b": guarded_payload,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def validate_provider_endpoint(provider_id: str, url: str) -> str:
    spec = PROVIDER_MAP.get(provider_id)
    if spec is None or spec.type != "external":
        raise RiwiProviderRouterError("invalid_provider")
    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise RiwiProviderRouterError("invalid_endpoint_url") from exc

    if parsed.scheme != "https":
        raise RiwiProviderRouterError("endpoint_must_use_https")
    if parsed.username or parsed.password or parsed.fragment:
        raise RiwiProviderRouterError("endpoint_credentials_or_fragment_forbidden")
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname or hostname in ("localhost", "localhost.localdomain") or hostname.endswith(".local") or hostname.endswith(".internal"):
        raise RiwiProviderRouterError("ssrf_blocked_host")

    # Block literal IP addresses (IPv4 and IPv6)
    try:
        ip_obj = ipaddress.ip_address(hostname)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
            or True
        ):
            raise RiwiProviderRouterError("ssrf_ip_literal_forbidden")
    except ValueError:
        pass

    if hostname not in spec.allowed_hosts:
        raise RiwiProviderRouterError("endpoint_host_not_allowlisted")
    return url


def validate_riwi_provider_answer(raw_answer: Any, allowed_citations: set[str] | None = None) -> dict[str, Any]:
    if not isinstance(raw_answer, dict):
        raise RiwiProviderRouterError("invalid_response")
    allowed_keys = {"answer", "uncertainty", "citations", "teaching"}
    extra_keys = set(raw_answer.keys()) - allowed_keys
    if extra_keys:
        raise RiwiProviderRouterError("invalid_response_extra_keys")

    answer = raw_answer.get("answer")
    if not isinstance(answer, str) or not answer.strip() or len(answer) > 6000:
        raise RiwiProviderRouterError("invalid_response_answer")
    clean_answer = redact_external_text(answer.strip(), 6000).strip()
    if not clean_answer:
        raise RiwiProviderRouterError("invalid_response_answer")

    uncertainty = raw_answer.get("uncertainty")
    if uncertainty is not None:
        if not isinstance(uncertainty, str) or len(uncertainty) > 600:
            raise RiwiProviderRouterError("invalid_response_uncertainty")
        uncertainty = redact_external_text(uncertainty.strip(), 600).strip() or None

    citations = raw_answer.get("citations")
    if not isinstance(citations, list) or len(citations) > 5:
        raise RiwiProviderRouterError("invalid_response_citations")
    clean_citations: list[str] = []
    for ref in citations:
        if not isinstance(ref, str) or not CITATION_REF_RE.match(ref):
            raise RiwiProviderRouterError("invalid_response_citations")
        if allowed_citations is not None and ref not in allowed_citations:
            raise RiwiProviderRouterError("ungrounded_citation")
        if ref not in clean_citations:
            clean_citations.append(ref)

    result: dict[str, Any] = {
        "answer": clean_answer,
        "uncertainty": uncertainty,
        "citations": clean_citations,
    }
    if "teaching" in raw_answer and raw_answer["teaching"] is not None:
        if not isinstance(raw_answer["teaching"], dict):
            raise RiwiProviderRouterError("invalid_response_teaching")
        result["teaching"] = raw_answer["teaching"]
    return result


def provider_readiness_snapshot(env: Mapping[str, str] | None = None) -> list[dict[str, Any]]:
    source = env if env is not None else os.environ
    items: list[dict[str, Any]] = []
    for spec in REGISTERED_PROVIDERS:
        missing = [name for name in spec.required_secrets if not (source.get(name) or "").strip()]
        model_val = _resolve_provider_model(spec, source)
        items.append({
            "id": spec.id,
            "displayName": spec.display_name,
            "type": spec.type,
            "model": model_val,
            "capabilities": list(spec.capabilities),
            "secretsPresent": len(missing) == 0,
            "missingSecretNames": missing,
        })
    return items


async def dispatch_external_riwi_provider(
    conn: Any,
    *,
    actor: RiwiActor,
    provider_id: str,
    task_profile: str,
    payload: dict[str, Any],
    correlation_id: str,
    transport: Callable[[str, str, dict[str, Any]], Awaitable[dict[str, Any]]] | None = None,
    env: Mapping[str, str] | None = None,
    timeout_ms: int = RIWI_EXTERNAL_TIMEOUT_MS,
    audit_writer: Callable[..., Awaitable[str]] = record_riwi_audit,
) -> dict[str, Any]:
    spec = PROVIDER_MAP.get(provider_id)
    if spec is None or spec.type != "external":
        raise RiwiProviderRouterError("invalid_provider")

    rollout = read_riwi_rollout(env)
    if not rollout.external_ai or not rollout.roles.enabled_for(actor.role):
        raise RiwiProviderRouterError("external_ai_disabled")

    source_env = env if env is not None else os.environ
    missing_secrets = [s for s in spec.required_secrets if not (source_env.get(s) or "").strip()]
    if missing_secrets:
        raise RiwiProviderRouterError("credentials_missing")

    guard = guard_external_payload("chat", payload)
    if not guard.ok or guard.payload is None:
        raise RiwiProviderRouterError(guard.reason or "outbound_guard_rejected")

    model = _resolve_provider_model(spec, source_env)
    try:
        await audit_writer(
            conn,
            actor_user_id=actor.id,
            action="riwi.external.requested",
            target_type="riwi_provider",
            target_id=spec.id,
            metadata={
                "role": actor.role,
                "providerId": spec.id,
                "model": model,
                "taskProfile": task_profile,
                "status": "requested",
            },
        )
    except Exception as exc:
        raise RiwiProviderRouterError("audit_failed") from exc

    if transport is None:
        await record_riwi_usage_metric(
            conn,
            actor_user_id=actor.id,
            actor_role=actor.role,
            task_profile=task_profile,
            provider_id=spec.id,
            model=model,
            state="externally_unverified",
            duration_ms=0,
            correlation_id=correlation_id,
        )
        raise RiwiProviderRouterError("externally_unverified")

    dedupe_key = _paid_request_dedupe_key(actor.id, spec.id, model, task_profile, guard.payload)
    inflight = _get_inflight_map()
    existing_future = inflight.get(dedupe_key)
    if existing_future is not None and not existing_future.done():
        shared = await asyncio.shield(existing_future)
        return dict(shared)

    loop = asyncio.get_running_loop()
    future: asyncio.Future[dict[str, Any]] = loop.create_future()
    inflight[dedupe_key] = future
    sem = _get_concurrency_semaphore(_max_concurrent_external_requests(source_env))

    started = time.monotonic()
    timeout_sec = max(0.05, min(25.0, timeout_ms / 1000.0))
    try:
        async with sem:
            raw_result = await asyncio.wait_for(
                transport(spec.id, model or "", guard.payload),
                timeout=timeout_sec,
            )
    except asyncio.TimeoutError as exc:
        duration_ms = int((time.monotonic() - started) * 1000)
        await record_riwi_usage_metric(
            conn,
            actor_user_id=actor.id,
            actor_role=actor.role,
            task_profile=task_profile,
            provider_id=spec.id,
            model=model,
            state="timeout",
            duration_ms=duration_ms,
            correlation_id=correlation_id,
        )
        await audit_writer(
            conn,
            actor_user_id=actor.id,
            action="riwi.external.failed",
            target_type="riwi_provider",
            target_id=spec.id,
            metadata={
                "role": actor.role,
                "providerId": spec.id,
                "model": model,
                "taskProfile": task_profile,
                "status": "timeout",
                "durationMs": duration_ms,
            },
        )
        err = RiwiProviderRouterError("timeout")
        if not future.done():
            future.set_exception(err)
            future.exception()
        inflight.pop(dedupe_key, None)
        raise err from exc
    except Exception as exc:
        duration_ms = int((time.monotonic() - started) * 1000)
        await record_riwi_usage_metric(
            conn,
            actor_user_id=actor.id,
            actor_role=actor.role,
            task_profile=task_profile,
            provider_id=spec.id,
            model=model,
            state="provider_error",
            duration_ms=duration_ms,
            correlation_id=correlation_id,
        )
        await audit_writer(
            conn,
            actor_user_id=actor.id,
            action="riwi.external.failed",
            target_type="riwi_provider",
            target_id=spec.id,
            metadata={
                "role": actor.role,
                "providerId": spec.id,
                "model": model,
                "taskProfile": task_profile,
                "status": "provider_error",
                "durationMs": duration_ms,
            },
        )
        err = RiwiProviderRouterError("provider_error")
        if not future.done():
            future.set_exception(err)
            future.exception()
        inflight.pop(dedupe_key, None)
        raise err from exc

    duration_ms = int((time.monotonic() - started) * 1000)
    allowed_refs = {str(k.get("ref")) for k in guard.payload.get("knowledge", []) if isinstance(k, dict) and k.get("ref")}
    try:
        validated = validate_riwi_provider_answer(raw_result.get("answer", raw_result), allowed_refs)
    except RiwiProviderRouterError as exc:
        await record_riwi_usage_metric(
            conn,
            actor_user_id=actor.id,
            actor_role=actor.role,
            task_profile=task_profile,
            provider_id=spec.id,
            model=model,
            state="invalid_response",
            duration_ms=duration_ms,
            correlation_id=correlation_id,
        )
        await audit_writer(
            conn,
            actor_user_id=actor.id,
            action="riwi.external.failed",
            target_type="riwi_provider",
            target_id=spec.id,
            metadata={
                "role": actor.role,
                "providerId": spec.id,
                "model": model,
                "taskProfile": task_profile,
                "status": "invalid_response",
                "durationMs": duration_ms,
            },
        )
        if not future.done():
            future.set_exception(exc)
            future.exception()
        inflight.pop(dedupe_key, None)
        raise exc

    usage = raw_result.get("usage") if isinstance(raw_result.get("usage"), dict) else {}
    in_tok = usage.get("inputTokens") if isinstance(usage.get("inputTokens"), int) else None
    out_tok = usage.get("outputTokens") if isinstance(usage.get("outputTokens"), int) else None

    await record_riwi_usage_metric(
        conn,
        actor_user_id=actor.id,
        actor_role=actor.role,
        task_profile=task_profile,
        provider_id=spec.id,
        model=model,
        state="succeeded",
        duration_ms=duration_ms,
        correlation_id=correlation_id,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    await audit_writer(
        conn,
        actor_user_id=actor.id,
        action="riwi.external.succeeded",
        target_type="riwi_provider",
        target_id=spec.id,
        metadata={
            "role": actor.role,
            "providerId": spec.id,
            "model": model,
            "taskProfile": task_profile,
            "status": "succeeded",
            "durationMs": duration_ms,
            "resultCount": len(validated["citations"]),
        },
    )
    response_payload = {
        "provider": {"id": spec.id, "model": model},
        "answer": validated["answer"],
        "uncertainty": validated["uncertainty"],
        "citations": validated["citations"],
        "teaching": validated.get("teaching"),
        "durationMs": duration_ms,
        "inputTokens": in_tok,
        "outputTokens": out_tok,
    }
    if not future.done():
        future.set_result(response_payload)
    inflight.pop(dedupe_key, None)
    return response_payload


async def get_riwi_owner_diagnostics(
    conn: Any,
    actor: RiwiActor,
    *,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.provider.read_status").allowed:
        raise PermissionError("forbidden")
    rollout = read_riwi_rollout(env)
    providers = provider_readiness_snapshot(env)
    usage_summary = {"totalRequests": 0, "succeededRequests": 0, "failedRequests": 0}
    if conn is not None and hasattr(conn, "fetchrow"):
        row = await conn.fetchrow(
            """
            SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE state = 'succeeded')::int AS succeeded,
                   count(*) FILTER (WHERE state <> 'succeeded')::int AS failed
            FROM riwi_usage_metrics
            """
        )
        if row:
            usage_summary = {
                "totalRequests": int(row["total"] or 0),
                "succeededRequests": int(row["succeeded"] or 0),
                "failedRequests": int(row["failed"] or 0),
            }
    return {
        "ok": True,
        "rollout": {
            "enabled": rollout.enabled,
            "roles": {
                "student": rollout.roles.student,
                "teacher": rollout.roles.teacher,
                "admin": rollout.roles.admin,
                "owner": rollout.roles.owner,
            },
            "externalAi": rollout.external_ai,
            "knowledgeIngestion": rollout.knowledge_ingestion,
            "providerLab": rollout.provider_lab,
        },
        "providers": providers,
        "usageSummary": usage_summary,
    }
