from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any, Callable, Mapping
import uuid

from .riwi_assessment_contracts import (
    ASSESSMENT_POLICY_SCOPES,
    run_assessment_policy_regression,
    validate_owner_overlay,
)
from .riwi_audit import list_riwi_audit_page, record_riwi_audit
from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_conversations import (
    delete_conversation,
    get_conversation_transcript,
)
from .riwi_gateway import handle_riwi_chat
from .riwi_knowledge import (
    approve_knowledge_candidate,
    create_knowledge_candidate,
    promote_knowledge_candidate,
)
from .riwi_learning_signals import (
    create_knowledge_candidate_from_learning_signal,
    create_learning_signal,
    review_learning_signal,
    submit_riwi_student_feedback,
)
from .riwi_provider_lab import run_riwi_provider_experiment
from .riwi_provider_router import get_riwi_owner_diagnostics
from .riwi_retention import touch_riwi_online_activity
from .riwi_role_surface import list_riwi_target_page
from .riwi_security_signals import list_security_signals, review_security_signal
from .riwi_tools_domain import explain_objective_question


RIWI_API_ROUTES: tuple[tuple[str, str, str], ...] = (
    ("GET", "/api/riwi/materials", "get_riwi_materials"),
    ("POST", "/api/riwi/chat", "post_riwi_chat"),
    ("GET", "/api/riwi/conversations/{conversation_id}", "get_riwi_conversation"),
    ("DELETE", "/api/riwi/conversations/{conversation_id}", "delete_riwi_conversation"),
    ("GET", "/api/riwi/targets", "get_riwi_targets"),
    ("POST", "/api/riwi/presence", "post_riwi_presence"),
    ("POST", "/api/riwi/feedback", "post_riwi_feedback"),
    ("POST", "/api/riwi/objective-explanation", "post_riwi_objective_explanation"),
    ("GET", "/api/riwi/learning-signals", "get_riwi_learning_signals"),
    ("POST", "/api/riwi/learning-signals", "post_riwi_learning_signal"),
    ("GET", "/api/riwi/learning-signals/{signal_id}", "get_riwi_learning_signal_detail"),
    ("POST", "/api/riwi/learning-signals/{signal_id}/review", "post_riwi_learning_signal_review"),
    ("POST", "/api/riwi/learning-signals/{signal_id}/knowledge", "post_riwi_learning_signal_knowledge"),
    ("GET", "/api/riwi/owner/audit", "get_riwi_owner_audit"),
    ("GET", "/api/riwi/owner/diagnostics", "get_riwi_owner_diagnostics_route"),
    ("GET", "/api/riwi/owner/knowledge", "get_riwi_owner_knowledge"),
    ("POST", "/api/riwi/owner/knowledge", "post_riwi_owner_knowledge"),
    ("GET", "/api/riwi/owner/knowledge/conflicts", "get_riwi_owner_knowledge_conflicts"),
    ("GET", "/api/riwi/owner/knowledge/{source_id}", "get_riwi_owner_knowledge_detail"),
    ("POST", "/api/riwi/owner/knowledge/{source_id}/approve", "post_riwi_owner_knowledge_approve"),
    ("POST", "/api/riwi/owner/knowledge/{source_id}/reject", "post_riwi_owner_knowledge_reject"),
    ("POST", "/api/riwi/owner/knowledge/{source_id}/promote", "post_riwi_owner_knowledge_promote"),
    ("GET", "/api/riwi/owner/provider-lab", "get_riwi_owner_provider_lab"),
    ("POST", "/api/riwi/owner/provider-lab", "post_riwi_owner_provider_lab"),
    ("GET", "/api/riwi/owner/security-signals", "get_riwi_owner_security_signals"),
    ("POST", "/api/riwi/owner/security-signals/{signal_id}/review", "post_riwi_owner_security_signal_review"),
    ("GET", "/api/riwi/owner/assessment-policies", "get_riwi_owner_assessment_policies"),
    ("POST", "/api/riwi/owner/assessment-policies/preview", "post_riwi_owner_assessment_policy_preview"),
    ("POST", "/api/riwi/owner/assessment-policies", "post_riwi_owner_assessment_policy_create"),
    ("POST", "/api/riwi/owner/assessment-policies/{version_id}/approve", "post_riwi_owner_assessment_policy_approve"),
    ("POST", "/api/riwi/owner/assessment-policies/{version_id}/reject", "post_riwi_owner_assessment_policy_reject"),
    ("POST", "/api/riwi/owner/assessment-policies/{version_id}/rollback", "post_riwi_owner_assessment_policy_rollback"),
)


