#!/usr/bin/env node
/**
 * Guarded additive migration for the APPROVED Preview QA database only.
 *
 *   DATABASE_URL=<preview QA url>                 never printed, never written to a receipt
 *   PREVIEW_QA_DB_FINGERPRINT=<hex>               owner-approved URL identity (host, port, database, USERNAME)
 *   PREVIEW_QA_PROJECT_REF=<ref>                  required when the host is a shared pooler (e.g. Supabase
 *                                                 "postgres.<ref>" usernames); must equal the ref in the username
 *   PREVIEW_QA_SERVER_IDENTITY=<hex>              owner-approved identity reported BY THE SERVER after connecting
 *                                                 (system_identifier, current_database, session_user, server port)
 *   PREVIEW_QA_BACKUP_REF=<snapshot/branch/PITR>  required for --apply: the recovery point taken first
 *
 *   node scripts/preview-qa-migrate.mjs --fingerprint   connect read-only, print both identities (no secrets)
 *   node scripts/preview-qa-migrate.mjs --plan          verify identities, show applied/pending, verify schema
 *   node scripts/preview-qa-migrate.mjs --apply         additionally apply the allowlisted pending migrations
 *
 * Why the username is part of the identity: on a shared pooler (one hostname,
 * database "postgres" for every tenant) host+database alone are identical for
 * the QA and the Production project; only the tenant/project part of the
 * username tells them apart. The post-connect server identity then proves which
 * cluster actually answered.
 *
 * Refuses: Production markers, URL or server identity mismatch, a missing
 * project ref on a shared pooler, migration history that diverges from the
 * journal, pending migrations outside the allowlist, destructive SQL.
 * Exits non-zero when ANY verification fails or the after-apply plan is not clean.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

export const ALLOWED_PENDING = ["0025_speaking_bank_identity", "0026_google_identity", "0027_live_partner", "0028_full_listening",
  // Owner explicitly approved only the pending 0029–0035 sequence on 2026-10-03,
  // conditional on a fresh verified recovery point for the fingerprinted Preview.
  "0029_vocabulary_architecture", "0030_general_reading", "0031_writing_workspace",
  "0032_writing_exam_papers", "0033_writing_language_stealing", "0034_typing_duration_presets", "0035_teacher_student_links",
  // Owner explicitly approved 0036 on 2026-10-04, after fresh native recovery verification.
  "0036_speaking_study_support",
  // Owner explicitly approved Preview-only 0037 with circular crop and remove control.
  "0037_profile_photos",
  // Owner explicitly approved the additive Dictionary + Academic Reading Preview closure on 2026-10-05.
  // These remain hash-pinned and still require the existing identity + backup gates at --apply time.
  "0038_dictionary_releases", "0039_academic_reading_sets"];
export const APPROVED_0036_SHA256 = "2287d37ada3bd0d542ecdc9fb966dd024c903f04f6f8d3c274294d73d3b071da";
export const APPROVED_0037_SHA256 = "32890672239b62b019331a43c72d1102d48cd66651c156662c1cbad5a98f0341";
export const APPROVED_0038_SHA256 = "b54e0187c6c5bcafdd7070437c5a9a27d7d3259ba1a93976544da26da74e916d";
export const APPROVED_0039_SHA256 = "7d4bb56a0cbc516f7be38da90c46b55e64be2fc7bd4816b1b6fe993642e0ebbd";
const DESTRUCTIVE = /\b(drop\s+(table|column|schema|database|type)|truncate|delete\s+from|alter\s+column\s+\S+\s+type)\b/i;
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Keep TLS verification enabled, including on Supabase session poolers. */
export function qaConnectionOptions(url, env = process.env) {
  const u = new URL(url);
  // pg connection-string SSL parameters can replace the explicit CA options.
  if ([...u.searchParams.keys()].some(k => /^ssl/i.test(k))) throw new Error("Remove URL SSL parameters; use PREVIEW_QA_CA_FILE with verified TLS");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return {
    connectionString: url, connectionTimeoutMillis: 15000, query_timeout: 30000,
    ssl: local ? false : {
      rejectUnauthorized: true, servername: u.hostname,
      ...(env.PREVIEW_QA_CA_FILE ? { ca: readFileSync(env.PREVIEW_QA_CA_FILE, "utf8") } : {}),
    },
  };
}

/** Parse the identity-relevant parts of a connection URL. The password is never read. */
export function urlIdentity(url) {
  const u = new URL(url);
  const username = decodeURIComponent(u.username || "");
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const port = u.port || "5432";
  const host = u.hostname.toLowerCase();
  // Supabase/Supavisor-style tenant routing: "<role>.<projectRef>".
  const dotted = username.match(/^([^.]+)\.([a-z0-9-]+)$/i);
  const projectRef = dotted ? dotted[2].toLowerCase() : null;
  const role = dotted ? dotted[1] : username;
  const sharedPooler = /pooler|pgbouncer|supavisor/i.test(host) || Boolean(dotted);
  return { host, port, database, role, projectRef, sharedPooler };
}

