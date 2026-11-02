from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Mapping
import uuid

from .riwi_assessment_contracts import (
    format_instruction_teaching,
    parse_owner_assessment_policy_message,
    run_assessment_policy_regression,
    select_instruction_task,
    get_assessment_contract,
    compose_teaching_prompt,
)
from .riwi_audit import record_riwi_audit
from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_contracts import (
    RIWI_MAX_ANSWER_CHARS,
    assess_riwi_intent,
    riwi_presentation_locale,
    validate_riwi_chat_request,
)
from .riwi_conversations import append_conversation_turn, get_tutoring_history
from .riwi_knowledge import retrieve_active_knowledge_for_actor
from .riwi_provider_router import dispatch_external_riwi_provider
from .riwi_role_surface import (
    RiwiTargetScopeError,
    authorize_target_learner_access,
    get_riwi_role_surface,
)
from .riwi_rollout import read_riwi_rollout, riwi_enabled_for_role
from .riwi_security_signals import record_security_signal
from .riwi_tool_broker import RiwiToolBroker, RiwiToolBrokerError
from .riwi_tools_domain import build_default_riwi_tool_broker


class RiwiGatewayError(ValueError):
    def __init__(self, code: str, status_code: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _policy_refusal_message(locale: str) -> str:
    if locale == "en":
        return (
            "I can only help with authorized English learning, IELTS preparation, dictionary lookup, "
            "grammar explanations, and your permitted progress or report scope. I cannot override security rules, "
            "access private system data, or change roles."
        )
    return (
        "Men faqat ruxsat etilgan ingliz tili va IELTS mashg'ulotlari, lug'at, grammatika tushuntirishlari "
        "hamda sizga ruxsat berilgan o'zlashtirish ko'rsatkichlari bo'yicha yordam bera olaman. "
        "Xavfsizlik qoidalarini chetlab o'tish yoki tizim ma'lumotlarini oshkor qilish mumkin emas."
    )


async def handle_riwi_chat(
    conn: Any,
    actor: RiwiActor,
    raw_payload: Any,
    *,
    cookie_locale: str | None = None,
    env: Mapping[str, str] | None = None,
    broker: RiwiToolBroker | None = None,
    external_runner: Callable[[str, dict[str, Any]], Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    if not riwi_enabled_for_role(actor.role, env):
        raise RiwiGatewayError("riwi_disabled_for_role", 503)
    if not authorize_capability(actor, "riwi.chat.self").allowed:
        raise RiwiGatewayError("forbidden", 403)

    req = validate_riwi_chat_request(raw_payload)
    locale = riwi_presentation_locale(cookie_locale, actor.locale)
    correlation_id = str(uuid.uuid4())
    message = req["message"]
    conversation_id = req.get("conversationId")
    target_user_id = req.get("targetUserId")

    intent_info = assess_riwi_intent(message)
    role_surface = await get_riwi_role_surface(conn, actor)

    if intent_info.is_adversarial:
        await record_security_signal(
            conn,
            signal_type=intent_info.attack_type or "prompt_injection",
            route_class="/api/riwi/chat",
            reason_code=f"adversarial_{intent_info.attack_type or 'prompt_injection'}_blocked",
            actor_role=actor.role
        )
        await record_riwi_audit(
            conn,
            actor_user_id=actor.id,
            action="riwi.chat.refused",
            target_type="riwi_gateway",
            target_id=correlation_id,
            metadata={
                "role": actor.role,
                "reason": intent_info.attack_type or "prompt_injection",
                "status": "refused",
            },
        )
        refusal_text = _policy_refusal_message(locale)
        saved_conv_id = await append_conversation_turn(
            conn,
            actor=actor,
            conversation_id=conversation_id,
            user_message=message,
            assistant_answer=refusal_text,
            correlation_id=correlation_id,
            provenance="policy_refusal",
            provider={"id": "riwi", "model": "deterministic-guard-v1"},
            citations=[],
            report_snapshot=None
        )
        return {
            "ok": True,
            "conversationId": saved_conv_id,
            "correlationId": correlation_id,
            "intent": intent_info.intent,
            "answer": refusal_text,
            "provenance": "policy_refusal",
            "provider": {"id": "riwi", "model": "deterministic-guard-v1"},
            "citations": [],
            "reportSnapshot": None,
            "roleSurface": role_surface,
        }

    if target_user_id is not None:
        try:
            await authorize_target_learner_access(
                conn,
                actor,
                target_user_id,
                for_report=(intent_info.intent == "report_self"),
            )
        except RiwiTargetScopeError as exc:
            await record_security_signal(
                conn,
                signal_type="idor",
                route_class="/api/riwi/chat",
                reason_code="unauthorized_target_learner_scope",
                actor_role=actor.role
            )
            raise RiwiGatewayError(exc.code, 403 if exc.code == "forbidden" else 400) from exc

    if actor.role == "owner":
        policy_draft = parse_owner_assessment_policy_message(message)
        if policy_draft is not None:
            reg = run_assessment_policy_regression(policy_draft["scope"], policy_draft["overlay"])
            ans = (
                f"Assessment policy candidate parsed for scope '{policy_draft['scope']}' "
                f"(regression passed={reg['passed']}, fixture={reg['fixtureId']}). "
                f"Overlay: {policy_draft['overlay']}."
            )
            saved_conv_id = await append_conversation_turn(
                conn,
                actor=actor,
                conversation_id=conversation_id,
                user_message=message,
                assistant_answer=ans,
                correlation_id=correlation_id,
                provenance="approved_knowledge",
                provider={"id": "riwi", "model": "policy-preview-v1"},
                citations=[],
                report_snapshot=None
            )
            return {
                "ok": True,
                "conversationId": saved_conv_id,
                "correlationId": correlation_id,
                "intent": "provider_admin",
                "answer": ans,
                "provenance": "approved_knowledge",
                "provider": {"id": "riwi", "model": "policy-preview-v1"},
                "citations": [],
                "reportSnapshot": None,
                "policyPreview": {"scope": policy_draft["scope"], "overlay": policy_draft["overlay"], "regression": reg},
                "roleSurface": role_surface,
            }

    tool_broker = broker or build_default_riwi_tool_broker()
    answer_text = ""
    provenance = "unavailable"
    citations: list[dict[str, Any]] = []
    report_snapshot: dict[str, Any] | None = None
    provider_meta: dict[str, Any] = {"id": "riwi", "model": "deterministic-v1"}

    try:
        if intent_info.intent == "dictionary_lookup" or req.get("occurrenceId"):
            term = intent_info.extracted_term or message.strip(" ?.!\"'")[:60]
            out = await tool_broker.execute(
                conn,
                actor=actor,
                tool_name="dictionary.lookup",
                raw_input={"term": term, "occurrenceId": req.get("occurrenceId"), "locale": locale},
            )
            answer_text = out["summary"]
            provenance = out["provenance"]
        elif intent_info.intent == "report_self":
            out = await tool_broker.execute(
                conn,
                actor=actor,
                tool_name="report.generate",
                raw_input={"targetUserId": target_user_id, "windowDays": 30, "locale": locale},
            )
            answer_text = out["summary"]
            provenance = out["provenance"]
            report_snapshot = out["reportSnapshot"]
        elif intent_info.intent == "progress_self":
            out = await tool_broker.execute(
                conn,
                actor=actor,
                tool_name="progress.read_learner",
                raw_input={"targetUserId": target_user_id, "locale": locale},
            )
            answer_text = out["summary"]
            provenance = out["provenance"]
        elif req.get("lessonId"):
            out = await tool_broker.execute(
                conn,
                actor=actor,
                tool_name="lesson.read_excerpt",
                raw_input={"lessonId": req["lessonId"], "locale": locale},
            )
            answer_text = out["summary"]
            provenance = out["provenance"]
        elif intent_info.intent == "grammar_help" or req.get("topicId"):
            out = await tool_broker.execute(
                conn,
                actor=actor,
                tool_name="grammar.explain",
                raw_input={"query": message, "topicId": req.get("topicId"), "locale": locale},
            )
            if out.get("resolved"):
                answer_text = out["summary"]
                provenance = out["provenance"]
    except RiwiToolBrokerError as exc:
        if exc.code == "forbidden":
            raise RiwiGatewayError("forbidden", 403) from exc
        raise RiwiGatewayError(exc.code, 400) from exc

    # This release is usable only after the normal Owner knowledge workflow
    # activates it. Follow-ups read only this actor's conversation metadata.
    from .riwi_curriculum import retrieve_lesson, format_lesson, is_library_text, MODEL_PREFIX
    lesson = None
    if not answer_text and intent_info.intent in ("grammar_help", "general_learning_question"):
        lesson = await retrieve_lesson(conn, actor, message, conversation_id)
    knowledge_units = ([lesson] if lesson else [
        unit for unit in await retrieve_active_knowledge_for_actor(conn, actor, message)
        if not is_library_text(unit.get("text"))
    ])
    if knowledge_units:
        citations = [
            {
                "ref": str(u["ref"]),
                "sourceId": str(u["sourceId"]),
                "unitId": str(u["unitId"]),
                "title": str(u["title"]),
                "authority": str(u["authority"]),
                "version": int(u["version"]),
            }
            for u in knowledge_units[:4]
        ]
        if not answer_text:
            top = knowledge_units[0]
            authored = format_lesson(top, message, locale) if top.get("curriculumId") else None
            answer_text = authored or f"[{top['ref']}] {top['title']}: {top['text']}"
            if authored:
                provider_meta = {"id": "riwi", "model": MODEL_PREFIX + top["curriculumId"]}
            provenance = "approved_knowledge"

    rollout = read_riwi_rollout(env)
    if rollout.external_ai and external_runner is not None and intent_info.intent in ("grammar_help", "general_learning_question"):
        history = await get_tutoring_history(conn, actor, conversation_id, now=now) if conversation_id else []
        task_key = "grammar.explanation" if intent_info.intent == "grammar_help" else select_instruction_task(message)
        import os
        provider_id = str((env if env is not None else os.environ).get("RIWI_PRIMARY_PROVIDER") or "openai").strip().lower()
        ext_res = await dispatch_external_riwi_provider(
            conn,
            actor=actor,
            provider_id=provider_id,
            task_profile="grammar_explanation" if intent_info.intent == "grammar_help" else "general_tutoring",
            payload={
                "language": locale,
                "message": message,
                "history": history,
                "instructions": compose_teaching_prompt(get_assessment_contract(task_key)),
                "knowledge": [
                    {
                        "ref": str(u["ref"]),
                        "text": str(u["text"]),
                        "authority": int(u["authority"]),
                        "version": int(u["version"]),
                    }
                    for u in knowledge_units[:4]
                ],
            },
            correlation_id=correlation_id,
            transport=external_runner,
            env=env,
        )
        formatted_teaching = (
            format_instruction_teaching(task_key, ext_res.get("teaching"), language=locale)
            if ext_res.get("teaching")
            else None
        )
        answer_text = formatted_teaching or ext_res["answer"]
        provenance = "external_provider"
        provider_meta = ext_res["provider"]
        if ext_res.get("citations"):
            allowed_map = {c["ref"]: c for c in citations}
            citations = [allowed_map[r] for r in ext_res["citations"] if r in allowed_map]

    if not answer_text:
        if locale == "en":
            answer_text = (
                "I processed your learning question using internal deterministic RIWI. "
                "Ask about a specific dictionary headword, grammar topic, approved course note, or your progress report."
            )
        else:
            answer_text = (
                "Savolingiz ichki RIWI tizimi orqali ko'rib chiqildi. Aniq lug'at so'zi, grammatika mavzusi, "
                "tasdiqlangan dars materiali yoki o'zlashtirish hisobotingiz haqida so'rashingiz mumkin."
            )
        provenance = "unavailable"

    saved_conv_id = await append_conversation_turn(
        conn,
        actor=actor,
        conversation_id=conversation_id,
        user_message=message,
        assistant_answer=answer_text[:RIWI_MAX_ANSWER_CHARS],
        correlation_id=correlation_id,
        provenance=provenance,
        provider=provider_meta,
        citations=citations,
        report_snapshot=report_snapshot,
        now=now,
    )
    await record_riwi_audit(
        conn,
        actor_user_id=actor.id,
        action="riwi.chat.completed",
        target_type="riwi_conversation",
        target_id=saved_conv_id,
        metadata={
            "role": actor.role,
            "intent": intent_info.intent,
            "provenance": provenance,
            "providerId": provider_meta["id"],
            "status": "succeeded",
        },
    )
    return {
        "ok": True,
        "conversationId": saved_conv_id,
        "correlationId": correlation_id,
        "intent": intent_info.intent,
        "answer": answer_text[:RIWI_MAX_ANSWER_CHARS],
        "provenance": provenance,
        "provider": provider_meta,
        "citations": citations,
        "reportSnapshot": report_snapshot,
        "roleSurface": role_surface,
    }
