#!/usr/bin/env node
/**
 * Migratsiya vositalarining o'zini tekshirish.
 *
 * `scripts/migrate-production.mjs` production bazaga yozadigan yagona vositadir,
 * shuning uchun uning *qarorlari* ham sinovdan o'tishi kerak: bo'sh bazani
 * tanishi, qisman sxemani rad etishi, buzilgan tarixni payqashi, davom ettirishi
 * va hech qanday holatda ma'lumot qo'shmasligi.
 *
 * Faqat LOKAL serverda ishlaydi va faqat o'zi yaratgan `learners_migtest_*`
 * bazalarini o'chiradi. DATABASE_URL ko'rsatgan bazaga hech qachon tegmaydi —
 * bu skript production uchun emas, u yerda ishlatilishi ham mumkin emas.
 *
 * Ishga tushirish (admin bazasi kerak, masalan `postgres`):
 *   MIGRATION_TEST_ADMIN_URL="postgres://postgres@127.0.0.1:5433/postgres" \
 *     node scripts/verify-migration-tooling.mjs
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const pass = (s) => `\u001b[32m${s}\u001b[0m`;
const bad = (s) => `\u001b[31m${s}\u001b[0m`;
let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? pass("PASS") : bad("FAIL")}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const admin = process.env.MIGRATION_TEST_ADMIN_URL;
const prefix = `learners_migtest_${Math.random().toString(36).slice(2, 8)}`;
const jdbc = (db) => {
  const url = new URL(admin);
  url.pathname = `/${db}`;
  return url.toString();
};

if (!admin) {
  console.error("MIGRATION_TEST_ADMIN_URL kerak, masalan postgres://postgres@127.0.0.1:5433/postgres");
  process.exit(1);
}
const adminHost = new URL(admin).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(adminHost)) {
  console.error(`${bad("REFUSED")} this script only ever runs against a local server (host: ${adminHost}).`);
  process.exit(1);
}

const { Pool } = require("pg");
const pool = new Pool({ connectionString: admin, max: 1 });
const created = [];

async function createDatabase(suffix) {
  const name = `${prefix}_${suffix}`;
  await pool.query(`create database "${name}"`);
  created.push(name);
  return name;
}

/** Runs one of our scripts and returns its exit code and output. */
function run(script, database, args = []) {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: jdbc(database), ALLOW_LOCAL_MIGRATION: "1" },
    input: "y\n",
  });
  return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function tableCount(database) {
  const client = new Pool({ connectionString: jdbc(database), max: 1 });
  const rows = await client.query(
    "select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
  );
  const users = await client.query(
    `select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='users'`
  );
  let userRows = 0;
  if (users.rows[0].n > 0) {
    const count = await client.query("select count(*)::int as n from users");
    userRows = count.rows[0].n;
  }
  await client.end();
  return { tables: rows.rows[0].n, userRows };
}

