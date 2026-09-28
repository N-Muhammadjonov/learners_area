import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  UPLOAD_RULES,
  acceptAttribute,
  maxBytesLabel,
  resourceHref,
  validateUploadFile,
  type UploadCategory,
} from "../src/lib/validation/uploads";
import { buildObjectKey } from "../src/lib/uploads/keys";
import {
  LocalDiskStorageProvider,
  LOCAL_UPLOAD_ROOT,
  inferContentType,
} from "../src/lib/services/storage/local-provider";
import { isSafeObjectKey } from "../src/lib/services/storage/types";

/**
 * Upload policy, object-key strategy and the local storage provider.
 *
 * These are the rules that make a direct browser→R2 upload safe to accept, so
 * they are worth pinning down: a regression here is a security regression, not
 * a cosmetic one.
 */

// ---------------------------------------------------------------------------
// validateUploadFile
// ---------------------------------------------------------------------------

test("validateUploadFile: accepts a PDF as a primary file", () => {
  const result = validateUploadFile({
    filename: "lesson-plan.pdf",
    contentType: "application/pdf",
    size: 1024 * 1024,
    category: "primary",
  });
  assert.deepEqual(result, { ok: true, category: "primary", extension: ".pdf" });
});

test("validateUploadFile: accepts a DOCX whose browser MIME is octet-stream", () => {
  // Safari and several Windows browsers report application/octet-stream for
  // Office documents. The extension is on the allow-list, so this must pass.
  const result = validateUploadFile({
    filename: "handout.docx",
    contentType: "application/octet-stream",
    size: 2048,
    category: "primary",
  });
  assert.equal(result.ok, true);
});

test("validateUploadFile: rejects an executable even when claimed as audio", () => {
  const result = validateUploadFile({
    filename: "payload.exe",
    contentType: "audio/mpeg",
    size: 2048,
    category: "audio",
  });
  assert.deepEqual(result, { ok: false, error: "unsupported_type" });
});

test("validateUploadFile: rejects an empty MIME with an unlisted extension", () => {
  const result = validateUploadFile({
    filename: "payload.exe",
    contentType: "",
    size: 2048,
    category: "primary",
  });
  assert.equal(result.ok, false);
});

test("validateUploadFile: rejects a file over the category ceiling", () => {
  const result = validateUploadFile({
    filename: "huge.png",
    contentType: "image/png",
    size: UPLOAD_RULES.image.maxBytes + 1,
    category: "image",
  });
  assert.deepEqual(result, { ok: false, error: "file_too_large" });
});

test("validateUploadFile: accepts a file exactly at the ceiling", () => {
  const result = validateUploadFile({
    filename: "edge.png",
    contentType: "image/png",
    size: UPLOAD_RULES.image.maxBytes,
    category: "image",
  });
  assert.equal(result.ok, true);
});

test("validateUploadFile: rejects zero-byte and non-finite sizes", () => {
  for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = validateUploadFile({
      filename: "a.png",
      contentType: "image/png",
      size,
      category: "image",
    });
    assert.equal(result.ok, false, `size ${size} should be rejected`);
  }
});

test("validateUploadFile: an audio category rejects a PDF, and vice versa", () => {
  assert.equal(
    validateUploadFile({ filename: "a.pdf", contentType: "application/pdf", size: 10, category: "audio" }).ok,
    false
  );
  assert.equal(
    validateUploadFile({ filename: "a.mp3", contentType: "audio/mpeg", size: 10, category: "file" }).ok,
    false
  );
});

test("validateUploadFile: case-insensitive extension handling", () => {
  const result = validateUploadFile({
    filename: "PHOTO.JPEG",
    contentType: "image/jpeg",
    size: 1024,
    category: "image",
  });
  assert.equal(result.ok, true);
});

