"""Idempotent coin awards on top of server evidence.

`study_reward_ledger` stays the legacy points wallet. Coins live beside it so a
learner without a study plan can still be paid, and so points and coins are not
the same number. Missing tables are ignored: production keeps working until the
operator applies migration 0084.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from .coin_policy import (POLICY_VERSION, answers_complete, cap_allows, coin_level,
                          grammar_submission_ok, next_level_at, vocab_milestone_coins)

ROOT = Path(__file__).resolve().parents[3]
FAR = datetime(9999, 1, 1, tzinfo=timezone.utc)
_EFFECTIVE = None
_EFFECTIVE_READY = False
_COURSES = None
_GRAMMAR = {}
_ARTICLES = None


def reset_cache() -> None:
    global _EFFECTIVE, _EFFECTIVE_READY, _COURSES, _GRAMMAR, _ARTICLES
    _EFFECTIVE = None
    _EFFECTIVE_READY = False
    _COURSES = None
    _GRAMMAR = {}
    _ARTICLES = None


async def policy_effective(con):
    """None means the coin policy is not installed yet."""
    global _EFFECTIVE, _EFFECTIVE_READY
    if _EFFECTIVE_READY and _EFFECTIVE is not None:
        return _EFFECTIVE
    try:
        async with con.transaction():
            value = await con.fetchval(
                "SELECT effective_at FROM coin_policy WHERE version=$1", POLICY_VERSION)
    except Exception:
        value = None
    _EFFECTIVE = value
    _EFFECTIVE_READY = value is not None
    return value


async def legacy_cutoff(con):
    start = await policy_effective(con)
    return start or FAR


def course_sources() -> set[str]:
    global _COURSES
    if _COURSES is None:
        path = ROOT / "services/backend/app/original_listening_course.json"
        try:
            _COURSES = set(json.loads(path.read_text()))
        except (OSError, ValueError):
            _COURSES = set()
    return _COURSES


def _frontend_array(relative: str, declaration: str) -> list:
    """Read authored JSON arrays from source or the minified production image."""
    source = ROOT / "frontend/vanilla"
    built = Path(os.environ.get("FRONTEND_DIST", str(source / "build")))
    for base in (source, built):
        try:
            body = (base / relative).read_text()
            match = re.search(declaration, body)
            if match:
                value, _ = json.JSONDecoder().raw_decode(body[match.end():].lstrip())
                if isinstance(value, list):
                    return value
        except (OSError, ValueError):
            continue
    return []


def _grammar_catalog(level: str):
    if level not in _GRAMMAR:
        parsed = _frontend_array(f"modules/grammar/book-content-{level}.js", r"\bexport\s+default\s*")
        _GRAMMAR[level] = {unit["id"]: unit for unit in parsed
                           if isinstance(unit, dict) and isinstance(unit.get("id"), str)}
    return _GRAMMAR[level]


def grammar_exercise(level: str, unit_id: str, stage: int, exercise: int):
    units = _grammar_catalog(level)
    unit = units.get(unit_id)
    if not unit:
        return None
    stages = unit.get("stages") or []
    if not 0 <= stage < len(stages):
        return None
    blocks = stages[stage].get("ex") or []
    if not 0 <= exercise < len(blocks):
        return None
    return blocks[exercise]


def article_question_count(article_id: str) -> int | None:
    global _ARTICLES
    if _ARTICLES is None:
        parsed = _frontend_array("modules/reading/articles-data.js", r"\bexport\s+const\s+articles\s*=\s*")
        _ARTICLES = {item["id"]: item["questionCount"] for item in parsed
                     if isinstance(item, dict) and isinstance(item.get("id"), str)
                     and type(item.get("questionCount")) is int and item["questionCount"] > 0}
    return _ARTICLES.get(article_id)


async def _counts(con, user_id, module: str, media_id: str | None, session_id):
    media_today = item_today = speaking_today = session_today = 0
    if module in ("ted", "podcast"):
        media_today = await con.fetchval(
            """SELECT count(*)::int FROM coin_ledger
               WHERE user_id=$1 AND module = ANY($2::text[]) AND earned_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'""",
            user_id, ["ted", "podcast"]) or 0
        item_today = await con.fetchval(
            """SELECT count(*)::int FROM coin_ledger
               WHERE user_id=$1 AND parent_content_id=$2
                 AND earned_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'""",
            user_id, media_id) or 0
    elif module == "speaking":
        speaking_today = await con.fetchval(
            """SELECT count(*)::int FROM coin_ledger
               WHERE user_id=$1 AND module='speaking'
                 AND earned_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'""",
            user_id) or 0
        if session_id is not None:
            session_today = await con.fetchval(
                """SELECT count(*)::int FROM coin_ledger
                   WHERE user_id=$1 AND evidence_id=$2""", user_id, str(session_id)) or 0
    return media_today, item_today, speaking_today, session_today


