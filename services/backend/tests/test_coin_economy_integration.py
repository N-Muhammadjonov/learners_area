"""Disposable Postgres and ASGI checks for daily coins, Telegram friends and gifts."""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import asyncpg
import httpx
import pytest
import pytest_asyncio

from app import main
from app import coin_economy_port as economy
from app import coin_rewards as rewards

DSN = "postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa"
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


class Lease:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False


class Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return Lease(self.connection)


@pytest_asyncio.fixture
async def setup_db():
    assert "@127.0.0.1:55439/coin_qa" in DSN
    try:
        connection = await asyncpg.connect(DSN)
    except OSError as exc:
        import os
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')
    schema = "coin_economy_test_" + uuid4().hex
    await connection.execute(f'CREATE SCHEMA "{schema}"')
    await connection.execute(f'SET search_path TO "{schema}", public')
    await connection.execute(
        """CREATE TABLE users (
              id uuid PRIMARY KEY, telegram_id varchar(40) UNIQUE,
              role text NOT NULL DEFAULT 'student',
              name text NOT NULL DEFAULT 'Test person',
              account_status text NOT NULL DEFAULT 'active',
              created_at timestamptz NOT NULL DEFAULT clock_timestamp()
           )""")
    await connection.execute(
        """CREATE TABLE notifications (
              id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
              user_id uuid NOT NULL REFERENCES users(id),
              type text NOT NULL, title text NOT NULL, body text NOT NULL,
              href text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb
           )""")
    await connection.execute(
        """CREATE TABLE telegram_contacts (
              telegram_user_id varchar(40) PRIMARY KEY,
              linked_user_id uuid,
              username varchar(40),
              removed_at timestamptz,
              last_seen_at timestamptz DEFAULT now()
           )""")
    await connection.execute(
        """CREATE TABLE video_lessons (
              id uuid PRIMARY KEY, lesson_id uuid, provider text,
              media_kind text, duration_seconds integer, is_active boolean,
              publication_state text, publish_at timestamptz
           )""")
    for role in ("anon", "authenticated", "service_role"):
        exists = await connection.fetchval("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", role)
        if not exists:
            await connection.execute(f'CREATE ROLE "{role}"')
    for version in ("0084_coin_economy.sql", "0091_coin_daily_referrals_gifts.sql",
                    "0092_coin_gift_fulfillment.sql"):
        await connection.execute((MIGRATIONS / version).read_text())
    # Reapplying the additive fulfillment migration must not duplicate constraints.
    await connection.execute((MIGRATIONS / "0092_coin_gift_fulfillment.sql").read_text())
    rewards.reset_cache()
    inviter = uuid4()
    await connection.execute(
        "INSERT INTO users(id,telegram_id) VALUES($1,'123456789')", inviter)
    try:
        yield connection, schema, inviter
    finally:
        rewards.reset_cache()
        await connection.execute("SET search_path TO public")
        await connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
        await connection.close()


async def make_client(monkeypatch, connection, user):
    owner = {"current": user}
    async def auth(_req, active=False):
        current = owner["current"]
        return current if not active or current["account_status"] == "active" else None
    async def get_pool():
        return Pool(connection)
    monkeypatch.setattr(main, "current_user", auth)
    monkeypatch.setattr(main, "pool", get_pool)
    transport = httpx.ASGITransport(app=main.app)
    return httpx.AsyncClient(transport=transport, base_url="http://test.local"), owner


@pytest.mark.asyncio
async def test_private_schema_and_single_daily_claim(setup_db, monkeypatch):
    con, schema, inviter = setup_db
    for name in ("coin_referrals", "coin_referral_codes", "coin_daily_claims",
                 "coin_gifts", "coin_gift_purchases", "coin_gift_refunds"):
        row = await con.fetchrow(
            """SELECT c.relrowsecurity AS rls, coalesce(c.relacl::text,'') AS acl
               FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname=$1 AND c.relname=$2""", schema, name)
        assert row and row["rls"]
        assert not any(f"{role}=" in row["acl"] for role in ("anon", "authenticated", "service_role"))
    user = {"id": inviter, "telegram_id": "123456789", "role": "student", "account_status": "active"}
    client, identity = await make_client(monkeypatch, con, user)
    async with client:
        first = await client.post("/api/coins/daily/claim")
        assert first.status_code == 200, first.text
        assert first.json()["awarded"] == 1
        assert first.json()["wallet"]["balance"] == 1
        second = await client.post("/api/coins/daily/claim")
        assert second.status_code == 200 and second.json()["awarded"] == 0
    assert await con.fetchval("SELECT count(*) FROM coin_daily_claims") == 1
    assert await con.fetchval("SELECT sum(coins) FROM coin_ledger") == 1


