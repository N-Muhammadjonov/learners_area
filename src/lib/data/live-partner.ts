import "server-only";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { livePartnerBlocks, livePartnerInvites, livePartnerPresence, livePartnerSessions, users } from "@/db/schema";
import { LIVE_PARTNER_RULES_VERSION, LivePartnerError, type LivePartnerState } from "@/lib/live-partner/rules";

/**
 * Live Partner — server-authoritative presence, invites and call sessions (N10).
 *
 * Every transition runs in one transaction and locks the presence rows of all
 * participants in a fixed (uuid) order, so concurrent invites/accepts cannot
 * deadlock and exactly one call can win. The browser never supplies a user id:
 * routes pass the authenticated user. Nothing about audio is stored.
 */
type Database = typeof db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const HEARTBEAT_FRESH_MS = 45_000;
export const INVITE_TTL_MS = 30_000;
export const RECONNECT_GRACE_MS = 60_000;
/** A call that never reaches media within this window ends instead of hanging in CONNECTING. */
export const CONNECT_TIMEOUT_MS = 45_000;

async function lockPresence(tx: Tx, ids: string[], now: Date) {
  const ordered = [...new Set(ids)].sort();
  for (const id of ordered) {
    await tx.insert(livePartnerPresence).values({ userId: id, state: "offline", updatedAt: now }).onConflictDoNothing();
  }
  const rows = await tx.select().from(livePartnerPresence).where(inArray(livePartnerPresence.userId, ordered)).orderBy(livePartnerPresence.userId).for("update");
  return new Map(rows.map((r) => [r.userId, r]));
}
const fresh = (heartbeatAt: Date | null, now: Date) => Boolean(heartbeatAt && now.getTime() - heartbeatAt.getTime() < HEARTBEAT_FRESH_MS);
async function setState(tx: Tx, userId: string, state: LivePartnerState, now: Date, sessionId: string | null = null) {
  await tx.update(livePartnerPresence).set({ state, sessionId, updatedAt: now }).where(eq(livePartnerPresence.userId, userId));
}
/** After an invite/call ends: AVAILABLE only if that tab is still alive, otherwise OFFLINE. */
async function release(tx: Tx, userId: string, heartbeatAt: Date | null, now: Date) {
  await setState(tx, userId, fresh(heartbeatAt, now) ? "available" : "offline", now);
}

/** Lazily expire stale invites and end calls whose participants vanished past the grace window. */
async function sweep(tx: Tx, now: Date) {
  const expired = await tx.update(livePartnerInvites).set({ status: "expired", respondedAt: now })
    .where(and(eq(livePartnerInvites.status, "pending"), lt(livePartnerInvites.expiresAt, now)))
    .returning({ from: livePartnerInvites.fromUserId, to: livePartnerInvites.toUserId });
  for (const inv of expired) {
    const rows = await lockPresence(tx, [inv.from, inv.to], now);
    for (const id of [inv.from, inv.to]) {
      const row = rows.get(id)!;
      if (row.state === "outgoing_invite" || row.state === "incoming_invite") await release(tx, id, row.heartbeatAt, now);
    }
  }
  const cutoff = new Date(now.getTime() - RECONNECT_GRACE_MS);
  const stale = await tx.execute(sql`
    select s.id, s.user_a, s.user_b from live_partner_sessions s
      join live_partner_presence pa on pa.user_id = s.user_a
      join live_partner_presence pb on pb.user_id = s.user_b
     where s.ended_at is null and (pa.heartbeat_at < ${cutoff} or pb.heartbeat_at < ${cutoff} or pa.heartbeat_at is null or pb.heartbeat_at is null)`);
  for (const row of stale.rows as { id: string; user_a: string; user_b: string }[]) {
    await endSessionTx(tx, row.id, now, "reconnect_timeout");
  }
  // Heartbeats alone must not keep a call alive: no media within the connect
  // window, or a participant stuck RECONNECTING past the grace window, ends it.
  const connectCutoff = new Date(now.getTime() - CONNECT_TIMEOUT_MS);
  const stuck = await tx.execute(sql`
    select s.id, case when s.connected_at is null then 'connect_timeout' else 'reconnect_timeout' end as reason
      from live_partner_sessions s
     where s.ended_at is null and (
       (s.connected_at is null and s.started_at < ${connectCutoff})
       or exists (select 1 from live_partner_presence p where p.session_id = s.id and p.state = 'reconnecting' and p.updated_at < ${cutoff}))`);
  for (const row of stuck.rows as { id: string; reason: string }[]) await endSessionTx(tx, row.id, now, row.reason);
}

