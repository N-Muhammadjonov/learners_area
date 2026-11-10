"""Persist rolling schedules and earned rewards against the same owned evidence."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .browser_coach import coach
from .study_plan_evidence import ASSIGNMENTS, EVENTS, assessed_history, candidates, reading_weaknesses, vocabulary
from .study_plan_rules import SKILLS, Candidate, allocate, band_value, estimate, study_streak

PREFERENCES = """
SELECT p.*,s.target_band,s.daily_study_minutes,s.exam_date,s.weakest_skill
FROM study_plan_preferences p JOIN onboarding_profiles s ON s.user_id=p.user_id
WHERE p.user_id=$1
"""
COMPLETION_SQL = """
WITH evidence AS MATERIALIZED ({events}), completed AS (
  SELECT t.task_key,min(e.happened_at) happened_at FROM study_plan_tasks t
  JOIN evidence e ON e.source_key=t.source_key AND e.happened_at>=t.created_at
  WHERE t.user_id=$1 AND t.completed_at IS NULL GROUP BY t.task_key
)
UPDATE study_plan_tasks t SET completed_at=c.happened_at
FROM completed c WHERE t.user_id=$1 AND t.task_key=c.task_key
""".format(events=EVENTS)
REWARD_SQL = """
WITH evidence AS MATERIALIZED ({events}), eligible AS (
  SELECT CASE WHEN source_key='vocab' THEN event_key ELSE source_key END reward_key,
     points,happened_at,
     row_number() OVER (PARTITION BY source_key, CASE WHEN source_key='vocab'
           THEN (happened_at AT TIME ZONE 'UTC')::date END ORDER BY happened_at,event_key) number
  FROM evidence
)
INSERT INTO study_reward_ledger(user_id,event_key,points,earned_at)
SELECT $1,reward_key,points,happened_at FROM eligible
WHERE number <= CASE WHEN reward_key LIKE 'vocab:%' THEN 5 ELSE 1 END
ON CONFLICT(user_id,event_key) DO NOTHING
""".format(events=EVENTS)
DAILY_BONUS = """
INSERT INTO study_reward_ledger(user_id,event_key,points,earned_at)
SELECT $1,'daily:'||$2::date,4,$3::timestamptz
WHERE EXISTS(SELECT 1 FROM study_plan_tasks WHERE user_id=$1 AND planned_on=$2
             AND completed_at IS NOT NULL AND (completed_at AT TIME ZONE $4)::date=$2)
  AND NOT EXISTS(SELECT 1 FROM study_plan_tasks WHERE user_id=$1 AND planned_on=$2
                 AND completed_at IS NULL AND retired_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM study_reward_ledger WHERE user_id=$1 AND event_key LIKE 'daily:%'
                 AND earned_at > $3::timestamptz - interval '20 hours')
ON CONFLICT(user_id,event_key) DO NOTHING
"""
DAILY_STAR = "SELECT EXISTS(SELECT 1 FROM study_reward_ledger WHERE user_id=$1 AND event_key=$2)"
UPSERT = """
INSERT INTO study_plan_tasks(user_id,task_key,source_key,skill,title,href,reason,minutes,priority,
                             planned_on,original_on,pinned,state)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)
ON CONFLICT(user_id,task_key) DO UPDATE SET
 title=EXCLUDED.title,href=EXCLUDED.href,reason=EXCLUDED.reason,minutes=EXCLUDED.minutes,
 priority=EXCLUDED.priority,planned_on=EXCLUDED.planned_on,pinned=EXCLUDED.pinned,state=EXCLUDED.state,retired_at=NULL
WHERE study_plan_tasks.completed_at IS NULL AND
 (study_plan_tasks.title,study_plan_tasks.href,study_plan_tasks.reason,study_plan_tasks.minutes,
  study_plan_tasks.priority,study_plan_tasks.planned_on,study_plan_tasks.pinned,study_plan_tasks.state,study_plan_tasks.retired_at)
 IS DISTINCT FROM (EXCLUDED.title,EXCLUDED.href,EXCLUDED.reason,EXCLUDED.minutes,EXCLUDED.priority,
                   EXCLUDED.planned_on,EXCLUDED.pinned,EXCLUDED.state,NULL)
