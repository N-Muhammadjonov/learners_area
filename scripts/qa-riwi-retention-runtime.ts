/** R04 private native DB + real HTTP rehearsal. No deployment or hosted cron claim. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "../src/db/schema";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth/session";
import { runRiwiConversationRetention } from "../src/lib/services/riwi/conversation-retention";
import { createPortableTestDatabase, nativePortableTestsEnabled } from "../tests/support/riwi-portability-database";

assert.ok(nativePortableTestsEnabled, "identified private native cluster required");
assert.ok(process.argv[2], "new QA receipt path required");
const database = await createPortableTestDatabase("native");
const previousSecret = process.env.AUTH_SECRET;
const authSecret = randomBytes(32).toString("hex"), cronSecret = randomBytes(32).toString("hex");
const time = new Date(), DAY = 86_400_000;
const http: { action: string; status: number }[] = [];
const log: string[] = [];
let child: ChildProcess | undefined;
let stopped = false;
let failure: unknown;
const report: Record<string, unknown> = {
  scope: "R04_PRIVATE_NATIVE_HTTP_REHEARSAL", sourceKind: "synthetic_disposable_canaries",
  deployedSchedulerVerified: false, hourlyScheduleVerified: false, realBrowserVerified: false,
  productionTouched: false, sharedDatabaseTouched: false, buildRun: false, http,
};

async function stopApp() {
  if (!child?.pid) return;
  const current = child;
  const exited = new Promise<void>(resolve => {
    if (current.exitCode !== null || current.signalCode !== null) resolve();
    else current.once("exit", () => resolve());
  });
  try { process.kill(-current.pid!, "SIGTERM"); } catch { /* already exited */ }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
  if (timer) clearTimeout(timer);
  try { process.kill(-current.pid!, "SIGKILL"); } catch { /* group exited */ }
  await exited;
  stopped = true;
}