async def completed_before_policy(con, user_id, module: str, content_id: str | None,
                                  exercise_id: str | None, start: datetime) -> bool:
    """Old completion evidence cannot become a new coin by resubmitting it."""
    from uuid import UUID

    if not content_id or not exercise_id:
        return False
    if module == "articles":
        return bool(await con.fetchval(
            """SELECT EXISTS(SELECT 1 FROM activity_events WHERE user_id=$1
               AND type='READING_ARTICLE_COMPLETIONS' AND created_at<$3
               AND payload->>$2::text='true')""", user_id, content_id, start))
    if module == "reading":
        return bool(await con.fetchval(
            """SELECT EXISTS(SELECT 1 FROM reading_attempts a
               WHERE a.user_id=$1 AND a.status='completed'
                 AND coalesce(a.submitted_at,a.started_at)<$3
                 AND EXISTS(SELECT 1 FROM reading_answers r JOIN reading_questions q ON q.id=r.question_id
                   WHERE r.attempt_id=a.id AND coalesce(q.group_id::text,'passage:'||q.passage_id::text)=$2)
                 AND NOT EXISTS(SELECT 1 FROM reading_questions q
                   WHERE coalesce(q.group_id::text,'passage:'||q.passage_id::text)=$2
                   AND NOT EXISTS(SELECT 1 FROM reading_answers r WHERE r.attempt_id=a.id
                     AND r.question_id=q.id AND btrim(coalesce(r.user_answer,''))<>'')))""",
            user_id, exercise_id, start))
    if module == "listening" and (exercise_id == "exam" or exercise_id.isdigit()):
        try:
            test_id = UUID(content_id)
        except ValueError:
            return False
        if exercise_id == "exam":
            return bool(await con.fetchval(
                """SELECT EXISTS(SELECT 1 FROM listening_attempts WHERE user_id=$1 AND test_id=$2
                   AND status='completed' AND coalesce(submitted_at,started_at)<$3)""",
                user_id, test_id, start))
        return bool(await con.fetchval(
            """SELECT EXISTS(SELECT 1 FROM listening_activity_runs WHERE user_id=$1 AND test_id=$2
               AND activity=$3 AND completed=true AND created_at<$4)""",
            user_id, test_id, int(exercise_id), start))
    return False


async def award_coin(con, user_id, event_key: str, *, module: str, activity_type: str,
                     coins: int = 1, parent_content_id: str | None = None,
                     exercise_id: str | None = None, content_revision: str | None = None,
                     evidence_id: str | None = None, session_id=None) -> bool:
    """Insert one coin. A repeated event key pays nothing."""
    if not event_key or coins < 1 or coins > 10:
        return False
    start = await policy_effective(con)
    if start is None:
        return False
    try:
        async with con.transaction():
            # Serialize all reward writes for one user, including concurrent tabs.
            await con.execute("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", str(user_id))
            if await completed_before_policy(con, user_id, module, parent_content_id, exercise_id, start):
                return False
            media_today, item_today, speaking_today, session_today = await _counts(
                con, user_id, module, parent_content_id, session_id)
            if not cap_allows(module=module, media_today=media_today, item_today=item_today,
                              speaking_today=speaking_today, session_today=session_today):
                return False
            inserted = await con.fetchval(
                """INSERT INTO coin_ledger(user_id,event_key,coins,module,activity_type,parent_content_id,
                       exercise_id,content_revision,evidence_id,policy_version)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                   ON CONFLICT(user_id,event_key) DO NOTHING RETURNING event_key""",
                user_id, event_key, coins, module, activity_type, parent_content_id,
                exercise_id, content_revision, evidence_id, POLICY_VERSION)
            return bool(inserted)
    except Exception:
        logging.getLogger(__name__).exception("coin ledger write failed for module %s", module)
        return False


