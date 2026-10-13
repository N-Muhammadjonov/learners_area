import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { plan, fingerprint, refuseProduction } from "../scripts/preview-qa-migrate.mjs";

const journal = { entries: ["0023_a", "0024_b", "0025_speaking_bank_identity", "0026_google_identity", "0027_live_partner"].map((tag, i) => ({ tag, when: i })) };
const sql: Record<string, string> = { "0023_a": "create table a();", "0024_b": "alter table a add column x int;", "0025_speaking_bank_identity": "alter table s add column t text;", "0026_google_identity": "alter table u add column g text;", "0027_live_partner": "create table lp();" };
const { createHash } = await import("node:crypto");
const h = (tag: string) => createHash("sha256").update(sql[tag]!).digest("hex");

test("plan: only unapplied, approved, additive migrations; refuses gaps, unknown history and destructive SQL", () => {
  assert.deepEqual(plan(journal, [h("0023_a"), h("0024_b")], (t: string) => sql[t]!), { applied: ["0023_a", "0024_b"], pending: ["0025_speaking_bank_identity", "0026_google_identity", "0027_live_partner"], problems: [] });
  assert.deepEqual(plan(journal, Object.keys(sql).map(h), (t: string) => sql[t]!).pending, [], "re-run applies nothing");
  assert.match(plan(journal, [h("0023_a"), h("0025_speaking_bank_identity")], (t: string) => sql[t]!).problems.join(), /gap/);
  assert.match(plan(journal, [h("0023_a"), "deadbeef"], (t: string) => sql[t]!).problems.join(), /not in the journal/);
  assert.match(plan(journal, [h("0023_a")], (t: string) => sql[t]!).problems.join(), /0024_b is not approved/);
  const bad: Record<string, string> = { ...sql, "0027_live_partner": "drop table users;" };
  assert.match(plan(journal, [h("0023_a"), h("0024_b")], (t: string) => bad[t]!).problems.join(), /destructive/);
});

test("identity guard: fingerprint hides the host; production refused", () => {
  assert.equal(fingerprint("postgres://u:p@db.example/qa").length, 64);
  assert.notEqual(fingerprint("postgres://u:p@db.example/qa"), fingerprint("postgres://u:p@db.example/prod_db"));
  assert.ok(refuseProduction("postgres://x@prod-db.example/app"));
  assert.ok(refuseProduction("postgres://x@db.example/app", { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv));
  assert.equal(refuseProduction("postgres://x@db.example/qa", {} as NodeJS.ProcessEnv), null);
});

// ---- identity hardening (audit of fd73eed) ----
const mig = await import("../scripts/preview-qa-migrate.mjs");
test("0036 approval permits only the exact reviewed SQL; altered widening and destructive SQL remain refused", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("drizzle/0036_speaking_study_support.sql", "utf8");
  const single = { entries: [{ tag: "0036_speaking_study_support", when: 1 }] };
  assert.deepEqual(mig.plan(single, [], () => source).problems, []);
  assert.match(mig.plan(single, [], () => source.replace("varchar(200)", "varchar(20)")).problems.join(), /approved hash/);
  assert.match(mig.plan(single, [], () => "drop table users;").problems.join(), /destructive SQL/);
});
test("0037 Preview approval permits only the reviewed additive photograph table", () => {
  const source = readFileSync("drizzle/0037_profile_photos.sql", "utf8");
  const single = { entries: [{ tag: "0037_profile_photos", when: 1 }] };
  assert.deepEqual(mig.plan(single, [], () => source).problems, []);
  assert.match(mig.plan(single, [], () => source.replace("409600", "409601")).problems.join(), /approved hash/);
  assert.match(mig.plan(single, [], () => "drop table users;").problems.join(), /destructive SQL/);
});
const QA = "postgres://postgres.qa:fake@pooler.example:6543/postgres";
const OTHER = "postgres://postgres.production:fake@pooler.example:6543/postgres";
const OTHER_NEUTRAL = "postgres://postgres.abcd1234:fake@pooler.example:6543/postgres";