/** URL fingerprint: host, port, database and the full username (role + project). Never the password. */
export function fingerprint(url) {
  const id = urlIdentity(url);
  return sha(`v2|${id.host}|${id.port}|${id.database}|${id.role}|${id.projectRef ?? "-"}`);
}

/** Identity reported by the server itself after connecting. */
export function serverIdentityHash(row) {
  return sha(`v1|${row.system_identifier ?? "unavailable"}|${row.db}|${row.session_user}|${row.port ?? "-"}`);
}

export function refuseProduction(url, env = process.env) {
  if (env.VERCEL_ENV === "production") return "VERCEL_ENV=production";
  const u = new URL(url);
  if (/prod/i.test(u.hostname + u.pathname + decodeURIComponent(u.username))) return "URL looks like production";
  return null;
}

/** Static identity checks that need no connection. Returns a list of refusal reasons. */
export function identityProblems(url, env = process.env) {
  const problems = [];
  const id = urlIdentity(url);
  if (!env.PREVIEW_QA_DB_FINGERPRINT) problems.push("PREVIEW_QA_DB_FINGERPRINT is not set");
  else if (env.PREVIEW_QA_DB_FINGERPRINT !== fingerprint(url)) problems.push("DATABASE_URL is not the approved Preview QA database (fingerprint mismatch)");
  if (id.sharedPooler) {
    if (!env.PREVIEW_QA_PROJECT_REF) problems.push("shared pooler host: PREVIEW_QA_PROJECT_REF must name the approved QA project");
    else if (!id.projectRef || id.projectRef !== env.PREVIEW_QA_PROJECT_REF.toLowerCase()) problems.push("project ref in DATABASE_URL username does not match PREVIEW_QA_PROJECT_REF");
  }
  if (!env.PREVIEW_QA_SERVER_IDENTITY) problems.push("PREVIEW_QA_SERVER_IDENTITY is not set (run --fingerprint and have the owner approve it)");
  return problems;
}

export function plan(journal, appliedHashes, readSql) {
  const entries = journal.entries.map((e) => ({ tag: e.tag, when: e.when, hash: sha(readSql(e.tag)) }));
  const applied = new Set(appliedHashes);
  // History must be a prefix of the journal: every applied hash is a journal entry, and no gaps.
  const firstPending = entries.findIndex((e) => !applied.has(e.hash));
  const pending = firstPending === -1 ? [] : entries.slice(firstPending);
  const problems = [];
  if (pending.some((e) => applied.has(e.hash))) problems.push("applied migrations after a pending one (gap)");
  const known = new Set(entries.map((e) => e.hash));
  for (const h of applied) if (!known.has(h)) problems.push("database has a migration not in the journal");
  for (const e of pending) {
    if (!ALLOWED_PENDING.includes(e.tag)) problems.push(`pending ${e.tag} is not approved`);
    const reviewed0036 = e.tag === "0036_speaking_study_support" && e.hash === APPROVED_0036_SHA256;
    if (e.tag === "0036_speaking_study_support" && !reviewed0036) problems.push("0036 SQL differs from the owner-approved hash");
    if (e.tag === "0037_profile_photos" && e.hash !== APPROVED_0037_SHA256) problems.push("0037 SQL differs from the owner-approved hash");
    if (e.tag === "0038_dictionary_releases" && e.hash !== APPROVED_0038_SHA256) problems.push("0038 SQL differs from the owner-approved hash");
    if (e.tag === "0039_academic_reading_sets" && e.hash !== APPROVED_0039_SHA256) problems.push("0039 SQL differs from the owner-approved hash");
    if (DESTRUCTIVE.test(readSql(e.tag)) && !reviewed0036) problems.push(`${e.tag} contains destructive SQL`);
  }
  return { applied: entries.filter((e) => applied.has(e.hash)).map((e) => e.tag), pending: pending.map((e) => e.tag), problems };
}

