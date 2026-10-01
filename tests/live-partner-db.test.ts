import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  acceptInvite, acceptRules, blockUser, closeInvite, getState, goOffline, goOnline, hangup, heartbeat, invite, listOnline, practiceStarted, reportConnection,
} from "../src/lib/data/live-partner";
import { LivePartnerError, LIVE_PARTNER_RULES_VERSION } from "../src/lib/live-partner/rules";
import { issueSignalToken, verifySignalToken } from "../src/lib/live-partner/signal-token";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

let database: TestDatabase; let conn: never;
const ids: Record<string, string> = {};
const T0 = new Date("2026-10-01T09:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const code = (c: string) => (e: unknown) => e instanceof LivePartnerError && e.code === c;

before(async () => {
  database = await createTestDatabase(); conn = database.db as never;
  for (const [key, gender, status] of [["a", "male", "active"], ["b", "female", "active"], ["c", "male", "active"], ["nog", null, "active"], ["pend", "male", "pending"]] as const) {
    const [row] = await database.query<{ id: string }>(`insert into users (name, role, account_status, email, gender) values ($1, 'student', $2, $3, $4) returning id`, [key.toUpperCase(), status, `${key}@lp.test`, gender]);
    ids[key] = row!.id;
  }
});
after(async () => { await database.close(); });

const online = async (k: string, s: number) => { await acceptRules(ids[k]!, LIVE_PARTNER_RULES_VERSION, at(s), conn); return goOnline(ids[k]!, at(s), conn); };

test("default OFFLINE; Go Online gated by eligibility, gender and current rules", async () => {
  assert.equal((await getState(ids.a!, at(0), conn)).state, "offline");
  await assert.rejects(goOnline(ids.a!, at(0), conn), code("rules_required"));
  await assert.rejects(acceptRules(ids.a!, 999, at(0), conn), code("rules_outdated"));
  await assert.rejects(goOnline(ids.pend!, at(0), conn), code("not_eligible"));
  await acceptRules(ids.nog!, LIVE_PARTNER_RULES_VERSION, at(0), conn);
  await assert.rejects(goOnline(ids.nog!, at(0), conn), code("profile_incomplete"));
  assert.equal((await online("a", 1)).state, "available");
});

test("Online Users: only fresh AVAILABLE others, once; stale heartbeat disappears", async () => {
  await online("b", 2);
  assert.deepEqual((await listOnline(ids.a!, at(3), conn)).map((u) => u.name), ["B"]);
  assert.equal((await listOnline(ids.a!, at(3), conn))[0]!.speakingScore, null, "S — without an evaluation");
  assert.deepEqual(await listOnline(ids.a!, at(100), conn), [], "stale heartbeat is not online");
  await heartbeat(ids.a!, at(100), conn); await heartbeat(ids.b!, at(100), conn);
  assert.equal((await listOnline(ids.a!, at(101), conn)).length, 1);
});

test("invite races: mutual invites and two inviters → exactly one wins; accept creates one room", async () => {
  await online("c", 101);
  const first = await invite(ids.a!, ids.b!, at(102), conn);
  await assert.rejects(invite(ids.b!, ids.a!, at(102), conn), code("not_available"), "B is now in an invite");
  await assert.rejects(invite(ids.c!, ids.b!, at(102), conn), code("partner_busy"));
  await assert.rejects(invite(ids.a!, ids.c!, at(102), conn), code("not_available"), "duplicate outgoing invite");
  assert.deepEqual((await listOnline(ids.c!, at(103), conn)).map((u) => u.name), [], "invite states are not listed");
  await assert.rejects(acceptInvite(ids.c!, first.id, at(103), conn), code("invite_not_found"), "only the recipient accepts");
  const s1 = await acceptInvite(ids.b!, first.id, at(103), conn);
  const s2 = await acceptInvite(ids.b!, first.id, at(104), conn);
  assert.equal(s1.id, s2.id, "duplicate accept → same room");
  const sa = await getState(ids.a!, at(104), conn);
  assert.equal(sa.state, "connecting"); assert.equal(sa.partner?.name, "B");
});

test("practice cannot silently end a call; call → in_call → hangup releases both; metadata only", async () => {
  const s = (await getState(ids.a!, at(105), conn)).sessionId!;
  await assert.rejects(practiceStarted(ids.a!, at(105), conn), code("in_call"));
  await assert.rejects(goOffline(ids.a!, at(105), conn), code("in_call"));
  await reportConnection(ids.a!, s, "connected", at(106), conn);
  assert.equal((await getState(ids.a!, at(106), conn)).state, "in_call");
  await assert.rejects(hangup(ids.c!, s, "x", at(107), conn), code("session_not_found"));
  const ended = await hangup(ids.b!, s, "hangup", at(107), conn);
  assert.equal(ended!.connectionOutcome, "connected");
  assert.equal((await getState(ids.a!, at(108), conn)).state, "available");
  const cols = await database.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'live_partner_sessions'`);
  assert.ok(!cols.some((c) => /audio|transcript|ice|sdp/.test(c.column_name)), "no media or signalling stored");
});

test("expired invite releases both; decline; practice takes AVAILABLE user offline and cancels invites", async () => {
  await heartbeat(ids.a!, at(110), conn); await heartbeat(ids.c!, at(110), conn);
  await invite(ids.a!, ids.c!, at(110), conn);
  await heartbeat(ids.a!, at(141), conn); await heartbeat(ids.c!, at(141), conn);
  assert.equal((await getState(ids.c!, at(142), conn)).state, "available", "expired after 30 s");
  const inv = await invite(ids.c!, ids.a!, at(143), conn);
  await closeInvite(ids.a!, inv.id, "decline", at(144), conn);
  assert.equal((await getState(ids.c!, at(144), conn)).state, "available");
  await invite(ids.c!, ids.a!, at(145), conn);
  await practiceStarted(ids.a!, at(146), conn);
  assert.equal((await getState(ids.a!, at(146), conn)).state, "offline");
  assert.equal((await getState(ids.c!, at(146), conn)).state, "available");
  assert.ok(!(await listOnline(ids.c!, at(147), conn)).some((u) => u.name === "A"));
});

test("blocking hides both directions and refuses invites", async () => {
  await online("a", 150); await heartbeat(ids.c!, at(150), conn);
  await blockUser(ids.c!, ids.a!, at(151), conn);
  assert.ok(!(await listOnline(ids.a!, at(151), conn)).some((u) => u.name === "C"));
  assert.ok(!(await listOnline(ids.c!, at(151), conn)).some((u) => u.name === "A"));
  await assert.rejects(invite(ids.a!, ids.c!, at(152), conn), code("partner_busy"));
});

test("vanished participant past grace ends the call and releases the other", async () => {
  await heartbeat(ids.b!, at(152), conn); await heartbeat(ids.a!, at(152), conn);
  const inv = await invite(ids.a!, ids.b!, at(153), conn);
  const s = await acceptInvite(ids.b!, inv.id, at(154), conn);
  await heartbeat(ids.b!, at(200), conn);
  await heartbeat(ids.b!, at(220), conn);
  const st = await getState(ids.b!, at(220), conn);
  assert.equal(st.state, "available"); assert.equal(st.sessionId, null);
  const [row] = await database.query<{ end_reason: string }>(`select end_reason from live_partner_sessions where id = $1`, [s.id]);
  assert.equal(row!.end_reason, "reconnect_timeout");
});

test("signal token: audience/issuer/expiry bound; tamper and wrong secret rejected; none without secret", async () => {
  const secret = "x".repeat(40);
  const token = (await issueSignalToken({ userId: ids.a!, sessionId: "00000000-0000-4000-8000-000000000001" }, secret, T0))!;
  assert.deepEqual(await verifySignalToken(token, secret, at(60)), { userId: ids.a!, sessionId: "00000000-0000-4000-8000-000000000001" });
  await assert.rejects(verifySignalToken(token, secret, at(200)));
  await assert.rejects(verifySignalToken(token, "y".repeat(40), at(10)));
  await assert.rejects(verifySignalToken(token.slice(0, -2) + "aa", secret, at(10)));
  assert.equal(await issueSignalToken({ userId: "u", sessionId: "s" }, undefined), null);
});
