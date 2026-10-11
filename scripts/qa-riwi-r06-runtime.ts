/** R06: disposable native PostgreSQL + real HTTP; optional manual browser hold.
 * This is local evidence only, never live-provider or deployed-target acceptance. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SignJWT } from "jose";
import { hashPassword } from "../src/lib/auth/password";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth/session";
import { createPortableTestDatabase, nativePortableTestsEnabled } from "../tests/support/riwi-portability-database";

assert.ok(nativePortableTestsEnabled, "identified private native cluster required");
assert.ok(process.argv[2], "new receipt path required");
const database = await createPortableTestDatabase("native");
const previousSecret = process.env.AUTH_SECRET;
const authSecret = randomBytes(32).toString("hex");
const password = "Qa-" + randomBytes(16).toString("hex");
const roles = ["student", "teacher", "admin", "owner"] as const;
const people = roles.map(role => ({ role, id: randomUUID(), conversation: randomUUID(), email: `${role}-${randomUUID()}@qa.invalid` }));
const http: { action: string; status: number }[] = [];
const report: Record<string, unknown> = {
  scope: "R06_PRIVATE_NATIVE_HTTP", syntheticDisposableData: true,
  realProviderVerified: false, deployedTargetVerified: false, realBrowserVerified: false,
  signedPrivateUrlExpiryVerified: false, productionTouched: false, sharedDatabaseTouched: false,
  buildRun: false, http,
};
let child: ChildProcess | undefined;
let failure: unknown;
const logs: string[] = [];
let stopped = false;
async function stop() {
  if (!child?.pid) return;
  const running = child;
  const exited = new Promise<void>(resolve => {
    if (running.exitCode !== null || running.signalCode !== null) resolve();
    else running.once("exit", () => resolve());
  });
  try { process.kill(-running.pid!, "SIGTERM"); } catch { /* already exited */ }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
  if (timer) clearTimeout(timer);
  try { process.kill(-running.pid!, "SIGKILL"); } catch { /* already exited */ }
  await exited;
  stopped = true;
}
try {
  const [identity] = await database.query<{ name: string; version: string }>("select current_database() name,current_setting('server_version') version");
  report.nativeVersion = identity!.version;
  const url = new URL(process.env.PORTABILITY_DATABASE_URL!); url.pathname = "/" + identity!.name;
  const hash = await hashPassword(password);
  for (const p of people) {
    await database.query("insert into users(id,name,email,password_hash,role,account_status,locale,onboarding_completed_at,last_active_at)values($1,$2,$3,$4,$5,'active','en',now(),now())", [p.id, `R06 QA ${p.role}`, p.email, hash, p.role]);
    await database.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,$3,now()+interval '1 day')", [p.conversation, p.id, p.role]);
    await database.query("insert into riwi_conversation_messages(conversation_id,role,content)values($1,'user',$2)", [p.conversation, `R06_PRIVATE_${p.role}`]);
  }
  const foreign = randomUUID(), foreignChat = randomUUID();
  await database.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Foreign QA','student','active',now())", [foreign]);
  await database.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,'student',now()+interval '1 day')", [foreignChat, foreign]);
  await database.query("insert into riwi_conversation_messages(conversation_id,role,content)values($1,'user','R06_FOREIGN_SECRET')", [foreignChat]);
  assert.ok(process.env.STORAGE_LOCAL_DIR, "fresh local storage required");
  const objectKey = `speaking/${people[0]!.id}/${randomUUID()}.webm`;
  const objectPath = join(process.env.STORAGE_LOCAL_DIR!, objectKey);
  await mkdir(join(objectPath, ".."), { recursive: true });
  await writeFile(objectPath, "R06_PRIVATE_RECORDING", { flag: "wx", mode: 0o600 });
  await database.query("insert into speaking_attempts(user_id,part,recording_object_key,recording_mime_type)values($1,'part1',$2,'audio/webm')", [people[0]!.id, objectKey]);
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: url.toString(), AUTH_SECRET: authSecret,
      PUBLIC_BASE_URL: base, NEXT_PUBLIC_APP_URL: base, TRUST_PROXY_HEADERS: "false", APP_ENV: "development",
      NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", STORAGE_PROVIDER: "local",
      RIWI_ENABLED: "true", RIWI_STUDENT_ENABLED: "true", RIWI_TEACHER_ENABLED: "true",
      RIWI_ADMIN_ENABLED: "true", RIWI_OWNER_ENABLED: "true", RIWI_PROVIDER_LAB_ENABLED: "true",
      RIWI_EXTERNAL_AI_ENABLED: "false", AI_EXTERNAL_ENABLED: "false", AI_PRIMARY_PROVIDER: "riwi",
      OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "" },
  });
  let spawnFailed = false; child.once("error", () => { spawnFailed = true; });
  const keep = (chunk: Buffer) => {
    logs.push(chunk.toString().replace(/postgres(?:ql)?:\/\/\S+/g, "postgres://[redacted]").replaceAll(authSecret, "[redacted]").replaceAll(password, "[redacted]"));
    if (logs.length > 100) logs.shift();
  };
  child.stdout!.on("data", keep); child.stderr!.on("data", keep);
  let ready = false; const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    assert.ok(!spawnFailed && child.exitCode === null, "app exited before ready");
    try { ready = (await fetch(base + "/api/version", { signal: AbortSignal.timeout(30_000) })).status === 200; } catch { /* boot */ }
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready, "app boot timeout");
  process.env.AUTH_SECRET = authSecret;
  const request = async (action: string, path: string, cookie = "", method = "GET", origin?: string, body?: unknown) => {
    const response = await fetch(base + path, { method, redirect: "manual",
      headers: { ...(cookie ? { cookie } : {}), ...(origin === undefined ? {} : { origin }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000) });
    http.push({ action, status: response.status });
    return response;
  };
  assert.equal((await request("anonymous transcript", `/api/riwi/conversations/${foreignChat}`)).status, 401);
  assert.equal((await request("anonymous private recording", `/api/resources/${objectKey}`)).status, 401);
  for (const p of people) {
    const payload = { sub: p.id, role: p.role, name: `R06 QA ${p.role}`, locale: "en", onboarded: true };
    const cookie = `${SESSION_COOKIE}=${await createSessionToken(payload)}`;
    const own = await request(`${p.role} own transcript`, `/api/riwi/conversations/${p.conversation}`, cookie);
    assert.equal(own.status, 200); assert.ok(own.headers.get("cache-control")?.includes("no-store"));
    assert.ok((await own.text()).includes(`R06_PRIVATE_${p.role}`));
    const other = await request(`${p.role} foreign transcript`, `/api/riwi/conversations/${foreignChat}`, cookie);
    assert.equal(other.status, 404); assert.ok(!(await other.text()).includes("R06_FOREIGN_SECRET"));
    assert.equal((await request(`${p.role} foreign-origin chat`, "/api/riwi/chat", cookie, "POST", "https://foreign.invalid", { message: "hello" })).status, 403);
    assert.equal((await request(`${p.role} null-origin chat`, "/api/riwi/chat", cookie, "POST", "null", { message: "hello" })).status, 403);
    assert.equal((await request(`${p.role} forged provider/role`, "/api/riwi/chat", cookie, "POST", base, { message: "hello", role: "owner", provider: "openai" })).status, 400);
    assert.equal((await request(`${p.role} RIWI page`, "/riwi", cookie)).status, 200);
    const panel = await request(`${p.role} owner provider panel`, "/api/riwi/owner/provider-lab", cookie);
    assert.equal(panel.status, p.role === "owner" ? 200 : 401);
    assert.equal((await request(`${p.role} foreign-origin delete`, `/api/riwi/conversations/${p.conversation}`, cookie, "DELETE", "https://foreign.invalid")).status, 403);
    assert.equal((await database.query("select id from riwi_conversations where id=$1", [p.conversation])).length, 1);
    const expired = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 100).setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(new TextEncoder().encode(authSecret));
    assert.equal((await request(`${p.role} expired-cookie replay`, `/api/riwi/conversations/${p.conversation}`, `${SESSION_COOKIE}=${expired}`)).status, 401);
    await database.query("update users set account_status='suspended' where id=$1", [p.id]);
    assert.equal((await request(`${p.role} suspended-cookie replay`, `/api/riwi/conversations/${p.conversation}`, cookie)).status, 401);
    await database.query("update users set account_status='active' where id=$1", [p.id]);
    const signedOut = await request(`${p.role} logout`, "/api/auth/logout", cookie, "POST", base);
    assert.equal(signedOut.status, 200); assert.ok(signedOut.headers.get("set-cookie")?.includes("Max-Age=0"));
    const audio = await request(`${p.role} private recording authorized`, `/api/resources/${objectKey}`, cookie);
    assert.equal(audio.status, 200); assert.ok(audio.headers.get("cache-control")?.includes("no-store"));
    assert.equal(await audio.text(), "R06_PRIVATE_RECORDING");
  }
  const owner = people[3]!;
  const ownerCookie = `${SESSION_COOKIE}=${await createSessionToken({ sub: owner.id, role: "owner", name: "R06 QA owner", locale: "en", onboarded: true })}`;
  await database.query("update users set role='student' where id=$1", [owner.id]);
  assert.equal((await request("demoted owner old-cookie replay", "/api/riwi/owner/provider-lab", ownerCookie)).status, 401);
  await database.query("update users set role='owner' where id=$1", [owner.id]);
  const foreignCookie = `${SESSION_COOKIE}=${await createSessionToken({ sub: foreign, role: "student", name: "Foreign QA", locale: "en", onboarded: true })}`;
  assert.equal((await request("foreign student recording IDOR", `/api/resources/${objectKey}`, foreignCookie)).status, 403);
  assert.equal((await request("tampered-cookie transcript", `/api/riwi/conversations/${foreignChat}`, `${SESSION_COOKIE}=invalid`)).status, 401);
  assert.ok(!JSON.stringify(await database.query("select * from audit_log")).includes("R06_FOREIGN_SECRET"));
  Object.assign(report, { passed: true, authenticatedRoles: roles, staleRoleRevocationVerified: true,
    expiredSessionReplayDenied: true, csrfDeniedWithoutDeletion: true, localPrivateRecordingAuthorizationVerified: true });
  if (process.argv[3]) {
    await writeFile(process.argv[3], JSON.stringify({ base, people: people.map(p => ({ role: p.role, email: p.email })), password, doneFile: process.argv[3] + ".done" }, null, 2), { flag: "wx", mode: 0o600 });
    console.log("R06_BROWSER_READY");
    const until = Date.now() + 20 * 60_000;
    let done = false;
    while (Date.now() < until) {
      try { await access(process.argv[3] + ".done"); done = true; break; } catch { /* manual browser pending */ }
      await delay(1000);
    }
    assert.ok(done, "browser hold expired without completion signal");
  }
} catch (error) { failure = error; report.passed = false; report.error = error instanceof Error ? error.message : "QA failure"; }
finally {
  await stop();
  await database.close();
  if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
  report.appProcessGroupStopped = stopped; report.privateDatabaseRemoved = true;
  await writeFile(process.argv[2]!, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
if (failure) { console.error(logs.slice(-10).join("")); throw failure; }
console.log(JSON.stringify({ status: "R06_LOCAL_NATIVE_HTTP_PASSED", requests: http.length, realProviderVerified: false, deployedTargetVerified: false }));
