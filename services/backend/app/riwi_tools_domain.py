from __future__ import annotations

from typing import Any

from .riwi_audit import record_riwi_audit
from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_contracts import UUID_RE
from .riwi_role_surface import RiwiTargetScopeError, authorize_target_learner_access
from .riwi_tool_broker import RiwiToolBroker, RiwiToolDefinition

MAX_LESSON_EXCERPT_CHARS = 600


class RiwiDomainToolError(ValueError):
    def __init__(self, code: str = "invalid_input") -> None:
        super().__init__(code)
        self.code = code


def _validate_dictionary_input(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("invalid_input")
    allowed = {"term", "occurrenceId", "locale"}
    if set(raw.keys()) - allowed:
        raise ValueError("invalid_input")
    term = str(raw.get("term") or "").strip().lower()
    occ = raw.get("occurrenceId")
    if occ is not None and (not isinstance(occ, str) or not UUID_RE.match(occ)):
        raise ValueError("invalid_input")
    if not term and not occ:
        raise ValueError("invalid_input")
    if len(term) > 80:
        raise ValueError("invalid_input")
    locale = "en" if str(raw.get("locale") or "uz").lower() == "en" else "uz"
    return {"term": term, "occurrenceId": occ.lower() if isinstance(occ, str) else None, "locale": locale}


def _validate_dictionary_output(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or "resolved" not in raw or "provenance" not in raw:
        raise ValueError("invalid_output")
    return raw


async def lookup_canonical_dictionary(conn: Any, actor: RiwiActor, data: dict[str, Any]) -> dict[str, Any]:
    term = data.get("term") or ""
    occ_id = data.get("occurrenceId")
    locale = data.get("locale", "uz")
    row = None
    if conn is not None and hasattr(conn, "fetchrow"):
        if occ_id:
            row = await conn.fetchrow(
                """
                SELECT de.id::text AS id, de.headword, de.part_of_speech,
                       de.definition_en, de.definition_uz, de.example_en
                FROM dictionary_occurrences dox
                JOIN dictionary_entries de ON de.id = dox.entry_id
                WHERE dox.id = $1::uuid
                LIMIT 1
                """,
                occ_id,
            )
        if not row and term:
            row = await conn.fetchrow(
                """
                SELECT id::text AS id, headword, part_of_speech,
                       definition_en, definition_uz, example_en
                FROM dictionary_entries
                WHERE lower(headword) = $1
                LIMIT 1
                """,
                term.lower(),
            )
    if not row:
        return {
            "resolved": False,
            "term": term,
            "provenance": "unavailable",
            "summary": (
                f"No canonical dictionary entry found for '{term}'."
                if locale == "en"
                else f"'{term}' so'zi bo'yicha rasmiy lug'at yozuvi topilmadi."
            ),
        }
    headword = str(row["headword"])
    pos = str(row.get("part_of_speech") or "word")
    def_en = str(row.get("definition_en") or "").strip()
    def_uz = str(row.get("definition_uz") or "").strip()
    ex_en = str(row.get("example_en") or "").strip()
    if locale == "en":
        summary = f"{headword} ({pos}): {def_en or def_uz}"
        if ex_en:
            summary += f" Example: {ex_en}"
    else:
        summary = f"{headword} ({pos}): {def_uz or def_en}"
        if ex_en:
            summary += f" Misol: {ex_en}"
    return {
        "resolved": True,
        "entryId": str(row["id"]),
        "term": headword,
        "partOfSpeech": pos,
        "definitionEn": def_en,
        "definitionUz": def_uz,
        "exampleEn": ex_en,
        "provenance": "canonical_dictionary",
        "summary": summary[:1200],
    }


def _validate_grammar_input(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("invalid_input")
    allowed = {"query", "topicId", "locale"}
    if set(raw.keys()) - allowed:
        raise ValueError("invalid_input")
    query = str(raw.get("query") or "").strip()
    topic_id = raw.get("topicId")
    if topic_id is not None and (not isinstance(topic_id, str) or not UUID_RE.match(topic_id)):
        raise ValueError("invalid_input")
    if not query and not topic_id:
        raise ValueError("invalid_input")
    locale = "en" if str(raw.get("locale") or "uz").lower() == "en" else "uz"
    return {"query": query[:300], "topicId": topic_id.lower() if isinstance(topic_id, str) else None, "locale": locale}


def _validate_grammar_output(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or "resolved" not in raw or "provenance" not in raw:
        raise ValueError("invalid_output")
    return raw


async def lookup_canonical_grammar(conn: Any, actor: RiwiActor, data: dict[str, Any]) -> dict[str, Any]:
    topic_id = data.get("topicId")
    query = data.get("query") or ""
    locale = data.get("locale", "uz")
    row = None
    if conn is not None and hasattr(conn, "fetchrow"):
        if topic_id:
            row = await conn.fetchrow(
                """
                SELECT id::text AS id, title, rule_summary, common_mistake, example_sentence
                FROM grammar_topics
                WHERE id = $1::uuid
                LIMIT 1
                """,
                topic_id,
            )
        elif query:
            row = await conn.fetchrow(
                """
                SELECT id::text AS id, title, rule_summary, common_mistake, example_sentence
                FROM grammar_topics
                WHERE lower(title) LIKE '%' || $1 || '%'
                LIMIT 1
                """,
                query.lower()[:80],
            )
    if not row:
        return {
            "resolved": False,
            "provenance": "unavailable",
            "summary": (
                "No canonical grammar topic matched your query."
                if locale == "en"
                else "Ushbu mavzu bo'yicha rasmiy grammatika qoidasi topilmadi."
            ),
        }
    title = str(row["title"])
    rule = str(row.get("rule_summary") or "").strip()
    mistake = str(row.get("common_mistake") or "").strip()
    example = str(row.get("example_sentence") or "").strip()
    if locale == "en":
        summary = f"Grammar Topic — {title}: {rule}"
        if example:
            summary += f" Example: {example}"
        if mistake:
            summary += f" Common mistake: {mistake}"
    else:
        summary = f"Grammatika mavzusi — {title}: {rule}"
        if example:
            summary += f" Misol: {example}"
        if mistake:
            summary += f" Ko'p uchraydigan xato: {mistake}"
    return {
        "resolved": True,
        "topicId": str(row["id"]),
        "title": title,
        "ruleSummary": rule,
        "commonMistake": mistake,
        "exampleSentence": example,
        "provenance": "canonical_grammar",
        "summary": summary[:1500],
    }


def _validate_progress_input(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("invalid_input")
    allowed = {"targetUserId", "locale"}
    if set(raw.keys()) - allowed:
        raise ValueError("invalid_input")
    tid = raw.get("targetUserId")
    if tid is not None and (not isinstance(tid, str) or not UUID_RE.match(tid)):
        raise ValueError("invalid_input")
    locale = "en" if str(raw.get("locale") or "uz").lower() == "en" else "uz"
    return {"targetUserId": tid.lower() if isinstance(tid, str) else None, "locale": locale}


def _validate_progress_output(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or "targetUserId" not in raw or "provenance" not in raw:
        raise ValueError("invalid_output")
    return raw


async def read_learner_progress_and_retention(conn: Any, actor: RiwiActor, data: dict[str, Any]) -> dict[str, Any]:
    target_user_id = await authorize_target_learner_access(
        conn,
        actor,
        data.get("targetUserId"),
        for_report=False,
    )
    locale = data.get("locale", "uz")
    weaknesses: list[str] = []
    due_reviews = 0
    completed_attempts = 0
    if conn is not None and hasattr(conn, "fetch"):
        w_rows = await conn.fetch(
            """
            SELECT weakness_key, occurrences
            FROM coach_weaknesses
            WHERE user_id = $1::uuid
            ORDER BY occurrences DESC, updated_at DESC
            LIMIT 5
            """,
            target_user_id,
        )
        weaknesses = [f"{r['weakness_key']} ({r['occurrences']}x)" for r in w_rows]
    if conn is not None and hasattr(conn, "fetchrow"):
        stats = await conn.fetchrow(
            """
            SELECT count(*)::int AS completed_attempts,
                   count(*) FILTER (WHERE next_review_at IS NOT NULL AND next_review_at <= now())::int AS due_reviews
            FROM retention_attempts
            WHERE user_id = $1::uuid
            """,
            target_user_id,
        )
        if stats:
            completed_attempts = int(stats.get("completed_attempts") or 0)
            due_reviews = int(stats.get("due_reviews") or 0)
    weakness_text = ", ".join(weaknesses) if weaknesses else ("none recorded yet" if locale == "en" else "hozircha qayd etilmagan")
    if locale == "en":
        summary = (
            f"Deterministic progress summary: {completed_attempts} retention attempt(s) completed, "
            f"{due_reviews} item(s) due for review. Top error patterns: {weakness_text}."
        )
    else:
        summary = (
            f"Aniq o'zlashtirish ko'rsatkichlari: {completed_attempts} ta xotira mashqi bajarilgan, "
            f"{due_reviews} ta takrorlash navbatda. Asosiy xato turlari: {weakness_text}."
        )
    return {
        "resolved": True,
        "targetUserId": target_user_id,
        "completedAttempts": completed_attempts,
        "dueReviews": due_reviews,
        "topWeaknesses": weaknesses,
        "provenance": "deterministic_learning_data",
        "summary": summary,
    }


def _validate_lesson_input(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw.keys()) - {"lessonId", "locale"}:
        raise ValueError("invalid_input")
    lesson_id = raw.get("lessonId")
    if not isinstance(lesson_id, str) or not UUID_RE.match(lesson_id):
        raise ValueError("invalid_input")
    locale = "en" if str(raw.get("locale") or "uz").lower() == "en" else "uz"
    return {"lessonId": lesson_id.lower(), "locale": locale}


def _validate_lesson_output(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or "resolved" not in raw or "excerpt" not in raw:
        raise ValueError("invalid_output")
    if len(str(raw.get("excerpt") or "")) > MAX_LESSON_EXCERPT_CHARS:
        raise ValueError("excerpt_exceeds_bound")
    return raw


async def read_course_lesson_excerpt(conn: Any, actor: RiwiActor, data: dict[str, Any]) -> dict[str, Any]:
    lesson_id = data["lessonId"]
    locale = data.get("locale", "uz")
    row = None
    if conn is not None and hasattr(conn, "fetchrow"):
        row = await conn.fetchrow(
            """
            SELECT id::text AS id, title, summary_text
            FROM course_lessons
            WHERE id = $1::uuid AND is_published = true
            LIMIT 1
            """,
            lesson_id,
        )
    if not row:
        return {
            "resolved": False,
            "lessonId": lesson_id,
            "excerpt": "",
            "provenance": "unavailable",
            "summary": "Published lesson excerpt not found." if locale == "en" else "Nashr qilingan dars parchasi topilmadi.",
        }
    excerpt = str(row.get("summary_text") or "").strip()[:MAX_LESSON_EXCERPT_CHARS]
    title = str(row.get("title") or "Lesson")
    return {
        "resolved": True,
        "lessonId": str(row["id"]),
        "title": title,
        "excerpt": excerpt,
        "provenance": "deterministic_learning_data",
        "summary": f"{title}: {excerpt}"[:MAX_LESSON_EXCERPT_CHARS],
    }


def _validate_report_input(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw.keys()) - {"targetUserId", "windowDays", "locale"}:
        raise ValueError("invalid_input")
    tid = raw.get("targetUserId")
    if tid is not None and (not isinstance(tid, str) or not UUID_RE.match(tid)):
        raise ValueError("invalid_input")
    win = int(raw.get("windowDays") or 30)
    if win not in (7, 30, 90):
        win = 30
    locale = "en" if str(raw.get("locale") or "uz").lower() == "en" else "uz"
    return {"targetUserId": tid.lower() if isinstance(tid, str) else None, "windowDays": win, "locale": locale}


def _validate_report_output(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or "reportSnapshot" not in raw or "provenance" not in raw:
        raise ValueError("invalid_output")
    return raw


async def generate_deterministic_report(conn: Any, actor: RiwiActor, data: dict[str, Any]) -> dict[str, Any]:
    target_user_id = data.get("targetUserId")
    window_days = data.get("windowDays", 30)
    locale = data.get("locale", "uz")

    if actor.role == "student":
        if target_user_id and target_user_id.lower() != actor.id.lower():
            raise RiwiTargetScopeError("forbidden")
        scope_kind = "self"
        resolved_target = actor.id
    elif actor.role == "teacher":
        if target_user_id:
            resolved_target = await authorize_target_learner_access(conn, actor, target_user_id, for_report=True)
            scope_kind = "assigned_student"
        else:
            resolved_target = None
            scope_kind = "assigned_roster"
    elif actor.role == "admin":
        if target_user_id:
            resolved_target = await authorize_target_learner_access(conn, actor, target_user_id, for_report=True)
            scope_kind = "admin_student_report"
        else:
            resolved_target = None
            scope_kind = "operational_cohort"
    elif actor.role == "owner":
        if target_user_id:
            resolved_target = await authorize_target_learner_access(conn, actor, target_user_id, for_report=True)
            scope_kind = "centre_student"
        else:
            resolved_target = None
            scope_kind = "centre"
    else:
        raise RiwiTargetScopeError("forbidden")

    metrics = {
        "evaluationsCount": 0,
        "averageWritingBand": None,
        "activeLearnersCount": 1 if resolved_target else 0,
    }
    if conn is not None and hasattr(conn, "fetchrow"):
        if resolved_target:
            row = await conn.fetchrow(
                """
                SELECT count(*)::int AS eval_count,
                       round(avg(overall_band)::numeric, 1) AS avg_band
                FROM evaluations
                WHERE user_id = $1::uuid
                """,
                resolved_target,
            )
            if row:
                metrics["evaluationsCount"] = int(row.get("eval_count") or 0)
                metrics["averageWritingBand"] = float(row["avg_band"]) if row.get("avg_band") is not None else None
        elif actor.role == "teacher":
            row = await conn.fetchrow(
                """
                SELECT count(DISTINCT tsl.student_id)::int AS learner_count,
                       count(e.id)::int AS eval_count
                FROM teacher_student_links tsl
                LEFT JOIN evaluations e ON e.user_id = tsl.student_id
                WHERE tsl.teacher_id = $1::uuid
                """,
                actor.id,
            )
            if row:
                metrics["activeLearnersCount"] = int(row.get("learner_count") or 0)
                metrics["evaluationsCount"] = int(row.get("eval_count") or 0)
        else:
            row = await conn.fetchrow(
                """
                SELECT count(DISTINCT u.id)::int AS learner_count,
                       count(e.id)::int AS eval_count
                FROM users u
                LEFT JOIN evaluations e ON e.user_id = u.id
                WHERE u.role = 'student' AND u.account_status = 'active'
                """
            )
            if row:
                metrics["activeLearnersCount"] = int(row.get("learner_count") or 0)
                metrics["evaluationsCount"] = int(row.get("eval_count") or 0)

    snapshot = {
        "scope": scope_kind,
        "targetUserId": resolved_target,
        "windowDays": window_days,
        "metrics": metrics,
        "authority": "deterministic_sql",
    }
    avg_band_str = str(metrics["averageWritingBand"]) if metrics["averageWritingBand"] is not None else "N/A"
    if locale == "en":
        summary = (
            f"Deterministic Report ({scope_kind}, {window_days}d window): "
            f"{metrics['evaluationsCount']} evaluation(s), average band: {avg_band_str}, "
            f"learners in scope: {metrics['activeLearnersCount']}."
        )
    else:
        summary = (
            f"Aniq hisobot ({scope_kind}, {window_days} kunlik davr): "
            f"{metrics['evaluationsCount']} ta baholash, o'rtacha ball: {avg_band_str}, "
            f"qamrovdagi o'quvchilar: {metrics['activeLearnersCount']}."
        )
    return {
        "resolved": True,
        "provenance": "deterministic_report",
        "reportSnapshot": snapshot,
        "summary": summary,
    }


async def explain_objective_question(
    conn: Any,
    actor: RiwiActor,
    payload: Any,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RiwiDomainToolError("invalid_input")
    attempt_id = payload.get("attemptId")
    question_id = payload.get("questionId")
    module = str(payload.get("module") or "reading").strip().lower()
    locale = "en" if str(payload.get("locale") or actor.locale or "uz").lower() == "en" else "uz"

    if module not in ("reading", "listening"):
        raise RiwiDomainToolError("invalid_input")
    cap = "riwi.reading.explain" if module == "reading" else "riwi.listening.explain"
    if not authorize_capability(actor, cap).allowed:
        raise PermissionError("forbidden")
    if not isinstance(attempt_id, str) or not UUID_RE.match(attempt_id):
        raise RiwiDomainToolError("invalid_input")
    if not isinstance(question_id, str) or not UUID_RE.match(question_id):
        raise RiwiDomainToolError("invalid_input")

    if conn is None or not hasattr(conn, "fetchrow"):
        raise LookupError("not_found")

    row = await conn.fetchrow(
        """
        SELECT a.id::text AS attempt_id,
               a.user_id::text AS user_id,
               a.status::text AS status,
               q.id::text AS question_id,
               q.prompt_text AS prompt_text,
               q.official_answer AS official_answer,
               q.accepted_answers AS accepted_answers,
               q.authored_explanation AS authored_explanation,
               r.learner_answer AS learner_answer,
               r.is_correct AS is_correct
        FROM objective_attempts a
        JOIN objective_questions q ON q.id = $2::uuid
        LEFT JOIN objective_responses r ON r.attempt_id = a.id AND r.question_id = q.id
        WHERE a.id = $1::uuid
        LIMIT 1
        """,
        attempt_id.lower(),
        question_id.lower(),
    )
    if not row:
        raise LookupError("not_found")

    if str(row.get("status") or "") not in ("submitted", "completed", "graded"):
        raise PermissionError("attempt_not_submitted")

    if actor.role == "student" and str(row["user_id"]).lower() != actor.id.lower():
        raise PermissionError("forbidden")
    elif actor.role == "teacher":
        await authorize_target_learner_access(conn, actor, str(row["user_id"]), for_report=False)

    official = str(row.get("official_answer") or "").strip()
    learner_ans = str(row.get("learner_answer") or "").strip()
    authored = str(row.get("authored_explanation") or "").strip()
    is_correct = bool(row.get("is_correct"))

    await record_riwi_audit(
        conn,
        actor_user_id=actor.id,
        action="riwi.objective_explanation.read",
        target_type=f"{module}_question",
        target_id=question_id.lower(),
        metadata={"role": actor.role, "module": module, "status": "succeeded"},
    )

    if locale == "en":
        explanation = (
            f"Official answer: {official}. Your answer: {learner_ans or '(blank)'} "
            f"({'Correct' if is_correct else 'Incorrect'}). "
            f"{authored or 'Verified against the official server answer key.'}"
        )
    else:
        explanation = (
            f"Rasmiy javob: {official}. Sizning javobingiz: {learner_ans or '(boʻsh)'} "
            f"({'Toʻgʻri' if is_correct else 'Notoʻgʻri'}). "
            f"{authored or 'Serverdagi rasmiy javob kaliti asosida tekshirildi.'}"
        )

    return {
        "ok": True,
        "module": module,
        "attemptId": attempt_id.lower(),
        "questionId": question_id.lower(),
        "isCorrect": is_correct,
        "officialAnswer": official,
        "learnerAnswer": learner_ans,
        "explanation": explanation,
        "provenance": "deterministic_learning_data",
    }


def build_default_riwi_tool_broker() -> RiwiToolBroker:
    broker = RiwiToolBroker()
    broker.register(
        RiwiToolDefinition(
            name="dictionary.lookup",
            required_capability="riwi.dictionary.lookup",
            allowed_roles=("student", "teacher", "admin", "owner"),
            input_validator=_validate_dictionary_input,
            output_validator=_validate_dictionary_output,
            handler=lookup_canonical_dictionary,
        )
    )
    broker.register(
        RiwiToolDefinition(
            name="grammar.explain",
            required_capability="riwi.grammar.explain",
            allowed_roles=("student", "teacher", "admin", "owner"),
            input_validator=_validate_grammar_input,
            output_validator=_validate_grammar_output,
            handler=lookup_canonical_grammar,
        )
    )
    broker.register(
        RiwiToolDefinition(
            name="progress.read_learner",
            required_capability="riwi.chat.self",
            allowed_roles=("student", "teacher", "owner"),
            input_validator=_validate_progress_input,
            output_validator=_validate_progress_output,
            handler=read_learner_progress_and_retention,
        )
    )
    broker.register(
        RiwiToolDefinition(
            name="lesson.read_excerpt",
            required_capability="riwi.chat.self",
            allowed_roles=("student", "teacher", "admin", "owner"),
            input_validator=_validate_lesson_input,
            output_validator=_validate_lesson_output,
            handler=read_course_lesson_excerpt,
        )
    )
    broker.register(
        RiwiToolDefinition(
            name="report.generate",
            required_capability="riwi.chat.self",
            allowed_roles=("student", "teacher", "admin", "owner"),
            input_validator=_validate_report_input,
            output_validator=_validate_report_output,
            handler=generate_deterministic_report,
        )
    )
    return broker