@pytest.mark.asyncio
async def test_repeating_seven_day_cycle_and_reset_after_gap(setup_db):
    con, schema, inviter = setup_db
    today = await con.fetchval("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Tashkent')::date")
    await con.execute(
        "INSERT INTO coin_daily_claims(user_id,claim_date,streak_day,coins) VALUES($1,$2,6,6)",
        inviter, today - timedelta(days=1))
    result = await economy.claim_daily(con, inviter)
    assert result["streak"] == 7 and result["awarded"] == 7
    assert await con.fetchval("SELECT sum(coins) FROM coin_ledger") == 7
    other = uuid4()
    await con.execute("INSERT INTO users(id,telegram_id) VALUES($1,'444555666')", other)
    await con.execute(
        "INSERT INTO coin_daily_claims(user_id,claim_date,streak_day,coins) VALUES($1,$2,7,7)",
        other, today - timedelta(days=1))
    assert (await economy.claim_daily(con, other))["awarded"] == 1
    gap = uuid4()
    await con.execute("INSERT INTO users(id,telegram_id) VALUES($1,'222333444')", gap)
    await con.execute(
        "INSERT INTO coin_daily_claims(user_id,claim_date,streak_day,coins) VALUES($1,$2,5,5)",
        gap, today - timedelta(days=2))
    assert (await economy.claim_daily(con, gap))["awarded"] == 1


@pytest.mark.asyncio
async def test_telegram_invite_requires_new_active_student_and_pays_once(setup_db, monkeypatch):
    con, schema, inviter = setup_db
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "test_learner_area_bot")
    monkeypatch.setattr(economy, "verify_bot", lambda _req: None)
    active = {"id": inviter, "telegram_id": "123456789", "role": "student", "account_status": "active"}
    client, identity = await make_client(monkeypatch, con, active)
    async with client:
        link = await client.post("/api/coins/referral-link")
        assert link.status_code == 200, link.text
        assert "?start=r_" in link.json()["url"]
        code = link.json()["url"].split("?start=r_", 1)[1]
        self_invite = await client.post("/api/internal/telegram/coins/referral",
                                        json={"telegramUserId": "123456789", "code": code})
        assert self_invite.status_code == 409
        request = {"telegramUserId": "987654321", "code": code}
        pending = await client.post("/api/internal/telegram/coins/referral", json=request)
        assert pending.status_code == 200 and pending.json()["pending"]
        assert (await client.post("/api/internal/telegram/coins/referral", json=request)).status_code == 409
        assert await con.fetchval("SELECT count(*) FROM coin_ledger") == 0
        invitee = uuid4()
        await con.execute(
            "INSERT INTO users(id,telegram_id,account_status) VALUES($1,'987654321','pending')", invitee)
        # Production current_user() intentionally omits telegram_id.
        identity["current"] = {"id": invitee,
                               "role": "student", "account_status": "pending"}
        assert (await client.post("/api/coins/daily/claim")).status_code == 401
        # Activate the new account; the first real website visit pays the inviter.
        await con.execute("UPDATE users SET account_status='active' WHERE id=$1", invitee)
        identity["current"]["account_status"] = "active"
        claim = await client.post("/api/coins/daily/claim")
        assert claim.status_code == 200, claim.text
        assert await con.fetchval(
            "SELECT coalesce(sum(coins),0) FROM coin_ledger WHERE user_id=$1", inviter) == 10
        again = await client.post("/api/coins/daily/claim")
        assert again.json()["awarded"] == 0
        assert await con.fetchval("SELECT count(*) FROM coin_referrals WHERE awarded_at IS NOT NULL") == 1
        assert await con.fetchval("SELECT count(*) FROM coin_ledger WHERE module='referral'") == 1