async def award_answers(con, user_id, event_key: str, answers, **meta) -> bool:
    if not answers_complete(answers):
        return False
    return await award_coin(con, user_id, event_key, **meta)


async def award_vocab_milestones(con, user_id) -> int:
    start = await policy_effective(con)
    if start is None:
        return 0
    try:
        async with con.transaction():
            mastered = await con.fetchval(
                """SELECT count(*)::int FROM user_vocabulary
                   WHERE user_id=$1 AND mastered_at IS NOT NULL AND mastered_at >= $2""",
                user_id, start) or 0
    except Exception:
        return 0
    awarded = 0
    for index in range(1, vocab_milestone_coins(mastered) + 1):
        if await award_coin(con, user_id, f"vocab:mastered:{index}", module="vocabulary",
                            activity_type="milestone", exercise_id=str(index)):
            awarded += 1
    return awarded


async def award_grammar_book(con, user_id, *, level: str, unit_id: str, stage: int,
                             exercise: int, answers) -> dict:
    block = grammar_exercise(level, unit_id, stage, exercise)
    if block is None:
        return {"ok": False, "error": "not_found"}
    if block.get("kind") == "speak":
        return {"ok": True, "awarded": False, "reason": "audio_not_verified"}
    if not grammar_submission_ok(block, answers):
        return {"ok": True, "awarded": False, "reason": "incomplete"}
    key = f"grammar-book:{level}:{unit_id}:{stage}:{exercise}"
    try:
        async with con.transaction():
            await con.execute(
                """INSERT INTO grammar_book_evidence(user_id,event_key,level,unit_id,stage,exercise,answer_count,content_kind)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8)
                   ON CONFLICT(user_id,event_key) DO NOTHING""",
                user_id, key, level, unit_id, stage, exercise, len(answers), str(block.get("kind")))
    except Exception:
        return {"ok": False, "error": "unavailable"}
    paid = await award_coin(con, user_id, key, module="grammar", activity_type=str(block.get("kind")),
                            parent_content_id=unit_id, exercise_id=str(exercise),
                            content_revision=level, evidence_id=key)
    return {"ok": True, "awarded": paid, "reason": None if paid else "already_rewarded"}


async def record_practice(con, user_id, module: str, active_ms: int) -> None:
    if active_ms <= 0 or active_ms > 30000:
        return
    try:
        async with con.transaction():
            await con.execute(
                "INSERT INTO coin_practice_time(user_id,module,active_ms) VALUES($1,$2,$3)",
                user_id, module, int(active_ms))
    except Exception:
        return


async def wallet(con, user_id) -> dict:
    empty = {"earned": 0, "spent": 0, "refunded": 0, "balance": 0, "lifetime": 0, "level": 1, "nextLevelAt": LEVEL_NEXT}
    try:
        async with con.transaction():
            earned = await con.fetchval(
                "SELECT coalesce(sum(coins),0)::int FROM coin_ledger WHERE user_id=$1", user_id) or 0
            spent = await con.fetchval(
                "SELECT coalesce(sum(coins),0)::int FROM coin_spend WHERE user_id=$1", user_id) or 0
            refunded = await con.fetchval(
                "SELECT coalesce(sum(coins),0)::int FROM coin_gift_refunds WHERE user_id=$1", user_id) or 0
    except Exception:
        return empty
    balance = max(0, earned - spent + refunded)
    return {"earned": earned, "spent": spent, "refunded": refunded, "balance": balance, "lifetime": earned,
            "level": coin_level(earned), "nextLevelAt": next_level_at(earned),
            "version": POLICY_VERSION}


LEVEL_NEXT = next_level_at(0)


