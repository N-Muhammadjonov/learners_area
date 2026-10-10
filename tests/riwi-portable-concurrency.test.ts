import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createPortableTestDatabase, nativePortableTestsEnabled, type PortableTestDatabase } from "./support/riwi-portability-database";
import { createPostgresImportDestination } from "../src/lib/portability/postgres-adapter";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function waitForRelationLock(database: PortableTestDatabase, pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await database.query<{ blocked: boolean }>("select exists(select 1 from pg_locks where pid=$1 and locktype='relation' and not granted) blocked", [pid]);
    if (row?.blocked) return;
    await delay(20);
  }
  assert.fail("the competing writer did not wait on the actual PostgreSQL relation lock");
}

const options = { skip: !nativePortableTestsEnabled ? "requires an identified private native PostgreSQL cluster" : false, timeout: 30000 };

test("native restore fences a non-anchor table writer and an owner demotion until COMMIT", options, async () => {
  const database = await createPortableTestDatabase("native");
  const owner = randomUUID(), entered = gate(), finish = gate();
  const writer = await database.pool!.connect();
  const demoter = await database.pool!.connect();
  let restore: Promise<unknown> | undefined;
  let mutation: Promise<unknown> | undefined;
  let demotion: Promise<unknown> | undefined;
  try {
    await database.query("insert into users(id,name,role,account_status)values($1,'Owner','owner','active')", [owner]);
    const writerPid = (await writer.query("select pg_backend_pid() pid")).rows[0]!.pid as number;
    const demoterPid = (await demoter.query("select pg_backend_pid() pid")).rows[0]!.pid as number;
    const destination = createPostgresImportDestination(database.pool!, undefined, { ownerId: owner, scope: "learners-area", dryRun: false });
    restore = destination.transaction(async transaction => {
      entered.resolve();
      await finish.promise;
      const row = { id: randomUUID(), title: "Restored", explanation: "Authored", order: 1 };
      assert.equal(await transaction.planRow("grammar_topics", row, new Map()), "create");
      await transaction.applyRow("grammar_topics", row, new Map());
      await transaction.finalize?.(false);
    });
    await Promise.race([entered.promise, restore]);
    mutation = writer.query("insert into grammar_topics(title,explanation,\"order\")values('Concurrent','Authored',2)");
    demotion = demoter.query("update users set role='student' where id=$1", [owner]);
    await waitForRelationLock(database, writerPid);
    await waitForRelationLock(database, demoterPid);
    assert.equal((await database.query<{ role: string }>("select role from users where id=$1", [owner]))[0]!.role, "owner");
    assert.equal((await database.query<{ n: number }>("select count(*)::int n from grammar_topics"))[0]!.n, 0);
    finish.resolve();
    await restore;
    await Promise.all([mutation, demotion]);
    assert.equal((await database.query<{ n: number }>("select count(*)::int n from grammar_topics"))[0]!.n, 2);
    assert.equal((await database.query<{ role: string }>("select role from users where id=$1", [owner]))[0]!.role, "student");
  } finally {
    finish.resolve();
    await Promise.allSettled([restore, mutation, demotion]);
    writer.release?.(); demoter.release?.();
    await database.close();
  }
});

for (const firstScope of ["full-system", "riwi"] as const) {
  test("native overlapping A/B restores serialize across different scopes, first=" + firstScope, options, async () => {
    const database = await createPortableTestDatabase("native");
    const owner = randomUUID(), entered = gate(), finish = gate();
    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    const contender = await database.pool!.connect();
    try {
      await database.query("insert into users(id,name,role,account_status)values($1,'Owner','owner','active')", [owner]);
      const pid = (await contender.query("select pg_backend_pid() pid")).rows[0]!.pid as number;
      const identities = new Map([[owner, owner]]);
      const firstDestination = createPostgresImportDestination(database.pool!, undefined, { ownerId: owner, scope: firstScope, dryRun: false, identityMap: firstScope === "riwi" ? identities : undefined });
      first = firstDestination.transaction(async transaction => {
        entered.resolve(); await finish.promise;
        const row = { id: randomUUID(), sourceType: "owner_instruction", title: "Restored", checksum: "a".repeat(64), provenance: "QA", rightsClass: "owned", scope: "global", createdByUserId: owner };
        assert.equal(await transaction.planRow("riwi_knowledge_sources", row, identities), "create");
        await transaction.applyRow("riwi_knowledge_sources", row, identities);
        await transaction.finalize?.(false);
      });
      await Promise.race([entered.promise, first]);
      let called = false;
      const secondDestination = createPostgresImportDestination({ async connect() { return contender; } }, undefined, { ownerId: owner, scope: firstScope === "riwi" ? "full-system" : "riwi", dryRun: false, identityMap: identities });
      second = secondDestination.transaction(async () => { called = true; });
      // Attach immediately so a failure cannot become an unhandled rejection.
      const rejected = assert.rejects(second, /portable_fresh_destination_required/);
      await waitForRelationLock(database, pid);
      assert.equal(called, false);
      finish.resolve(); await first; await rejected;
      assert.equal(called, false, "freshness is rechecked after waiting, before any archive application");
      assert.equal((await database.query<{ n: number }>("select count(*)::int n from riwi_knowledge_sources"))[0]!.n, 1);
    } finally {
      finish.resolve(); await Promise.allSettled([first, second]);
      // The destination releases the contender once its transaction finishes.
      if (!second) contender.release?.();
      await database.close();
    }
  });
}