test("maxBytesLabel and acceptAttribute are derived from the rules, not hard-coded", () => {
  assert.equal(maxBytesLabel("image"), "10 MB");
  assert.match(acceptAttribute("image"), /image\//);
  assert.match(acceptAttribute("primary"), /application\/pdf/);
  assert.match(acceptAttribute("file"), /\.docx/);
});

// ---------------------------------------------------------------------------
// buildObjectKey
// ---------------------------------------------------------------------------

test("buildObjectKey: never uses the original filename as identity", () => {
  const key = buildObjectKey({
    materialId: "11111111-1111-1111-1111-111111111111",
    intentId: "22222222-2222-2222-2222-222222222222",
    category: "primary",
    filename: "my-secret-name.pdf",
  });
  assert.ok(!key.includes("my-secret-name"), `key leaked the filename: ${key}`);
  assert.match(key, /^resources\/[0-9a-f-]+\/primary\/[0-9a-f-]{36}\.pdf$/);
});

test("buildObjectKey: uses the pending namespace when the resource does not exist yet", () => {
  const key = buildObjectKey({
    materialId: null,
    intentId: "22222222-2222-2222-2222-222222222222",
    category: "image",
    filename: "diagram.png",
  });
  assert.match(key, /^pending\/[0-9a-f-]+\/images\/[0-9a-f-]{36}\.png$/);
});

test("buildObjectKey: block kinds map to their own key segments", () => {
  const base = { materialId: "m", intentId: "i", filename: "x.mp3" } as const;
  assert.match(buildObjectKey({ ...base, category: "audio" }), /\/audio\//);
  assert.match(buildObjectKey({ ...base, category: "file", filename: "x.zip" }), /\/files\//);
  assert.match(buildObjectKey({ ...base, category: "image", filename: "x.png" }), /\/images\//);
});

test("buildObjectKey: two uploads of the same filename never collide", () => {
  const args = {
    materialId: "11111111-1111-1111-1111-111111111111",
    intentId: "22222222-2222-2222-2222-222222222222",
    category: "primary" as UploadCategory,
    filename: "same.pdf",
  };
  assert.notEqual(buildObjectKey(args), buildObjectKey(args));
});

test("buildObjectKey: sanitizes a hostile material id out of the path", () => {
  const key = buildObjectKey({
    materialId: "../../etc/passwd",
    intentId: "22222222-2222-2222-2222-222222222222",
    category: "primary",
    filename: "x.pdf",
  });
  assert.ok(!key.includes(".."), `traversal survived: ${key}`);
  assert.equal(isSafeObjectKey(key), true);
});

// ---------------------------------------------------------------------------
// isSafeObjectKey
// ---------------------------------------------------------------------------

test("isSafeObjectKey: accepts well-formed keys", () => {
  assert.equal(isSafeObjectKey("resources/abc/primary/123e4567-e89b-12d3-a456-426614174000.pdf"), true);
  assert.equal(isSafeObjectKey("pending/abc/files/a.png"), true);
});

test("isSafeObjectKey: rejects traversal, absolute paths and empty segments", () => {
  for (const bad of [
    "../secrets/x",
    "resources/../../etc/passwd",
    "/etc/passwd",
    "resources//primary/x",
    "resources/./primary/x",
    "",
    "resources/primary/x".concat("\0"),
    "a".repeat(500),
  ]) {
    assert.equal(isSafeObjectKey(bad), false, `should reject: ${JSON.stringify(bad)}`);
  }
});

test("resourceHref is stable and non-expiring", () => {
  assert.equal(resourceHref("resources/x/primary/a.pdf"), "/api/resources/resources/x/primary/a.pdf");
});

// ---------------------------------------------------------------------------
// LocalDiskStorageProvider
// ---------------------------------------------------------------------------

test("LocalDiskStorageProvider: put → head → read → delete round-trip", async (t) => {
  const previousCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), "learners-area-storage-"));
  process.chdir(dir);
  t.after(() => {
    process.chdir(previousCwd);
    return rm(dir, { recursive: true, force: true });
  });

  const storage = new LocalDiskStorageProvider();
  const key = "resources/material-1/primary/abc.png";

  assert.equal(await storage.head(key), null, "nothing stored yet");
  assert.equal(await storage.read(key), null);
  assert.equal(await storage.presignPut({ key, contentType: "image/png", expiresInSeconds: 60 }), null);
  assert.equal(await storage.signedReadUrl(key, 60), null);
  assert.equal(storage.supportsDirectUpload, false);

  await storage.put({ key, body: Buffer.from("hello-bytes"), contentType: "image/png" });

  const head = await storage.head(key);
  assert.equal(head?.size, Buffer.byteLength("hello-bytes"));

  const read = await storage.read(key);
  assert.equal(read?.body.toString(), "hello-bytes");
  assert.equal(read?.contentType, "image/png");

  // Deleting a key that does not exist must not throw — the caller is usually
  // mid-way through deleting a DB row and must not be blocked by storage.
  await storage.delete("resources/nope/primary/missing.png");

  await storage.delete(key);
  assert.equal(await storage.head(key), null);
});

test("LocalDiskStorageProvider: refuses to write outside the uploads root", async () => {
  const storage = new LocalDiskStorageProvider();
  await assert.rejects(() => storage.put({ key: "../escape.txt", body: Buffer.from("x"), contentType: "text/plain" }));
  await assert.rejects(() => storage.head("../../etc/passwd"));
  await assert.rejects(() => storage.delete("/etc/passwd"));
});

test("inferContentType maps the documented extensions", () => {
  assert.equal(inferContentType("a/b/c.mp3"), "audio/mpeg");
  assert.equal(inferContentType("a/b/c.pdf"), "application/pdf");
  assert.equal(inferContentType("a/b/c.unknown"), "application/octet-stream");
});

test("local deletion is idempotent for missing files but propagates filesystem failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qa2-storage-"));
  const key = `qa2-delete-${path.basename(root)}`;
  const directory = path.join(LOCAL_UPLOAD_ROOT, key);
  await mkdir(directory, { recursive: true });
  const storage = new LocalDiskStorageProvider();
  try {
    await assert.rejects(storage.delete(key), "a directory must not be reported as a deleted object");
    await storage.delete(`${key}/missing.webm`);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
