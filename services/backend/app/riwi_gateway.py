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
    locale = req.get('replyLocale') or riwi_presentation_locale(cookie_locale, actor.locale)
    correlation_id = str(uuid.uuid4())
    message = req["message"]
    original_message=message
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
        from .riwi_questions import guard_reply
        refusal_text = guard_reply(message,locale) or _policy_refusal_message(locale)
        saved_conv_id = await append_conversation_turn(
            conn,
            actor=actor,
            conversation_id=conversation_id,
            user_message=original_message,
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

    if not any(req.get(k) for k in ('material','attachments','targetUserId','occurrenceId','topicId','lessonId','attemptId')):
        from .riwi_language_memory import proposal_for_message,learn_proposal,learning_ack,resolve_private_language,MODEL as LANGUAGE_MODEL
        from .riwi_retention import retention_transaction
        proposal=await proposal_for_message(conn,actor,message,conversation_id)
        if proposal is not None:
            async with retention_transaction(conn) as active:
                learned=await learn_proposal(active,actor,proposal,now=now)
                answer=learning_ack(proposal,learned,locale)
                source='deterministic_learning_data' if learned.get('saved') or learned.get('reason')=='already_known' else 'unavailable'
                meta={'id':'riwi','model':LANGUAGE_MODEL}
                saved=await append_conversation_turn(active,actor=actor,conversation_id=conversation_id,user_message=original_message,
                    assistant_answer=answer,correlation_id=correlation_id,provenance=source,provider=meta,citations=[],now=now)
            if source=='unavailable':
                from .riwi_conversation_learning import capture_safely
                await capture_safely(conn,actor,saved,original_message)
            return {'ok':True,'conversationId':saved,'correlationId':correlation_id,'intent':intent_info.intent,
                'answer':answer,'provenance':source,'provider':meta,'citations':[],'reportSnapshot':None,'roleSurface':role_surface,'learning':learned}
        mapped=await resolve_private_language(conn,actor,message)
        if mapped:
            message=mapped;intent_info=assess_riwi_intent(message)

    from .riwi_site import site_response
    site_reply = (site_response(actor.role, message, locale, req.get('siteContext', []))
        if not any(req.get(k) for k in ('material','attachments','targetUserId','occurrenceId','topicId','lessonId','attemptId')) else None)
    if site_reply:
        site_answer=site_reply['answer'];site_links=site_reply['navigationLinks']
        meta = {'id':'riwi','model':'riwi-site-guide-v1'}
        saved = await append_conversation_turn(conn, actor=actor, conversation_id=conversation_id,
            user_message=original_message, assistant_answer=site_answer, correlation_id=correlation_id,
            provenance='deterministic_learning_data',provider=meta,citations=[],report_snapshot=None,navigation_links=site_links,now=now)
        await record_riwi_audit(conn,actor_user_id=actor.id,action='riwi.chat.completed',
            target_type='riwi_conversation',target_id=saved,
            metadata={'role':actor.role,'intent':intent_info.intent,'provenance':'deterministic_learning_data','providerId':'riwi','status':'succeeded'})
        return {'ok':True,'conversationId':saved,'correlationId':correlation_id,'intent':intent_info.intent,
            'answer':site_answer,'provenance':'deterministic_learning_data','provider':meta,'citations':[],
            'reportSnapshot':None,'roleSurface':role_surface,'navigationLinks':site_links}

    from .riwi_documents import answer_request as document_answer, gate as document_gate
    document = document_answer(message, req.get('attachments', []), locale)
    if document:
        await document_gate(conn, actor)
        text = document['answer'][:RIWI_MAX_ANSWER_CHARS]
        meta = {'id':'riwi','model':'riwi-document-v1','fileCount':len(req.get('attachments', []))}
        saved = await append_conversation_turn(conn, actor=actor, conversation_id=conversation_id,
            user_message=original_message, assistant_answer=text, correlation_id=correlation_id,
            provenance='deterministic_learning_data',provider=meta,citations=[],report_snapshot=None,now=now)
        await record_riwi_audit(conn,actor_user_id=actor.id,action='riwi.chat.completed',
            target_type='riwi_conversation',target_id=saved,
            metadata={'role':actor.role,'intent':intent_info.intent,'provenance':'deterministic_learning_data','providerId':'riwi','status':'succeeded'})
        return {'ok':True,'conversationId':saved,'correlationId':correlation_id,'intent':intent_info.intent,
            'answer':text,'provenance':'deterministic_learning_data','provider':meta,'citations':[],
            'reportSnapshot':None,'roleSurface':role_surface,'documentAction':document.get('action')}

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
                user_message=original_message,
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

    from .riwi_understanding import explain_request,text_request
    from .riwi_internal_tutor import correction_request as is_correction_request
    from .riwi_questions import answer_question
    from .riwi_grammar_reference import retrieve_lesson as retrieve_reference,format_lesson as format_reference,MODEL_PREFIX as REFERENCE_PREFIX
    unscoped=not any(req.get(k) for k in ('material','targetUserId','attemptId','topicId','occurrenceId','lessonId'))
    reference=await retrieve_reference(conn,actor,message,conversation_id) if unscoped and not text_request(message) and not is_correction_request(message) and intent_info.intent in ('grammar_help','general_learning_question') else None
    if reference:
        answer_text=format_reference(reference,message,locale);provenance='approved_knowledge'
        provider_meta={'id':'riwi','model':REFERENCE_PREFIX+reference['referenceId'],'lessonVariant':reference.get('lessonVariant',0),'queryAliases':reference.get('queryAliases',[])}
        citations=[{k:reference[k] for k in ('ref','sourceId','unitId','title','authority','version')}]
    from .riwi_grammar_reference import answer_support
    support=await answer_support(conn,actor,message,locale) if not reference and unscoped and intent_info.intent in ('grammar_help','general_learning_question') else None
    faq = support or (await answer_question(conn,actor,message,locale,conversation_id) if not reference and unscoped else None)
    if faq:
        answer_text=faq['answer'];provenance=faq['provenance'];citations=faq['citations'];provider_meta=faq['provider']
    understood = await explain_request(conn,actor,message,locale,tool_broker) if not faq and not reference and intent_info.intent in ('grammar_help','general_learning_question') else None
    if understood:
        answer_text=understood['answer'];provenance=understood['provenance'];citations=understood['citations']
        provider_meta={'id':'riwi','model':'riwi-understanding-v1'}
    material_item = None
    material_reference=req.get('material')
    if not faq and not reference and not material_reference and not any(req.get(k) for k in ('targetUserId','attemptId','topicId','occurrenceId','lessonId')):
        from .riwi_material_search import resolve_material, clarification
        try:
            found=await resolve_material(conn,actor,message,conversation_id)
        except PermissionError as exc:
            found={'clarification':str(exc),'kinds':[]}
        if found and 'clarification' in found:
            reason=found['clarification'];blocked=reason in ('forbidden','active_exam_lookup_forbidden')
            text=clarification(reason,locale)
            meta={'id':'riwi','model':'riwi-material-resolution-v1','materialSearchKinds':found['kinds']}
            source='policy_refusal' if blocked else 'unavailable'
            saved=await append_conversation_turn(conn,actor=actor,conversation_id=conversation_id,
                user_message=original_message,assistant_answer=text,correlation_id=correlation_id,
                provenance=source,provider=meta,citations=[],report_snapshot=None,now=now)
            await record_riwi_audit(conn,actor_user_id=actor.id,action='riwi.chat.completed',
                target_type='riwi_conversation',target_id=saved,
                metadata={'role':actor.role,'intent':intent_info.intent,'provenance':source,'providerId':'riwi','status':'succeeded'})
            return {'ok':True,'conversationId':saved,'correlationId':correlation_id,'intent':intent_info.intent,
                'answer':text,'provenance':source,'provider':meta,'citations':[],'reportSnapshot':None,'roleSurface':role_surface}
        material_reference=found
    if material_reference:
        from .riwi_materials import read_material, teach_material
        try:
            material_item = await read_material(conn, actor, material_reference)
        except PermissionError as exc:
            raise RiwiGatewayError(str(exc), 403) from exc
        except LookupError as exc:
            raise RiwiGatewayError(str(exc), 404) from exc
        from .riwi_curriculum import retrieve_lesson as material_lesson, format_lesson as material_explanation
        related = await material_lesson(conn,actor,message)
        extra = material_explanation(related,message,locale) if related else None
        answer_text = teach_material(material_item, message, locale, supplement=extra)
        provenance = 'deterministic_learning_data'
        provider_meta = {'id':'riwi','model':'riwi-material-v1','material':material_reference,
                         'contentHash':material_item['contentHash']}
        citations = [{'ref':'S1','sourceId':str(material_item['id']),
                      'unitId':material_reference['kind']+':'+str(material_item['id']),
                      'title':str(material_item['title']),'authority':'75','version':1,
                      'contentHash':material_item['contentHash']}]
        if related:
            citations += [{k:related[k] for k in ('ref','sourceId','unitId','title','authority','version')}]
            if related.get('supplement'):
                citations += [{k:related['supplement'][k] for k in ('ref','sourceId','unitId','title','authority','version')}]

    try:
        if material_item or understood or faq or reference:
            pass
        elif intent_info.intent == "dictionary_lookup" or req.get("occurrenceId"):
            term = intent_info.extracted_term or message.strip(" ?.!\"'")[:60]
            out = await tool_broker.execute(
                conn,
                actor=actor,
                tool_name="dictionary.lookup",
                raw_input={"term": term, "occurrenceId": req.get("occurrenceId"), "locale": locale},
            )
            if not out.get('resolved') and not req.get('occurrenceId'):
                from .riwi_grammar_reference import lookup_term
                grammar_term=await lookup_term(conn,actor,term,locale)
                if grammar_term:out=grammar_term
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
    from .riwi_curriculum import retrieve_lesson, format_lesson, is_library_text, choose_entry, MODEL_PREFIX
    from .riwi_internal_tutor import correction_request, format_correction, smalltalk
    from .riwi_study_library import retrieve_lesson as retrieve_study, format_lesson as format_study, MODEL_PREFIX as STUDY_PREFIX
    correction=correction_request(message)
    if correction:
        from .riwi_grammar_reference import correction_example
        correction=await correction_example(conn,actor,correction)
    study = None
    if not answer_text and intent_info.intent in ('grammar_help','general_learning_question'):
        study = await retrieve_study(conn,actor,message,conversation_id)
        if study:
            answer_text = format_study(study,message,locale)
            provenance = 'approved_knowledge'
            provider_meta = {'id':'riwi','model':STUDY_PREFIX+study['studyId'],
                             'lessonVariant':study['lessonVariant'],'teachingEdition':'study-v1'}
            citations = [{key:study[key] for key in ('ref','sourceId','unitId','title','authority','version')}]
    lesson = None
    canonical_grammar = provenance == "canonical_grammar"
    if (not answer_text or canonical_grammar) and intent_info.intent in ("grammar_help", "general_learning_question"):
        # A published topic remains authoritative. Enrich it only when its own
        # title resolves to a supported lesson, including explicit topic links.
        topic_key = choose_entry(out.get('title', '')) if canonical_grammar else (correction['topic'] if correction else None)
        if not canonical_grammar or topic_key:
            lesson = await retrieve_lesson(conn, actor, message, conversation_id,
                                          **({'topic_key':topic_key} if topic_key else {}))
    knowledge_units = [] if material_item or study or understood or faq or reference else ([lesson]+([lesson['supplement']] if lesson.get('supplement') else []) if lesson else [
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
        if not answer_text or (canonical_grammar and lesson and lesson.get('supplement')):
            top = knowledge_units[0]
            authored = format_lesson(top, message, locale) if top.get("curriculumId") else None
            if authored and correction and not canonical_grammar:authored=format_correction(correction,authored,locale)
            if canonical_grammar:
                if authored:
                    answer_text += "\n\n" + authored
            else:
                answer_text = authored or str(top['text'])
            if authored:
                provider_meta = {"id": "riwi", "model": MODEL_PREFIX + top["curriculumId"],
                                 'lessonVariant':top.get('lessonVariant',0),
                                 'queryAliases':top.get('queryAliases',[]),
                                 'teachingEdition':'details-v1' if top.get('supplement') else 'compact-v1'}
            if not canonical_grammar:
                provenance = "approved_knowledge"

    rollout = read_riwi_rollout(env)
    if not material_item and not study and not understood and not faq and not reference and rollout.external_ai and external_runner is not None and intent_info.intent in ("grammar_help", "general_learning_question"):
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
        dialogue=smalltalk(message,locale)
        if locale == "en":
            answer_text = dialogue or "I could not find a reliable match in my learning material 🤔\n\nCould you write your question in more detail? Which topic did you not understand? I will not present a guess as a fact when I do not know the information!"
        else:
            answer_text = dialogue or "Bilimlarim orasidan bu savolga ishonchli mos javob topa olmadim 🤔\n\nSavolingizni to'liqroq yozib bera olasizmi? Qaysi mavzuga tushunmadingiz? Bilmagan ma'lumotimdan tahminni fakt deb bermayman!"
        provenance = "unavailable"

    from .riwi_conversation_learning import attach_clarification_alias,capture_safely
    provider_meta=await attach_clarification_alias(conn,actor,conversation_id,message,provider_meta)
    saved_conv_id = await append_conversation_turn(
        conn,
        actor=actor,
        conversation_id=conversation_id,
        user_message=original_message,
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
    review_capture = await capture_safely(conn,actor,saved_conv_id,original_message) if provenance=='unavailable' and not faq else None
    from .riwi_documents import requested_format
    document_format = requested_format(message)
    document_action = ({'mode':'create','format':document_format,'text':answer_text[:RIWI_MAX_ANSWER_CHARS]}
                       if document_format and provenance not in ('unavailable','policy_refusal') else None)
    return {
        "ok": True,
        "conversationId": saved_conv_id,
        "correlationId": correlation_id,
        "documentAction": document_action,
        "intent": intent_info.intent,
        "answer": answer_text[:RIWI_MAX_ANSWER_CHARS],
        "provenance": provenance,
        "provider": provider_meta,
        "citations": citations,
        "reportSnapshot": report_snapshot,
        "roleSurface": role_surface,
        "learningReview": review_capture,
    }
