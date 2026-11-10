"""Read owned learning evidence and eligible material through the current modules."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from .browser_coach import coach
from .browser_common import live
from .browser_reading import academic_catalogue
from .browser_listening import catalogue as listening_catalogue
from .browser_curriculum import roadmap
from .mock_scoring_engine import convert_raw_to_band, current_weekly_slot, round_half_or_whole
from .step21_reading_port import TYPE_IDS
from .study_plan_rules import Candidate, SKILLS, band_value

ASSIGNMENTS = """
    SELECT a.id,a.title,a.module,coalesce(t.status,a.status)::text status,
           coalesce(t.due_at,a.due_at) due_at,t.completed_at
    FROM assignments a
    LEFT JOIN assignment_targets t ON t.assignment_id=a.id AND t.student_user_id=$1
    WHERE t.id IS NOT NULL OR a.target_user_id=$1
"""

# Never accept or read a browser-supplied completion, score, duration, or reward.
EVENTS = """
    SELECT 'reading:'||a.id event_key,
           'reading:'||coalesce(s.set_id,a.passage_id) source_key,a.submitted_at happened_at,5 points
    FROM reading_attempts a LEFT JOIN reading_assessments s ON s.attempt_id=a.id
    WHERE a.user_id=$1 AND a.status='completed' AND a.score IS NOT NULL
      AND a.total_questions>0 AND a.submitted_at >= $2
      AND EXISTS(SELECT 1 FROM reading_answers answer WHERE answer.attempt_id=a.id
          AND btrim(coalesce(answer.user_answer,''))<>'')
    UNION ALL
    SELECT 'reading-practice:'||passage_id,'reading-practice:'||passage_id,checked_at,5
    FROM study_reading_practice_evidence WHERE user_id=$1 AND checked_at >= $2
    UNION ALL
    SELECT 'listening:'||id,'listening:'||test_id,submitted_at,5
    FROM listening_attempts a WHERE user_id=$1 AND status='completed' AND score IS NOT NULL
      AND total_questions>0 AND submitted_at >= $2
      AND EXISTS(SELECT 1 FROM listening_answers answer WHERE answer.attempt_id=a.id
          AND btrim(coalesce(answer.user_answer,''))<>'')
    UNION ALL
    SELECT 'writing:'||id,'writing:'||prompt_id,submitted_at,5
    FROM writing_submissions WHERE user_id=$1 AND status<>'draft' AND word_count>0 AND submitted_at >= $2
    UNION ALL
    SELECT 'speaking:'||id,'speaking:'||prompt_id,submitted_at,5
    FROM speaking_attempts WHERE user_id=$1 AND status IN ('submitted','reviewed')
      AND prompt_id IS NOT NULL AND recording_size>0 AND submitted_at >= $2
    UNION ALL
    SELECT 'grammar:'||id,'grammar:'||(payload->>'topicId'),created_at,3
    FROM activity_events WHERE user_id=$1 AND type='GRAMMAR_TOPIC_ATTEMPTED'
      AND payload->>'topicId' IS NOT NULL AND created_at >= $2
    UNION ALL
    SELECT 'lesson:'||lesson_id,'lesson:'||lesson_id,completed_at,3
    FROM lesson_progress WHERE user_id=$1 AND state='completed' AND completed_at >= $2
    UNION ALL
    SELECT 'mock:'||id,'mock:'||mock_test_id,coalesce(submitted_at,finished_at),8
    FROM mock_attempts WHERE user_id=$1 AND status NOT IN ('in_progress','abandoned')
      AND mock_test_id IS NOT NULL AND coalesce(submitted_at,finished_at) >= $2
    UNION ALL
    SELECT 'assignment:'||assignment_id,'assignment:'||assignment_id,completed_at,5
    FROM assignment_targets WHERE student_user_id=$1 AND status='completed' AND completed_at >= $2
    UNION ALL
    SELECT 'vocab:'||id,'vocab',created_at,2
    FROM activity_events WHERE user_id=$1 AND type='VOCAB_REVIEWED'
      AND payload->>'outcome' IN ('correct','incorrect') AND created_at >= $2
