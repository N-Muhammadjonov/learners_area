import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createPortableTestDatabase, nativePortableTestsEnabled, type PortableTestDatabase } from "./support/riwi-portability-database";

const exec = promisify(execFile);
const options = { skip: !nativePortableTestsEnabled ? "requires an identified private native cluster" : false, timeout: 30000 };
async function job(args: string[], environment: Record<string, string | undefined>) {
  const argv = process.env.RIWI_TEST_RETENTION_JOB_BUNDLE === "1"
    ? [join(process.cwd(), ".riwi-jobs/chat-retention.cjs"), ...args]
    : ["--conditions=react-server", "--import", "tsx", "scripts/riwi-chat-retention-job.ts", ...args];
  try {
    const { stdout, stderr } = await exec(process.execPath, argv, { cwd: process.cwd(), env: { ...process.env, ...environment }, timeout: 15000 });
    assert.equal(stderr, "");
    return { code: 0, output: JSON.parse(stdout) as Record<string, unknown> };
  } catch (error) {
    const failed = error as Error & { code?: number; stdout?: string; stderr?: string };
    assert.ok(typeof failed.code === "number", "worker must exit rather than leave connections open");
    assert.equal(failed.stderr, "");
    return { code: failed.code, output: JSON.parse(failed.stdout!) as Record<string, unknown> };
  }
}
async function environment(database: PortableTestDatabase) {
  const [row] = await database.query<{ name: string }>("select current_database() name");
  const url = new URL(process.env.PORTABILITY_DATABASE_URL!); url.pathname = "/" + row!.name;
  return { DATABASE_URL: url.toString(), RIWI_CHAT_RETENTION_DATABASE: row!.name, RIWI_CHAT_RETENTION_JOB_ENABLED: "true" };
}
async function seed(database: PortableTestDatabase) {
  const id = randomUUID(), chat = randomUUID();
  await database.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Job canary','student','active',now()-interval '8 days')", [id]);
  await database.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,'student',now()+interval '1 day')", [chat,id]);
  await database.query("insert into riwi_conversation_messages(conversation_id,role,content)values($1,'user','JOB_PRIVATE_TEXT')", [chat]);
  return { id, chat };
}

test("retention worker refuses missing apply opt-in and malformed args before any DB connection", async () => {
  const env = { DATABASE_URL: "postgres://secret-not-to-log@127.0.0.1:1/unreachable", RIWI_CHAT_RETENTION_DATABASE: "unreachable", RIWI_CHAT_RETENTION_JOB_ENABLED: undefined };
  for (const args of [["--apply"], ["--apply","--dry-run"], ["--unknown"]]) {
    const result = await job(args, env);
    assert.equal(result.code, 64); assert.equal(result.output.status,"REFUSED");
    assert.ok(!JSON.stringify(result).includes("secret-not-to-log"));
  }
});

test("native retention worker: default preview writes nothing, opt-in applies canonical cascade, repeat exits cleanly", options, async () => {
  const database = await createPortableTestDatabase("native");
  try {
    const { id } = await seed(database), env = await environment(database);
    const preview = await job([], env);
    assert.equal(preview.code, 0); assert.equal(preview.output.status, "DRY_RUN");
    assert.equal(preview.output.offlineChats, 1); assert.equal(preview.output.applied, false);
    assert.equal((await database.query("select * from riwi_conversations")).length, 1);
    assert.equal((await database.query("select * from audit_log")).length, 0);
    const applied = await job(["--apply"], env);
    assert.equal(applied.code, 0); assert.equal(applied.output.status, "APPLIED");
    assert.equal(applied.output.offlineChats, 1);
    assert.equal((await database.query("select * from riwi_conversation_messages")).length, 0);
    assert.equal((await database.query("select id from users where id=$1", [id])).length, 1);
    assert.ok(!JSON.stringify(await database.query("select * from audit_log")).includes("JOB_PRIVATE_TEXT"));
    const repeated = await job(["--apply"], env);
    assert.equal(repeated.code, 0); assert.equal(repeated.output.offlineChats, 0);
  } finally { await database.close(); }
});

test("native retention worker: wrong database identity refuses apply without changing rows", options, async () => {
  const database = await createPortableTestDatabase("native");
  try {
    await seed(database);
    const result = await job(["--apply"], { ...await environment(database), RIWI_CHAT_RETENTION_DATABASE: "wrong_database" });
    assert.equal(result.code, 64); assert.equal(result.output.reason, "database_identity_mismatch");
    assert.equal((await database.query("select * from riwi_conversations")).length, 1);
    assert.equal((await database.query("select * from audit_log")).length, 0);
  } finally { await database.close(); }
});

test("native retention worker: locked work and unfinished SKIP LOCKED sweeps exit75, later execution succeeds", options, async () => {
  const database = await createPortableTestDatabase("native");
  const blocker = await database.pool!.connect();
  try {
    const { id } = await seed(database), env = await environment(database);
    await blocker.query("begin"); await blocker.query("select pg_advisory_xact_lock(hashtext('learners_area.riwi.chat_retention'))");
    const busy = await job(["--apply"], env);
    assert.equal(busy.code,75); assert.equal(busy.output.status,"DEFERRED");
    await blocker.query("rollback");
    await blocker.query("begin"); await blocker.query("select id from users where id=$1 for update", [id]);
    const incomplete = await job(["--apply"], env);
    assert.equal(incomplete.code,75); assert.equal(incomplete.output.status,"INCOMPLETE");
    assert.equal(incomplete.output.complete,false);
    assert.equal((await database.query("select * from riwi_conversations")).length,1);
    await blocker.query("rollback");
    const retry = await job(["--apply"], env);
    assert.equal(retry.code,0); assert.equal(retry.output.status,"APPLIED");
    assert.equal((await database.query("select * from riwi_conversations")).length,0);
  } finally { await blocker.query("rollback").catch(()=>{}); blocker.release?.(); await database.close(); }
});