async function endSessionTx(tx: Tx, sessionId: string, now: Date, reason: string) {
  const [session] = await tx.select().from(livePartnerSessions).where(eq(livePartnerSessions.id, sessionId)).for("update");
  if (!session || session.endedAt) return session ?? null;
  const rows = await lockPresence(tx, [session.userA, session.userB], now);
  const [ended] = await tx.update(livePartnerSessions).set({ endedAt: now, endReason: reason, connectionOutcome: session.connectedAt ? "connected" : "never_connected" })
    .where(eq(livePartnerSessions.id, sessionId)).returning();
  for (const id of [session.userA, session.userB]) {
    const row = rows.get(id)!;
    if (row.sessionId === sessionId) await release(tx, id, row.heartbeatAt, now);
  }
  return ended!;
}

export async function acceptRules(userId: string, version: number, now = new Date(), connection: Database = db) {
  if (version !== LIVE_PARTNER_RULES_VERSION) throw new LivePartnerError("rules_outdated");
  return connection.transaction(async (tx) => {
    await lockPresence(tx, [userId], now);
    await tx.update(livePartnerPresence).set({ rulesVersion: version, rulesAcceptedAt: now, updatedAt: now }).where(eq(livePartnerPresence.userId, userId));
  });
}

/** Partner route entry requires current rules and a known profile gender. */
export async function goOnline(userId: string, now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    await sweep(tx, now);
    const [user] = await tx.select({ status: users.accountStatus, gender: users.gender }).from(users).where(eq(users.id, userId));
    if (!user || user.status !== "active") throw new LivePartnerError("not_eligible");
    if (!user.gender) throw new LivePartnerError("profile_incomplete");
    const row = (await lockPresence(tx, [userId], now)).get(userId)!;
    if (row.rulesVersion !== LIVE_PARTNER_RULES_VERSION) throw new LivePartnerError("rules_required");
    if (["connecting", "in_call", "reconnecting"].includes(row.state)) throw new LivePartnerError("in_call");
    if (row.state === "offline") await setState(tx, userId, "available", now);
    await tx.update(livePartnerPresence).set({ heartbeatAt: now }).where(eq(livePartnerPresence.userId, userId));
    return getStateTx(tx, userId, now);
  });
}

async function cancelOpenInvites(tx: Tx, userId: string, now: Date) {
  const open = await tx.update(livePartnerInvites).set({ status: "cancelled", respondedAt: now })
    .where(and(eq(livePartnerInvites.status, "pending"), or(eq(livePartnerInvites.fromUserId, userId), eq(livePartnerInvites.toUserId, userId))))
    .returning({ from: livePartnerInvites.fromUserId, to: livePartnerInvites.toUserId });
  for (const inv of open) {
    const other = inv.from === userId ? inv.to : inv.from;
    const row = (await lockPresence(tx, [other], now)).get(other)!;
    if (row.state === "outgoing_invite" || row.state === "incoming_invite") await release(tx, other, row.heartbeatAt, now);
  }
}

export async function goOffline(userId: string, now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    const row = (await lockPresence(tx, [userId], now)).get(userId)!;
    if (["connecting", "in_call", "reconnecting"].includes(row.state)) throw new LivePartnerError("in_call");
    await cancelOpenInvites(tx, userId, now);
    await setState(tx, userId, "offline", now);
  });
}

/**
 * Practice on Your Own started (any tab). AVAILABLE/invite states go OFFLINE and
 * invites are cancelled; a live call is never silently killed — the Practice
 * recording is refused instead.
 */
export async function practiceStarted(userId: string, now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    const row = (await lockPresence(tx, [userId], now)).get(userId)!;
    if (["connecting", "in_call", "reconnecting"].includes(row.state)) throw new LivePartnerError("in_call");
    await cancelOpenInvites(tx, userId, now);
    await setState(tx, userId, "offline", now);
  });
}

export async function heartbeat(userId: string, now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    await lockPresence(tx, [userId], now);
    await tx.update(livePartnerPresence).set({ heartbeatAt: now }).where(and(eq(livePartnerPresence.userId, userId), sql`${livePartnerPresence.state} <> 'offline'`));
    await sweep(tx, now);
    return getStateTx(tx, userId, now);
  });
}