try {
  const [identity] = await database.query<{ name: string; version: string }>("select current_database() name,current_setting('server_version') version");
  report.nativeVersion = identity!.version;
  const url = new URL(process.env.PORTABILITY_DATABASE_URL!); url.pathname = "/" + identity!.name;
  const roles = ["student", "teacher", "admin", "owner"] as const;
  const people = roles.map(role => ({ role, id: randomUUID(), conversation: randomUUID() }));
  const cronUser = randomUUID(), activeUser = randomUUID(), activeChat = randomUUID(), cronChat = randomUUID();
  for (const person of people) {
    await database.query("insert into users(id,name,role,account_status,last_active_at,last_meaningful_activity_at)values($1,'R04 QA',$2,'active',$3,$4)", [person.id, person.role, new Date(time.getTime() - 8 * DAY), new Date("2020-01-01T00:00:00Z")]);
    await database.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,$3,$4)", [person.conversation, person.id, person.role, new Date(time.getTime() + DAY)]);
    await database.query("insert into riwi_conversation_messages(conversation_id,role,content)values($1,'user','R04_PRIVATE_CANARY')", [person.conversation]);
  }
  await database.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Cron QA','student','active',$3),($2,'Active QA','student','active',$4)", [cronUser, activeUser, new Date(time.getTime() - 8 * DAY), time]);
  await database.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,'student',$5),($3,$4,'student',$5)", [cronChat, cronUser, activeChat, activeUser, new Date(time.getTime() + DAY)]);
  await database.query("insert into riwi_conversation_messages(conversation_id,role,content,created_at)select $1,'user','R04_RECENT '||i,$2 from generate_series(1,101)i", [activeChat, time]);
  await database.query("insert into riwi_conversation_messages(conversation_id,role,content,created_at)values($1,'user','R04_OLD',$2),($3,'user','R04_OFFLINE',$4)", [activeChat, new Date(time.getTime() - 31 * DAY), cronChat, time]);
  const bank = randomUUID(), attempt = randomUUID();
  await database.query("insert into listening_tests(id,created_by_user_id,title,audio_type)values($1,$2,'R04 academic canary','file')", [bank, people[3]!.id]);
  await database.query("insert into listening_attempts(id,user_id,test_id,status,score,total_questions)values($1,$2,$3,'completed',37,40)", [attempt, people[0]!.id, bank]);
  const academic = await database.query("select * from listening_attempts order by id");
  const fingerprint = async () => JSON.stringify(await database.query("select (select jsonb_agg(u order by id) from users u) users,(select jsonb_agg(c order by id) from riwi_conversations c) chats,(select jsonb_agg(m order by id) from riwi_conversation_messages m) messages,(select jsonb_agg(a order by id) from audit_log a) audit"));
  const before = await fingerprint();
  const preview = await runRiwiConversationRetention({ now: time }, drizzle(database.pool! as pg.Pool, { schema }));
  assert.ok(preview.locked && !preview.applied && preview.offlineChats === 5 && preview.oldMessages === 1);
  assert.equal(await fingerprint(), before);
  report.zeroWriteDryRun = true;

  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: url.toString(), AUTH_SECRET: authSecret, CRON_SECRET: cronSecret,
      PUBLIC_BASE_URL: base, NEXT_PUBLIC_APP_URL: base, TRUST_PROXY_HEADERS: "false", APP_ENV: "development",
      NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", STORAGE_PROVIDER: "local" },
  });
  let spawnFailed = false; child.once("error", () => { spawnFailed = true; });
  const keep = (chunk: Buffer) => {
    log.push(chunk.toString().replace(/postgres(?:ql)?:\/\/\S+/g, "postgres://[redacted]").replaceAll(authSecret, "[redacted]").replaceAll(cronSecret, "[redacted]"));
    if (log.length > 100) log.shift();
  };
  child.stdout!.on("data", keep); child.stderr!.on("data", keep);
  let ready = false; const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    assert.ok(!spawnFailed && child.exitCode === null, "app exited before ready");
    try { ready = (await fetch(base + "/api/version", { signal: AbortSignal.timeout(30_000) })).status === 200; } catch { /* dev boot */ }
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready, "app boot timeout");
  process.env.AUTH_SECRET = authSecret;
  const request = async (action: string, path: string, headers: Record<string, string> = {}, method = "GET") => {
    const response = await fetch(base + path, { method, headers, signal: AbortSignal.timeout(120_000) });
    http.push({ action, status: response.status });
    return response;
  };
  assert.equal((await request("cron missing secret", "/api/cron/riwi-chat-retention")).status, 401);
  assert.equal((await request("cron wrong secret", "/api/cron/riwi-chat-retention", { authorization: `Bearer ${randomBytes(32).toString("hex")}` })).status, 401);
  assert.equal((await request("presence anonymous", "/api/riwi/presence", { origin: base }, "POST")).status, 401);
  assert.equal(await fingerprint(), before);
  for (const person of people) {
    const token = await createSessionToken({ sub: person.id, name: "R04 QA", role: person.role, locale: "en", onboarded: true });
    const cookie = `${SESSION_COOKIE}=${token}`;
    assert.equal((await request(person.role + " foreign-origin presence", "/api/riwi/presence", { cookie, origin: "https://foreign.invalid" }, "POST")).status, 403);
    assert.equal((await database.query("select id from riwi_conversations where id=$1", [person.conversation])).length, 1);
    assert.equal((await request(person.role + " late-return presence", "/api/riwi/presence", { cookie, origin: base }, "POST")).status, 204);
    assert.equal((await database.query("select id from riwi_conversations where id=$1", [person.conversation])).length, 0);
    const [user] = await database.query<{ last_active_at: Date; last_meaningful_activity_at: Date }>("select last_active_at,last_meaningful_activity_at from users where id=$1", [person.id]);
    assert.ok(user!.last_active_at.getTime() >= time.getTime());
    assert.equal(user!.last_meaningful_activity_at.toISOString(), "2020-01-01T00:00:00.000Z");
  }
  const first = await request("authorized cron HTTP apply", "/api/cron/riwi-chat-retention", { authorization: `Bearer ${cronSecret}` });
  assert.equal(first.status, 200);
  const applied = await first.json();
  assert.ok(applied.locked && applied.complete && applied.applied && applied.offlineChats === 1 && applied.oldMessages === 1);
  const second = await request("authorized cron HTTP retry", "/api/cron/riwi-chat-retention", { authorization: `Bearer ${cronSecret}` });
  assert.equal(second.status, 200);
  const repeated = await second.json();
  assert.ok(repeated.locked && repeated.complete && repeated.offlineChats === 0 && repeated.oldMessages === 0);
  assert.equal((await database.query("select * from riwi_conversation_messages")).length, 101);
  assert.equal((await database.query("select * from users")).length, 6);
  assert.deepEqual(await database.query("select * from listening_attempts order by id"), academic);
  assert.ok(!JSON.stringify(await database.query("select * from audit_log")).includes("R04_PRIVATE_CANARY"));
  Object.assign(report, { passed: true, authenticatedPresenceRoles: roles, applied, repeated, recentMessagesPreserved: 101, academicRecordsPreserved: true, accountsPreserved: 6, auditContainsNoChatText: true });
} catch (error) { failure = error; report.passed = false; report.error = error instanceof Error ? error.message : "QA runtime failure"; }
finally {
  await stopApp();
  await database.close();
  if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
  report.appProcessGroupStopped = stopped;
  report.privateDatabaseRemoved = true;
  await writeFile(process.argv[2]!, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
if (failure) { console.error(log.slice(-10).join("")); throw failure; }
console.log(JSON.stringify({ status: "R04_LOCAL_NATIVE_HTTP_PASSED", requests: http.length, deployedSchedulerVerified: false }));