"""

ASSESSMENTS = """
    SELECT 'reading' skill,a.score raw,a.total_questions total,NULL::real band,a.submitted_at at,
           'academic' track,'academic_test' source
    FROM reading_attempts a JOIN reading_assessments m ON m.attempt_id=a.id
    WHERE a.user_id=$1 AND a.status='completed' AND a.total_questions=40 AND a.submitted_at >= $2
    UNION ALL
    SELECT 'listening',score,total_questions,NULL,submitted_at,'academic','full_test'
    FROM listening_attempts WHERE user_id=$1 AND status='completed' AND total_questions=40 AND submitted_at >= $2
    UNION ALL
    SELECT e.evaluation_type::text,NULL,NULL,e.overall_estimate,e.created_at,'academic','rubric'
    FROM evaluations e
    WHERE e.user_id=$1 AND e.overall_estimate IS NOT NULL AND e.created_at >= $2
      AND ((e.source_type='writing_submission' AND e.evaluation_type='writing'
            AND EXISTS(SELECT 1 FROM writing_submissions w WHERE w.id=e.source_id AND w.user_id=$1 AND w.submitted_at IS NOT NULL))
        OR (e.source_type='speaking_attempt' AND e.evaluation_type='speaking'
            AND EXISTS(SELECT 1 FROM speaking_attempts s WHERE s.id=e.source_id AND s.user_id=$1 AND s.status='reviewed')))
    UNION ALL
    SELECT 'writing',NULL,NULL,f.overall_band,f.created_at,'academic','teacher'
    FROM writing_feedback f JOIN writing_submissions w ON w.id=f.submission_id
    WHERE w.user_id=$1 AND w.submitted_at IS NOT NULL AND f.teacher_id IS NOT NULL
      AND f.overall_band IS NOT NULL AND f.created_at >= $2
    UNION ALL
    SELECT s.skill,NULL,NULL,s.band,coalesce(a.finished_at,s.submitted_at),'academic','mock'
    FROM mock_section_submissions s JOIN mock_attempts a ON a.id=s.attempt_id
    WHERE a.user_id=$1 AND s.band IS NOT NULL AND coalesce(a.finished_at,s.submitted_at) >= $2
      AND (s.status='published' OR (s.skill IN ('reading','listening') AND s.status IN ('auto_graded','completed')))
    UNION ALL
    SELECT 'overall',NULL,NULL,estimated_band,finished_at,'academic','mock'
    FROM mock_attempts WHERE user_id=$1 AND estimated_band IS NOT NULL AND finished_at >= $2
      AND coalesce(mock_snapshot->>'kind','')='full' AND status NOT IN ('in_progress','abandoned')
    ORDER BY at DESC, skill, source, band DESC NULLS LAST, raw DESC NULLS LAST LIMIT 160
"""

READING_EVIDENCE = """
    WITH practices AS (
      SELECT passage_id,checked_at,scores FROM study_reading_practice_evidence
      WHERE user_id=$1 AND checked_at >= $2 ORDER BY checked_at DESC,passage_id LIMIT 16
    ), recent AS (
      SELECT id,submitted_at FROM reading_attempts WHERE user_id=$1 AND status='completed'
        AND score IS NOT NULL AND submitted_at >= $2 ORDER BY submitted_at DESC,id LIMIT 16
    )
    SELECT a.id,a.submitted_at,coalesce(nullif(q.type_code,''),q.type::text) kind,
           count(*)::int total,count(*) FILTER (WHERE r.is_correct)::int correct
    FROM recent a JOIN reading_answers r ON r.attempt_id=a.id
    JOIN reading_questions q ON q.id=r.question_id GROUP BY a.id,a.submitted_at,kind
    UNION ALL
    SELECT p.passage_id,p.checked_at,t.key,(t.value->>'total')::int,(t.value->>'correct')::int
    FROM practices p CROSS JOIN LATERAL jsonb_each(p.scores) t
    ORDER BY submitted_at DESC,id,kind