test("identity: same shared pooler host/db with different project usernames never share a fingerprint", () => {
  assert.notEqual(mig.fingerprint(QA), mig.fingerprint(OTHER));
  assert.notEqual(mig.fingerprint(QA), mig.fingerprint(OTHER_NEUTRAL));
  assert.notEqual(mig.fingerprint(QA), mig.fingerprint(QA.replace(":6543", ":5432")), "port is part of the identity");
  assert.notEqual(mig.fingerprint(QA), mig.fingerprint(QA.replace("/postgres", "/other")), "database is part of the identity");
  assert.equal(mig.fingerprint(QA), mig.fingerprint(QA.replace(":fake@", ":rotated@")), "password is never part of the identity");
  const env = { PREVIEW_QA_DB_FINGERPRINT: mig.fingerprint(QA), PREVIEW_QA_PROJECT_REF: "qa", PREVIEW_QA_SERVER_IDENTITY: "x" };
  assert.deepEqual(mig.identityProblems(QA, env), []);
  const other = mig.identityProblems(OTHER_NEUTRAL, env).join("; ");
  assert.match(other, /fingerprint mismatch/);
  assert.match(other, /project ref .* does not match/);
  assert.match(mig.identityProblems(QA, { ...env, PREVIEW_QA_PROJECT_REF: "" }).join(), /shared pooler host: PREVIEW_QA_PROJECT_REF/);
  assert.match(mig.identityProblems(QA, { ...env, PREVIEW_QA_SERVER_IDENTITY: "" }).join(), /PREVIEW_QA_SERVER_IDENTITY is not set/);
  assert.ok(mig.refuseProduction(OTHER, {}), "a production username is refused outright");
});

type Row = Record<string, unknown>;
function fakeClient(opts: { db?: string; verifyN?: (q: string) => number; applied?: string[]; failQuery?: RegExp }) {
  const queries: string[] = [];
  return { queries, client: {
    async connect() {}, async end() {},
    async query(q: string): Promise<{ rows: Row[] }> {
      queries.push(q);
      if (opts.failQuery?.test(q)) throw Object.assign(new Error("boom"), { code: "42P01" });
      if (q.includes("current_database()")) return { rows: [{ db: opts.db ?? "postgres", session_user: "postgres", port: 6543 }] };
      if (q.includes("pg_control_system")) return { rows: [{ system_identifier: "7300000000000000001" }] };
      if (q.includes("to_regclass")) return { rows: [{ t: "drizzle.__drizzle_migrations" }] };
      if (q.includes("__drizzle_migrations")) return { rows: (opts.applied ?? []).map((hash) => ({ hash })) };
      return { rows: [{ n: opts.verifyN ? opts.verifyN(q) : 0 }] };
    },
  } };
}
const serverId = mig.serverIdentityHash({ system_identifier: "7300000000000000001", db: "postgres", session_user: "postgres", port: 6543 });
const goodEnv = { DATABASE_URL: QA, PREVIEW_QA_DB_FINGERPRINT: mig.fingerprint(QA), PREVIEW_QA_PROJECT_REF: "qa", PREVIEW_QA_SERVER_IDENTITY: serverId };
const allApplied = Object.keys(sql).map(h);
const healthy = (q: string) => (
  q.includes("dictionary_releases',") ? 9 :
  q.includes("dictionary_entries_immutable") ? 3 :
  q.includes("reading_assessments',") ? 2 :
  q.includes("user_profile_photos") ? 4 :
  q.includes("study_support") ? 1 :
  q.includes("lexical_units','") ? 2 :
  q.includes("lexical_unit_id is null") ? 0 :
  q.includes("general_reading_sets','") ? 3 :
  q.includes("writing_lessons','") ? 15 :
  q.includes("listening_packages',") ? 3 :
  q.includes("speaking_prompts") && q.includes("column_name") ? 4 :
  q.includes("live_partner_presence','") ? 4 : 1
);
const base = { readJournal: () => journal, readSql: (t: string) => sql[t]!, runMigrations: async () => {} };

test("Connection construction, socket and identity errors produce FAIL receipts without leaking credentials", async () => {
 for (const stage of ["factory", "socket", "identity"]) {
  let written = "";
  const error = Object.assign(new Error(QA), { code: "ECONNRESET" });
  const { client } = fakeClient({});
  const result = await mig.run({ ...base, mode: "--fingerprint", env: goodEnv,
   connect: () => {
    if(stage === "factory") throw error;
    return {...client, connect: async()=>{if(stage === "socket") throw error;}, query: async()=>{throw error;}};
   }, writeReceipt: (r: unknown)=>{written=JSON.stringify(r);return null;},
  });
  assert.equal(result.code,1);assert.equal(result.receipt.result!.pass,false);
  assert.match(written,/ECONNRESET/);assert.ok(!written.includes("fake"));assert.ok(!written.includes("postgres:\/\/"));
 }
});

test("CLI run: a failed verification exits non-zero (receipt pass:false is no longer silent)", async () => {
  const { client } = fakeClient({ applied: allApplied, verifyN: () => 0 });
  const r = await mig.run({ ...base, mode: "--plan", env: goodEnv, connect: () => client });
  assert.equal(r.code, 1);
  assert.equal(r.receipt.result!.pass, false);
  assert.match(r.receipt.result!.failures.join(), /verification failed: live_partner tables/);
});

