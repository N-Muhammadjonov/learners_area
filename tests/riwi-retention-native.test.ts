import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "../src/db/schema";
import { createPortableTestDatabase, nativePortableTestsEnabled, type PortableTestDatabase } from "./support/riwi-portability-database";
import { recordRiwiOnlineActivity, runRiwiConversationRetention } from "../src/lib/services/riwi/conversation-retention";

const options = { skip: !nativePortableTestsEnabled ? "requires an identified private native PostgreSQL cluster" : false, timeout: 30000 };
const DAY = 86_400_000;
const now = new Date("2026-10-11T04:00:00Z");
const orm = (database: PortableTestDatabase) => drizzle(database.pool! as pg.Pool, { schema });

async function seed(database: PortableTestDatabase, lastActiveAt: Date, role = "student") {
  const userId = randomUUID(), conversationId = randomUUID();
  await database.query("insert into users(id,name,role,account_status,last_active_at,last_meaningful_activity_at) values($1,'Retention QA',$2,'active',$3,$4)", [userId, role, lastActiveAt, new Date("2020-01-01")]);
  await database.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,$3,$4)", [conversationId, userId, role, new Date(now.getTime() + DAY)]);
  await database.query("insert into riwi_conversation_messages(conversation_id,role,content,created_at)values($1,'user','PRIVATE_CHAT_CANARY',$2)", [conversationId, now]);
  return { userId, conversationId };
}

async function chatCount(database: PortableTestDatabase) {
  return (await database.query<{ n: number }>("select count(*)::int n from riwi_conversations"))[0]!.n;
}

test("native retention: strict day-seven/day-thirty boundaries, all four roles, no count cap, dry-run, cascades and academic isolation", options, async () => {
  const database = await createPortableTestDatabase("native");
  try {
    for (const role of ["student", "teacher", "admin", "owner"]) await seed(database, new Date(now.getTime() - 7 * DAY - 1), role);
    const boundary = await seed(database, new Date(now.getTime() - 7 * DAY));
    const active = await seed(database, now);
    const bank = randomUUID(), attempt = randomUUID();
    await database.query("insert into listening_tests(id,created_by_user_id,title,audio_type)values($1,$2,'Academic safety canary','file')", [bank, active.userId]);
    await database.query("insert into listening_attempts(id,user_id,test_id,status,score,total_questions)values($1,$2,$3,'completed',37,40)", [attempt, active.userId, bank]);
    const academicBefore = await database.query("select * from listening_attempts order by id");
    await database.query("insert into riwi_conversation_messages(conversation_id,role,content,created_at)values($1,'user','exact thirty days',$2),($1,'user','one millisecond too old',$3)", [active.conversationId, new Date(now.getTime() - 30 * DAY), new Date(now.getTime() - 30 * DAY - 1)]);
    await database.query("insert into riwi_conversation_messages(conversation_id,role,content,created_at)select $1,'user','recent '||i,$2 from generate_series(1,101)i", [active.conversationId, now]);
    // More than the production batch size must drain over several statements.
    await database.query("insert into riwi_conversation_messages(conversation_id,role,content,created_at)select $1,'user','old '||i,$2 from generate_series(1,601)i", [active.conversationId, new Date(now.getTime() - 31 * DAY)]);
    const before = await database.query("select * from riwi_conversation_messages order by id");
    const preview = await runRiwiConversationRetention({ now }, orm(database));
    assert.ok(preview.locked && !preview.applied && preview.offlineChats === 4 && preview.oldMessages === 602);
    assert.deepEqual(await database.query("select * from riwi_conversation_messages order by id"), before);
    assert.equal((await database.query("select * from audit_log")).length, 0);
    const result = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(result.locked && result.complete && result.offlineChats === 4 && result.oldMessages === 602);
    assert.equal(await chatCount(database), 2);
    assert.equal((await database.query("select * from riwi_conversation_messages where conversation_id=$1", [active.conversationId])).length, 103);
    assert.equal((await database.query("select * from riwi_conversation_messages where conversation_id=$1", [boundary.conversationId])).length, 1);
    assert.equal((await database.query("select * from users")).length, 6);
    assert.deepEqual(await database.query("select * from listening_attempts order by id"), academicBefore);
    const audits = await database.query("select * from audit_log");
    assert.equal(audits.length, 1);
    assert.ok(!JSON.stringify(audits).includes("PRIVATE_CHAT_CANARY"));
    const repeated = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(repeated.locked && repeated.complete && repeated.offlineChats === 0 && repeated.oldMessages === 0);
  } finally { await database.close(); }
});

test("native retention: a locked eligible owner is deferred and cannot be reported as complete", options, async () => {
  const database = await createPortableTestDatabase("native");
  const blocker = await database.pool!.connect();
  try {
    const { userId } = await seed(database, new Date(now.getTime() - 8 * DAY));
    await blocker.query("begin");
    await blocker.query("select id from users where id=$1 for update", [userId]);
    const deferred = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(deferred.locked && deferred.offlineChats === 0);
    assert.equal(deferred.complete, false, "SKIP LOCKED is not proof that all eligible chats are gone");
    assert.equal(await chatCount(database), 1);
    await blocker.query("rollback");
    const retried = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(retried.locked && retried.complete && retried.offlineChats === 1);
    assert.equal(await chatCount(database), 0);
  } finally { await blocker.query("rollback").catch(() => {}); blocker.release?.(); await database.close(); }
});