export async function invite(fromUserId: string, toUserId: string, now = new Date(), connection: Database = db) {
  if (fromUserId === toUserId) throw new LivePartnerError("invalid_target");
  return connection.transaction(async (tx) => {
    await sweep(tx, now);
    const rows = await lockPresence(tx, [fromUserId, toUserId], now);
    const from = rows.get(fromUserId)!;
    const to = rows.get(toUserId)!;
    if (from.state !== "available" || !fresh(from.heartbeatAt, now)) throw new LivePartnerError("not_available");
    if (to.state !== "available" || !fresh(to.heartbeatAt, now)) throw new LivePartnerError("partner_busy");
    const blocked = await tx.select({ x: livePartnerBlocks.blockerId }).from(livePartnerBlocks).where(or(
      and(eq(livePartnerBlocks.blockerId, fromUserId), eq(livePartnerBlocks.blockedId, toUserId)),
      and(eq(livePartnerBlocks.blockerId, toUserId), eq(livePartnerBlocks.blockedId, fromUserId)),
    )).limit(1);
    if (blocked.length) throw new LivePartnerError("partner_busy");
    const [created] = await tx.insert(livePartnerInvites).values({ fromUserId, toUserId, expiresAt: new Date(now.getTime() + INVITE_TTL_MS), createdAt: now }).returning();
    await setState(tx, fromUserId, "outgoing_invite", now);
    await setState(tx, toUserId, "incoming_invite", now);
    return created!;
  });
}

async function lockInvite(tx: Tx, inviteId: string) {
  const [row] = await tx.select().from(livePartnerInvites).where(eq(livePartnerInvites.id, inviteId)).for("update");
  return row ?? null;
}

/** Accept: exactly one room per invite; duplicate accepts return the same session. */
export async function acceptInvite(userId: string, inviteId: string, now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    await sweep(tx, now);
    const inv = await lockInvite(tx, inviteId);
    if (!inv || inv.toUserId !== userId) throw new LivePartnerError("invite_not_found");
    if (inv.status === "accepted") {
      const [existing] = await tx.select().from(livePartnerSessions).where(eq(livePartnerSessions.inviteId, inv.id));
      return existing!;
    }
    if (inv.status !== "pending") throw new LivePartnerError("invite_closed");
    const rows = await lockPresence(tx, [inv.fromUserId, inv.toUserId], now);
    const from = rows.get(inv.fromUserId)!;
    const to = rows.get(inv.toUserId)!;
    if (from.state !== "outgoing_invite" || to.state !== "incoming_invite" || !fresh(from.heartbeatAt, now)) {
      await tx.update(livePartnerInvites).set({ status: "cancelled", respondedAt: now }).where(eq(livePartnerInvites.id, inv.id));
      if (to.state === "incoming_invite") await release(tx, to.userId, to.heartbeatAt, now);
      throw new LivePartnerError("partner_busy");
    }
    await tx.update(livePartnerInvites).set({ status: "accepted", respondedAt: now }).where(eq(livePartnerInvites.id, inv.id));
    const [session] = await tx.insert(livePartnerSessions).values({ inviteId: inv.id, userA: inv.fromUserId, userB: inv.toUserId, startedAt: now }).returning();
    await setState(tx, inv.fromUserId, "connecting", now, session!.id);
    await setState(tx, inv.toUserId, "connecting", now, session!.id);
    return session!;
  });
}

export async function closeInvite(userId: string, inviteId: string, action: "decline" | "cancel", now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    const inv = await lockInvite(tx, inviteId);
    const owner = action === "decline" ? inv?.toUserId : inv?.fromUserId;
    if (!inv || owner !== userId) throw new LivePartnerError("invite_not_found");
    if (inv.status !== "pending") return inv;
    const rows = await lockPresence(tx, [inv.fromUserId, inv.toUserId], now);
    const [closed] = await tx.update(livePartnerInvites).set({ status: action === "decline" ? "declined" : "cancelled", respondedAt: now }).where(eq(livePartnerInvites.id, inv.id)).returning();
    for (const id of [inv.fromUserId, inv.toUserId]) {
      const row = rows.get(id)!;
      if (row.state === "outgoing_invite" || row.state === "incoming_invite") await release(tx, id, row.heartbeatAt, now);
    }
    return closed!;
  });
}

async function ownSession(tx: Tx, userId: string, sessionId: string) {
  const [s] = await tx.select().from(livePartnerSessions).where(eq(livePartnerSessions.id, sessionId)).for("update");
  if (!s || (s.userA !== userId && s.userB !== userId)) throw new LivePartnerError("session_not_found");
  return s;
}