@pytest.mark.asyncio
async def test_gift_purchases_are_atomic_idempotent_and_cannot_overdraw(setup_db, monkeypatch):
    con, schema, inviter = setup_db
    user = {"id": inviter, "telegram_id": "123456789", "role": "student", "account_status": "active"}
    client, identity = await make_client(monkeypatch, con, user)
    await rewards.award_coin(con, inviter, "earning:test", module="reading",
                             activity_type="exercise", coins=10)
    first = uuid4()
    second = uuid4()
    await con.execute(
        """INSERT INTO coin_gifts(id,item_key,title_uz,title_en,category,cost_coins,stock_remaining)
           VALUES($1,'badge-one','Mukofot','Badge','badge',8,2),
                 ($2,'badge-two','Keyingi','Next','badge',5,1)""", first, second)
    async with client:
        req_id = str(uuid4())
        response = await client.post(
            f"/api/coins/gifts/{first}/purchase", json={"requestId": req_id})
        assert response.status_code == 200, response.text
        assert response.json()["wallet"]["balance"] == 2
        assert response.json()["status"] == "pending"
        assert response.json()["receiptId"]
        repeat = await client.post(
            f"/api/coins/gifts/{first}/purchase", json={"requestId": req_id})
        assert repeat.status_code == 200 and repeat.json()["alreadyPurchased"]
        duplicate = await client.post(
            f"/api/coins/gifts/{first}/purchase", json={"requestId": str(uuid4())})
        assert duplicate.status_code == 409
        expensive = await client.post(
            f"/api/coins/gifts/{second}/purchase", json={"requestId": str(uuid4())})
        assert expensive.status_code == 409 and expensive.json()["error"] == "insufficient_coins"
    assert await con.fetchval("SELECT sum(coins) FROM coin_spend") == 8
    assert await con.fetchval("SELECT count(*) FROM coin_gift_purchases") == 1
    assert await con.fetchval("SELECT stock_remaining FROM coin_gifts WHERE id=$1", first) == 1
    assert await con.fetchval("SELECT count(*) FROM notifications WHERE type='COIN_GIFT_PURCHASE'") == 0



@pytest.mark.asyncio
async def test_all_active_roles_can_claim_daily_and_shop(setup_db, monkeypatch):
    con, _schema, inviter = setup_db
    owner_id = uuid4()
    await con.execute("INSERT INTO users(id,role,name) VALUES($1,'owner','Owner')", owner_id)
    owner_identity = {"id": owner_id, "role": "owner", "account_status": "active"}
    client, identity = await make_client(monkeypatch, con, owner_identity)
    gift_id = uuid4()
    await con.execute(
        """INSERT INTO coin_gifts(id,item_key,title_uz,title_en,category,cost_coins)
           VALUES($1,'role-gift','Sovg‘a','Gift','badge',1)""", gift_id)
    async with client:
        daily = await client.post("/api/coins/daily/claim")
        assert daily.status_code == 200, daily.text
        assert daily.json()["wallet"]["balance"] == 1
        buy = await client.post(f"/api/coins/gifts/{gift_id}/purchase",
                                json={"requestId": str(uuid4())})
        assert buy.status_code == 200, buy.text
        assert buy.json()["status"] == "pending"
        assert buy.json()["wallet"]["balance"] == 0
        for role in ("teacher", "admin", "student"):
            user_id = uuid4()
            await con.execute("INSERT INTO users(id,role) VALUES($1,$2)", user_id, role)
            identity["current"] = {"id": user_id, "role": role, "account_status": "active"}
            result = await client.post("/api/coins/daily/claim")
            assert result.status_code == 200, (role, result.text)
            assert result.json()["awarded"] == 1
    assert await con.fetchval("SELECT count(*) FROM coin_daily_claims") == 4
    assert await con.fetchval("SELECT count(*) FROM notifications WHERE type='COIN_GIFT_PURCHASE'") == 1


