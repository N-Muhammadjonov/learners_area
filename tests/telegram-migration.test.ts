import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Telegram migrations preserve accounts and prevent anonymous contact access", async () => {
  const client = new PGlite();
  const files = readdirSync("drizzle").filter(x => x.endsWith(".sql")).sort();
  const apply = async (file: string) => {
    for (const statement of readFileSync("drizzle/" + file, "utf8").split("--> statement-breakpoint").filter(s => s.trim())) {
      await client.exec(statement);
    }
  };
  try {
    for (const file of files.filter(x => Number(x.slice(0, 4)) <= 52)) await apply(file);
    await client.exec("insert into users (name,email,password_hash,role,account_status) values ('Owner fixture','owner@fixture.invalid','preserved-owner-hash','owner','active'), ('Admin fixture','admin@fixture.invalid','preserved-admin-hash','admin','active'), ('Student fixture','student@fixture.invalid','preserved-student-hash','student','pending')");
    const before = (await client.query("select id,name,email,password_hash,role,account_status from users order by email")).rows;
    for (const file of files.filter(x => Number(x.slice(0, 4)) >= 53)) {
      assert.doesNotMatch(readFileSync("drizzle/" + file, "utf8"), /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"?users"?/i);
      await apply(file);
    }
    assert.deepEqual((await client.query("select id,name,email,password_hash,role,account_status from users order by email")).rows, before);
    const tables = (await client.query<{relname:string; relrowsecurity:boolean}>("select relname,relrowsecurity from pg_class where relkind='r' and (relname like 'telegram_%' or relname='ownership_transfer_challenges')")).rows;
    assert.equal(tables.length, 15);
    assert.ok(tables.every(x => x.relrowsecurity));
    await client.exec("insert into telegram_contacts (telegram_user_id,chat_id,phone_number,phone_verified_at) values ('9001','9001','fixture-private-phone',now())");
    await client.exec("create role telegram_fixture_anon; grant usage on schema public to telegram_fixture_anon; grant select on telegram_contacts to telegram_fixture_anon; set role telegram_fixture_anon");
    assert.equal((await client.query("select * from telegram_contacts")).rows.length, 0);
    await client.exec("reset role");
    const columns = (await client.query<{column_name:string}>("select column_name from information_schema.columns where table_name='telegram_login_intents'")).rows.map(x => x.column_name);
    assert.ok(columns.includes("purpose") && columns.includes("browser_nonce_hash"));
  } finally { await client.close(); }
});
