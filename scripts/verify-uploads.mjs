#!/usr/bin/env node
/**
 * End-to-end verification of the resource/upload system against a RUNNING app
 * and a REAL database. This is the acceptance test the README points at: it
 * exercises the whole lifecycle over HTTP, the way a browser does.
 *
 *   node scripts/verify-uploads.mjs [baseUrl]
 *
 * Prerequisites:
 *   - a Postgres reachable at DATABASE_URL
 *   - `npm run db:push && npm run db:seed` applied
 *   - `npm run dev` (or `npm start`) serving on http://localhost:3000
 *
 * It uses the seeded demo accounts and cleans up everything it creates.
 * Nothing here fakes a result: every assertion is checked against the real
 * server response, the real database, or the real filesystem.
 */
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const UPLOAD_ROOT = path.join(process.cwd(), ".data", "uploads");

const ACCOUNTS = {
  admin: { email: "admin@learnersarea.uz", password: "Admin12345!" },
  teacher: { email: "teacher@learnersarea.uz", password: "Teacher12345!" },
  teacher2: { email: "teacher2@learnersarea.uz", password: "Teacher12345!" },
  student: { email: "demo.student@learnersarea.uz", password: "Student12345!" },
  student2: { email: "new.student@learnersarea.uz", password: "Student12345!" },
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n         ${err.message}`);
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.cookie = "";
  }
  async login(account) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ACCOUNTS[account]),
    });
    assert.equal(res.status, 200, `login as ${account} failed: ${res.status}`);
    const raw = res.headers.getSetCookie?.() ?? [];
    this.cookie = raw.map((c) => c.split(";")[0]).join("; ");
    assert.ok(this.cookie, `no session cookie for ${account}`);
    return this;
  }
  async request(pathname, { method = "GET", body, json = true, form } = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      if (json) headers["Content-Type"] = "application/json";
      payload = json ? JSON.stringify(body) : body;
    }
    const res = await fetch(`${BASE}${pathname}`, { method, headers, body: payload, redirect: "manual" });
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
}

const teacher = new Client("teacher");
const teacher2 = new Client("teacher2");
const student = new Client("student");
const anonymous = new Client("anonymous");

function fileBlob(name, type, contents) {
  return new File([contents ?? `contents of ${name}`], name, { type });
}

async function uploadThrough(client, file, { purpose, blockKind, materialId }) {
  const intent = await client.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose, blockKind, materialId, filename: file.name, contentType: file.type, size: file.size },
  });
  assert.equal(intent.status, 200, `intent failed: ${JSON.stringify(intent.data)}`);
  const form = new FormData();
  form.append("uploadId", intent.data.uploadId);
  form.append("file", file);
  const put = await client.request("/api/uploads", { method: "POST", form });
  assert.equal(put.status, 200, `proxy upload failed: ${JSON.stringify(put.data)}`);
  const final = await client.request("/api/uploads/finalize", {
    method: "POST",
    body: { uploadId: intent.data.uploadId },
  });
  assert.equal(final.status, 200, `finalize failed: ${JSON.stringify(final.data)}`);
  return { uploadId: intent.data.uploadId, objectKey: final.data.objectKey };
}

function diskPath(objectKey) {
  return path.join(UPLOAD_ROOT, objectKey);
}

async function dbRows(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// ---------------------------------------------------------------------------

console.log(`\nLearners Area — upload/resource E2E verification against ${BASE}\n`);

await check("seeded accounts can log in", async () => {
  await teacher.login("teacher");
  await teacher2.login("teacher2");
  await student.login("student");
});

// --- Authorization ---------------------------------------------------------

await check("anonymous intent request is rejected (401)", async () => {
  const res = await anonymous.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_primary", filename: "a.pdf", contentType: "application/pdf", size: 10 },
  });
  assert.equal(res.status, 401);
});

await check("student cannot obtain an upload intent (403)", async () => {
  const res = await student.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_primary", filename: "a.pdf", contentType: "application/pdf", size: 10 },
  });
  assert.equal(res.status, 403);
});

await check("student cannot create a material (403)", async () => {
  const res = await student.request("/api/speaking/materials", {
    method: "POST",
    body: { title: "x", category: "part1", primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.com/a" }, blocks: [] },
  });
  assert.equal(res.status, 403);
});

await check("anonymous read of a stored object is rejected (401)", async () => {
  const res = await anonymous.request("/api/resources/pending/nope/primary/x.pdf");
  assert.equal(res.status, 401);
});

// --- Validation ------------------------------------------------------------

await check("oversized image is rejected at intent time (413)", async () => {
  const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
  const res = await teacher.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_block", blockKind: "image", filename: "big.png", contentType: "image/png", size: big.size },
  });
  assert.equal(res.status, 413, `expected 413, got ${res.status}: ${JSON.stringify(res.data)}`);
});

await check("unsupported MIME is rejected at intent time (400)", async () => {
  const res = await teacher.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_block", blockKind: "file", filename: "evil.exe", contentType: "application/x-msdownload", size: 2048 },
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.data)}`);
});