async def get_riwi_materials(conn: Any, actor: RiwiActor, *, kind='reading', query=''):
    from .riwi_materials import list_materials
    return await list_materials(conn, actor, kind, query)


async def post_riwi_chat(
    conn: Any,
    actor: RiwiActor,
    payload: Any,
    *,
    cookie_locale: str | None = None,
    env: Mapping[str, str] | None = None,
    external_runner: Callable[[str, dict[str, Any]], Any] | None = None,
) -> dict[str, Any]:
    return await handle_riwi_chat(
        conn,
        actor,
        payload,
        cookie_locale=cookie_locale,
        env=env,
        external_runner=external_runner,
    )


async def get_riwi_conversation(conn: Any, actor: RiwiActor, conversation_id: str) -> dict[str, Any]:
    return await get_conversation_transcript(conn, actor, conversation_id)


async def delete_riwi_conversation(conn: Any, actor: RiwiActor, conversation_id: str) -> dict[str, Any]:
    return await delete_conversation(conn, actor, conversation_id)


async def get_riwi_targets(
    conn: Any,
    actor: RiwiActor,
    *,
    cursor: str | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    return await list_riwi_target_page(conn, actor, cursor=cursor, limit=limit)


async def post_riwi_presence(conn: Any, actor: RiwiActor) -> dict[str, Any]:
    if not authorize_capability(actor, "riwi.chat.self").allowed:
        raise PermissionError("forbidden")
    touched = await touch_riwi_online_activity(conn, actor.id)
    return {"ok": True, "recorded": touched}


async def post_riwi_feedback(conn: Any, actor: RiwiActor, payload: dict[str, Any]) -> dict[str, Any]:
    sig = await submit_riwi_student_feedback(
        conn,
        actor=actor,
        correlation_id=str(payload.get("correlationId") or "") or None,
        rating=str(payload.get("rating") or "") or None,
        conversation_id=str(payload.get("conversationId") or "") or None,
        helpful=payload.get("helpful") if isinstance(payload.get("helpful"), bool) else None,
        reason=str(payload.get("reason") or "") or None,
    )
    return {"ok": True, "signal": sig}


async def post_riwi_objective_explanation(conn: Any, actor: RiwiActor, payload: dict[str, Any]) -> dict[str, Any]:
    return await explain_objective_question(conn, actor, payload)


async def post_riwi_learning_signal(conn: Any, actor: RiwiActor, payload: dict[str, Any]) -> dict[str, Any]:
    sig = await create_learning_signal(
        conn,
        actor=actor,
        signal_type=str(payload.get("signalType") or ""),
        source_id=str(payload.get("sourceId") or ""),
        target_user_id=payload.get("targetUserId"),
        scope=str(payload.get("scope") or "user"),
        candidate_claim=str(payload.get("candidateClaim") or ""),
        evidence_summary=str(payload.get("evidenceSummary") or ""),
    )
    return {"ok": True, "signal": sig}


async def post_riwi_learning_signal_review(
    conn: Any,
    actor: RiwiActor,
    signal_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    reviewed = await review_learning_signal(
        conn,
        actor=actor,
        signal_id=signal_id,
        decision=str(payload.get("decision") or ""),
        reason=str(payload.get("reason") or ""),
        regression_fixture_id=payload.get("regressionFixtureId"),
    )
    return {"ok": True, "signal": reviewed}


async def post_riwi_learning_signal_knowledge(
    conn: Any,
    actor: RiwiActor,
    signal_id: str,
) -> dict[str, Any]:
    src = await create_knowledge_candidate_from_learning_signal(conn, actor=actor, signal_id=signal_id)
    return {"ok": True, "source": src}


async def get_riwi_owner_audit(
    conn: Any,
    actor: RiwiActor,
    *,
    cursor: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    return await list_riwi_audit_page(conn, actor, cursor=cursor, limit=limit)


async def get_riwi_owner_diagnostics_route(
    conn: Any,
    actor: RiwiActor,
    *,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    return await get_riwi_owner_diagnostics(conn, actor, env=env)


async def post_riwi_owner_knowledge(conn: Any, actor: RiwiActor, payload: dict[str, Any]) -> dict[str, Any]:
    src = await create_knowledge_candidate(
        conn,
        actor=actor,
        source_type=str(payload.get("sourceType") or ""),
        title=str(payload.get("title") or ""),
        provenance=str(payload.get("provenance") or ""),
        rights_class=str(payload.get("rightsClass") or ""),
        scope=payload.get("scope") if isinstance(payload.get("scope"), dict) else {"kind": "global"},
        content=str(payload.get("content") or ""),
    )
    return {"ok": True, "source": src}


async def post_riwi_owner_knowledge_approve(conn: Any, actor: RiwiActor, source_id: str) -> dict[str, Any]:
    res = await approve_knowledge_candidate(conn, actor=actor, source_id=source_id)
    return {"ok": True, "source": res}


async def post_riwi_owner_knowledge_promote(
    conn: Any,
    actor: RiwiActor,
    source_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    res = await promote_knowledge_candidate(
        conn,
        actor=actor,
        source_id=source_id,
        regression_fixture_id=str(payload.get("regressionFixtureId") or ""),
    )
    return {"ok": True, "source": res}


async def post_riwi_owner_provider_lab(
    conn: Any,
    actor: RiwiActor,
    payload: dict[str, Any],
    *,
    env: Mapping[str, str] | None = None,
    runner: Callable[[str, dict[str, Any]], Any] | None = None,
) -> dict[str, Any]:
    return await run_riwi_provider_experiment(
        conn,
        actor=actor,
        fixture_id=str(payload.get("fixtureId") or ""),
        provider_ids=list(payload.get("providerIds") or []),
        idempotency_key=str(payload.get("idempotencyKey") or ""),
        env=env,
        runner=runner,
    )


async def get_riwi_owner_security_signals(conn: Any, actor: RiwiActor) -> dict[str, Any]:
    items = await list_security_signals(conn, actor)
    return {"ok": True, "items": items}


async def post_riwi_owner_security_signal_review(
    conn: Any,
    actor: RiwiActor,
    signal_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    reviewed = await review_security_signal(
        conn,
        actor=actor,
        signal_id=signal_id,
        state=str(payload.get("state") or ""),
        regression_fixture_id=payload.get("regressionFixtureId"),
    )
    return {"ok": True, "signal": reviewed}


async def post_riwi_owner_assessment_policy_preview(
    conn: Any,
    actor: RiwiActor,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.approve").allowed:
        raise PermissionError("forbidden")
    scope = str(payload.get("scope") or "").strip()
    if scope not in ASSESSMENT_POLICY_SCOPES:
        raise ValueError("invalid_scope")
    overlay = validate_owner_overlay(payload.get("overlay") or {})
    reg = run_assessment_policy_regression(scope, overlay)
    return {"ok": True, "scope": scope, "overlay": overlay, "regression": reg}


async def post_riwi_owner_assessment_policy_create(
    conn: Any,
    actor: RiwiActor,
    payload: dict[str, Any],
) -> dict[str, Any]:
    from .riwi_assessment_policy_store import create
    return await create(conn,actor,str(payload.get('scope') or '').strip(),payload.get('overlay'))


# ---------------------------------------------------------------------------
# FastAPI Router & Canonical main.py Installation
# ---------------------------------------------------------------------------
from fastapi import APIRouter, Request

def _core():
    from . import main as _m
    return _m
from .riwi_contracts import RiwiContractError, UUID_RE
from .riwi_conversations import RiwiConversationError
from .riwi_gateway import RiwiGatewayError
from .riwi_knowledge import KnowledgeServiceError
from .riwi_learning_signals import LearningServiceError
from .riwi_provider_lab import RiwiProviderLabError
from .riwi_role_surface import RiwiTargetScopeError
from .riwi_security_signals import SecuritySignalError

router = APIRouter()

from .db import PooledReads


class RiwiQueryPool(PooledReads):
    async def execute(self,query,*args):
        async with self.pool.acquire() as conn:
            return await conn.execute(query,*args)


async def _require_riwi_actor(req: Request) -> RiwiActor | None:
    user = await _core().current_user(req, active=True)
    if not user:
        return None
    return RiwiActor(
        id=str(user["id"]),
        role=str(user["role"]),
        account_status=str(user["account_status"]),
        locale=str(user.get("locale") or "uz"),
    )


def _riwi_error_response(exc: Exception):
    if isinstance(exc, RiwiGatewayError):
        return _core().j({"ok": False, "error": exc.code}, exc.status_code, _core().PRIVATE)
    if isinstance(exc, PermissionError):
        return _core().j({"ok": False, "error": str(exc) or "forbidden"}, 403, _core().PRIVATE)
    if isinstance(exc, LookupError):
        return _core().j({"ok": False, "error": "not_found"}, 404, _core().PRIVATE)
    if isinstance(
        exc,
        (
            RiwiContractError,
            RiwiConversationError,
            RiwiTargetScopeError,
            KnowledgeServiceError,
            LearningServiceError,
            SecuritySignalError,
            RiwiProviderLabError,
            ValueError,
        ),
    ):
        code = getattr(exc, "code", str(exc) or "invalid_input")
        if code == "forbidden":
            return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
        if code == "not_found":
            return _core().j({"ok": False, "error": "not_found"}, 404, _core().PRIVATE)
        return _core().j({"ok": False, "error": code}, 400, _core().PRIVATE)
    raise exc


@router.post("/api/riwi/chat")
async def _http_post_riwi_chat(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    try:
        db = await _core().pool()
        from .riwi_provider_transport import create_riwi_transport
        res = await post_riwi_chat(RiwiQueryPool(db), actor, body, cookie_locale=req.cookies.get("la_locale"),
                                   external_runner=create_riwi_transport(actor.id))
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post('/api/riwi/documents/export')
async def _http_export_riwi_document(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor: return _core().auth_error()
    from .riwi_rollout import riwi_enabled_for_role
    from .riwi_documents import gate, export_document
    if not riwi_enabled_for_role(actor.role):
        return _core().j({'ok':False,'error':'riwi_disabled_for_role'},503,_core().PRIVATE)
    try:
        body = await _core().payload(req)
        db = await _core().pool()
        await gate(RiwiQueryPool(db), actor)
        result = await _core().run_blocking(export_document, body)
        return _core().j({'ok':True,'document':result},200,_core().PRIVATE)
    except (ValueError, PermissionError) as exc:
        return _core().j({'ok':False,'error':str(exc)},403 if isinstance(exc,PermissionError) else 400,_core().PRIVATE)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error('RIWI document export failed: %s',type(exc).__name__)
        return _core().j({'ok':False,'error':'document_export_unavailable'},503,_core().PRIVATE)


@router.get('/api/riwi/materials')
async def _http_get_riwi_materials(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor: return _core().auth_error()
    from .riwi_rollout import riwi_enabled_for_role
    if not riwi_enabled_for_role(actor.role):
        return _core().j({'ok':False,'error':'riwi_disabled_for_role'},503,_core().PRIVATE)
    try:
        db = await _core().pool()
        result = await get_riwi_materials(RiwiQueryPool(db),actor,kind=req.query_params.get('kind','reading'),query=req.query_params.get('q',''))
        return _core().j(result,200,_core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/conversations/{conversation_id}")
async def _http_get_riwi_conversation(req: Request, conversation_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await get_riwi_conversation(conn, actor, conversation_id)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.delete("/api/riwi/conversations/{conversation_id}")
async def _http_delete_riwi_conversation(req: Request, conversation_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await delete_riwi_conversation(conn, actor, conversation_id)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/targets")
async def _http_get_riwi_targets(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    cursor = req.query_params.get("cursor")
    limit = int(req.query_params.get("limit") or 25)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await get_riwi_targets(conn, actor, cursor=cursor, limit=limit)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post("/api/riwi/presence")
async def _http_post_riwi_presence(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_presence(conn, actor)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post("/api/riwi/feedback")
async def _http_post_riwi_feedback(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_feedback(conn, actor, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post("/api/riwi/objective-explanation")
async def _http_post_riwi_objective_explanation(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_objective_explanation(conn, actor, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/learning-signals")
async def _http_get_riwi_learning_signals(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    db = await _core().pool()
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text AS id, signal_type::text AS signal_type, state::text AS state, scope::text AS scope, candidate_claim, created_at FROM riwi_learning_signals ORDER BY created_at DESC LIMIT 50"
        )
    return _core().j({"ok": True, "items": [_core().row_to_dict(r) for r in rows]}, 200, _core().PRIVATE)


@router.post("/api/riwi/learning-signals")
async def _http_post_riwi_learning_signal(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_learning_signal(conn, actor, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/learning-signals/{signal_id}")
async def _http_get_riwi_learning_signal_detail(req: Request, signal_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    if not UUID_RE.match(signal_id):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    db = await _core().pool()
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM riwi_learning_signals WHERE id = $1::uuid LIMIT 1", signal_id)
    if not row:
        return _core().j({"ok": False, "error": "not_found"}, 404, _core().PRIVATE)
    return _core().j({"ok": True, "signal": _core().row_to_dict(row)}, 200, _core().PRIVATE)


@router.post("/api/riwi/learning-signals/{signal_id}/review")
async def _http_post_riwi_learning_signal_review(req: Request, signal_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_learning_signal_review(conn, actor, signal_id, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post("/api/riwi/learning-signals/{signal_id}/knowledge")
async def _http_post_riwi_learning_signal_knowledge(req: Request, signal_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_learning_signal_knowledge(conn, actor, signal_id)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/owner/audit")
async def _http_get_riwi_owner_audit(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    cursor = req.query_params.get("cursor")
    limit = int(req.query_params.get("limit") or 20)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await get_riwi_owner_audit(conn, actor, cursor=cursor, limit=limit)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/owner/diagnostics")
async def _http_get_riwi_owner_diagnostics(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await get_riwi_owner_diagnostics_route(conn, actor)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/owner/knowledge")
async def _http_get_riwi_owner_knowledge(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    db = await _core().pool()
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text AS id, source_type::text AS source_type, title, state::text AS state, scope::text AS scope, authority, version, unit_count, updated_at FROM riwi_knowledge_sources ORDER BY updated_at DESC LIMIT 50"
        )
    return _core().j({"ok": True, "items": [_core().row_to_dict(r) for r in rows]}, 200, _core().PRIVATE)


@router.post("/api/riwi/owner/knowledge")
async def _http_post_riwi_owner_knowledge(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_owner_knowledge(conn, actor, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/owner/knowledge/conflicts")
async def _http_get_riwi_owner_knowledge_conflicts(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    db = await _core().pool()
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text AS id, candidate_source_id::text AS candidate_source_id, active_source_id::text AS active_source_id, state::text AS state, summary, created_at FROM riwi_knowledge_conflicts ORDER BY created_at DESC LIMIT 50"
        )
    return _core().j({"ok": True, "items": [_core().row_to_dict(r) for r in rows]}, 200, _core().PRIVATE)


@router.get("/api/riwi/owner/knowledge/{source_id}")
async def _http_get_riwi_owner_knowledge_detail(req: Request, source_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    if not UUID_RE.match(source_id):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    db = await _core().pool()
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM riwi_knowledge_sources WHERE id = $1::uuid LIMIT 1", source_id)
    if not row:
        return _core().j({"ok": False, "error": "not_found"}, 404, _core().PRIVATE)
    return _core().j({"ok": True, "source": _core().row_to_dict(row)}, 200, _core().PRIVATE)


@router.post("/api/riwi/owner/knowledge/{source_id}/approve")
async def _http_post_riwi_owner_knowledge_approve(req: Request, source_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_owner_knowledge_approve(conn, actor, source_id)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post("/api/riwi/owner/knowledge/{source_id}/reject")
async def _http_post_riwi_owner_knowledge_reject(req: Request, source_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    if not UUID_RE.match(source_id):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    db = await _core().pool()
    async with db.acquire() as conn:
        await conn.execute("UPDATE riwi_knowledge_sources SET state = 'rejected', updated_at = NOW() WHERE id = $1::uuid", source_id)
    return _core().j({"ok": True, "sourceId": source_id, "state": "rejected"}, 200, _core().PRIVATE)


@router.post("/api/riwi/owner/knowledge/{source_id}/promote")
async def _http_post_riwi_owner_knowledge_promote(req: Request, source_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_owner_knowledge_promote(conn, actor, source_id, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/owner/provider-lab")
async def _http_get_riwi_owner_provider_lab(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    db = await _core().pool()
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text AS id, fixture_id, state::text AS state, created_at FROM riwi_provider_experiments ORDER BY created_at DESC LIMIT 25"
        )
    return _core().j({"ok": True, "items": [_core().row_to_dict(r) for r in rows]}, 200, _core().PRIVATE)


@router.post("/api/riwi/owner/provider-lab")
async def _http_post_riwi_owner_provider_lab(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_owner_provider_lab(conn, actor, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/owner/security-signals")
async def _http_get_riwi_owner_security_signals(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await get_riwi_owner_security_signals(conn, actor)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post("/api/riwi/owner/security-signals/{signal_id}/review")
async def _http_post_riwi_owner_security_signal_review(req: Request, signal_id: str):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_owner_security_signal_review(conn, actor, signal_id, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.get("/api/riwi/owner/assessment-policies")
async def _http_get_riwi_owner_assessment_policies(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    if actor.role != "owner":
        return _core().j({"ok": False, "error": "forbidden"}, 403, _core().PRIVATE)
    from .riwi_assessment_policy_store import present
    db = await _core().pool()
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT v.*,p.scope FROM riwi_assessment_policy_versions v JOIN riwi_assessment_policies p ON p.id=v.policy_id ORDER BY v.created_at DESC,v.id DESC LIMIT 50"
        )
    return _core().j({"ok": True, "items": [present(r) for r in rows]}, 200, _core().PRIVATE)


@router.post("/api/riwi/owner/assessment-policies/preview")
async def _http_post_riwi_owner_assessment_policy_preview(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_owner_assessment_policy_preview(conn, actor, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


@router.post("/api/riwi/owner/assessment-policies")
async def _http_post_riwi_owner_assessment_policy_create(req: Request):
    actor = await _require_riwi_actor(req)
    if not actor:
        return _core().auth_error()
    body = await _core().payload(req)
    if not isinstance(body, dict):
        return _core().j({"ok": False, "error": "invalid_input"}, 400, _core().PRIVATE)
    try:
        db = await _core().pool()
        async with db.acquire() as conn:
            res = await post_riwi_owner_assessment_policy_create(conn, actor, body)
        return _core().j(res, 200, _core().PRIVATE)
    except Exception as exc:
        return _riwi_error_response(exc)


async def _review_assessment_policy(req,version_id,decision):
    actor=await _require_riwi_actor(req)
    if not actor:return _core().auth_error()
    if actor.role!='owner':return _core().j({'ok':False,'error':'forbidden'},403,_core().PRIVATE)
    if not UUID_RE.match(version_id):return _core().j({'ok':False,'error':'invalid_input'},400,_core().PRIVATE)
    body=await _core().payload(req)
    if not isinstance(body,dict) or set(body)!={'contentHash'}:
        return _core().j({'ok':False,'error':'exact_hash_required'},400,_core().PRIVATE)
    try:
        from .riwi_assessment_policy_store import review
        db=await _core().pool()
        async with db.acquire() as conn:
            result=await review(conn,actor,version_id,body['contentHash'],decision)
        return _core().j(result,200,_core().PRIVATE)
    except Exception as exc:return _riwi_error_response(exc)


@router.post("/api/riwi/owner/assessment-policies/{version_id}/approve")
async def _http_post_riwi_owner_assessment_policy_approve(req:Request,version_id:str):
    return await _review_assessment_policy(req,version_id,'approve')


@router.post("/api/riwi/owner/assessment-policies/{version_id}/reject")
async def _http_post_riwi_owner_assessment_policy_reject(req:Request,version_id:str):
    return await _review_assessment_policy(req,version_id,'reject')


@router.post("/api/riwi/owner/assessment-policies/{version_id}/rollback")
async def _http_post_riwi_owner_assessment_policy_rollback(req:Request,version_id:str):
    return await _review_assessment_policy(req,version_id,'rollback')


def install():
    _core().app.include_router(router)