async def sync_listening_activities(con, user_id, source_id: str, test_id: str, status: dict,
                                    revision: str, previous: dict | None = None):
    if not status:
        return
    for name, item in (status.get("activities") or {}).items():
        prior = ((previous or {}).get("activities") or {}).get(name) or {}
        if item.get("complete") and not prior.get("complete"):
            await award_coin(con, user_id, f"listening:{source_id}:{name}", module="listening",
                             activity_type="exercise", parent_content_id=str(test_id),
                             exercise_id=name, content_revision=revision or None,
                             evidence_id=f"{source_id}:{name}")


async def media_heartbeat(con, user_id, *, session_id, media_id: str, module: str,
                          position_ms: int, playback_rate: float, playing: bool,
                          duration_ms: int | None):
    """Credit unique active wall time for a published, server-owned direct media item.

    The public heartbeat is never accepted for Speaking: a browser-selected
    mediaId and playing flag do not prove that the learner spoke.
    """
    from uuid import UUID
    from .coin_policy import advance_playback
    from .lesson_writing_port import lesson_live

    if module not in ("ted", "podcast") or not media_id or len(media_id) > 80:
        return {"error": "invalid_input"}
    try:
        canonical_id = UUID(media_id)
    except (ValueError, AttributeError, TypeError):
        return {"error": "invalid_media"}
    if await policy_effective(con) is None:
        return {"sessionId": None, "awarded": 0, "unavailable": True}
    try:
        async with con.transaction():
            # One user cannot claim overlapping intervals or bypass per-day
            # caps through simultaneous tabs.
            await con.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", str(user_id))
            server_now = await con.fetchval("SELECT clock_timestamp()")
            latest_at = await con.fetchval(
                "SELECT max(last_at) FROM coin_media_sessions WHERE user_id=$1", user_id)
            source = await con.fetchrow(
                """SELECT id,lesson_id,provider,media_kind,duration_seconds,is_active,publication_state,publish_at
                   FROM video_lessons WHERE id=$1""", canonical_id)
            expected_kind = "audio" if module == "podcast" else "video"
            if (not source or source["lesson_id"] is not None
                    or source["provider"] not in ("direct", "youtube")
                    or source["media_kind"] != expected_kind
                    or source["is_active"] is False or not lesson_live(source)):
                return {"error": "invalid_media"}
            media_id = str(source["id"])
            canonical_duration = (
                int(source["duration_seconds"]) * 1000
                if source["duration_seconds"] and source["duration_seconds"] > 0 else None)
            if canonical_duration is not None and position_ms > canonical_duration + 2000:
                return {"error": "invalid_position"}
            if session_id is not None:
                row = await con.fetchrow(
                    """SELECT id,last_at,last_position_ms,credited_ms FROM coin_media_sessions
                       WHERE id=$1 AND user_id=$2 AND media_id=$3 AND module=$4
                       FOR UPDATE""", session_id, user_id, media_id, module)
                if row is None:
                    return {"error": "invalid_session"}
            else:
                row = await con.fetchrow(
                    """INSERT INTO coin_media_sessions(user_id,media_id,module,last_at,last_position_ms)
                       VALUES($1,$2,$3,$5,$4)
                       RETURNING id,last_at,last_position_ms,credited_ms""",
                    user_id, media_id, module, max(0, int(position_ms)), server_now)
                await con.execute(
                    """INSERT INTO coin_media_coverage(user_id,media_id,bucket,credited_ms,paid)
                       VALUES($1,$2,-2,$3,$4) ON CONFLICT(user_id,media_id,bucket)
                       DO UPDATE SET credited_ms=excluded.credited_ms,paid=excluded.paid""",
                    user_id, media_id, int(playback_rate * 1000), playing)
                return {"sessionId": str(row["id"]), "awarded": 0}
            coverage_rows = await con.fetch(
                """SELECT bucket,credited_ms,paid FROM coin_media_coverage
                   WHERE user_id=$1 AND media_id=$2""", user_id, media_id)
            original = {int(item["bucket"]): int(item["credited_ms"])
                        for item in coverage_rows if item["bucket"] >= 0}
            seen = {-int(item["bucket"]) - 10: int(item["credited_ms"])
                    for item in coverage_rows if item["bucket"] <= -10}
            marker = next((item for item in coverage_rows if item["bucket"] == -2), None)
            paid_rows = await con.fetch(
                """SELECT exercise_id FROM coin_ledger
                   WHERE user_id=$1 AND parent_content_id=$2 AND activity_type='active_time'""",
                user_id, media_id)
            paid = {int(item["exercise_id"]) for item in paid_rows
                    if item["exercise_id"] and item["exercise_id"].isdigit()}
            if any(item["bucket"] == -1 and item["paid"] for item in coverage_rows):
                paid.add("short")
            state = {"at": max(row["last_at"], latest_at or row["last_at"]),
                     "position": int(row["last_position_ms"]), "seen": seen,
                     "playing": bool(marker and marker["paid"]),
                     "rate": marker["credited_ms"] / 1000 if marker else playback_rate,
                     "coverage": original, "paid": paid, "credited": int(row["credited_ms"] or 0)}
            step = advance_playback(
                state, server_now, position_ms=position_ms,
                playback_rate=playback_rate, playing=playing,
                duration_ms=canonical_duration)
            nxt = step["state"]
            await con.execute(
                """UPDATE coin_media_sessions SET last_at=$2,last_position_ms=$3,credited_ms=$4
                   WHERE id=$1""", row["id"], nxt["at"], nxt["position"], nxt["credited"])
            await con.execute(
                """INSERT INTO coin_media_coverage(user_id,media_id,bucket,credited_ms,paid)
                   VALUES($1,$2,-2,$3,$4) ON CONFLICT(user_id,media_id,bucket)
                   DO UPDATE SET credited_ms=excluded.credited_ms,paid=excluded.paid""",
                user_id, media_id, int(playback_rate * 1000), playing)
            if step["credit_ms"]:
                await con.execute(
                    "INSERT INTO coin_practice_time(user_id,module,active_ms) VALUES($1,$2,$3)",
                    user_id, module, step["credit_ms"])
            for bucket, amount in nxt["coverage"].items():
                if amount <= original.get(bucket, 0):
                    continue
                await con.execute(
                    """INSERT INTO coin_media_coverage(user_id,media_id,bucket,credited_ms,paid)
                       VALUES($1,$2,$3,$4,false)
                       ON CONFLICT(user_id,media_id,bucket) DO UPDATE
                         SET credited_ms=GREATEST(coin_media_coverage.credited_ms,excluded.credited_ms),
                             updated_at=now()""",
                    user_id, media_id, int(bucket), int(amount))
            for bucket, bounds in nxt["seen"].items():
                if bounds == seen.get(bucket):
                    continue
                await con.execute(
                    """INSERT INTO coin_media_coverage(user_id,media_id,bucket,credited_ms,paid)
                       VALUES($1,$2,$3,$4,false) ON CONFLICT(user_id,media_id,bucket)
                       DO UPDATE SET credited_ms=excluded.credited_ms,updated_at=now()""",
                    user_id, media_id, -int(bucket) - 10, int(bounds))
            awarded = 0
            for bucket in step["buckets"]:
                if await award_coin(
                        con, user_id, f"media:{user_id}:{media_id}:{bucket}",
                        module=module, activity_type="active_time",
                        parent_content_id=media_id, exercise_id=str(bucket),
                        evidence_id=str(row["id"]), session_id=row["id"]):
                    awarded += 1
            if step["short"]:
                if await award_coin(
                        con, user_id, f"media:{user_id}:{media_id}:short",
                        module=module, activity_type="short_complete",
                        parent_content_id=media_id, exercise_id="short",
                        evidence_id=str(row["id"]), session_id=row["id"]):
                    await con.execute(
                        """INSERT INTO coin_media_coverage(user_id,media_id,bucket,credited_ms,paid)
                           VALUES($1,$2,-1,$3,true)
                           ON CONFLICT(user_id,media_id,bucket) DO UPDATE
                             SET paid=true,updated_at=now()""",
                        user_id, media_id, nxt["credited"])
                    awarded += 1
            return {"sessionId": str(row["id"]), "awarded": awarded}
    except Exception:
        logging.getLogger(__name__).exception("Coin media heartbeat failed for module %s", module)
        return {"sessionId": None, "awarded": 0, "unavailable": True}