"""


def goal_payload(row: dict, configured: bool) -> dict:
    zone = ZoneInfo(row.get("timezone") or "Asia/Tashkent")
    target = row.get("target_band")
    exam = row.get("exam_date")
    weak = row.get("weakest_skill")
    return {"configured": configured, "target": target if band_value(target) else None,
            "examDate": exam.astimezone(timezone.utc).date() if exam else None,
            "minutes": row.get("daily_study_minutes") or 60,
            "weekdays": row.get("weekdays", list(range(6))),
            "timezone": zone.key, "preferredTime": row["preferred_time"].isoformat(timespec="minutes") if row.get("preferred_time") else None,
            "focusSkills": row.get("focus_skills", [weak] if weak in SKILLS else []),
            "skillTargets": row.get("skill_targets") or {}}


def task_payload(row: dict, today) -> dict:
    completed = row["completed_at"]
    return {"key": row["task_key"], "title": row["title"], "skill": row["skill"],
            "href": row["href"] if not completed and not row["retired_at"] else None, "reason": row["reason"],
            "minutes": row["minutes"], "date": row["planned_on"], "originalDate": row["original_on"],
            "status": "completed" if completed else row["state"] if not row["retired_at"] else "unavailable",
            "rescheduled": row["original_on"] != row["planned_on"],
            "missed": row["original_on"] < today and row["planned_on"] > row["original_on"]}


async def current_plan(con, user: dict, now: datetime, *, mode: str = "week",
                       reason: str | None = None, move: tuple | None = None) -> dict:
    uid = user["id"]
    prefs = await con.fetchrow(PREFERENCES + " FOR UPDATE OF p", uid)
    if not prefs:
        initial = await con.fetchrow("SELECT * FROM onboarding_profiles WHERE user_id=$1", uid)
        return {"goals": goal_payload(dict(initial or {}), False), "days": [], "latest": {}}
    goal = goal_payload(dict(prefs), True)
    zone = ZoneInfo(goal["timezone"])
    today = now.astimezone(zone).date()
    end = today + timedelta(days=6)
    await con.execute(COMPLETION_SQL, uid, now - timedelta(days=180))
    await con.execute(REWARD_SQL, uid, max(prefs["created_at"], now - timedelta(days=30)))

    if (mode == "today" and prefs["revised_on"] == today and prefs["validated_at"]
            and now - prefs["validated_at"] <= timedelta(seconds=30)):
        planned = await con.fetch("""SELECT * FROM study_plan_tasks WHERE user_id=$1
          AND planned_on=$2 AND (retired_at IS NULL OR completed_at IS NOT NULL)
          ORDER BY priority,task_key""", uid, today)
        await con.execute(DAILY_BONUS, uid, today, now, zone.key)
        latest,_ = await assessed_history(con,uid,now,zone,180)
        return {"goals":goal,"today":today,"days":[{"date":today,"tasks":[task_payload(row,today) for row in planned]}],
                "latest":latest,"dailyStar":await con.fetchval(DAILY_STAR,uid,"daily:"+today.isoformat())}

    latest, history = await assessed_history(con,uid,now,zone,180)
    vocab = await vocabulary(con, uid, now, zone)
    reading = await reading_weaknesses(con, uid, now)
    coach_data = await coach(con, uid)
    options = await candidates(con, user, now, zone, goal["focusSkills"], reading, coach_data["recommendations"], vocab["due"], goal["minutes"])
    assigned = await con.fetch(f"""SELECT * FROM ({ASSIGNMENTS}) a
        WHERE status<>'completed' AND (due_at IS NULL OR due_at < $2) ORDER BY due_at NULLS LAST,id LIMIT 100""",
        uid, datetime.combine(end + timedelta(days=1), datetime.min.time(), zone))
    for assignment in assigned:
        due_at = assignment["due_at"]
        due = due_at.astimezone(zone).date() if due_at else end
        key = "assignment:"+str(assignment["id"])
        options.append(Candidate(key, assignment["module"] or "assignment", assignment["title"],
            "/app/assignments#assignment-"+str(assignment["id"]), "assignment_overdue" if due < today else "assignment",
            25, 0, "in_progress" if assignment["status"] == "in_progress" else "planned", due))
    assessment_gaps = {skill for skill in SKILLS if skill in latest and
        latest[skill]["band"] < (goal["skillTargets"].get(skill) or goal["target"] or 0)}
    options = [replace(item,priority=item.priority-3)
               if item.priority >= 50 and item.skill in assessment_gaps else item for item in options]
    active = {(item.key+":"+today.isoformat() if item.key=="vocab" else item.key): item for item in options}

    rows = await con.fetch("""SELECT * FROM study_plan_tasks WHERE user_id=$1
        AND (planned_on BETWEEN $2 AND $3 OR (completed_at IS NULL AND retired_at IS NULL))
        ORDER BY planned_on,priority,task_key""", uid, today, end)
    completed = {row["task_key"] for row in rows if row["completed_at"]}
    previous = {row["task_key"]:row["planned_on"] for row in rows if not row["completed_at"]}
    pins = {row["task_key"] for row in rows if row["pinned"] and not row["completed_at"]} if reason != "preferences" else set()
    reserved = {}
    for row in rows:
        if row["completed_at"]:
            day = row["planned_on"]
            reserved[day] = reserved.get(day,0) + row["minutes"]
    if move:
        key, day = move
        item = active.get(key)
        if (not item or key not in previous or item.priority <= 20 or item.key == "vocab"
                or day < today or day > end or day.weekday() not in goal["weekdays"]):
            return {"error": "invalid_reschedule"}
        previous[key] = day
        pins.add(key)
    tasks = [replace(item, key=key) for key,item in active.items() if key not in completed]
    scheduled = allocate(tasks, today, set(goal["weekdays"]), goal["minutes"], reserved, previous, pins)
    if move and scheduled.get(move[0]) != move[1]:
        return {"error": "day_at_capacity"}
    revision = reason or ("reschedule" if move else "rolling_day" if prefs["revised_on"] != today else
                          "learning_evidence" if previous != scheduled else None)
    await con.execute("""UPDATE study_plan_preferences SET revised_on=$2,validated_at=$3,
        revision=revision+CASE WHEN $4::text IS NOT NULL THEN 1 ELSE 0 END,
        revision_reason=coalesce($4,revision_reason) WHERE user_id=$1""", uid,today,now,revision)
    await con.execute("""UPDATE study_plan_tasks SET retired_at=$2 WHERE user_id=$1 AND completed_at IS NULL
        AND retired_at IS NULL AND NOT (task_key=ANY($3::text[]))""", uid, now, list(scheduled))
    if scheduled:
        await con.executemany(UPSERT, [(uid,key,active[key].key,active[key].skill,active[key].title,active[key].href,
            active[key].reason,active[key].minutes,active[key].priority,day,key in pins and previous.get(key)==day,active[key].state)
            for key,day in scheduled.items()])
    await con.execute(DAILY_BONUS, uid, today, now, zone.key)

    start = today if mode != "week" else today - timedelta(days=6)
    last = today if mode == "today" else end
    planned = await con.fetch("""SELECT * FROM study_plan_tasks
        WHERE user_id=$1 AND planned_on BETWEEN $2 AND $3
          AND (retired_at IS NULL OR completed_at IS NOT NULL)
        ORDER BY planned_on,priority,task_key""", uid, start, last)
    grouped = {}
    for row in planned:
        grouped.setdefault(row["planned_on"], []).append(task_payload(row, today))
    days = [{"date": day, "tasks": grouped.get(day, [])} for day in (today+timedelta(days=i) for i in range((last-today).days+1))]
    data = {"goals": goal,"today":today,"days":days,"latest":latest,
            "dailyStar":await con.fetchval(DAILY_STAR,uid,"daily:"+today.isoformat())}
    if mode == "today":
        return data
    events = await con.fetch(f"""SELECT DISTINCT (happened_at AT TIME ZONE $3)::date AS day
        FROM ({EVENTS}) e WHERE happened_at <= $4""", uid, now - timedelta(days=365), zone.key, now)
    historical = [task for day,tasks_on_day in grouped.items() if day < today for task in tasks_on_day]
    backlog = [{"key":item.key,"title":item.title,"skill":item.skill,"minutes":item.minutes,"due":item.due_on,
                "href":item.href if item.priority == 0 else None}
               for item in tasks if item.key not in scheduled]
    study_days = {row["day"] for row in events}
    forecast = estimate(history, goal["target"], today) if not goal["examDate"] or goal["examDate"] >= today else None
    if forecast and forecast["confidence"] == "medium":
        recent_days = sum(today - timedelta(days=14) < day <= today for day in study_days)
        if recent_days < 4 or goal["minutes"] * len(goal["weekdays"]) < 180:
            forecast["confidence"] = "low"
    return {**data, "history":history,"pastTasks":historical,"backlog":backlog,"vocabulary":vocab,
            "weaknesses":[*reading,*coach_data["weaknesses"]],"forecast":forecast,
            "streak":study_streak(study_days, today),
            "revision":prefs["revision"]+bool(revision),"revisionReason":revision or prefs["revision_reason"]}