/** Every verification is scoped to the application schema `public`. */
export const VERIFY = [
  ["Profile photographs", "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='user_profile_photos' and column_name in ('user_id','image_base64','content_type','updated_at')", (r) => r.n === 4],
  ["Dictionary release tables", "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('dictionary_releases','dictionary_channels','dictionary_entries','dictionary_search_terms','dictionary_sense_mappings','dictionary_recent_searches','dictionary_drafts','dictionary_owner_events','dictionary_publish_jobs')", (r) => r.n === 9],
  ["Dictionary immutability triggers", "select count(distinct trigger_name)::int n from information_schema.triggers where event_object_schema='public' and trigger_name in ('dictionary_entries_immutable','dictionary_terms_immutable','dictionary_registry_immutable')", (r) => r.n === 3],
  ["Academic Reading assessment tables", "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('reading_assessments','reading_assessment_passages')", (r) => r.n === 2],
  ["Speaking study support", "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='speaking_prompts' and column_name='study_support' and data_type='jsonb' and is_nullable='NO'", (r) => r.n === 1],
  ["Speaking question folder capacity", "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='vocab_folders' and column_name='name' and character_maximum_length=200", (r) => r.n === 1],
  ["Listening independent segment offsets", "select count(*)::int n from pg_indexes where schemaname='public' and indexname='lexical_occurrences_listening_offset_idx' and indexdef ilike '%UNIQUE%' and indexdef ilike '%segment_key%'", (r) => r.n === 1],
  ["lexical architecture", "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('lexical_units','lexical_unit_forms')", (r) => r.n === 2],
  ["lexeme backfill complete", "select count(*)::int n from public.lexemes where lexical_unit_id is null", (r) => r.n === 0],
  ["General Reading tables", "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('general_reading_sets','general_reading_passages','general_reading_progress')", (r) => r.n === 3],
  ["Writing workspace and paper tables", "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('writing_lessons','writing_lesson_progress','writing_exam_sessions','writing_grade_requests','writing_translation_sets','writing_translation_sentences','writing_translation_attempts','writing_translation_answers','writing_model_texts','typing_run_texts','writing_language_patterns','writing_pattern_bank','writing_exam_papers','writing_exam_paper_entries','writing_stealing_sessions')", (r) => r.n === 15],
  ["Typing preset column", "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='typing_run_texts' and column_name='preset_seconds'", (r) => r.n === 1],
  ["Explicit teacher roster", "select count(*)::int n from pg_indexes where schemaname='public' and tablename='teacher_student_links' and indexname='teacher_student_links_pair_uidx'", (r) => r.n === 1],
  ["full Listening tables", "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('listening_packages','listening_activity_runs','listening_drafts')", (r) => r.n === 3],
  ["full Listening speed column", "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='listening_activity_runs' and column_name='speed_rate'", (r) => r.n === 1],
  ["speaking_prompts identity columns", "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='speaking_prompts' and column_name in ('external_id','topic','source_class','available_in')", (r) => r.n === 4],
  ["users.google_sub unique index", "select count(*)::int n from pg_indexes where schemaname='public' and tablename='users' and indexdef ilike '%(google_sub)%' and indexdef ilike '%unique%'", (r) => r.n >= 1],
  ["live_partner tables", "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('live_partner_presence','live_partner_invites','live_partner_sessions','live_partner_blocks')", (r) => r.n === 4],
  ["practice query runs", `select count(*)::int n from public.speaking_prompts where available_in @> '["practice_alone"]'::jsonb`, () => true],
  ["live partner query runs", `select count(*)::int n from public.live_partner_presence p join public.users u on u.id = p.user_id where p.state = 'available'`, () => true],
];

/** Decide the exit code from a finished receipt: anything not clean is a failure. */
export function receiptFailures(receipt) {
  const failures = [];
  if (receipt.refused) failures.push(receipt.refused);
  for (const v of receipt.verify ?? []) if (!v.pass) failures.push(`verification failed: ${v.name}`);
  if (receipt.after) {
    for (const p of receipt.after.problems) failures.push(`after apply: ${p}`);
    if (receipt.after.pending.length) failures.push(`after apply: still pending ${receipt.after.pending.join(",")}`);
  }
  if (receipt.mode !== "--fingerprint" && !receipt.verify && !receipt.verifySkipped && !receipt.refused) failures.push("verification did not run");
  return failures;
}

export async function readServerIdentity(client) {
  const base = (await client.query("select current_database() db, session_user, inet_server_port() port")).rows[0];
  let system_identifier = null;
  try { system_identifier = String((await client.query("select system_identifier from pg_control_system()")).rows[0].system_identifier); } catch { /* not permitted for this role: recorded as unavailable */ }
  return { ...base, system_identifier };
}

/**
 * The whole CLI as a function. `connect(url)` returns a pg-compatible client
 * (connect/query/end); `runMigrations(client)` applies pending migrations.
 * Returns { code, receipt } and never prints the URL or password.
 */
