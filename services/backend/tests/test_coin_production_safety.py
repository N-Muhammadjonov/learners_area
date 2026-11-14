"""Production coin gates exercised only against a disposable local Postgres."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from app import main
from app import coin_rewards as rewards
from app.coin_policy import advance_playback

DSN = "postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa"
MIGRATION_DIR = Path(__file__).resolve().parents[1] / "migrations"
# coin_rewards.wallet() reads coin_gift_refunds, which 0092 adds. Applying only 0084 made the
# fixture schema older than the code under test: wallet() swallowed the missing-table error and
# reported an all-zero balance, so four assertions failed for a reason that was not the wallet.
MIGRATIONS = [MIGRATION_DIR / name for name in (
    "0084_coin_economy.sql", "0091_coin_daily_referrals_gifts.sql",
    "0092_coin_gift_fulfillment.sql")]
MIGRATION = MIGRATIONS[0]


@pytest_asyncio.fixture
async def database():
    assert "@127.0.0.1:55439/coin_qa" in DSN
    try:
        con = await asyncpg.connect(DSN)
    except OSError as exc:
        import os
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')
    schema = "coin_test_" + uuid4().hex
    await con.execute(f'CREATE SCHEMA "{schema}"')
    await con.execute(f'SET search_path TO "{schema}", public')
    for role in ("anon", "authenticated", "service_role"):
        if not await con.fetchval("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", role):
            await con.execute(f'CREATE ROLE "{role}"')
    await con.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" GRANT ALL ON TABLES TO anon,authenticated,service_role')
    await con.execute("CREATE TABLE users(id uuid PRIMARY KEY,name text,role text DEFAULT 'student',account_status text DEFAULT 'active',last_meaningful_activity_at timestamptz)")
    await con.execute("""CREATE TABLE video_lessons(id uuid PRIMARY KEY,lesson_id uuid,
        provider text,media_kind text,duration_seconds integer,is_active boolean,
        publication_state text,publish_at timestamptz)""")
    for migration in MIGRATIONS:
        async with con.transaction():
            await con.execute(migration.read_text())
    rewards.reset_cache()
    user = uuid4()
    await con.execute("INSERT INTO users(id) VALUES($1)", user)
    try:
        yield con, schema, user
    finally:
        rewards.reset_cache()
        await con.execute("SET search_path TO public")
        await con.execute(f'DROP SCHEMA "{schema}" CASCADE')
        await con.close()


@pytest.mark.asyncio
async def test_migration_is_idempotent_and_private(database):
    con, schema, user = database
    before = await con.fetchval("SELECT effective_at FROM coin_policy")
    async with con.transaction():
        await con.execute(MIGRATION.read_text())
    assert await con.fetchval("SELECT effective_at FROM coin_policy") == before
    assert await con.fetchval("SELECT count(*) FROM coin_policy") == 1
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 0
    assert await con.fetchval("SELECT (rules->>'exercise')::int FROM coin_policy") == 1
    assert await con.fetchval("SELECT (rules->>'activeMinutes')::int FROM coin_policy") == 5
    rows = await con.fetch("""SELECT c.relname,c.relrowsecurity,c.relacl::text AS acl
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relkind='r' AND c.relname<>'users'
        AND c.relname<>'video_lessons'""", schema)
    assert len(rows) == 13 and all(row["relrowsecurity"] for row in rows)
    assert all("anon=" not in (row["acl"] or "") and "authenticated=" not in (row["acl"] or "")
               and "service_role=" not in (row["acl"] or "") for row in rows)


@pytest.mark.asyncio
@pytest.mark.parametrize("module", ["listening", "reading", "articles"])
async def test_partial_complete_and_duplicate_rewards(database, module):
    con, schema, user = database
    meta = {"module": module, "activity_type": "exercise"}
    assert not await rewards.award_answers(con, user, "exercise:1", ["yes", ""], **meta)
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 0
    assert await rewards.award_answers(con, user, "exercise:1", ["yes", "no"], **meta)
    assert not await rewards.award_answers(con, user, "exercise:1", ["yes", "no"], **meta)
    assert (await rewards.wallet(con, user))["balance"] == 1


@pytest.mark.asyncio
async def test_twenty_parallel_submissions_create_one_reward(database):
    con, schema, user = database
    async def submit():
        other = await asyncpg.connect(DSN)
        try:
            await other.execute(f'SET search_path TO "{schema}", public')
            return await rewards.award_coin(other, user, "same-event", module="reading", activity_type="exercise")
        finally:
            await other.close()
    assert sum(await asyncio.gather(*(submit() for _ in range(20)))) == 1
    assert await con.fetchval("SELECT sum(coins) FROM coin_ledger") == 1


@pytest.mark.asyncio
async def test_course_sync_never_backfills_completed_activities(database):
    con, schema, user = database
    status = {"activities": {"mcq": {"complete": True}, "map": {"complete": True}}}
    previous = {"activities": {"mcq": {"complete": True}, "map": {"complete": False}}}
    await rewards.sync_listening_activities(con, user, "test-1", "test-1", status, "1", previous)
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 1
    assert await con.fetchval("SELECT exercise_id FROM coin_ledger") == "map"
    await rewards.sync_listening_activities(con, user, "test-1", "test-1", status, "1", status)
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 1


@pytest.mark.asyncio
async def test_grammar_fabricated_options_and_unverified_speech_pay_zero(database, monkeypatch):
    con, schema, user = database
    monkeypatch.setattr(rewards, "grammar_exercise", lambda *args: {"kind": "mcq", "items": [{"opts": ["A", "B"]}]})
    args = dict(level="b1", unit_id="one", stage=0, exercise=0)
    result = await rewards.award_grammar_book(con, user, answers=["fabricated"], **args)
    assert not result["awarded"]
    assert await con.fetchval("SELECT count(*) FROM grammar_book_evidence") == 0
    assert (await rewards.award_grammar_book(con, user, answers=["A"], **args))["awarded"]
    assert not (await rewards.award_grammar_book(con, user, answers=["A"], **args))["awarded"]
    result = await rewards.media_heartbeat(con, user, session_id=None, media_id=str(uuid4()),
        module="speaking", position_ms=300000, playback_rate=1, playing=True, duration_ms=None)
    assert result["error"] == "invalid_input"
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 1


@pytest.mark.asyncio
async def test_real_media_clock_replay_and_parallel_sessions(database):
    con, schema, user = database
    media = uuid4()
    await con.execute("INSERT INTO video_lessons VALUES($1,NULL,'direct','video',1800,true,'published',NULL)", media)
    async def pulse(session, position, rate=1, playing=True):
        return await rewards.media_heartbeat(con, user, session_id=session, media_id=str(media),
            module="ted", position_ms=position, playback_rate=rate, playing=playing, duration_ms=1)
    first = await pulse(None, 0)
    assert not first.get("unavailable"), first
    session = __import__("uuid").UUID(first["sessionId"])
    for tick in range(1, 21):
        await con.execute("UPDATE coin_media_sessions SET last_at=clock_timestamp()-interval '15 seconds' WHERE user_id=$1", user)
        result = await pulse(session, tick * 15000)
        assert not result.get("unavailable"), result
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 1
    assert 299000 <= await con.fetchval("SELECT sum(active_ms) FROM coin_practice_time") <= 301000
    # A second tab cannot spend the same server-clock interval.
    second = await pulse(None, 0)
    assert second["awarded"] == 0
    assert (await pulse(__import__("uuid").UUID(second["sessionId"]), 15000))["awarded"] == 0
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 1
    # Replaying previously credited content at a slower speed earns nothing.
    await pulse(session, 0, rate=0.5, playing=False)
    await con.execute("UPDATE coin_media_sessions SET last_at=clock_timestamp()-interval '15 seconds' WHERE user_id=$1", user)
    await pulse(session, 0, rate=0.5)
    before = await con.fetchval("SELECT coalesce(sum(active_ms),0) FROM coin_practice_time")
    await con.execute("UPDATE coin_media_sessions SET last_at=clock_timestamp()-interval '15 seconds' WHERE user_id=$1", user)
    await pulse(session, 7500, rate=0.5)
    assert await con.fetchval("SELECT coalesce(sum(active_ms),0) FROM coin_practice_time") == before


def test_sub_slice_heartbeats_and_rate_change_replay():
    now = datetime(2026, 11, 11, tzinfo=timezone.utc)
    state = advance_playback(None, now, position_ms=0, playback_rate=2, playing=True)["state"]
    for tick in range(1, 41):
        state = advance_playback(state, now+timedelta(seconds=tick*7.5), position_ms=tick*15000,
                                 playback_rate=2, playing=True)["state"]
    assert sum(state["coverage"].values()) == 300000
    state = advance_playback(state, now+timedelta(seconds=315), position_ms=0,
                             playback_rate=0.5, playing=False)["state"]
    state = advance_playback(state, now+timedelta(seconds=330), position_ms=0,
                             playback_rate=0.5, playing=True)["state"]
    replay = advance_playback(state, now+timedelta(seconds=345), position_ms=7500,
                              playback_rate=0.5, playing=True)
    assert replay["credit_ms"] == 0 and replay["buckets"] == []


@pytest.mark.xfail(strict=True, reason="Owner decision required: short-media milestone currently becomes payable before five minutes; payout behavior is unchanged")
def test_short_media_never_pays_before_five_minutes():
    now = datetime(2026, 11, 11, tzinfo=timezone.utc)
    state = advance_playback(None, now, position_ms=0, playback_rate=1, playing=True)["state"]
    for tick in range(1, 5):
        result = advance_playback(state, now+timedelta(seconds=tick*15), position_ms=tick*15000,
                                  playback_rate=1, playing=True, duration_ms=60000)
        assert not result["buckets"] and not result["short"]
        state = result["state"]


@pytest.mark.asyncio
@pytest.mark.parametrize("module", ["reading", "listening", "articles"])
async def test_pre_policy_completions_cannot_be_replayed_for_coins(database, module):
    con, schema, user = database
    content, group, question, attempt = uuid4(), uuid4(), uuid4(), uuid4()
    await con.execute("""CREATE TABLE activity_events(user_id uuid,type text,payload jsonb,created_at timestamptz);
        CREATE TABLE reading_attempts(id uuid,user_id uuid,status text,started_at timestamptz,submitted_at timestamptz);
        CREATE TABLE reading_questions(id uuid,group_id uuid,passage_id uuid);
        CREATE TABLE reading_answers(attempt_id uuid,question_id uuid,user_answer text);
        CREATE TABLE listening_attempts(user_id uuid,test_id uuid,status text,started_at timestamptz,submitted_at timestamptz);
        CREATE TABLE listening_activity_runs(user_id uuid,test_id uuid,activity int,completed bool,created_at timestamptz)""")
    start = await con.fetchval("SELECT effective_at FROM coin_policy")
    old = start-timedelta(days=1)
    if module == "reading":
        await con.execute("INSERT INTO reading_attempts VALUES($1,$2,'completed',$3,$3)", attempt,user,old)
        await con.execute("INSERT INTO reading_questions VALUES($1,$2,$3)",question,group,content)
        await con.execute("INSERT INTO reading_answers VALUES($1,$2,'yes')",attempt,question)
        exercise = str(group)
    elif module == "listening":
        await con.execute("INSERT INTO listening_attempts VALUES($1,$2,'completed',$3,$3)",user,content,old)
        exercise = "exam"
    else:
        await con.execute("INSERT INTO activity_events VALUES($1,'READING_ARTICLE_COMPLETIONS',$2::jsonb,$3)",user,json.dumps({str(content):True}),old)
        exercise = str(content)
    result = await rewards.award_coin(con,user,"old-completion",module=module,activity_type="exercise",
                                      parent_content_id=str(content),exercise_id=exercise)
    assert result is False
    assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 0


@pytest.mark.asyncio
async def test_wallet_and_leaderboard_minimal_api_smoke(database, monkeypatch):
    from contextlib import asynccontextmanager
    from fastapi import Request
    from app import coin_port, study_plan_port
    con, schema, user = database
    await con.execute("""CREATE TABLE study_leaderboard_participants(user_id uuid,alias text);
        CREATE TABLE study_reward_ledger(user_id uuid,points integer,earned_at timestamptz DEFAULT now());
        CREATE TABLE teacher_student_links(student_user_id uuid,teacher_user_id uuid);
        CREATE TABLE subscriptions(user_id uuid,status text,current_period_end timestamptz)""")
    await con.execute("INSERT INTO study_leaderboard_participants VALUES($1,'Learner')", user)
    assert await rewards.award_coin(con,user,"fresh",module="reading",activity_type="exercise")
    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield con
    async def pool():
        return Pool()
    async def current_user(*args, **kwargs):
        return {"id":user,"role":"student"}
    monkeypatch.setattr(main,"pool",pool)
    monkeypatch.setattr(main,"current_user",current_user)
    req = Request({"type":"http","method":"GET","path":"/","headers":[],"query_string":b""})
    wallet = await coin_port.coin_wallet(req)
    assert wallet.status_code == 200 and json.loads(wallet.body)["balance"] == 1
    board = await study_plan_port.leaderboard(req)
    body = json.loads(board.body)
    assert board.status_code == 200 and len(body["standings"]) == 1
    assert body["standings"][0]["coins"] == 1 and body["standings"][0]["rank"] == 1
    assert await con.fetchval("SELECT count(*) FROM study_reward_ledger") == 0


def test_health_alias_has_the_existing_liveness_response():
    from fastapi.testclient import TestClient
    from app.asgi import application
    with TestClient(application) as client:
        health = client.get("/health")
        existing = client.get("/healthz")
    assert health.status_code == existing.status_code == 200
    assert health.json() == existing.json()


@pytest.mark.parametrize("kind", ["tr", "transform", "fix", "typed", "fill"])
def test_grammar_free_text_requires_an_authored_answer(kind):
    from app.coin_policy import grammar_submission_ok
    exercise = {"kind":kind,"items":[{"a":["She studies English."]}]}
    assert not grammar_submission_ok(exercise,["fabricated"])
    assert grammar_submission_ok(exercise,[" she studies English "])


def test_grammar_repeated_junk_does_not_complete_writing():
    from app.coin_policy import grammar_submission_ok
    assert not grammar_submission_ok({"kind":"write","min":25},["fake "*25])


def test_coin_catalogs_load_from_the_minified_docker_layout(tmp_path, monkeypatch):
    import shutil
    root = Path(__file__).resolve().parents[3]
    built = root / "frontend/vanilla/build"
    target = tmp_path / "frontend/vanilla/build"
    for relative in ("modules/grammar/book-content-b1.js", "modules/reading/articles-data.js"):
        (target / relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(built / relative, target / relative)
    monkeypatch.setattr(rewards,"ROOT",tmp_path)
    monkeypatch.delenv("FRONTEND_DIST",raising=False)
    rewards.reset_cache()
    assert rewards.grammar_exercise("b1","a0-1",0,0) is not None
    assert rewards.article_question_count("plastic-bags") == 13
    rewards.reset_cache()
