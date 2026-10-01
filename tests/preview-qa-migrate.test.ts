import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain ESM script
import { plan, fingerprint, refuseProduction } from "../scripts/preview-qa-migrate.mjs";

const journal = { entries: ["0023_a", "0024_b", "0025_speaking_bank_identity", "0026_google_identity", "0027_live_partner"].map((tag, i) => ({ tag, when: i })) };
const sql: Record<string, string> = { "0023_a": "create table a();", "0024_b": "alter table a add column x int;", "0025_speaking_bank_identity": "alter table s add column t text;", "0026_google_identity": "alter table u add column g text;", "0027_live_partner": "create table lp();" };
const { createHash } = await import("node:crypto");
const h = (tag: string) => createHash("sha256").update(sql[tag]!).digest("hex");

test("plan: only unapplied, approved, additive migrations; refuses gaps, unknown history and destructive SQL", () => {
  assert.deepEqual(plan(journal, [h("0023_a"), h("0024_b")], (t: string) => sql[t]), { applied: ["0023_a", "0024_b"], pending: ["0025_speaking_bank_identity", "0026_google_identity", "0027_live_partner"], problems: [] });
  assert.deepEqual(plan(journal, Object.keys(sql).map(h), (t: string) => sql[t]).pending, [], "re-run applies nothing");
  assert.match(plan(journal, [h("0023_a"), h("0025_speaking_bank_identity")], (t: string) => sql[t]).problems.join(), /gap/);
  assert.match(plan(journal, [h("0023_a"), "deadbeef"], (t: string) => sql[t]).problems.join(), /not in the journal/);
  assert.match(plan(journal, [h("0023_a")], (t: string) => sql[t]).problems.join(), /0024_b is not approved/);
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