test("CLI run: a query error during verification exits non-zero", async () => {
  const { client } = fakeClient({ applied: allApplied, verifyN: healthy, failQuery: /live_partner_presence p join/ });
  const r = await mig.run({ ...base, env: goodEnv, connect: () => client });
  assert.equal(r.code, 1);
});

test("CLI run: healthy plan passes; every verification query is scoped to schema public", async () => {
  const { client, queries } = fakeClient({ applied: allApplied, verifyN: healthy });
  const r = await mig.run({ ...base, env: goodEnv, connect: () => client });
  assert.equal(r.code, 0, JSON.stringify(r.receipt.result));
  for (const [, q] of mig.VERIFY) assert.match(q as string, /table_schema='public'|event_object_schema='public'|schemaname='public'|public\./);
  assert.ok(queries.some((q) => q.includes("pg_control_system")), "server identity is read after connecting");
});

test("CLI run: server identity mismatch refuses before any plan or migration", async () => {
  let migrated = false;
  const { client, queries } = fakeClient({ applied: allApplied, verifyN: healthy });
  const r = await mig.run({ ...base, mode: "--apply", env: { ...goodEnv, PREVIEW_QA_SERVER_IDENTITY: "0".repeat(64), PREVIEW_QA_BACKUP_REF: "snap-1" }, connect: () => client, runMigrations: async () => { migrated = true; } });
  assert.equal(r.code, 1);
  assert.match(r.receipt.refused!, /server identity does not match/);
  assert.equal(migrated, false);
  assert.ok(!queries.some((q) => q.includes("__drizzle_migrations order by")));
});

test("CLI run: apply that leaves pending migrations is a failure; apply needs a backup ref", async () => {
  const two = [h("0023_a"), h("0024_b")];
  const noBackup = await mig.run({ ...base, mode: "--apply", env: goodEnv, connect: () => fakeClient({ applied: two, verifyN: healthy }).client });
  assert.equal(noBackup.code, 1); assert.match(noBackup.receipt.refused!, /PREVIEW_QA_BACKUP_REF/);
  const stuck = await mig.run({ ...base, mode: "--apply", env: { ...goodEnv, PREVIEW_QA_BACKUP_REF: "snap-1" }, connect: () => fakeClient({ applied: two, verifyN: healthy }).client });
  assert.equal(stuck.code, 1);
  assert.match(stuck.receipt.result!.failures.join(), /still pending 0025_speaking_bank_identity/);
});

test("CLI run: receipts and logs never contain the password or full URL", async () => {
  const lines: string[] = []; let written = "";
  const { client } = fakeClient({ applied: allApplied, verifyN: healthy });
  await mig.run({ ...base, env: goodEnv, connect: () => client, log: (l: string) => lines.push(l), writeReceipt: (rc: unknown) => { written = JSON.stringify(rc); return null; } });
  for (const s of [written, lines.join("\n")]) { assert.ok(!s.includes("fake"), "password leaked"); assert.ok(!s.includes("postgres://"), "url leaked"); }
});

test("CLI process: a refused run exits non-zero without connecting", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["scripts/preview-qa-migrate.mjs", "--plan"], { env: { PATH: process.env.PATH ?? "", DATABASE_URL: OTHER_NEUTRAL, PREVIEW_QA_DB_FINGERPRINT: String(mig.fingerprint(QA)) } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 1);
  assert.ok(!(r.stdout + r.stderr).includes("fake"));
});

test("CLI run: --plan with pending migrations reports them and skips (not fakes) verification", async () => {
  const r = await mig.run({ ...base, mode: "--plan", env: goodEnv, connect: () => fakeClient({ applied: [h("0023_a"), h("0024_b")], verifyN: () => 0 }).client });
  assert.equal(r.code, 0);
  assert.match(r.receipt.verifySkipped!, /pending migrations not applied yet: 0025/);
  assert.equal(r.receipt.verify, undefined);
});

test("Full Listening migration is additive and requires the same identity, journal and backup gates", () => {
 const tag = "0028_full_listening";
 const sql28 = readFileSync("drizzle/0028_full_listening.sql", "utf8");
 const joined = {entries:[...journal.entries,{tag,when:999}]};
 const result = plan(joined, allApplied, (t: string) => t === tag ? sql28 : sql[t]!);
 assert.deepEqual(result.pending,[tag]);
 assert.deepEqual(result.problems,[]);
 assert.match(plan(joined,allApplied,(t:string)=>t===tag?"drop table users;":sql[t]!).problems.join(),/destructive/);
});