export async function run({ mode = "--plan", env = process.env, connect, runMigrations, readJournal, readSql, writeReceipt = () => null, log = () => {} }) {
  const url = env.DATABASE_URL;
  const receipt = { at: new Date().toISOString(), mode };
  if (!url) { receipt.refused = "DATABASE_URL is required"; return { code: 1, receipt }; }
  receipt.dbFingerprint = fingerprint(url);
  const id = urlIdentity(url);
  receipt.target = { host: id.host, port: id.port, database: id.database, role: id.role, projectRef: id.projectRef, sharedPooler: id.sharedPooler };
  const prod = refuseProduction(url, env);
  if (prod) { receipt.refused = `refused: ${prod}`; return { code: 1, receipt }; }
  if (mode !== "--fingerprint") {
    const problems = identityProblems(url, env);
    if (problems.length) { receipt.refused = `refused: ${problems.join("; ")}`; return { code: 1, receipt }; }
  }
  let client;
  try {
    client = await connect(url);
    await client.connect();
    const server = await readServerIdentity(client);
    receipt.serverIdentity = serverIdentityHash(server);
    receipt.server = { database: server.db, sessionUser: server.session_user, port: server.port, systemIdentifier: server.system_identifier ? "present" : "unavailable" };
    if (mode === "--fingerprint") return { code: 0, receipt };
    if (server.db !== id.database) { receipt.refused = "refused: server reports a different database than DATABASE_URL"; return { code: 1, receipt }; }
    if (receipt.serverIdentity !== env.PREVIEW_QA_SERVER_IDENTITY) { receipt.refused = "refused: server identity does not match PREVIEW_QA_SERVER_IDENTITY"; return { code: 1, receipt }; }
    const journal = readJournal();
    const hasTable = (await client.query("select to_regclass('drizzle.__drizzle_migrations') t")).rows[0].t;
    const appliedHashes = hasTable ? (await client.query("select hash from drizzle.__drizzle_migrations order by id")).rows.map((r) => r.hash) : [];
    const before = plan(journal, appliedHashes, readSql);
    receipt.before = before;
    if (before.problems.length) { receipt.refused = `refused: ${before.problems.join("; ")}`; return { code: 1, receipt }; }
    if (mode === "--apply" && before.pending.length) {
      if (!env.PREVIEW_QA_BACKUP_REF) { receipt.refused = "refused: set PREVIEW_QA_BACKUP_REF to the recovery point taken before applying"; return { code: 1, receipt }; }
      receipt.backupRef = env.PREVIEW_QA_BACKUP_REF;
      await runMigrations(client);
      const after = (await client.query("select hash from drizzle.__drizzle_migrations order by id")).rows.map((r) => r.hash);
      receipt.after = plan(journal, after, readSql);
    }
    if (mode === "--plan" && before.pending.length) {
      // The schema cannot pass before the pending migrations exist; say so instead of failing.
      receipt.verifySkipped = `pending migrations not applied yet: ${before.pending.join(",")}`;
      return { code: 0, receipt };
    }
    receipt.verify = [];
    for (const [name, q, ok] of VERIFY) {
      try { const r = (await client.query(q)).rows[0]; receipt.verify.push({ name, pass: Boolean(ok(r)), value: r.n }); }
      catch (e) { receipt.verify.push({ name, pass: false, error: String(e.code ?? e.message).slice(0, 80) }); }
    }
  } catch (error) {
    // Connection/identity/migration failures must never leave a green receipt.
    // Record only a driver code: error messages can contain connection secrets.
    const code = /^[A-Z0-9_]+$/.test(String(error?.code ?? "")) ? error.code : "DATABASE_OPERATION_FAILED";
    receipt.refused = `database operation failed: ${code}; inspect current state before retrying`;
  } finally {
    if (client) await client.end().catch(() => {});
    const failures = receiptFailures(receipt);
    receipt.result = failures.length ? { pass: false, failures } : { pass: true };
    const file = writeReceipt(receipt);
    log(JSON.stringify(receipt, null, 2));
    if (file) log(`receipt: ${file}`);
  }
  return { code: receipt.result.pass ? 0 : 1, receipt };
}

async function cli() {
  const pg = (await import("pg")).default;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { code } = await run({
    mode: process.argv[2] ?? "--plan",
    connect: (url) => new pg.Client(qaConnectionOptions(url)),
    runMigrations: (client) => migrate(drizzle(client), { migrationsFolder: "drizzle" }),
    readJournal: () => JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")),
    readSql: (tag) => readFileSync(`drizzle/${tag}.sql`, "utf8"),
    writeReceipt: (receipt) => {
      mkdirSync("docs/receipts", { recursive: true });
      const file = `docs/receipts/preview-qa-migrate-${receipt.at.replace(/[:.]/g, "-")}.json`;
      writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
      return file;
    },
    log: (line) => console.log(line),
  });
  process.exit(code);
}
if (import.meta.url === `file://${process.argv[1]}`) cli().catch((e) => { console.error(String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/g, "<redacted-url>")); process.exit(1); });
