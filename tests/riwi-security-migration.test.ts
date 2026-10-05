import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { migrateTestDatabase } from "./support/pglite";

const BEFORE_0048 = "0047_bent_bulldozer.sql";

test("0048 upgrades a populated pre-0048 database and enforces security-signal constraints", async () => {
  const client = new PGlite();
  const ownerId = "11111111-2222-4333-8444-555555555555";
  try {
    await migrateTestDatabase(client, { through: BEFORE_0048 });
    await client.query("insert into users (id, name, role) values ($1, 'Migration owner', 'owner')", [ownerId]);
    await migrateTestDatabase(client, { after: BEFORE_0048 });
    assert.equal((await client.query<{ name: string }>("select name from users where id=$1", [ownerId])).rows[0]?.name, "Migration owner");

    const enumLabels = (await client.query<{ enumlabel: string }>(`select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='riwi_security_signal_state' order by e.enumsortorder`)).rows.map((row) => row.enumlabel);
    assert.deepEqual(enumLabels, ["candidate", "in_review", "approved_regression", "rejected", "developer_action_required"]);
    const indexes = (await client.query<{ indexname: string }>("select indexname from pg_indexes where tablename='riwi_security_signals' order by indexname")).rows.map((row) => row.indexname);
    for (const expected of ["riwi_security_signals_fingerprint_uidx", "riwi_security_signals_state_seen_idx", "riwi_security_signals_type_seen_idx"]) assert.ok(indexes.includes(expected));

    const base = ["prompt_injection", "candidate", "a".repeat(64), "riwi.chat", "prompt_injection; route=riwi.chat; traits=none"];
    await client.query("insert into riwi_security_signals (signal_type,state,fingerprint,route_class,sanitized_evidence) values ($1,$2,$3,$4,$5)", base);
    await assert.rejects(client.query("insert into riwi_security_signals (signal_type,state,fingerprint,route_class,sanitized_evidence) values ($1,$2,$3,$4,$5)", base));
    await assert.rejects(client.query("insert into riwi_security_signals (signal_type,fingerprint,occurrence_count,route_class,sanitized_evidence) values ('idor',$1,0,'riwi.chat','safe')", ["b".repeat(64)]));
    await assert.rejects(client.query("insert into riwi_security_signals (signal_type,fingerprint,route_class,sanitized_evidence) values ('idor','bad','riwi.chat','safe')"));
    await assert.rejects(client.query("insert into riwi_security_signals (signal_type,state,fingerprint,route_class,sanitized_evidence) values ('idor','approved_regression',$1,'riwi.chat','safe')", ["c".repeat(64)]));
    await client.query(`insert into riwi_security_signals (signal_type,state,fingerprint,route_class,sanitized_evidence,regression_fixture_id,regression_evidence_hash,reviewed_by_user_id,reviewed_at)
      values ('idor','approved_regression',$1,'riwi.chat','safe','fixture-1',$2,$3,now())`, ["d".repeat(64), "e".repeat(64), ownerId]);
    await assert.rejects(client.query(`insert into riwi_security_signals (signal_type,state,fingerprint,route_class,sanitized_evidence,regression_fixture_id,regression_evidence_hash,reviewed_by_user_id,reviewed_at)
      values ('idor','approved_regression',$1,'riwi.chat','safe','fixture-2',$2,'99999999-9999-4999-8999-999999999999',now())`, ["f".repeat(64), "0".repeat(64)]));
  } finally { await client.close(); }
});

test("0048 generated SQL and Drizzle schema retain the same named constraints", () => {
  const sql = readFileSync(new URL("../drizzle/0048_condemned_pyro.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  for (const name of ["riwi_security_signals_fingerprint_check", "riwi_security_signals_count_check", "riwi_security_signals_regression_hash_check", "riwi_security_signals_promotion_check", "riwi_security_signals_fingerprint_uidx", "riwi_security_signals_state_seen_idx", "riwi_security_signals_type_seen_idx"]) {
    assert.match(sql, new RegExp(name)); assert.match(schema, new RegExp(name));
  }
});
