#!/usr/bin/env node
/**
 * Adversarial cleanup proof on isolated QA2 only. First run the 0052 probe's fresh/apply/verify.
 * Plants unrelated rows with the SAME display names/titles/source reference, then runs clean.
 * They must survive byte-for-byte; every recorded probe ID must disappear. Removes its own
 * collision fixtures in finally. Never starts/recreates a database or changes migration files.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { assertIsolatedTarget } from "./qa2-seed-fixtures.mjs";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
assertIsolatedTarget(url);
// This probe writes fixtures. Refuse any database that is not disposable QA.
const { assertMutableDatabase: __assertMutableDb } = await import("./lib/fixture-safety.mjs");
__assertMutableDb(url);
const db = new pg.Client({ connectionString: url });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const [{ fixture }] = await q("select fixture from qa0052_probe");
const users = []; const tests = []; const versions = [];
let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log(`ok - ${name}`); };
async function snapshot() {
  return JSON.stringify(await Promise.all([
    q("select to_jsonb(u) row from users u where id = any($1::uuid[]) order by id", [users]),
    q("select to_jsonb(t) row from listening_tests t where id = any($1::uuid[]) order by id", [tests]),
    q("select to_jsonb(v) row from content_versions v where id = any($1::uuid[]) order by id", [versions]),
  ]));
}
try {
  for (const name of ["0052 probe owner", "0052 probe learner"]) {
    const [user] = await q("insert into users (name, role, account_status) values ($1, 'student', 'active') returning id", [name]);
    users.push(user.id);
  }
  for (const title of ["Probe full test", "Probe day two claimant", "Probe other programme day one"]) {
    const [test] = await q("insert into listening_tests (created_by_user_id, title, audio_type) values ($1, $2, 'audio') returning id", [users[0], title]);
    tests.push(test.id);
  }
  const [version] = await q(`insert into content_versions (module, content_type, source_ref, version_no, status, title, content_snapshot, content_hash, semantic_hash, answer_key_hash, target_type, target_id, created_by_user_id)
    values ('listening', 'full_test', 'probe-0052-full', 77, 'draft', 'Unrelated version', '{}'::jsonb, repeat('0',64), repeat('0',64), repeat('0',64), 'listening_test', $1, $2) returning id`, [tests[0], users[0]]);
  versions.push(version.id);
  const before = await snapshot();
  const run = spawnSync(process.execPath, ["scripts/qa2-listening-mcq-0052-upgrade.mjs", "clean"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: url } });
  check("clean exits successfully", run.status === 0);
  check("clean explicitly reports residue 0", run.stdout.includes('"residue":0'));
  check("colliding unrelated users, tests and version are unchanged", await snapshot() === before);
  const probeTests = [fixture.test, ...fixture.extraTests];
  for (const [table, where, args] of [
    ["users", "id = any($1::uuid[])", [[fixture.owner, fixture.learner]]],
    ["listening_tests", "id = any($1::uuid[])", [probeTests]],
    ["listening_questions", "test_id = any($1::uuid[])", [probeTests]],
    ["listening_packages", "test_id = any($1::uuid[])", [probeTests]],
    ["content_versions", "target_id = any($1::uuid[])", [probeTests]],
    ["listening_attempts", "test_id = any($1::uuid[])", [probeTests]],
    ["listening_mcq_sessions", "test_id = any($1::uuid[])", [probeTests]],
  ]) check(`${table}: probe IDs absent`, (await q(`select count(*)::int n from ${table} where ${where}`, args))[0].n === 0);
  check("probe manifest removed", (await q("select to_regclass('qa0052_probe') present"))[0].present === null);
} finally {
  await q("delete from content_versions where id = any($1::uuid[])", [versions]);
  await q("delete from listening_tests where id = any($1::uuid[])", [tests]);
  await q("delete from users where id = any($1::uuid[])", [users]);
  check("collision fixtures also removed", (await snapshot()) === "[[],[],[]]");
  await db.end();
}
console.log(`PASS — ${passed}/${passed} checks`);