/** Media path reported connected (by the realtime client), or reconnecting. */
export async function reportConnection(userId: string, sessionId: string, status: "connected" | "reconnecting", now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    const s = await ownSession(tx, userId, sessionId);
    if (s.endedAt) throw new LivePartnerError("session_ended");
    const rows = await lockPresence(tx, [s.userA, s.userB], now);
    const target = status === "connected" ? "in_call" : "reconnecting";
    if (rows.get(userId)!.state === target) return; // repeated reports must not extend the grace window
    if (status === "connected" && !s.connectedAt) await tx.update(livePartnerSessions).set({ connectedAt: now }).where(eq(livePartnerSessions.id, s.id));
    await setState(tx, userId, target, now, s.id);
  });
}

export async function hangup(userId: string, sessionId: string, reason = "hangup", now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => {
    const s = await ownSession(tx, userId, sessionId);
    return endSessionTx(tx, s.id, now, reason.slice(0, 40));
  });
}

export async function blockUser(userId: string, otherId: string, now = new Date(), connection: Database = db) {
  if (userId === otherId) throw new LivePartnerError("invalid_target");
  return connection.transaction(async (tx) => {
    await tx.insert(livePartnerBlocks).values({ blockerId: userId, blockedId: otherId, createdAt: now }).onConflictDoNothing();
    await cancelOpenInvites(tx, userId, now);
  });
}

/** Authoritative S score: latest stored Speaking evaluation estimate, else null ("S —"). */
async function speakingScores(tx: Tx | Database, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await tx.execute(sql`
    select distinct on (user_id) user_id, overall_estimate from evaluations
     where user_id = any(${`{${ids.join(",")}}`}::uuid[])
       and source_type = 'speaking_attempt' and overall_estimate is not null
     order by user_id, created_at desc`);
  return new Map((rows.rows as { user_id: string; overall_estimate: number }[]).map((r) => [r.user_id, Number(r.overall_estimate)]));
}

/**
 * Which of these users have a servable profile photo, using exactly the predicate the photo route
 * uses: the table exists, a photo row exists, and the account is active.
 *
 * The client avatar used to mount an <img> for every user id it was given and recover through
 * onError. That looks fine visually, but having no photo is the common case — the QA baseline has
 * none at all — and a 404 on an <img> is written to the browser console every single time. The
 * browser matrix measured exactly one such error on /app/speaking/live-partner at rest, for the
 * signed-in learner's own id. Whether a photo exists is server knowledge, so the server states it;
 * and it is batched the way speakingScores is, so a room of 100 online learners costs one extra
 * query rather than 100 requests that were always going to fail.
 */
async function photoPresence(tx: Tx | Database, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const ready = await tx.execute(sql`select to_regclass('public.user_profile_photos') as ready`);
  if (!(ready.rows as { ready: string | null }[])[0]?.ready) return new Set<string>();
  const rows = await tx.execute(sql`
    select p.user_id from user_profile_photos p join users u on u.id = p.user_id
     where u.account_status = 'active' and p.user_id = any(${`{${ids.join(",")}}`}::uuid[])`);
  return new Set((rows.rows as { user_id: string }[]).map((r) => r.user_id));
}

export type OnlineUser = { userId: string; name: string; avatar: "a" | "b"; speakingScore: number | null; hasPhoto: boolean };

/** Only AVAILABLE, fresh, non-blocked, other accounts — once each; never IN_CALL/practice/stale. */
export async function listOnline(viewerId: string, now = new Date(), connection: Database = db): Promise<OnlineUser[]> {
  const cutoff = new Date(now.getTime() - HEARTBEAT_FRESH_MS);
  const rows = await connection.execute(sql`
    select u.id, u.name, u.gender from live_partner_presence p join users u on u.id = p.user_id
     where p.state = 'available' and p.heartbeat_at >= ${cutoff} and u.account_status = 'active' and u.id <> ${viewerId}
       and not exists (select 1 from live_partner_blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = ${viewerId}))
     order by u.name limit 100`);
  const list = rows.rows as { id: string; name: string; gender: string | null }[];
  const scores = await speakingScores(connection, list.map((r) => r.id));
  const photos = await photoPresence(connection, list.map((r) => r.id));
  return list.map((r) => ({ userId: r.id, name: r.name, avatar: r.gender === "female" ? "b" : "a", speakingScore: scores.get(r.id) ?? null, hasPhoto: photos.has(r.id) }));
}

