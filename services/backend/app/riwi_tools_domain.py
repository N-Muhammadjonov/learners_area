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
    if conn is not None and hasattr(conn,'fetchrow'):
        from .step17_dictionary_read_port import active_release,entry,normalize_search
        if actor.role=='student' and hasattr(conn,'fetchval'):
            locked=await conn.fetchval("""SELECT EXISTS(SELECT 1 FROM reading_attempts WHERE user_id=$1::uuid AND status='in_progress')
                OR EXISTS(SELECT 1 FROM listening_attempts WHERE user_id=$1::uuid AND status='in_progress')""",actor.id)
            if locked:raise PermissionError('active_exam_lookup_forbidden')
        try:
            release=(await active_release(conn))['active_release_id']
            if occ_id:
                found=await conn.fetchrow("""SELECT e.lexeme_id,m.sense_id FROM lexical_occurrences o
                    JOIN dictionary_sense_mappings m ON m.app_sense_id=o.lexeme_id
                    JOIN dictionary_entries e ON e.release_id=$2 AND
                      (m.sense_id=ANY(e.sense_ids) OR (e.sense_ids IS NULL AND EXISTS(
                        SELECT 1 FROM jsonb_array_elements(e.payload->'senses') s WHERE s->>'sense_id'=m.sense_id::text)))
                    WHERE o.id=$1::uuid LIMIT 1""",occ_id,release)
            else:
                found=await conn.fetchrow("SELECT lexeme_id FROM dictionary_entries WHERE release_id=$1 AND lemma_norm=$2 ORDER BY part_of_speech,lexeme_id LIMIT 1",release,normalize_search(term))
            value=await entry(conn,found['lexeme_id'],release) if found else None
            if value:
                selected=str(found.get('sense_id') or '')
                sense=next((s for s in value['senses'] if s['sense_id']==selected),None) if selected else next(iter(value['senses']),None)
                if sense:
                    row={'id':value['lexeme_id'],'headword':value['display_lemma'],'part_of_speech':value['part_of_speech'],
                         'definition_en':sense['definition_en'],'definition_uz':', '.join(x['text'] for x in sense['translations']),
                         'example_en':next((x['text_en'] for x in sense['examples']),''),'sense_id':sense['sense_id'],'release_id':release}
        except ValueError as exc:
            if str(exc)!='dictionary_unavailable':raise
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
        "senseId": str(row.get("sense_id") or ""),
        "releaseId": row.get("release_id"),
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
                SELECT id::text AS id, title, explanation AS rule_summary, NULL::text AS common_mistake, NULL::text AS example_sentence
                FROM grammar_topics
                WHERE id = $1::uuid AND publication_state='published'
                LIMIT 1
                """,
                topic_id,
            )
        elif query:
            row = await conn.fetchrow(
                """
                SELECT id::text AS id, title, explanation AS rule_summary, NULL::text AS common_mistake, NULL::text AS example_sentence
                FROM grammar_topics
                WHERE publication_state='published' AND lower(title) LIKE '%' || $1 || '%'
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
            SELECT category AS weakness_key, occurrence_count AS occurrences
            FROM coach_weaknesses
            WHERE user_id = $1::uuid
            ORDER BY occurrence_count DESC, last_seen_at DESC
            LIMIT 5
            """,
            target_user_id,
        )
        weaknesses = [f"{r['weakness_key']} ({r['occurrences']}x)" for r in w_rows]
    if conn is not None and hasattr(conn, "fetchrow"):
        stats = await conn.fetchrow(
            """
            SELECT count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed_attempts,
                   (SELECT count(*)::int FROM user_vocabulary WHERE user_id=$1::uuid AND next_review_at<=now()) AS due_reviews
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
            SELECT l.id::text AS id, l.title, l.summary AS summary_text
            FROM lessons l JOIN units u ON u.id=l.unit_id
            JOIN course_modules m ON m.id=u.module_id
            WHERE l.id=$1::uuid AND l.publication_state='published'
              AND ($2::text='owner' OR EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=m.course_id AND e.user_id=$3::uuid))
            LIMIT 1
            """,
            lesson_id,actor.role,actor.id,
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
        if target_user_id:raise RiwiTargetScopeError("forbidden")
        row=await conn.fetchrow("SELECT count(*)::int AS learner_count FROM users WHERE role='student' AND account_status='active'")
        count=int(row['learner_count'] or 0) if row else 0
        return {'resolved':True,'provenance':'deterministic_report',
                'reportSnapshot':{'scope':'operational_cohort','targetUserId':None,'windowDays':window_days,
                    'metrics':{'activeLearnersCount':count},'authority':'deterministic_sql'},
                'summary':f'Active learners: {count}.' if locale=='en' else f'Faol o‘quvchilar: {count}.'}
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
                       round(avg(overall_estimate) FILTER (WHERE evaluation_type='writing')::numeric, 1) AS avg_band
                FROM evaluations
                WHERE user_id = $1::uuid AND created_at>=now()-$2::int*interval '1 day'
                  AND ($3::text<>'teacher' OR EXISTS(SELECT 1 FROM teacher_student_links l
                       WHERE l.teacher_user_id=$4::uuid AND l.student_user_id=evaluations.user_id AND l.created_at<=evaluations.created_at))
                """,
                resolved_target,window_days,actor.role,actor.id,
            )
            if row:
                metrics["evaluationsCount"] = int(row.get("eval_count") or 0)
                metrics["averageWritingBand"] = float(row["avg_band"]) if row.get("avg_band") is not None else None
        elif actor.role == "teacher":
            row = await conn.fetchrow(
                """
                SELECT count(DISTINCT tsl.student_user_id)::int AS learner_count,
                       count(e.id)::int AS eval_count
                FROM teacher_student_links tsl
                LEFT JOIN evaluations e ON e.user_id=tsl.student_user_id
                  AND e.created_at>=greatest(tsl.created_at,now()-$2::int*interval '1 day')
                WHERE tsl.teacher_user_id = $1::uuid
                """,
                actor.id,window_days,
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
                LEFT JOIN evaluations e ON e.user_id=u.id AND e.created_at>=now()-$1::int*interval '1 day'
                WHERE u.role = 'student' AND u.account_status = 'active'
                """,window_days
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

    # Table names come exclusively from this closed module enum.
    attempt_table,answer_table,question_table,source_column=(
        ('reading_attempts','reading_answers','reading_questions','passage_id') if module=='reading' else
        ('listening_attempts','listening_answers','listening_questions','test_id'))
    row=await conn.fetchrow(f"""SELECT a.id::text AS attempt_id,a.user_id::text AS user_id,
        a.status::text AS status,a.content_version_id,r.question_id::text AS question_id,
        a.{source_column}::text AS source_id,q."order" AS question_order,
        r.user_answer AS learner_answer,r.is_correct
        FROM {attempt_table} a JOIN {answer_table} r ON r.attempt_id=a.id AND r.question_id=$2::uuid
        JOIN {question_table} q ON q.id=r.question_id AND q.{source_column}=a.{source_column}
        WHERE a.id=$1::uuid LIMIT 1""",attempt_id.lower(),question_id.lower())
    if not row:raise LookupError('not_found')
    if str(row.get('status') or '') not in ('submitted','completed','graded'):
        raise PermissionError('attempt_not_submitted')
    if actor.role=='student' and str(row['user_id']).lower()!=actor.id.lower():
        raise PermissionError('forbidden')
    if actor.role=='teacher':
        await authorize_target_learner_access(conn,actor,str(row['user_id']),for_report=False)
    row=dict(row)
    version=row.get('content_version_id')
    question=None
    if version:
        import json
        saved=await conn.fetchrow('SELECT content_snapshot FROM content_versions WHERE id=$1::uuid AND module=$2',version,module)
        source=saved['content_snapshot'] if saved else None
        if isinstance(source,str):source=json.loads(source)
        questions=source.get('questions',[]) if isinstance(source,dict) else []
        question=next((q for q in questions if isinstance(q,dict) and str(q.get('id') or q.get('questionId') or '').lower()==question_id.lower()),None)
        # The authoring port assigns physical UUIDs after parsing the snapshot.
        # Resolve by order only within its exact revision-owned source identity.
        if question is None and isinstance(source,dict):
            if module=='reading':
                ids=source.get('canonicalPassageIds',[])
                passages=source.get('passages',[])
                if row['source_id'] in ids and ids.index(row['source_id'])<len(passages):
                    passage=passages[ids.index(row['source_id'])]
                    questions=passage.get('questions',[]) if isinstance(passage,dict) else []
                else:questions=[]
            else:
                bound=await conn.fetchval('SELECT content_version_id=$2::uuid FROM listening_questions WHERE id=$1::uuid',question_id,version)
                if not bound:questions=[]
            question=next((q for i,q in enumerate(questions) if isinstance(q,dict) and q.get('order',i+1)==row['question_order']),None)
    if question is not None:
        row['official_answer']=question.get('correct_answer',question.get('correctAnswer',''))
        row['authored_explanation']=question.get('explanation') or ''
    else:
        # Never substitute today's answer key for an unrecorded historical key.
        row['official_answer']=''
        row['authored_explanation']=('Historical answer evidence is unavailable. The correctness result below is the saved attempt outcome.'
            if locale=='en' else 'Tarixiy javob dalili mavjud emas. Quyida saqlangan urinish natijasi ko‘rsatilgan.')

    official = str(row.get("official_answer") or "").strip()
    learner_ans = str(row.get("learner_answer") or "").strip()
    authored = str(row.get("authored_explanation") or "").strip()
    is_correct = row.get("is_correct") if type(row.get("is_correct")) is bool else None

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
            f"({'Not assessed' if is_correct is None else 'Correct' if is_correct else 'Incorrect'}). "
            f"{authored or 'Verified against the official server answer key.'}"
        )
    else:
        explanation = (
            f"Rasmiy javob: {official}. Sizning javobingiz: {learner_ans or '(boʻsh)'} "
            f"({'Baholanmagan' if is_correct is None else 'Toʻgʻri' if is_correct else 'Notoʻgʻri'}). "
            f"{authored or 'Serverdagi rasmiy javob kaliti asosida tekshirildi.'}"
        )

    return {
        "ok": True,
        "module": module,
        "attemptId": attempt_id.lower(),
        "questionId": question_id.lower(),
        "isCorrect": is_correct,
        "officialAnswer": official,
        "sourceRevisionId":str(version) if version else None,
        "explanationAvailable":question is not None,
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