try {
  // ---------------------------------------------------------------- 1. bo'sh baza
  console.log("\n1. Bo'sh baza — tekshirish hech narsa yozmaydi, keyin to'liq qo'llanadi");
  const empty = await createDatabase("empty");
  const inspect = run("migrate-production.mjs", empty);
  check("inspect rejimi 0 bilan chiqadi (qo'llash mumkin)", inspect.code === 0, `exit ${inspect.code}`);
  check("xulosa: empty", /empty\s+the public schema holds no tables/.test(inspect.output));
  check("inspect hech narsa yozmagan", (await tableCount(empty)).tables === 0);

/**
 * How many tables the migration chain declares, derived from the SQL itself.
 *
 * A6. The expected table count used to be a literal (62) that went stale as the chain grew; 53
 * migrations now declare 119 tables. Counting distinct CREATE TABLE names across drizzle/*.sql and
 * subtracting anything later dropped keeps the check honest with no constant to maintain, and it
 * reads the same files migrate-production.mjs applies — so a migration that declares a table the
 * fresh apply does not produce is a real failure rather than a number to bump.
 */
function countDeclaredTables() {
  const dir = join(ROOT, "drizzle");
  const created = new Set();
  const dropped = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(/create table(?: if not exists)?\s+"?([a-z0-9_]+)"?/gi)) created.add(m[1].toLowerCase());
    for (const m of sql.matchAll(/drop table(?: if exists)?\s+"?([a-z0-9_]+)"?/gi)) dropped.add(m[1].toLowerCase());
  }
  const net = [...created].filter((table) => !dropped.has(table));
  // Refuse to check against zero: an empty derivation would make any empty database look correct.
  if (net.length === 0) throw new Error("could not derive the declared table count from drizzle/*.sql");
  return net.length;
}

  const applied = run("migrate-production.mjs", empty, ["--apply", "--yes"]);
  check("qo'llash 2 bilan chiqadi (bajarildi)", applied.code === 2, `exit ${applied.code}`);
  const afterApply = await tableCount(empty);
  /*
   * A6. This was `afterApply.tables === 62` with a comment calling 62 "the size of the release, not
   * a magic constant" — but it WAS a constant, and it went stale: 53 migrations now create 119
   * tables. The expectation is derived from the migration SQL itself instead, so it tracks the chain
   * automatically. Counting distinct CREATE TABLE names (minus any DROP TABLE) is the property this
   * check actually wants: applying every migration to an empty database must produce exactly the
   * tables the migrations declare, no more and no fewer.
   */
  const declaredTables = countDeclaredTables();
  check(`${declaredTables} jadval yaratildi`, afterApply.tables === declaredTables,
    `${afterApply.tables} jadval yaratildi; migratsiyalarda ${declaredTables} ta e'lon qilingan`);
  check("users jadvali bor", afterApply.userRows === 0 && afterApply.tables > 0);
  check("migratsiya HECH QANDAY foydalanuvchi qo'shmadi", afterApply.userRows === 0, `${afterApply.userRows} qator`);

  const verify = run("verify-production-schema.mjs", empty);
  check("sxema tekshiruvi to'liq o'tadi", verify.code === 0 && /ALL CHECKS PASSED/.test(verify.output));
  check("egasi haqida ogohlantiradi, lekin yiqilmaydi", /an active OWNER account exists/.test(verify.output) && verify.code === 0);

  const again = run("migrate-production.mjs", empty, ["--apply", "--yes"]);
  check("qayta qo'llash 'up-to-date' deb to'xtaydi", again.code === 0 && /Nothing to do/.test(again.output));

  // ------------------------------------------------------- 2. qisman sxema (begona)
  console.log("\n2. Tarixsiz qisman sxema — rad etiladi va hech narsa yozilmaydi");
  const partial = await createDatabase("partial");
  const partialClient = new Pool({ connectionString: jdbc(partial), max: 1 });
  await partialClient.query("create table users (id uuid primary key, email varchar(320))");
  await partialClient.end();

  const partialInspect = run("migrate-production.mjs", partial);
  check("rad etiladi (exit 1)", partialInspect.code === 1, `exit ${partialInspect.code}`);
  check("xulosa: partial", /partial\s+there are 1 table/.test(partialInspect.output));
  const partialApply = run("migrate-production.mjs", partial, ["--apply", "--yes"]);
  check("--apply ham rad etadi", partialApply.code === 1 && /REFUSED/.test(partialApply.output));
  const partialAfter = await tableCount(partial);
  check("rad etilgandan keyin jadval soni o'zgarmagan", partialAfter.tables === 1, `${partialAfter.tables} jadval`);

  // ------------------------------------------------------------ 3. davom ettirish
  console.log("\n3. 3/17 dan davom ettirish — zanjir oxirigacha davom etadi");
  const resume = await createDatabase("resume");
  const temp = mkdtempSync(join(tmpdir(), "learners-resume-"));
  mkdirSync(join(temp, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
  const firstThree = journal.entries.slice(0, 3);
  writeFileSync(join(temp, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: firstThree }));
  for (const entry of firstThree) copyFileSync(join(ROOT, "drizzle", `${entry.tag}.sql`), join(temp, `${entry.tag}.sql`));
  writeFileSync(
    join(temp, "drizzle.config.ts"),
    `import type { Config } from "drizzle-kit";
export default { schema: ${JSON.stringify(join(ROOT, "src", "db", "schema.ts"))}, out: ${JSON.stringify(temp)},
  dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL! } } satisfies Config;
`
  );
  const partialMigrate = spawnSync(
    process.execPath,
    [join(ROOT, "node_modules", "drizzle-kit", "bin.cjs"), "migrate", `--config=${join(temp, "drizzle.config.ts")}`],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, DATABASE_URL: jdbc(resume) } }
  );
  check("3 ta migratsiya qo'lda qo'llandi (tayyorgarlik)", partialMigrate.status === 0);
  const resumeRun = run("migrate-production.mjs", resume, ["--apply", "--yes"]);
  check("davom ettirish bajarildi (exit 2)", resumeRun.code === 2, `exit ${resumeRun.code}`);
  // The denominator is the chain length, not a literal: "3 of 19" went stale at 53 migrations and
  // made a correct resume look like a failed one.
  check("xulosa: resume", new RegExp(`resume\\s+3\\/${journal.entries.length} migrations are recorded`).test(resumeRun.output),
    resumeRun.output.split("\n").find((l) => /resume/.test(l))?.trim().slice(0, 90) ?? "");
  const resumeVerify = run("verify-production-schema.mjs", resume);
  check("natija to'liq sxema", resumeVerify.code === 0 && /ALL CHECKS PASSED/.test(resumeVerify.output));
  check("davom ettirish ham foydalanuvchi qo'shmadi", (await tableCount(resume)).userRows === 0);

  // ------------------------------------------------------------- 4. buzilgan tarix
  console.log("\n4. Buzilgan migratsiya tarixi — rad etiladi");
  const tamper = new Pool({ connectionString: jdbc(resume), max: 1 });
  await tamper.query(
    `update drizzle.__drizzle_migrations set created_at = created_at + 999999
      where id = (select max(id) from drizzle.__drizzle_migrations)`
  );
  await tamper.end();
  const divergent = run("migrate-production.mjs", resume, ["--apply", "--yes"]);
  check("rad etiladi (exit 1)", divergent.code === 1, `exit ${divergent.code}`);
  check("xulosa: divergent", /divergent\s+drizzle\.__drizzle_migrations holds timestamps/.test(divergent.output));

  // --------------------------------------------------------- 5. sir oshkor bo'lmaydi
  console.log("\n5. Sir va stack trace oshkor bo'lmaydi");
  const secret = "sup3r-s3cret-password";
  const withSecret = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "migrate-production.mjs")],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: `postgres://postgres:${secret}@127.0.0.1:5433/${prefix}_empty`,
        ALLOW_LOCAL_MIGRATION: "1",
      },
    }
  );
  const output = `${withSecret.stdout}${withSecret.stderr}`;
  check("parol chiqishda ko'rinmaydi", !output.includes(secret));
  check("parol o'rniga **** ko'rsatiladi", /postgres:\*{4}@/.test(output));
  const badConn = spawnSync(process.execPath, [join(ROOT, "scripts", "migrate-production.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: `postgres://postgres:${secret}@127.0.0.1:5599/${prefix}_empty`, ALLOW_LOCAL_MIGRATION: "1" },
  });
  const badOutput = `${badConn.stdout}${badConn.stderr}`;
  check("ulanish xatosi ham sirni oshkor qilmaydi", !badOutput.includes(secret), badOutput.split("\n")[0]?.slice(0, 80));
} finally {
  for (const name of created.reverse()) {
    await pool.query(`drop database if exists "${name}" with (force)`).catch(() => {});
  }
  await pool.end();
  console.log(`\n${created.length} ta vaqtinchalik baza o'chirildi (${prefix}_*)`);
}

console.log(`\n${failed === 0 ? pass("ALL CHECKS PASSED") : bad(`${failed} CHECK(S) FAILED`)} — ${passed}/${passed + failed}\n`);
process.exit(failed === 0 ? 0 : 1);
