import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptPortableFile, decryptPortableFile } from "../src/lib/portability/encryption";

test("encrypted publication cannot replace an existing accepted destination or erase an aliased source", async () => {
  const folder = await mkdtemp(join(tmpdir(), "riwi-encryption-safety-"));
  const source = join(folder, "plain"); const destination = join(folder, "accepted.lap"); const key = randomBytes(32);
  try {
    await writeFile(source, "PRIVATE_SOURCE", { mode: 0o600 });
    await writeFile(destination, "ACCEPTED_BACKUP", { mode: 0o600 });
    await assert.rejects(encryptPortableFile(source, destination, key, { removeSourceAfterSuccess: true }));
    assert.equal(await readFile(destination, "utf8"), "ACCEPTED_BACKUP");
    assert.equal(await readFile(source, "utf8"), "PRIVATE_SOURCE");
    await assert.rejects(encryptPortableFile(source, `${folder}/./plain`, key, { removeSourceAfterSuccess: true }));
    assert.equal(await readFile(source, "utf8"), "PRIVATE_SOURCE");
    assert.deepEqual((await readdir(folder)).sort(), ["accepted.lap", "plain"]);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("authenticated decryption cannot overwrite an existing private destination", async () => {
  const folder = await mkdtemp(join(tmpdir(), "riwi-decryption-safety-")); const key = randomBytes(32);
  try {
    const source = join(folder, "plain"); const encrypted = join(folder, "backup.lap"); const destination = join(folder, "existing");
    await writeFile(source, "PRIVATE_SOURCE", { mode: 0o600 });
    await encryptPortableFile(source, encrypted, key);
    await writeFile(destination, "KEEP_EXISTING", { mode: 0o600 });
    await assert.rejects(decryptPortableFile(encrypted, destination, key));
    assert.equal(await readFile(destination, "utf8"), "KEEP_EXISTING");
    assert.deepEqual((await readdir(folder)).sort(), ["backup.lap", "existing", "plain"]);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