"""


async def assessed_history(con, uid, now: datetime, zone: ZoneInfo, days: int) -> tuple[dict, list[dict]]:
    rows = await con.fetch(ASSESSMENTS, uid, now - timedelta(days=days))
    by_day = {}
    for row in reversed(rows):
        band = row["band"]
        if band is None and row["raw"] is not None:
            mapped = convert_raw_to_band(row["skill"], row["raw"], row["total"], row["track"])
            band = mapped["band"] if mapped else None
        if band_value(band):
            day = row["at"].astimezone(zone).date()
            by_day[day, row["skill"]] = {"skill": row["skill"], "day": day, "band": float(band), "source": row["source"]}
    latest = {}
    history = []
    for day in sorted({day for day, _ in by_day}):
        for skill in (*SKILLS, "overall"):
            if sample := by_day.get((day, skill)):
                latest[skill] = sample
                history.append(sample)
        if (day, "overall") not in by_day and all(
            skill in latest and (day - latest[skill]["day"]).days <= 42 for skill in SKILLS
        ):
            overall = {"skill": "overall", "day": day, "source": "skills",
                       "band": round_half_or_whole(sum(latest[skill]["band"] for skill in SKILLS) / 4)}
            latest["overall"] = overall
            history.append(overall)
    return latest, history


async def vocabulary(con, uid, now: datetime, zone: ZoneInfo) -> dict:
    rows = await con.fetch("""SELECT mastery,count(*)::int count,
        count(*) FILTER (WHERE next_review_at <= $2)::int due
        FROM user_vocabulary WHERE user_id=$1 GROUP BY mastery""", uid, now)
    reviews = await con.fetch("""SELECT (created_at AT TIME ZONE $3)::date AS day,count(*)::int count,
        count(*) FILTER (WHERE payload->>'outcome'='correct')::int correct
        FROM activity_events WHERE user_id=$1 AND type='VOCAB_REVIEWED' AND created_at >= $2
          AND payload->>'outcome' IN ('correct','incorrect') GROUP BY day ORDER BY day""",
        uid, now - timedelta(days=7), zone.key)
    today = now.astimezone(zone).date()
    recent = [dict(row) for row in reviews if (today - row["day"]).days < 7]
    count = sum(row["count"] for row in recent)
    return {"total": sum(row["count"] for row in rows), "due": sum(row["due"] for row in rows),
            "mastery": {level: sum(row["count"] for row in rows if row["mastery"] == level)
                        for level in ("new","learning","known","active","mastered")},
            "reviews": recent, "recall": round(sum(row["correct"] for row in recent) * 100 / count) if count else None}


async def reading_weaknesses(con, uid, now: datetime) -> list[dict]:
    groups = {}
    for row in await con.fetch(READING_EVIDENCE, uid, now - timedelta(days=120)):
        kind = TYPE_IDS.get(row["kind"].lower())
        if not kind:
            continue
        attempt = groups.setdefault(kind, {}).setdefault(row["id"], [row["submitted_at"], 0, 0])
        attempt[1] += row["correct"]
        attempt[2] += row["total"]
    result = []
    for kind, attempts in groups.items():
        samples = list(attempts.values())
        if sum(row[2] for row in samples) < 3:
            continue
        recent, older = samples[:2], samples[2:]
        accuracy = lambda rows: sum(row[1] for row in rows) / sum(row[2] for row in rows)
        current = accuracy(recent)
        previous = accuracy(older) if older else None
        if current >= .75 and (previous is None or previous >= .75):
            continue
        enough = len(recent) >= 2 and sum(row[2] for row in recent) >= 6
        status = ("resolved" if current >= .8 else "improving") if enough and previous is not None and current - previous >= .15 else "open"
        result.append({"area": "reading", "category": kind, "label": kind.replace("_", " ").title(),
                       "recentSeverity": "high" if current < .5 else "medium",
                       "occurrenceCount": sum(row[2] - row[1] for row in samples),
                       "lastSeenAt": samples[0][0], "status": status,
                       "history": [{"at": at, "correct": correct, "total": total} for at, correct, total in reversed(samples)]})
    return sorted(result, key=lambda row: (row["status"] == "resolved", -row["occurrenceCount"], row["category"]))


async def candidates(con, user: dict, now: datetime, zone: ZoneInfo, focus: list[str],
                     weak: list[dict], recommendations: list[dict], due_count: int, budget: int) -> list[Candidate]:
    uid = user["id"]
    today = now.astimezone(zone).date()
    result = []
    if due_count:
        result.append(Candidate("vocab", "vocabulary", "Vocabulary SRS", "/app/vocabulary?tab=revision", "vocab_due", 10, 40, due_on=today, opens_on=today))
    categories = [row["category"] for row in weak if row["status"] != "resolved"]
    practice = None
    if categories or budget < 60:
        aliases = [key for key,value in TYPE_IDS.items() if value in categories]
        practice = await con.fetchrow(f"""SELECT g.set_id,g.passage_id,g.passage_no,p.title,p.suggested_minutes,
               coalesce(array_agg(DISTINCT lower(coalesce(nullif(q.type_code,''),q.type::text)))
                   FILTER(WHERE lower(coalesce(nullif(q.type_code,''),q.type::text))=ANY($2::text[])),ARRAY[]::text[]) focus,
               saved.user_id IS NOT NULL started
            FROM general_reading_passages g
            JOIN general_reading_sets s ON s.id=g.set_id
            JOIN reading_passages p ON p.id=g.passage_id
            JOIN reading_questions q ON q.passage_id=p.id
            LEFT JOIN general_reading_progress saved ON saved.passage_id=p.id AND saved.user_id=$1
            WHERE g.reading_mode='general_practice' AND {live('s')} AND {live('p')}
              AND NOT EXISTS(SELECT 1 FROM study_reading_practice_evidence ev WHERE ev.user_id=$1 AND ev.passage_id=p.id)
              AND p.suggested_minutes BETWEEN 1 AND $3
              AND NOT EXISTS (SELECT 1 FROM general_reading_passages sibling JOIN reading_passages sp ON sp.id=sibling.passage_id
                 WHERE sibling.set_id=s.id AND NOT {live('sp')})
              AND NOT EXISTS(SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:'||s.id::text)::uuid AND e.type='CONTENT_DELETED')
            GROUP BY g.set_id,g.passage_id,g.passage_no,p.title,p.suggested_minutes,saved.user_id
            ORDER BY cardinality(coalesce(array_agg(DISTINCT lower(coalesce(nullif(q.type_code,''),q.type::text)))
                FILTER(WHERE lower(coalesce(nullif(q.type_code,''),q.type::text))=ANY($2::text[])),ARRAY[]::text[])) DESC,
                saved.user_id IS NULL,p.suggested_minutes,g.passage_id LIMIT 1""",uid,aliases,budget)
    if practice:
        item = str(practice["passage_id"])
        matching = {TYPE_IDS.get(alias) for alias in practice["focus"]}
        weakness = next((category for category in categories if category in matching), None)
        result.append(Candidate("reading-practice:"+item,"reading",practice["title"],
            "/app/reading/general/"+str(practice["set_id"])+"?passage="+str(practice["passage_no"]),
            "reading:"+weakness if weakness else "diagnostic",practice["suggested_minutes"],25 if weakness else 55,
            "in_progress" if practice["started"] else "planned"))
    if budget >= 60 and (reading := next((row for row in await academic_catalogue(con, user)
                        if not row["locked"] and row["assessmentStatus"] != "completed"), None)):
        item_id = reading["id"]
        details = await con.fetchval("""SELECT array_agg(DISTINCT coalesce(nullif(q.type_code,''),q.type::text))
            FROM general_reading_passages g JOIN reading_questions q ON q.passage_id=g.passage_id
            WHERE g.set_id=$1""", item_id)
        available_types = {TYPE_IDS.get(value.lower()) for value in details or []}
        weakness = next((row for row in weak if row["status"] != "resolved" and row["category"] in available_types), None)
        href = "/app/reading/academic/" + item_id
        if reading["assessmentStatus"] == "in_progress":
            href = "/app/reading/attempts/" + reading["attemptId"]
        result.append(Candidate("reading:"+item_id, "reading", reading["title"], href,
            "reading:"+weakness["category"] if weakness else "diagnostic", 60, 30 if weakness else 55,
            "in_progress" if reading["assessmentStatus"] == "in_progress" else "planned"))

    listening = await listening_catalogue(con, user, "academic_full_test", {})
    if item := next((row for row in listening["cards"] if not row["locked"] and not row["exam"]), None):
        result.append(Candidate("listening:"+item["testId"], "listening", item["title"],
            "/app/listening/tests/"+item["testId"]+"/1", "diagnostic", item["minutes"] or 30, 55,
            "in_progress" if item["started"] else "planned"))

    writing = await con.fetchrow(f"""SELECT p.id,p.category,p.task_type,
        (SELECT s.id FROM writing_submissions s WHERE s.user_id=$1 AND s.prompt_id=p.id
          AND s.status='draft' ORDER BY s.updated_at DESC LIMIT 1) draft
        FROM writing_prompts p WHERE {live('p')} AND p.is_active
          AND NOT EXISTS(SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:'||p.id::text)::uuid AND e.type='CONTENT_DELETED')
          AND NOT EXISTS(SELECT 1 FROM writing_submissions s WHERE s.user_id=$1 AND s.prompt_id=p.id AND s.submitted_at IS NOT NULL)
        ORDER BY draft NULLS LAST,p.created_at,p.id LIMIT 1""", uid)
    if writing:
        rec = next((row for row in recommendations if row["area"] == "writing"), None)
        result.append(Candidate("writing:"+str(writing["id"]), "writing", writing["category"],
            "/app/writing/submissions/"+str(writing["draft"]) if writing["draft"] else "/app/writing/prompts/"+str(writing["id"]),
            "coach:"+rec["reason"] if rec else "diagnostic", 20 if writing["task_type"] == "task1" else 40,
            32 if rec else 55, "in_progress" if writing["draft"] else "planned"))

    speaking = await con.fetchrow(f"""SELECT p.id,p.part,p.prompt_text FROM speaking_prompts p
        WHERE {live('p')} AND p.is_active AND p.part IN ('part1','part2','part3')
          AND (p.available_in @> '["ai"]'::jsonb OR p.available_in @> '["practice_alone"]'::jsonb)
          AND NOT EXISTS(SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:'||p.id::text)::uuid AND e.type='CONTENT_DELETED')
          AND NOT EXISTS(SELECT 1 FROM speaking_attempts s WHERE s.user_id=$1 AND s.prompt_id=p.id AND s.submitted_at IS NOT NULL)
        ORDER BY p.part,p.created_at,p.id LIMIT 1""", uid)
    if speaking:
        rec = next((row for row in recommendations if row["area"] == "speaking"), None)
        result.append(Candidate("speaking:"+str(speaking["id"]), "speaking", speaking["prompt_text"],
            "/app/speaking/ai?"+urlencode({"part": speaking["part"], "promptId": speaking["id"]}),
            "coach:"+rec["reason"] if rec else "diagnostic", 10, 32 if rec else 55))

    grammar_rec = next((row for row in recommendations if row["area"] == "grammar"), None)
    if grammar_rec:
        grammar = await con.fetchrow("""SELECT t.id,t.title FROM grammar_topics t WHERE t.publication_state='published'
            AND EXISTS(SELECT 1 FROM grammar_exercises e WHERE e.topic_id=t.id
                AND (e.source_owner_user_id IS NULL OR e.source_owner_user_id=$1))
            AND NOT EXISTS(SELECT 1 FROM activity_events e WHERE e.user_id=$1 AND e.type='GRAMMAR_TOPIC_ATTEMPTED'
                AND e.payload->>'topicId'=t.id::text) ORDER BY t."order",t.id LIMIT 1""",uid)
        if grammar:
            result.append(Candidate("grammar:"+str(grammar["id"]),"grammar",grammar["title"],
                "/app/grammar/"+str(grammar["id"]),"coach:"+grammar_rec["reason"],15,33))
    course = await roadmap(con, user)
    lessons = (lesson for module in (course or {}).get("modules", []) for unit in module["units"] for lesson in unit["lessons"])
    lesson = next((row for row in lessons if row["state"] in ("available", "assigned", "in_progress")), None)
    if lesson:
        result.append(Candidate("lesson:"+lesson["id"], "course", lesson["title"],
            "/app/courses/ielts/lessons/"+lesson["id"], "foundation", 15, 60,
            "in_progress" if lesson["state"] == "in_progress" else "planned"))

    slot = current_weekly_slot(now)
    mock = await con.fetchrow(f"""SELECT t.id,t.title,schedule.starts_at,schedule.ends_at,a.status FROM mock_tests t
        JOIN mock_schedules schedule ON schedule.mock_test_id=t.id
        LEFT JOIN mock_attempts a ON a.user_id=$1 AND a.weekly_slot=$2 AND a.status<>'abandoned'
        WHERE t.kind='full' AND {live('t')} AND schedule.starts_at <= $3 AND schedule.ends_at > $4 AND schedule.published_at IS NOT NULL
          AND (a.id IS NULL OR (a.mock_test_id=t.id AND a.status='in_progress'))
        ORDER BY schedule.starts_at,t.id LIMIT 1""", uid, slot, now + timedelta(days=7), now)
    if mock:
        result.append(Candidate("mock:"+str(mock["id"]), "mock", mock["title"], "/app/mocks",
            "scheduled_mock", 165, 20, "in_progress" if mock["status"] else "planned",
            mock["ends_at"].astimezone(zone).date(), mock["starts_at"].astimezone(zone).date()))
    return [Candidate(item.key,item.skill,item.title,item.href,item.reason,item.minutes,
                      item.priority - (2 if item.skill in focus else 0),item.state,item.due_on,item.opens_on)
            for item in result]