@pytest.mark.asyncio
async def test_owner_rejects_order_once_and_refunds_exact_coins(setup_db, monkeypatch):
    con, _schema, student_id = setup_db
    owner_id = uuid4()
    await con.execute("INSERT INTO users(id,role,name) VALUES($1,'owner','Owner')", owner_id)
    await rewards.award_coin(con, student_id, "earning:test", module="reading",
                             activity_type="exercise", coins=10)
    gift_id = uuid4()
    await con.execute(
        """INSERT INTO coin_gifts(id,item_key,title_uz,title_en,category,cost_coins,stock_remaining)
           VALUES($1,'refund-gift','Sovg‘a','Gift','badge',8,2)""", gift_id)
    user = {"id": student_id, "role": "student", "account_status": "active"}
    client, identity = await make_client(monkeypatch, con, user)
    async with client:
        purchase = await client.post(f"/api/coins/gifts/{gift_id}/purchase",
                                     json={"requestId": str(uuid4())})
        assert purchase.status_code == 200, purchase.text
        purchase_id = purchase.json()["receiptId"]
        assert purchase.json()["wallet"]["balance"] == 2
        identity["current"] = {"id": owner_id, "role": "owner", "account_status": "active"}
        receipt = await client.get("/api/coins/admin/purchases")
        assert receipt.status_code == 200
        assert any(row["id"] == purchase_id for row in receipt.json()["purchases"])
        rejection = await client.patch(f"/api/coins/admin/purchases/{purchase_id}",
                                        json={"status": "rejected"})
        assert rejection.status_code == 200, rejection.text
        again = await client.patch(f"/api/coins/admin/purchases/{purchase_id}",
                                    json={"status": "rejected"})
        assert again.status_code == 200 and again.json()["alreadyResolved"]
        assert (await client.patch(f"/api/coins/admin/purchases/{purchase_id}",
                                   json={"status": "fulfilled"})).status_code == 409
        identity["current"] = user
        balance = await client.get("/api/coins/wallet")
        assert balance.json()["balance"] == 10
        history = await client.get("/api/coins/purchases")
        assert history.json()["purchases"][0]["status"] == "rejected"
        repeat = await client.post(f"/api/coins/gifts/{gift_id}/purchase",
                                   json={"requestId": str(uuid4())})
        assert repeat.status_code == 200, repeat.text
        assert repeat.json()["wallet"]["balance"] == 2
    assert await con.fetchval("SELECT count(*) FROM coin_gift_refunds") == 1
    assert await con.fetchval("SELECT count(*) FROM notifications WHERE type='COIN_GIFT_RESOLVED'") == 1
    assert await con.fetchval("SELECT stock_remaining FROM coin_gifts WHERE id=$1", gift_id) == 1


@pytest.mark.asyncio
async def test_nonowner_cannot_resolve_or_view_other_orders(setup_db, monkeypatch):
    con, _schema, student_id = setup_db
    client, identity = await make_client(monkeypatch, con,
        {"id": student_id, "role": "student", "account_status": "active"})
    async with client:
        assert (await client.get("/api/coins/admin/purchases")).status_code == 403
        assert (await client.patch(f"/api/coins/admin/purchases/{uuid4()}",
                                   json={"status": "rejected"})).status_code == 403



@pytest.mark.asyncio
async def test_owner_receipt_has_buyer_telegram_link_but_other_roles_have_no_access(setup_db, monkeypatch):
    con, _schema, buyer = setup_db
    owner_id = uuid4()
    await con.execute("INSERT INTO users(id,role,name) VALUES($1,'owner','Owner')", owner_id)
    await con.execute(
        "INSERT INTO telegram_contacts(telegram_user_id,linked_user_id,username) "
        "VALUES('123456789',$1,'buyer_username')", buyer)
    await rewards.award_coin(con, buyer, "earning:contact", module="reading",
                             activity_type="exercise", coins=10)
    gift_id = uuid4()
    await con.execute(
        """INSERT INTO coin_gifts(id,item_key,title_uz,title_en,category,cost_coins)
           VALUES($1,'contact-gift','Sovg‘a','Gift','badge',5)""", gift_id)
    client, identity = await make_client(monkeypatch, con,
        {"id": buyer, "role": "student", "account_status": "active"})
    async with client:
        purchase = await client.post(f"/api/coins/gifts/{gift_id}/purchase",
                                     json={"requestId": str(uuid4())})
        assert purchase.status_code == 200, purchase.text
        assert (await client.get("/api/coins/admin/purchases")).status_code == 403
        own = await client.get("/api/coins/purchases")
        assert "telegramUrl" not in own.text
        identity["current"] = {"id": owner_id, "role": "owner", "account_status": "active"}
        receipts = await client.get("/api/coins/admin/purchases")
        assert receipts.status_code == 200, receipts.text
        assert receipts.json()["purchases"][0]["telegramUrl"] == "https://t.me/buyer_username"


def test_gift_validation_refuses_fake_prices_and_unsafe_categories():
    valid = {
        "key": "learning-badge",
        "titleUz": "Mukofot", "titleEn": "Badge",
        "descriptionUz": "", "descriptionEn": "",
        "category": "badge", "coins": 30, "stock": 2, "active": True,
    }
    assert economy.valid_gift(valid)
    assert not economy.valid_gift({**valid, "coins": -1})
    assert not economy.valid_gift({**valid, "coins": True})
    assert not economy.valid_gift({**valid, "category": "real_money"})
    assert not economy.valid_gift({**valid, "key": "../bad"})
    assert not economy.valid_gift({**valid, "imageData": "data:image/svg+xml;base64,PHN2Zy8+"})
    assert not economy.valid_gift({**valid, "imageData": "data:image/png;base64,YWJj"})
    assert not economy.valid_gift({**valid, "imageData": "data:image/webp;base64," + "A" * 230001})