test("native retention: overlapping scheduled runs use the same transaction advisory lock", options, async () => {
  const database = await createPortableTestDatabase("native");
  const blocker = await database.pool!.connect();
  try {
    await seed(database, new Date(now.getTime() - 8 * DAY));
    await blocker.query("begin");
    await blocker.query("select pg_advisory_xact_lock(hashtext('learners_area.riwi.chat_retention'))");
    assert.deepEqual(await runRiwiConversationRetention({ now, dryRun: false }, orm(database)), { locked: false });
    assert.equal(await chatCount(database), 1);
    await blocker.query("rollback");
    const retried = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(retried.locked && retried.offlineChats === 1 && retried.complete);
  } finally { await blocker.query("rollback").catch(() => {}); blocker.release?.(); await database.close(); }
});

test("native retention: locked old messages and expired chats remain pending until a successful retry", options, async () => {
  const database = await createPortableTestDatabase("native");
  const blocker = await database.pool!.connect();
  try {
    const { conversationId } = await seed(database, now);
    const oldMessage = randomUUID();
    await database.query("insert into riwi_conversation_messages(id,conversation_id,role,content,created_at)values($1,$2,'user','old locked canary',$3)", [oldMessage, conversationId, new Date(now.getTime() - 31 * DAY)]);
    await blocker.query("begin");
    await blocker.query("select id from riwi_conversation_messages where id=$1 for update", [oldMessage]);
    const deferredMessage = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(deferredMessage.locked && !deferredMessage.complete && deferredMessage.oldMessages === 0);
    await blocker.query("rollback");
    const retriedMessage = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(retriedMessage.locked && retriedMessage.complete && retriedMessage.oldMessages === 1);
    await database.query("update riwi_conversations set expires_at=$1 where id=$2", [now, conversationId]);
    await blocker.query("begin");
    await blocker.query("select id from riwi_conversations where id=$1 for update", [conversationId]);
    const deferredChat = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(deferredChat.locked && !deferredChat.complete && deferredChat.expiredChats === 0);
    await blocker.query("rollback");
    const retriedChat = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(retriedChat.locked && retriedChat.complete && retriedChat.expiredChats === 1);
    assert.equal(await chatCount(database), 0);
  } finally { await blocker.query("rollback").catch(() => {}); blocker.release?.(); await database.close(); }
});

test("native retention: missed cron and parallel late heartbeat delete before refreshing online time", options, async () => {
  const database = await createPortableTestDatabase("native");
  const blocker = await database.pool!.connect();
  let touch: Promise<unknown> | undefined;
  try {
    const { userId } = await seed(database, new Date(now.getTime() - 12 * DAY));
    await blocker.query("begin");
    await blocker.query("select id from users where id=$1 for update", [userId]);
    touch = recordRiwiOnlineActivity(userId, now, orm(database));
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = (await database.query<{ blocked: boolean }>("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%last_active_at%' and pid<>pg_backend_pid()) blocked"))[0]!.blocked;
      if (blocked) break;
      await delay(20);
    }
    assert.ok(blocked, "observe the real PostgreSQL row-lock wait, not a timing guess");
    const sweep = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(sweep.locked && !sweep.complete);
    await blocker.query("rollback");
    await touch;
    assert.equal(await chatCount(database), 0);
    assert.equal((await database.query("select * from riwi_conversation_messages")).length, 0);
    const [user] = await database.query<{ last_active_at: Date; last_meaningful_activity_at: Date }>("select last_active_at,last_meaningful_activity_at from users where id=$1", [userId]);
    assert.equal(user!.last_active_at.toISOString(), now.toISOString());
    assert.equal(user!.last_meaningful_activity_at.toISOString(), "2020-01-01T00:00:00.000Z");
  } finally { await blocker.query("rollback").catch(() => {}); await touch?.catch(() => {}); blocker.release?.(); await database.close(); }
});

test("native retention: audit failure rolls back deletion and late-return online timestamp together", options, async () => {
  const database = await createPortableTestDatabase("native");
  try {
    const { userId } = await seed(database, new Date(now.getTime() - 8 * DAY));
    const usersBefore = await database.query("select * from users order by id");
    const messagesBefore = await database.query("select * from riwi_conversation_messages order by id");
    await database.query("create function qa_reject_audit() returns trigger language plpgsql as $$begin raise exception 'QA_AUDIT_REJECT'; end$$");
    await database.query("create trigger qa_reject_audit before insert on audit_log for each row execute function qa_reject_audit()");
    const rejectedAudit = (error: unknown) => error instanceof Error && error.cause instanceof Error && error.cause.message.includes("QA_AUDIT_REJECT");
    await assert.rejects(runRiwiConversationRetention({ now, dryRun: false }, orm(database)), rejectedAudit);
    await assert.rejects(recordRiwiOnlineActivity(userId, now, orm(database)), rejectedAudit);
    assert.equal(await chatCount(database), 1);
    assert.deepEqual(await database.query("select * from users order by id"), usersBefore);
    assert.deepEqual(await database.query("select * from riwi_conversation_messages order by id"), messagesBefore);
    await database.query("drop trigger qa_reject_audit on audit_log");
    const recovered = await runRiwiConversationRetention({ now, dryRun: false }, orm(database));
    assert.ok(recovered.locked && recovered.complete && recovered.offlineChats === 1);
  } finally { await database.close(); }
});
