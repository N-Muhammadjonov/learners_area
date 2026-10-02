// Server-authoritative byte verification on finalize (bypass of the browser preflight).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestDatabase } from "./support/pglite";
import { finalizeUploadIntent } from "../src/lib/data/uploads";
import { LocalDiskStorageProvider } from "../src/lib/services/storage/local-provider";

async function setup(t: test.TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "la-finalize-"));
  const database = await createTestDatabase();
  t.after(async () => {
    await database.close();
    await rm(dir, { recursive: true, force: true });
  });
  const [user] = await database.query<{ id: string }>("insert into users(name,role,account_status) values ('Uploader QA','admin','active') returning id");
  return { dir, database, userId: user!.id };
}

// An intent exactly as /api/uploads/intent issues it for "document.pdf".
async function pdfIntent(database: Awaited<ReturnType<typeof createTestDatabase>>, userId: string, key: string, size: number) {
  const [row] = await database.query<{ id: string }>(
    `insert into upload_intents(user_id,purpose,object_key,original_name,mime_type,size,status,expires_at)
     values ($1,'material_primary',$2,'document.pdf','application/pdf',$3,'pending',now()+interval '10 minutes') returning id`,
    [userId, key, size],
  );
  return row!.id;
}

// Writes straight to storage under the authorized key: the browser validator is never run.
async function bypassWrite(dir: string, key: string, body: Buffer) {
  const file = path.join(dir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

// The local provider's root is fixed at module load; point its private
// resolve() at this test's temp dir instead.
function storageAt(dir: string) {
  return new Proxy(new LocalDiskStorageProvider(), {
    get(target, prop, receiver) {
      if (prop === "resolve") return (key: string) => path.join(dir, key);
      return Reflect.get(target, prop, receiver);
    },
  }) as LocalDiskStorageProvider;
}

test("finalize refuses executable bytes uploaded under a PDF intent; intent never finalized, object removed", async (t) => {
  const { dir, database, userId } = await setup(t);
  const key = "resources/qa/primary/attack.pdf";
  const body = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(510, 0x90)]);
  const id = await pdfIntent(database, userId, key, body.length);
  await bypassWrite(dir, key, body);
  const storage = storageAt(dir);
  assert.ok(await storage.head(key), "attacker object landed with the expected size");

  const result = await finalizeUploadIntent(userId, id, { database: database.db, storage });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error, "dangerous_type");
  const [row] = await database.query<{ status: string; error: string; finalized_at: Date | null }>("select status,error,finalized_at from upload_intents where id=$1", [id]);
  assert.equal(row!.status, "aborted");
  assert.equal(row!.error, "signature_executable");
  assert.equal(row!.finalized_at, null);
  assert.equal(await storage.head(key), null, "rejected object deleted");
  // A retry cannot resurrect it: the intent is no longer pending.
  const again = await finalizeUploadIntent(userId, id, { database: database.db, storage });
  assert.equal(again.ok, false);
});

test("finalize refuses non-PDF bytes (a ZIP renamed .pdf) as a type mismatch", async (t) => {
  const { dir, database, userId } = await setup(t);
  const key = "resources/qa/primary/renamed.pdf";
  const body = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(100)]);
  const id = await pdfIntent(database, userId, key, body.length);
  await bypassWrite(dir, key, body);
  const result = await finalizeUploadIntent(userId, id, { database: database.db, storage: storageAt(dir) });
  assert.equal(!result.ok && result.error, "upload_type_mismatch");
});

test("finalize accepts genuine PDF bytes", async (t) => {
  const { dir, database, userId } = await setup(t);
  const key = "resources/qa/primary/real.pdf";
  const body = Buffer.from("%PDF-1.7\n%\u00e2\u00e3\n1 0 obj<<>>endobj\n%%EOF\n");
  const id = await pdfIntent(database, userId, key, body.length);
  await bypassWrite(dir, key, body);
  const result = await finalizeUploadIntent(userId, id, { database: database.db, storage: storageAt(dir) });
  assert.equal(result.ok, true);
  const [row] = await database.query<{ status: string }>("select status from upload_intents where id=$1", [id]);
  assert.equal(row!.status, "finalized");
});

test("local readHead returns only the requested prefix", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "la-head-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await bypassWrite(dir, "resources/qa/primary/big.bin", Buffer.alloc(1024 * 1024, 7));
  const head = await storageAt(dir).readHead("resources/qa/primary/big.bin", 4096);
  assert.equal(head!.length, 4096);
  assert.equal(await storageAt(dir).readHead("resources/qa/primary/none.bin", 10), null);
});