test("0038 and 0039 Preview closure approval is hash-pinned and additive", () => {
  const sql38 = readFileSync("drizzle/0038_dictionary_releases.sql", "utf8");
  const sql39 = readFileSync("drizzle/0039_academic_reading_sets.sql", "utf8");
  const joined = {
    entries: [
      { tag: "0038_dictionary_releases", when: 1 },
      { tag: "0039_academic_reading_sets", when: 2 },
    ],
  };
  assert.deepEqual(
    mig.plan(joined, [], (t: string) =>
      t === "0038_dictionary_releases" ? sql38 : sql39,
    ).problems,
    [],
  );
  assert.match(
    mig.plan(joined, [], (t: string) =>
      t === "0038_dictionary_releases"
        ? sql38.replace("dictionary_releases", "dictionary_releases_changed")
        : sql39,
    ).problems.join(),
    /0038 SQL differs from the owner-approved hash/,
  );
  assert.match(
    mig.plan(joined, [], (t: string) =>
      t === "0039_academic_reading_sets"
        ? sql39 + "\n-- changed"
        : sql38,
    ).problems.join(),
    /0039 SQL differs from the owner-approved hash/,
  );
  assert.match(
    mig.plan(joined, [], (t: string) =>
      t === "0038_dictionary_releases" ? "drop table users;" : sql39,
    ).problems.join(),
    /destructive SQL/,
  );
});

// ---- integration registration (CONTROLLED CONTENT-OS -> INTEGRATION review, 2026-10-06) ----
test("real journal: the frozen Preview state (through 0039) leaves exactly 0040-0052 pending, all registered and hash-pinned", () => {
  const realJournal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
  const readSql = (tag: string) => readFileSync(`drizzle/${tag}.sql`, "utf8");
  const hash = (tag: string) => createHash("sha256").update(readSql(tag)).digest("hex");
  const through0039 = realJournal.entries.filter((e) => e.tag <= "0039_academic_reading_sets").map((e) => hash(e.tag));

  // Every entry is ordered and unique: a duplicated ordinal must never reach this planner.
  const tags = realJournal.entries.map((e) => e.tag);
  assert.deepEqual(tags, [...new Set(tags)], "journal tags must be unique");
  assert.deepEqual(tags, [...tags].sort(), "journal tags must be ordered");

  const frozenPreview = plan(realJournal, through0039, readSql);
  assert.deepEqual(frozenPreview.problems, realJournal.entries.slice(53).map(e => `pending ${e.tag} is not approved`));
  assert.deepEqual(
    frozenPreview.pending,
    ["0040_content_imports", "0041_content_versions", "0042_mock_composition", "0043_authoring_identity",
      "0044_lesson_blocks", "0045_media_lessons", "0046_vocabulary_topic_packs", "0047_assignments_canonical",
      "0048_typing_trainer", "0049_lesson_notes", "0050_lesson_learning_area", "0051_listening_question_revision",
      "0052_listening_mcq_program_days", ...realJournal.entries.slice(53).map(e => e.tag)],
  );

  // Fully applied: pending nothing, problems none — the planner is a no-op on a current DB.
  const current = plan(realJournal, tags.map(hash), readSql);
  assert.deepEqual(current.pending, []);
  assert.deepEqual(current.problems, []);

  // A reviewed migration that changed after review is refused, not silently applied.
  assert.match(
    plan(realJournal, through0039, (t: string) => t === "0048_typing_trainer" ? readSql(t) + "\n-- changed" : readSql(t)).problems.join(),
    /0048_typing_trainer SQL differs from the reviewed integration hash/,
  );
  // The single reviewed widening exception is bound to the pinned SQL and covers one
  // statement: a narrower (lossy) type change can never ride on it.
  const widening = mig.REVIEWED_SAFE_STATEMENTS["0043_authoring_identity"] ?? [];
  assert.equal(widening.length, 1);
  assert.doesNotMatch('ALTER TABLE "reading_questions" ALTER COLUMN "type_code" TYPE varchar(4);', widening[0]!);
  assert.match(
    plan(realJournal, through0039, (t: string) => t === "0043_authoring_identity"
      ? readSql(t).replace('ALTER COLUMN "type_code" TYPE varchar(40);', 'ALTER COLUMN "type_code" TYPE varchar(4);')
      : readSql(t)).problems.join(),
    /0043_authoring_identity SQL differs from the reviewed integration hash/,
  );

  // An unreviewed pending migration is still refused.
  assert.match(plan({ entries: [{ tag: "0099_unreviewed", when: 1 }] }, [], () => "create table x();").problems.join(), /0099_unreviewed is not approved/);
});