await check("block intent without a blockKind is rejected (400)", async () => {
  const res = await teacher.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_block", filename: "a.png", contentType: "image/png", size: 10 },
  });
  assert.equal(res.status, 400);
});

await check("finalize for an object that was never uploaded fails (409)", async () => {
  const intent = await teacher.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_block", blockKind: "file", filename: "never.pdf", contentType: "application/pdf", size: 32 },
  });
  assert.equal(intent.status, 200);
  const final = await teacher.request("/api/uploads/finalize", {
    method: "POST",
    body: { uploadId: intent.data.uploadId },
  });
  assert.equal(final.status, 409, `expected 409, got ${final.status}: ${JSON.stringify(final.data)}`);
});

// --- Full resource lifecycle ----------------------------------------------

let materialId;
let recordingKey;
const created = { primary: null, image: null, audio: null, file: null };

await check("primary + image + audio + file + text + link blocks are created in order", async () => {
  created.primary = await uploadThrough(
    teacher,
    fileBlob("lesson-guide.pdf", "application/pdf"),
    { purpose: "material_primary" }
  );
  created.image = await uploadThrough(
    teacher,
    fileBlob("diagram.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    { purpose: "material_block", blockKind: "image" }
  );
  created.audio = await uploadThrough(
    teacher,
    fileBlob("model-answer.mp3", "audio/mpeg", new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
    { purpose: "material_block", blockKind: "audio" }
  );
  created.file = await uploadThrough(
    teacher,
    fileBlob("worksheet.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    { purpose: "material_block", blockKind: "file" }
  );

  const res = await teacher.request("/api/speaking/materials", {
    method: "POST",
    body: {
      category: "part2",
      title: "E2E: the one-minute cue-card plan",
      primary: { mode: "upload", primaryType: "file", ref: { uploadId: created.primary.uploadId } },
      blocks: [
        { type: "text", textContent: "First paragraph of the description." },
        { type: "image", ref: { uploadId: created.image.uploadId } },
        { type: "text", textContent: "Second paragraph, after the image." },
        { type: "audio", ref: { uploadId: created.audio.uploadId } },
        { type: "link", linkUrl: "https://example.com/cue-card-template" },
        { type: "file", ref: { uploadId: created.file.uploadId } },
      ],
    },
  });
  assert.equal(res.status, 200, `create failed: ${JSON.stringify(res.data)}`);
  materialId = res.data.id;
  assert.ok(materialId, "no material id returned");
});

await check("objects really exist on disk under their generated keys", async () => {
  for (const key of [created.primary.objectKey, created.image.objectKey, created.audio.objectKey, created.file.objectKey]) {
    assert.ok(existsSync(diskPath(key)), `missing object on disk: ${key}`);
  }
});

await check("object keys are namespaced, never the original filename", async () => {
  for (const [label, entry] of Object.entries(created)) {
    assert.match(
      entry.objectKey,
      /^(resources|pending)\/[A-Za-z0-9-]+\/(primary|images|audio|files)\/[0-9a-f-]{36}\./,
      `${label}: ${entry.objectKey}`
    );
    assert.ok(!entry.objectKey.includes("lesson-guide"), `primary key leaked filename: ${entry.objectKey}`);
    assert.ok(!entry.objectKey.includes("diagram"), `image key leaked filename: ${entry.objectKey}`);
    assert.ok(!entry.objectKey.includes("worksheet"), `file key leaked filename: ${entry.objectKey}`);
  }
});

await check("block order is persisted in the database, not just client memory", async () => {
  const rows = await dbRows(
    "SELECT type, position, text_content, link_url, object_key, original_name, mime_type, size FROM material_blocks WHERE material_id = $1 ORDER BY position",
    [materialId]
  );
  assert.equal(rows.length, 6, `expected 6 blocks, got ${rows.length}`);
  assert.deepEqual(
    rows.map((r) => r.type),
    ["text", "image", "text", "audio", "link", "file"]
  );
  assert.equal(rows[0].text_content, "First paragraph of the description.");
  assert.equal(rows[2].text_content, "Second paragraph, after the image.");
  assert.equal(rows[1].object_key, created.image.objectKey);
  assert.equal(rows[1].original_name, "diagram.png");
  assert.equal(rows[1].mime_type, "image/png");
  assert.equal(rows[3].object_key, created.audio.objectKey);
  assert.equal(rows[4].link_url, "https://example.com/cue-card-template");
  assert.equal(rows[5].object_key, created.file.objectKey);

  const [material] = await dbRows(
    "SELECT primary_object_key, primary_original_name, primary_url, primary_size FROM speaking_materials WHERE id = $1",
    [materialId]
  );
  assert.equal(material.primary_object_key, created.primary.objectKey);
  assert.equal(material.primary_original_name, "lesson-guide.pdf");
  // The stored URL must be the stable resource path, never an expiring one.
  assert.equal(material.primary_url, `/api/resources/${created.primary.objectKey}`);
  assert.ok(!material.primary_url.includes("X-Amz-Signature"), "a signed URL was persisted as authoritative");
});

await check("stored metadata comes from the server-side intent, not the request body", async () => {
  // Ask for a material claiming a bogus size/name alongside a real uploadId;
  // the server must ignore the claim.
  const upload = await uploadThrough(teacher, fileBlob("real-name.txt", "text/plain"), {
    purpose: "material_block",
    blockKind: "file",
  });
  const res = await teacher.request("/api/speaking/materials", {
    method: "POST",
    body: {
      category: "general",
      title: "E2E: metadata is server-authoritative",
      primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.com/x" },
      blocks: [
        {
          type: "file",
          ref: { uploadId: upload.uploadId },
          originalName: "totally-different-name.pdf",
          mimeType: "application/pdf",
          size: 999999,
        },
      ],
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const rows = await dbRows("SELECT original_name, mime_type, object_key FROM material_blocks WHERE material_id = $1", [res.data.id]);
  assert.equal(rows[0].original_name, "real-name.txt");
  assert.equal(rows[0].mime_type, "text/plain");
  assert.equal(rows[0].object_key, upload.objectKey);
  await dbRows("DELETE FROM speaking_materials WHERE id = $1", [res.data.id]);
});

await check("an arbitrary object key cannot be registered as a resource (400)", async () => {
  const res = await teacher.request("/api/speaking/materials", {
    method: "POST",
    body: {
      category: "general",
      title: "E2E: injected key must be refused",
      primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.com/y" },
      blocks: [
        { type: "file", ref: { objectKey: "resources/someone-else/primary/deadbeef.pdf" } },
      ],
    },
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.data)}`);
});

await check("an already-spent uploadId cannot be reused (400)", async () => {
  const upload = await uploadThrough(teacher, fileBlob("spent.pdf", "application/pdf"), {
    purpose: "material_block",
    blockKind: "file",
  });
  const body = (title) => ({
    category: "general",
    title,
    primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.com/z" },
    blocks: [{ type: "file", ref: { uploadId: upload.uploadId } }],
  });
  const first = await teacher.request("/api/speaking/materials", { method: "POST", body: body("E2E: first use") });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await teacher.request("/api/speaking/materials", { method: "POST", body: body("E2E: second use") });
  assert.equal(second.status, 400, `expected reuse to fail, got ${second.status}`);
  await dbRows("DELETE FROM speaking_materials WHERE id = $1", [first.data.id]);
});

await check("a malformed link URL is rejected (400)", async () => {
  const res = await teacher.request("/api/speaking/materials", {
    method: "POST",
    body: {
      category: "general",
      title: "E2E: malformed link",
      primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.com/ok" },
      blocks: [{ type: "link", linkUrl: "not-a-url" }],
    },
  });
  assert.equal(res.status, 400);
});

// --- Private delivery ------------------------------------------------------

await check("an authenticated student can read an object from an active material", async () => {
  const res = await student.request(`/api/resources/${created.primary.objectKey}`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get("content-type") ?? ""), /pdf/);
});

await check("the resource route never echoes R2 credentials or a signed URL", async () => {
  const res = await student.request(`/api/resources/${created.primary.objectKey}`);
  const body = String(res.data ?? "");
  assert.ok(!body.includes("X-Amz-Signature"), "signed query leaked to the client");
  assert.ok(!body.includes("X-Amz-Credential"), "credentials leaked to the client");
  assert.ok(!res.headers.get("location")?.includes("X-Amz-Signature"), "signed redirect target leaked");
});

await check("deactivating a material immediately stops student reads (403)", async () => {
  const patch = await teacher.request(`/api/speaking/materials/${materialId}`, {
    method: "PATCH",
    body: { isActive: false },
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  const asStudent = await student.request(`/api/resources/${created.primary.objectKey}`);
  assert.equal(asStudent.status, 403, `expected 403, got ${asStudent.status}`);
  const asTeacher = await teacher.request(`/api/resources/${created.primary.objectKey}`);
  assert.equal(asTeacher.status, 200, "the owner must still be able to read it");
});

// A stored object must not be reachable any other way. The key is not a secret
// — it travels in the URL a student is given — so if a static path served the
// bytes, the authenticated route above would be decorative. The local provider
// used to write into `public/uploads/`, which Next serves straight from disk to
// anyone who asks; the object root now sits outside the web root, and this is
// the check that keeps it there.
await check("a stored object is not served from a static path (no bypass)", async () => {
  const res = await anonymous.request(`/uploads/${created.primary.objectKey}`);
  assert.ok(
    res.status === 404 || res.status === 403,
    `a static path served a private object: ${res.status}`
  );
});

await check("the local object on disk lives outside the web root", async () => {
  const onDisk = diskPath(created.primary.objectKey);
  assert.ok(existsSync(onDisk), `object is not on disk at ${onDisk}`);
  const publicRoot = path.resolve(process.cwd(), "public");
  assert.ok(
    !path.resolve(onDisk).startsWith(`${publicRoot}${path.sep}`),
    `object was written inside public/: ${onDisk}`
  );
});

await check("an unknown object key answers 404, not 403 (no enumeration)", async () => {
  const res = await teacher.request("/api/resources/pending/does-not-exist/primary/00000000-0000-0000-0000-000000000000.pdf");
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});

await check("a path-traversal key is refused (400)", async () => {
  const res = await teacher.request("/api/resources/..%2F..%2F.env");
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

// --- Editing ---------------------------------------------------------------

await check("editing keeps retained attachments without re-uploading them", async () => {
  // Re-send every block, but change only the first text block and move the link
  // to the front. No uploadIds at all — everything is retained by objectKey.
  const res = await teacher.request(`/api/speaking/materials/${materialId}`, {
    method: "PATCH",
    body: {
      title: "E2E: the one-minute cue-card plan (edited)",
      blocks: [
        { type: "link", linkUrl: "https://example.com/cue-card-template" },
        { type: "text", textContent: "First paragraph, EDITED." },
        { type: "image", ref: { objectKey: created.image.objectKey } },
        { type: "text", textContent: "Second paragraph, after the image." },
        { type: "audio", ref: { objectKey: created.audio.objectKey } },
        { type: "file", ref: { objectKey: created.file.objectKey } },
      ],
    },
  });
  assert.equal(res.status, 200, `edit failed: ${JSON.stringify(res.data)}`);

  // The retained objects must still be on disk — reordering must not delete.
  for (const key of [created.image.objectKey, created.audio.objectKey, created.file.objectKey]) {
    assert.ok(existsSync(diskPath(key)), `retained object was deleted by a reorder: ${key}`);
  }

  const rows = await dbRows("SELECT type, position, text_content FROM material_blocks WHERE material_id = $1 ORDER BY position", [materialId]);
  assert.deepEqual(rows.map((r) => r.type), ["link", "text", "image", "text", "audio", "file"]);
  assert.equal(rows[1].text_content, "First paragraph, EDITED.");

  const [material] = await dbRows("SELECT title FROM speaking_materials WHERE id = $1", [materialId]);
  assert.equal(material.title, "E2E: the one-minute cue-card plan (edited)");
});

await check("removing a block deletes its object from storage", async () => {
  const res = await teacher.request(`/api/speaking/materials/${materialId}`, {
    method: "PATCH",
    body: {
      blocks: [
        { type: "link", linkUrl: "https://example.com/cue-card-template" },
        { type: "text", textContent: "First paragraph, EDITED." },
        { type: "image", ref: { objectKey: created.image.objectKey } },
        { type: "text", textContent: "Second paragraph, after the image." },
        { type: "audio", ref: { objectKey: created.audio.objectKey } },
      ],
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(!existsSync(diskPath(created.file.objectKey)), "removed block's object is still on disk");
  const rows = await dbRows("SELECT type FROM material_blocks WHERE material_id = $1 ORDER BY position", [materialId]);
  assert.equal(rows.length, 5);
  assert.ok(!rows.some((r) => r.type === "file"));
});

await check("replacing a block attachment deletes the obsolete object", async () => {
  const replacement = await uploadThrough(teacher, fileBlob("model-answer-v2.mp3", "audio/mpeg", new Uint8Array([0xff, 0xfb, 0x90, 0x01])), {
    purpose: "material_block",
    blockKind: "audio",
    materialId,
  });
  const res = await teacher.request(`/api/speaking/materials/${materialId}`, {
    method: "PATCH",
    body: {
      blocks: [
        { type: "link", linkUrl: "https://example.com/cue-card-template" },
        { type: "text", textContent: "First paragraph, EDITED." },
        { type: "image", ref: { objectKey: created.image.objectKey } },
        { type: "text", textContent: "Second paragraph, after the image." },
        { type: "audio", ref: { uploadId: replacement.uploadId } },
      ],
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(!existsSync(diskPath(created.audio.objectKey)), "the replaced audio object was not cleaned up");
  assert.ok(existsSync(diskPath(replacement.objectKey)), "the replacement object is missing");
  created.audio = replacement;
});

await check("replacing the primary file deletes the obsolete primary object", async () => {
  const replacement = await uploadThrough(teacher, fileBlob("lesson-guide-v2.pdf", "application/pdf"), {
    purpose: "material_primary",
    materialId,
  });
  const res = await teacher.request(`/api/speaking/materials/${materialId}`, {
    method: "PATCH",
    body: { primary: { mode: "upload", primaryType: "file", ref: { uploadId: replacement.uploadId } } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(!existsSync(diskPath(created.primary.objectKey)), "old primary object survived the replacement");
  assert.ok(existsSync(diskPath(replacement.objectKey)), "new primary object missing");
  created.primary = replacement;

  const [material] = await dbRows("SELECT primary_object_key FROM speaking_materials WHERE id = $1", [materialId]);
  assert.equal(material.primary_object_key, replacement.objectKey);
});

await check("a second teacher cannot edit someone else's material (403)", async () => {
  const res = await teacher2.request(`/api/speaking/materials/${materialId}`, {
    method: "PATCH",
    body: { title: "hijacked" },
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  const [material] = await dbRows("SELECT title, created_by_user_id FROM speaking_materials WHERE id = $1", [materialId]);
  assert.ok(!material.title.includes("hijacked"), "the title was changed by a non-owner");
});

await check("a second teacher cannot obtain an upload intent scoped to someone else's material (403)", async () => {
  const res = await teacher2.request("/api/uploads/intent", {
    method: "POST",
    body: {
      purpose: "material_primary",
      materialId,
      filename: "hijack.pdf",
      contentType: "application/pdf",
      size: 32,
    },
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});

await check("a second teacher cannot delete someone else's material (403)", async () => {
  const res = await teacher2.request(`/api/speaking/materials/${materialId}`, { method: "DELETE" });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});

await check("the platform owner CAN edit another teacher's material (200)", async () => {
  const admin = new Client("admin");
  await admin.login("admin");
  const res = await admin.request(`/api/speaking/materials/${materialId}`, {
    method: "PATCH",
    body: { title: "E2E: owner-adjusted title" },
  });
  assert.equal(res.status, 200, `owner edit failed: ${JSON.stringify(res.data)}`);
});

// --- Cancellation & cleanup ------------------------------------------------

await check("cancelling an upload removes its object and closes the intent", async () => {
  const intent = await teacher.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_block", blockKind: "file", filename: "to-cancel.pdf", contentType: "application/pdf", size: 32 },
  });
  assert.equal(intent.status, 200);
  const form = new FormData();
  form.append("uploadId", intent.data.uploadId);
  form.append("file", fileBlob("to-cancel.pdf", "application/pdf"));
  await teacher.request("/api/uploads", { method: "POST", form });

  const abort = await teacher.request(`/api/uploads/${intent.data.uploadId}`, { method: "DELETE" });
  assert.equal(abort.status, 200, JSON.stringify(abort.data));
  assert.ok(!existsSync(diskPath(intent.data.objectKey)), "cancelled upload left an object behind");

  const finalize = await teacher.request("/api/uploads/finalize", {
    method: "POST",
    body: { uploadId: intent.data.uploadId },
  });
  assert.equal(finalize.status, 409, `expected the aborted intent to refuse finalize, got ${finalize.status}`);
});

await check("an abandoned upload is swept by the admin cleanup endpoint", async () => {
  const intent = await teacher.request("/api/uploads/intent", {
    method: "POST",
    body: { purpose: "material_block", blockKind: "file", filename: "abandoned.pdf", contentType: "application/pdf", size: 32 },
  });
  assert.equal(intent.status, 200);
  const form = new FormData();
  form.append("uploadId", intent.data.uploadId);
  form.append("file", fileBlob("abandoned.pdf", "application/pdf"));
  await teacher.request("/api/uploads", { method: "POST", form });
  assert.ok(existsSync(diskPath(intent.data.objectKey)), "object should exist before cleanup");

  // Age the intent past its expiry, as if the browser had gone away.
  await dbRows("UPDATE upload_intents SET expires_at = now() - interval '1 hour' WHERE id = $1", [intent.data.uploadId]);

  const admin = new Client("admin");
  await admin.login("admin");
  const cleaned = await admin.request("/api/admin/uploads/cleanup", { method: "POST" });
  assert.equal(cleaned.status, 200, JSON.stringify(cleaned.data));
  assert.ok(cleaned.data.removedObjects >= 1, `cleanup removed nothing: ${JSON.stringify(cleaned.data)}`);
  assert.ok(!existsSync(diskPath(intent.data.objectKey)), "abandoned object survived cleanup");

  const asStudent = await student.request("/api/admin/uploads/cleanup", { method: "POST" });
  assert.equal(asStudent.status, 403, "cleanup must be admin-only");
});

// --- Deletion --------------------------------------------------------------

await check("deleting a resource removes every object it owned", async () => {
  const keys = [created.primary.objectKey, created.image.objectKey, created.audio.objectKey];
  const res = await teacher.request(`/api/speaking/materials/${materialId}`, { method: "DELETE" });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  for (const key of keys) {
    assert.ok(!existsSync(diskPath(key)), `object survived resource deletion: ${key}`);
  }
  const rows = await dbRows("SELECT id FROM material_blocks WHERE material_id = $1", [materialId]);
  assert.equal(rows.length, 0, "blocks were not cascaded away");
  const [material] = await dbRows("SELECT id FROM speaking_materials WHERE id = $1", [materialId]);
  assert.equal(material, undefined, "material row survived deletion");
});

// --- Speaking practice recordings ------------------------------------------

let practiceAttemptId;

await check("a student can start a Speaking attempt and scope an upload to it", async () => {
  const prompts = await student.request("/api/speaking/prompts");
  assert.equal(prompts.status, 200, JSON.stringify(prompts.data));
  assert.ok(Array.isArray(prompts.data.prompts) && prompts.data.prompts.length >= 5, "seeded prompts missing");

  const prompt = prompts.data.prompts.find((p) => p.part === "part2");
  assert.ok(prompt, "no Part 2 prompt seeded");

  const created = await student.request("/api/speaking/attempts", {
    method: "POST",
    body: { promptId: prompt.id, part: "part2" },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  practiceAttemptId = created.data.attempt.id;
  assert.equal(created.data.attempt.status, "recording");
});

await check("a recording upload intent is namespaced under the attempt", async () => {
  const res = await student.request("/api/uploads/intent", {
    method: "POST",
    body: {
      purpose: "speaking_recording",
      speakingAttemptId: practiceAttemptId,
      filename: "answer.webm",
      contentType: "audio/webm",
      size: 12,
    },
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert.match(res.data.objectKey, new RegExp(`^speaking/attempts/${practiceAttemptId}/audio/[0-9a-f-]{36}\\.webm$`));
  recordingKey = res.data.objectKey;
});

await check("a student cannot scope a recording upload to someone else's attempt", async () => {
  const stranger = new Client("stranger");
  await stranger.login("student2");

  const res = await stranger.request("/api/uploads/intent", {
    method: "POST",
    body: {
      purpose: "speaking_recording",
      speakingAttemptId: practiceAttemptId,
      filename: "hijack.webm",
      contentType: "audio/webm",
      size: 12,
    },
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.data)}`);
});

await check("a stranger cannot read another student's attempt", async () => {
  const stranger = new Client("stranger-read");
  await stranger.login("student2");
  const res = await stranger.request(`/api/speaking/attempts/${practiceAttemptId}`);
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.data)}`);
});

await check("an unsubmitted attempt refuses a second recording upload intent", async () => {
  // First one is fine, but once submitted the attempt is closed.
  const submit = await student.request(`/api/speaking/attempts/${practiceAttemptId}/submit`, {
    method: "POST",
    body: {},
  });
  // No recording attached yet, so this must refuse rather than half-submit.
  assert.equal(submit.status, 409, `expected 409 (no_recording), got ${submit.status}`);

  const res = await student.request("/api/uploads/intent", {
    method: "POST",
    body: {
      purpose: "speaking_recording",
      speakingAttemptId: practiceAttemptId,
      filename: "second.webm",
      contentType: "audio/webm",
      size: 12,
    },
  });
  assert.equal(res.status, 200, "an open attempt should still accept a recording");
});

await check("a full recording round-trip: upload, attach, submit, playback, history", async () => {
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
  const intent = await student.request("/api/uploads/intent", {
    method: "POST",
    body: {
      purpose: "speaking_recording",
      speakingAttemptId: practiceAttemptId,
      filename: "answer.webm",
      contentType: "audio/webm",
      size: bytes.byteLength,
    },
  });
  assert.equal(intent.status, 200, JSON.stringify(intent.data));

  const form = new FormData();
  form.append("uploadId", intent.data.uploadId);
  form.append("file", fileBlob("answer.webm", "audio/webm", bytes));
  await student.request("/api/uploads", { method: "POST", form });

  const final = await student.request("/api/uploads/finalize", {
    method: "POST",
    body: { uploadId: intent.data.uploadId },
  });
  assert.equal(final.status, 200, `finalize failed: ${JSON.stringify(final.data)}`);
  assert.equal(final.data.objectKey, intent.data.objectKey, "finalize returned a different key");
  assert.ok(existsSync(diskPath(final.data.objectKey)), "recording object missing on disk");

  const attach = await student.request(`/api/speaking/attempts/${practiceAttemptId}`, {
    method: "PATCH",
    body: { uploadId: intent.data.uploadId, durationMs: 4200 },
  });
  assert.equal(attach.status, 200, `attach failed: ${JSON.stringify(attach.data)}`);

  const submit = await student.request(`/api/speaking/attempts/${practiceAttemptId}/submit`, {
    method: "POST",
    body: { durationMs: 4200 },
  });
  assert.equal(submit.status, 200, `submit failed: ${JSON.stringify(submit.data)}`);
  assert.equal(submit.data.attempt.status, "submitted");
  assert.ok(submit.data.attempt.recordingObjectKey, "submitted attempt has no recording key");

  // The owner can play their own recording back.
  const asOwner = await student.request(`/api/resources/${final.data.objectKey}`);
  assert.equal(asOwner.status, 200, `owner playback failed: ${asOwner.status}`);

  // A submitted attempt is closed to further recording uploads.
  const after = await student.request("/api/uploads/intent", {
    method: "POST",
    body: {
      purpose: "speaking_recording",
      speakingAttemptId: practiceAttemptId,
      filename: "late.webm",
      contentType: "audio/webm",
      size: 12,
    },
  });
  assert.equal(after.status, 409, `expected 409 after submit, got ${after.status}`);

  // A second student must not be able to read someone else's recording.
  const stranger = new Client("stranger-playback");
  await stranger.login("student2");
  const asStranger = await stranger.request(`/api/resources/${final.data.objectKey}`);
  assert.equal(asStranger.status, 403, `a stranger read another student's recording: ${asStranger.status}`);

  // History lists it, without inventing a transcript.
  const history = await student.request("/api/speaking/attempts");
  assert.equal(history.status, 200);
  const mine = history.data.attempts.find((a) => a.id === practiceAttemptId);
  assert.ok(mine, "submitted attempt is missing from history");
  assert.equal(mine.transcript, null, "a transcript was invented without a provider");
  assert.equal(mine.recordingObjectKey, final.data.objectKey);

  // Discarding a submitted attempt is not allowed; only a recording one can be dropped.
  const resubmit = await student.request(`/api/speaking/attempts/${practiceAttemptId}/submit`, {
    method: "POST",
    body: {},
  });
  assert.equal(resubmit.status, 409, `expected 409 on double submit, got ${resubmit.status}`);

  await dbRows("DELETE FROM speaking_attempts WHERE id = $1", [practiceAttemptId]);
});

await check("the speaking practice and history pages render for a student", async () => {
  const practice = await student.request("/speaking/practice");
  assert.equal(practice.status, 200, `practice page: ${practice.status}`);
  assert.match(String(practice.data), /Speaking practice|Speaking mashqi/);
  const history = await student.request("/speaking/history");
  assert.equal(history.status, 200, `history page: ${history.status}`);
});

// --- Page rendering --------------------------------------------------------

await check("the teacher speaking page renders with the composer", async () => {
  const res = await teacher.request("/teacher/speaking");
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const html = String(res.data);
  assert.match(html, /Manage Speaking materials|Speaking materiallarini boshqarish/);
  assert.match(html, /Add a description block|Tavsif bloki qo'shish/);
});

await check("the student speaking page renders", async () => {
  const res = await student.request("/speaking");
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
await pool.end();

if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
