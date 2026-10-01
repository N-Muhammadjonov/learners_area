import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { passwordLoginColumns } from "../src/lib/auth/password-login-columns";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";

test("password login still reads an existing account when google_sub has not been migrated", async () => {
  const database = await createTestDatabase();
  try {
    await database.query("alter table users drop column google_sub");
    const [user] = await database.query<{ id: string }>("insert into users(email,name,role,password_hash) values ('projection@example.test','QA','student','existing-hash') returning id");
    const actual = await database.db.query.users.findFirst({ where: eq(users.id, user!.id), columns: passwordLoginColumns });
    assert.equal(actual?.passwordHash, "existing-hash");
    assert.equal(actual?.email, "projection@example.test");
    assert.ok(!Object.hasOwn(actual!, "googleSub"));
  } finally { await database.close(); }
});