async function getStateTx(tx: Tx | Database, userId: string, now: Date) {
  const [row] = await tx.select().from(livePartnerPresence).where(eq(livePartnerPresence.userId, userId));
  const incoming = await tx.select({ id: livePartnerInvites.id, fromUserId: livePartnerInvites.fromUserId, name: users.name, gender: users.gender, expiresAt: livePartnerInvites.expiresAt })
    .from(livePartnerInvites).innerJoin(users, eq(users.id, livePartnerInvites.fromUserId))
    .where(and(eq(livePartnerInvites.toUserId, userId), eq(livePartnerInvites.status, "pending"))).limit(1);
  const outgoing = await tx.select({ id: livePartnerInvites.id, toUserId: livePartnerInvites.toUserId, expiresAt: livePartnerInvites.expiresAt })
    .from(livePartnerInvites).where(and(eq(livePartnerInvites.fromUserId, userId), eq(livePartnerInvites.status, "pending"))).limit(1);
  let partner: OnlineUser | null = null;
  if (row?.sessionId) {
    const [s] = await tx.select().from(livePartnerSessions).where(eq(livePartnerSessions.id, row.sessionId));
    const otherId = s ? (s.userA === userId ? s.userB : s.userA) : null;
    if (otherId) {
      const [u] = await tx.select({ name: users.name, gender: users.gender }).from(users).where(eq(users.id, otherId));
      const scores = await speakingScores(tx, [otherId]);
      const photos = await photoPresence(tx, [otherId]);
      partner = { userId: otherId, name: u?.name ?? "", avatar: u?.gender === "female" ? "b" : "a", speakingScore: scores.get(otherId) ?? null, hasPhoto: photos.has(otherId) };
    }
  }
  const inScores = incoming[0] ? await speakingScores(tx, [incoming[0].fromUserId]) : new Map<string, number>();
  const inPhotos = incoming[0] ? await photoPresence(tx, [incoming[0].fromUserId]) : new Set<string>();
  const stateValue = (row?.state ?? "offline") as LivePartnerState;
  return {
    state: stateValue === "available" && !fresh(row?.heartbeatAt ?? null, now) ? ("offline" as const) : stateValue,
    rulesAccepted: row?.rulesVersion === LIVE_PARTNER_RULES_VERSION,
    sessionId: row?.sessionId ?? null,
    partner,
    incoming: incoming[0] ? { id: incoming[0].id, from: { userId: incoming[0].fromUserId, name: incoming[0].name, avatar: incoming[0].gender === "female" ? ("b" as const) : ("a" as const), speakingScore: inScores.get(incoming[0].fromUserId) ?? null, hasPhoto: inPhotos.has(incoming[0].fromUserId) }, expiresAt: incoming[0].expiresAt.toISOString() } : null,
    outgoing: outgoing[0] ? { id: outgoing[0].id, toUserId: outgoing[0].toUserId, expiresAt: outgoing[0].expiresAt.toISOString() } : null,
    serverNow: now.toISOString(),
  };
}

export async function getState(userId: string, now = new Date(), connection: Database = db) {
  return connection.transaction(async (tx) => { await sweep(tx, now); return getStateTx(tx, userId, now); });
}
export type LivePartnerStatePayload = Awaited<ReturnType<typeof getState>>;

/** The "YOU" card: system avatar from gender and the authoritative S score (or null → "S —"). */
export async function getLivePartnerProfile(userId: string, connection: Database = db) {
  const [u] = await connection.select({ gender: users.gender }).from(users).where(eq(users.id, userId));
  const scores = await speakingScores(connection, [userId]);
  const photos = await photoPresence(connection, [userId]);
  return { avatar: u?.gender === "female" ? ("b" as const) : ("a" as const), hasGender: Boolean(u?.gender), speakingScore: scores.get(userId) ?? null, hasPhoto: photos.has(userId) };
}

/** Participant view of a LIVE session for the realtime token; throws for others/ended. */
export async function sessionForParticipant(userId: string, sessionId: string, connection: Database = db) {
  const [s] = await connection.select().from(livePartnerSessions).where(eq(livePartnerSessions.id, sessionId));
  if (!s || (s.userA !== userId && s.userB !== userId)) throw new LivePartnerError("session_not_found");
  if (s.endedAt) throw new LivePartnerError("session_ended");
  return { sessionId: s.id, peerId: s.userA === userId ? s.userB : s.userA, role: s.userA === userId ? ("offerer" as const) : ("answerer" as const) };
}
