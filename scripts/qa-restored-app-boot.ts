/**
 * Restored-database application boot rehearsal (D05). QA only; never run against a real environment.
 *
 *   PORTABILITY_DATABASE_URL=postgres://postgres@localhost:<port>/learners_portability \
 *   RIWI_QA_DATA_DIR=<private cluster data dir> SPEAKING_BANK_SOURCE=<bank.jsonl> \
 *   node --conditions=react-server --import tsx scripts/qa-restored-app-boot.ts <out.json>
 *
 * For each scope (A full-system, B riwi, C learners-area) it creates a fresh source and destination
 * database in the identified private native cluster (canonical migrations), seeds >1000 permitted rows plus
 * the original Speaking bank, runs the actual encrypted export/dry-run/import commands, then boots the real
 * Next.js app (`next dev`, no build) bound to the restored destination and asserts real HTTP responses.
 * Development boot is NOT production-build acceptance. No secrets, tokens or cookies are written to the output.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { JSDOM } from "jsdom";
import { readListeningZip } from "../src/lib/listening/zip";
import { convertLegacyPackage } from "../src/lib/listening/source-parser";
import { createPortableTestDatabase, type PortableTestDatabase } from "../tests/support/riwi-portability-database";
import { createSessionToken } from "../src/lib/auth/session";
import { hashPassword } from "../src/lib/auth/password";
import { runPortableExportCommand } from "../src/lib/portability/export-command";
import { runPortableImportCommand } from "../src/lib/portability/import-command";
import { sha256, stableJson } from "../src/lib/portability/archive";
import { tablesForScope } from "../src/lib/portability/classification";
import type { PgPool } from "../src/lib/portability/postgres-adapter";

const SCOPES = ["full-system", "riwi", "learners-area"] as const;
const PASSWORD = "QaOnly-Restored-Boot-2026!";
const AUTH_SECRET = "qa-restored-boot-session-secret-" + "0".repeat(32);
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const poolFor = (database: PortableTestDatabase): PgPool => database.pool!;

async function fingerprint(database: PortableTestDatabase) {
  const rows = [];
  for (const table of tablesForScope("full-system").sort()) rows.push({ table, contents: await database.query(`select to_jsonb(t) row from "${table}" t order by to_jsonb(t)::text`) });
  return sha256(stableJson(rows));
}
const dbUrl = async (database: PortableTestDatabase) => {
  const [row] = await database.query<{ name: string }>("select current_database() name");
  const url = new URL(process.env.PORTABILITY_DATABASE_URL!); url.pathname = "/" + row!.name; return url.toString();
};

type Http = { path: string; status: number; note?: string };
async function call(base: string, path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  const response = await fetch(base + path, {
    method: init.method ?? "GET", signal: AbortSignal.timeout(240_000),
    headers: { ...(init.body ? { "content-type": "application/json", origin: base } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  let json: unknown = null; try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: response.status, text, json, setCookie: response.headers.getSetCookie?.() ?? [] };
}
// Search echoes the query, so assertions inspect only the result list.
const resultsText = (response: { json: unknown }) => JSON.stringify((response.json as { results?: unknown } | null)?.results ?? []);
const cookieOf = (setCookie: string[]) => setCookie.map(value => value.split(";")[0]).join("; ");

async function bootApp(databaseUrl: string): Promise<{ child: ChildProcess; base: string; log: string[] }> {
  const log: string[] = [];
  const port = await freePort();
  const child = spawn(process.execPath, [join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET, PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
      APP_ENV: "development", STORAGE_PROVIDER: "local", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "development" },
  });
  const keep = (chunk: Buffer) => { log.push(chunk.toString().replace(/postgres(?:ql)?:\/\/\S+/g, "postgres://[redacted]")); if (log.length > 200) log.shift(); };
  child.stdout!.on("data", keep); child.stderr!.on("data", keep);
  const base = `http://127.0.0.1:${port}`;
  let spawnError: Error | null = null;
  child.on("error", error => { spawnError = error; });
  const deadline = Date.now() + 300_000;
  try {
  while (Date.now() < deadline) {
    if (spawnError) throw new Error("app_spawn_failed");
    if (child.exitCode !== null) throw new Error("app_exited_before_ready:" + log.slice(-5).join(""));
    try { if ((await fetch(base + "/api/version", { signal: AbortSignal.timeout(120_000) })).status === 200) return { child, base, log }; } catch { /* still compiling */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error("app_boot_timeout");
  } catch (error) { await stopApp(child); throw error; }
}
async function stopApp(child: ChildProcess) {
  if (!child.pid) return;
  const exited = new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", () => resolve()); });
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = await Promise.race([exited.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
  if (timer) clearTimeout(timer);
  // Also reap descendants in this QA process group if the launcher exited first.
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already exited */ }
  if (!stopped) await exited;
}

async function rehearse(scope: (typeof SCOPES)[number]) {
  const source = await createPortableTestDatabase("native");
  const target = await createPortableTestDatabase("native").catch(async error => { await source.close(); throw error; });
  const root = await mkdtemp(join(tmpdir(), "riwi-boot-")); const key = randomBytes(32);
  const sourceOwner = randomUUID(), targetOwner = randomUUID(), learner = randomUUID(), global = randomUUID(), conversation = randomUUID(), offlineUser = randomUUID(), offlineConversation = randomUUID();
  const ownerEmail = `owner-${scope}@target.invalid`, learnerEmail = `learner-${scope}@source.invalid`;
  const hash = await hashPassword(PASSWORD);
  let listeningTestId = "";
  const listeningAnswers: { questionId: string; answer: string }[] = [];
  const http: Http[] = []; const checks: Record<string, unknown> = {};
  let app: Awaited<ReturnType<typeof bootApp>> | null = null;
  const token = (id: string) => createSessionToken({ sub: id, role: "student", name: "Untrusted role claim", locale: "en", onboarded: true });
  try {
    await source.query("insert into users(id,name,role,account_status,password_hash,last_active_at,email,onboarding_completed_at)values($1,'Source owner','owner','active','source-auth',now(),'owner@source.invalid',now()),($2,'Restored learner','student','active',$3,now(),$4,now())", [sourceOwner, learner, hash, learnerEmail]);
    await target.query("insert into users(id,name,role,account_status,password_hash,email,onboarding_completed_at)values($1,'Target owner','owner','active',$2,$3,now())", [targetOwner, hash, ownerEmail]);
    await source.query("insert into grammar_topics(title,explanation,\"order\") select 'RESTOREDTOPIC '||n,'SITE_CONTENT_CANARY '||n,n from generate_series(1,1005)n");
    await source.query("insert into riwi_knowledge_sources(id,source_type,title,checksum,provenance,rights_class,scope,scope_user_id,created_by_user_id)values($1,'owner_instruction','RESTORED_RIWI_SOURCE',repeat('a',64),'QA','owned','global',null,$2)", [global, sourceOwner]);
    await source.query("insert into riwi_knowledge_units(source_id,ordinal,content,content_hash,character_count) select $1,n,'Public fact '||n,lpad(n::text,64,'0'),length('Public fact '||n) from generate_series(1,1005)n", [global]);
    await source.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,'student',now()+interval '30 days')", [conversation, learner]);
    await source.query("insert into riwi_conversation_messages(id,conversation_id,role,content,created_at)values(gen_random_uuid(),$1,'user','RECENT_CHAT_CANARY',now())", [conversation]);
    await source.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Offline export canary','student','active',now()-interval '8 days')", [offlineUser]);
    await source.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$2,'student',now()+interval '30 days')", [offlineConversation, offlineUser]);
    await source.query("insert into riwi_conversation_messages(id,conversation_id,role,content)values(gen_random_uuid(),$1,'user','OFFLINE_DAY8_CHAT_CANARY')", [offlineConversation]);
    if (scope === "riwi") await target.query("insert into grammar_topics(title,explanation,\"order\")values('DESTINATION_SITE_TOPIC','TARGET_SITE_CANARY',1)");
    if (scope === "learners-area") await target.query("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,created_by_user_id)values('owner_instruction','TARGET_RIWI_SOURCE',repeat('d',64),'TARGET_RIWI_CANARY','owned',$1)", [targetOwner]);
    // Original Speaking bank through the repository's own idempotent importer (rows land as drafts).
    const sourceUrl = await dbUrl(source); const sourceName = new URL(sourceUrl).pathname.slice(1);
    execFileSync("node", ["scripts/import-speaking-bank.mjs", "--source", process.env.SPEAKING_BANK_SOURCE!, "--apply"], { env: { ...process.env, DATABASE_URL: sourceUrl, SPEAKING_IMPORT_CONFIRM_DATABASE: sourceName }, stdio: "pipe" });
    const bankRows = (await source.query<{ n: number }>("select count(*)::int n from speaking_prompts"))[0]!.n;
    assert.equal(bankRows, 880);
    checks.sourceRows = { grammarTopics: 1005, riwiUnits: 1005, speakingPrompts: bankRows, bankSha256: createHash("sha256").update(await (await import("node:fs/promises")).readFile(process.env.SPEAKING_BANK_SOURCE!)).digest("hex") };

    // Restore the actual supplied Listening payload, not a hand-written substitute.
    const listeningBytes = await readFile(process.env.LISTENING_SOURCE_ZIP!);
    const { textFiles } = readListeningZip(new Uint8Array(listeningBytes));
    const listening = convertLegacyPackage(textFiles, 1645.061224, html => new JSDOM(html).window.document);
    assert.equal(listening.questions.length, 40);
    const [listeningRow] = await source.query<{ id: string }>("insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'RESTORED_ORIGINAL_LISTENING','audio','published')returning id", [sourceOwner]);
    listeningTestId = listeningRow!.id;
    await source.query("insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/original-listening.mp3',$4)", [listeningTestId, listening.testId, JSON.stringify(listening), createHash("sha256").update(listeningBytes).digest("hex")]);
    for (const q of listening.questions) {
      const [row] = await source.query<{ id: string }>("insert into listening_questions(test_id,\"order\",type,question_text,correct_answer,explanation)values($1,$2,'short_answer',$3,$4,$5)returning id", [listeningTestId, q.number, q.text, q.key, q.evidence.why]);
      listeningAnswers.push({ questionId: row!.id, answer: q.number === 25 ? listening.questions[25]!.key : q.number === 26 ? listening.questions[24]!.key : q.key });
    }
    checks.originalListening = { sourceSha256: createHash("sha256").update(listeningBytes).digest("hex"), questions: 40, includesSwappedChooseTwo: true, audioStorageAcceptance: false };

    const before = await fingerprint(target);
    const archive = join(root, "source.lap");
    const manifest = await runPortableExportCommand({ request: { scope, dryRun: false, destination: archive, sourceFingerprint: "boot-source" }, sessionToken: await token(sourceOwner), pool: poolFor(source), key, async *objects() {} });
    checks.manifest = { manifestSha256: manifest.manifestSha256, tables: manifest.tables.length };
    const input = { request: { source: archive, expectedScope: scope, dryRun: true, destinationFingerprint: "boot-target" }, sessionToken: await token(targetOwner), pool: poolFor(target), key, identityMapping: [{ sourceId: sourceOwner, targetId: targetOwner }] };
    const dry = await runPortableImportCommand(input);
    assert.equal(dry.dryRun, true);
    assert.equal(await fingerprint(target), before, "dry-run: zero persistent writes");
    const applied = await runPortableImportCommand({ ...input, request: { ...input.request, dryRun: false } });
    assert.equal(applied.creates, dry.creates);
    const after = await fingerprint(target);
    checks.import = { dryCreates: dry.creates, appliedCreates: applied.creates, fingerprintBeforeDryRun: before, fingerprintAfterApply: after };
    const count = async (table: string) => (await target.query<{ n: number }>(`select count(*)::int n from ${table}`))[0]!.n;
    checks.destinationCounts = { users: await count("users"), grammarTopics: await count("grammar_topics"), riwiUnits: await count("riwi_knowledge_units"), speakingPrompts: await count("speaking_prompts"), riwiMessages: await count("riwi_conversation_messages") };
    assert.equal((checks.destinationCounts as { riwiMessages: number }).riwiMessages, scope === "full-system" ? 1 : 0, "day-eight offline chat is excluded in all scopes");
    assert.equal((await target.query<{ n: number }>("select count(*)::int n from riwi_conversation_messages where content='OFFLINE_DAY8_CHAT_CANARY'"))[0]!.n, 0);
    checks.offlineRetention = { offlineDays: 8, excludedChatMessages: true };
    const expectedPrompts = scope === "riwi" ? 0 : 880;
    assert.equal((checks.destinationCounts as { speakingPrompts: number }).speakingPrompts, expectedPrompts);
    assert.equal((checks.destinationCounts as { grammarTopics: number }).grammarTopics, scope === "riwi" ? 1 : 1005);

    app = await bootApp(await dbUrl(target));
    const base = app.base;
    const record = (path: string, status: number, note?: string) => http.push({ path, status, ...(note ? { note } : {}) });
    const version = await call(base, "/api/version"); record("/api/version", version.status); assert.equal(version.status, 200);
    const wrong = await call(base, "/api/auth/login", { method: "POST", body: { email: ownerEmail, password: "wrong-password-value" } }); record("/api/auth/login (wrong password)", wrong.status); assert.equal(wrong.status, 401);
    const ownerLogin = await call(base, "/api/auth/login", { method: "POST", body: { email: ownerEmail, password: PASSWORD } }); record("/api/auth/login (target owner)", ownerLogin.status); assert.equal(ownerLogin.status, 200);
    const ownerCookie = cookieOf(ownerLogin.setCookie); assert.ok(ownerCookie);
    const knowledge = await call(base, "/api/riwi/owner/knowledge", { cookie: ownerCookie });
    const sawRestoredRiwi = knowledge.text.includes("RESTORED_RIWI_SOURCE"), sawTargetRiwi = knowledge.text.includes("TARGET_RIWI_SOURCE");
    record("/api/riwi/owner/knowledge (owner)", knowledge.status, `restoredSource=${sawRestoredRiwi} targetSource=${sawTargetRiwi}`);
    assert.equal(knowledge.status, 200);
    assert.equal(sawRestoredRiwi, scope !== "learners-area", "scope C must not restore RIWI knowledge");
    assert.equal(sawTargetRiwi, scope === "learners-area", "scope C must keep the destination's own RIWI state");
    const ownerSearch = await call(base, "/api/search?q=RESTOREDTOPIC", { cookie: ownerCookie });
    record("/api/search?q=RESTOREDTOPIC (owner)", ownerSearch.status, `restoredTopics=${resultsText(ownerSearch).includes("RESTOREDTOPIC")}`);
    assert.equal(ownerSearch.status, 200); assert.equal(resultsText(ownerSearch).includes("RESTOREDTOPIC"), scope !== "riwi", "scope B must not restore site content");
    if (scope === "riwi") {
      const destination = await call(base, "/api/search?q=DESTINATION_SITE_TOPIC", { cookie: ownerCookie });
      record("/api/search?q=DESTINATION_SITE_TOPIC (owner)", destination.status, `targetTopic=${resultsText(destination).includes("DESTINATION_SITE_TOPIC")}`);
      assert.ok(resultsText(destination).includes("DESTINATION_SITE_TOPIC"), "scope B preserves the destination site");
      const learnerLogin = await call(base, "/api/auth/login", { method: "POST", body: { email: learnerEmail, password: PASSWORD } });
      record("/api/auth/login (source learner, not restored)", learnerLogin.status); assert.equal(learnerLogin.status, 401);
    } else {
      const learnerLogin = await call(base, "/api/auth/login", { method: "POST", body: { email: learnerEmail, password: PASSWORD } });
      record("/api/auth/login (restored learner)", learnerLogin.status); assert.equal(learnerLogin.status, 200);
      const learnerCookie = cookieOf(learnerLogin.setCookie);
      const start = await call(base, "/api/listening/attempts", { method: "POST", cookie: learnerCookie, body: { testId: listeningTestId } });
      record("/api/listening/attempts (restored original Listening)", start.status); assert.equal(start.status, 200);
      const attemptId = (start.json as { id: string }).id; assert.ok(attemptId);
      const submitPath = `/api/listening/attempts/${attemptId}/submit`;
      const submitted = await call(base, submitPath, { method: "POST", cookie: learnerCookie, body: { answers: listeningAnswers } });
      record("/api/listening/attempts/:id/submit (40 original answers)", submitted.status); assert.equal(submitted.status, 200);
      assert.equal((submitted.json as { score: number }).score, 40);
      assert.equal((submitted.json as { totalQuestions: number }).totalQuestions, 40);
      const repeated = await call(base, submitPath, { method: "POST", cookie: learnerCookie, body: { answers: [] } });
      record("/api/listening/attempts/:id/submit (immutable repeat)", repeated.status); assert.equal(repeated.status, 409);
      checks.originalListeningHttp = { score: 40, totalQuestions: 40, repeatStatus: repeated.status };
      const learnerSearch = await call(base, "/api/search?q=RESTOREDTOPIC", { cookie: learnerCookie });
      record("/api/search?q=RESTOREDTOPIC (restored learner)", learnerSearch.status, `restoredTopics=${resultsText(learnerSearch).includes("RESTOREDTOPIC")}`);
      assert.equal(learnerSearch.status, 200); assert.ok(resultsText(learnerSearch).includes("RESTOREDTOPIC"));
      const denied = await call(base, "/api/riwi/owner/knowledge", { cookie: learnerCookie });
      record("/api/riwi/owner/knowledge (restored learner)", denied.status); assert.ok([401, 403].includes(denied.status));
      assert.ok(!denied.text.includes("RESTORED_RIWI_SOURCE"));
    }
    const anonymous = await call(base, "/api/riwi/owner/knowledge");
    record("/api/riwi/owner/knowledge (anonymous)", anonymous.status); assert.ok([401, 403].includes(anonymous.status));
    const runningUrl = await dbUrl(target);
    checks.appBoundToRestoredDatabase = { database: new URL(runningUrl).pathname.slice(1), proof: "owner/learner credentials and restored rows exist only in this destination database and were returned by the running app" };
    return { scope, ok: true, checks, http };
  } catch (error) {
    return { scope, ok: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 8).join("\n").replace(/postgres(?:ql)?:\/\/\S+/g, "postgres://[redacted]") : null, checks, http, appLog: app?.log.slice(-8) };
  } finally {
    if (app) await stopApp(app.child);
    key.fill(0);
    await source.close().catch(() => {}); await target.close().catch(() => {}); await rm(root, { recursive: true, force: true });
  }
}

const out = process.argv[2];
const oldSecret = process.env.AUTH_SECRET; process.env.AUTH_SECRET = AUTH_SECRET;
const results = [];
try {
  for (const scope of SCOPES) { results.push(await rehearse(scope)); console.log(scope, results.at(-1)!.ok ? "PASS" : "FAIL"); }
} finally { if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret; }
const report = { node: process.version, runtime: "next dev (development boot, no production build)", results };
if (out) await writeFile(out, JSON.stringify(report, null, 1));
process.exit(results.every(item => item.ok) ? 0 : 1);
