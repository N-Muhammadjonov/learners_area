#!/usr/bin/env -S node --conditions=react-server --import tsx
/**
 * Install GitHub-versioned Listening Test 1 as a native database test.
 *
 * No admin HTML upload, no separate vocabulary tables, and no public answer-key
 * file. The existing canonical Listening importer creates package/questions,
 * lexical senses/units/occurrences and content versions in one transaction.
 *
 * Default: source-only validation, zero DB/storage writes.
 * --apply: requires owner identity and verified private R2 MP3; writes draft.
 * --apply --publish: explicitly authorizes immediate publication of a valid
 * test after the MP3 is verified. Reusing unchanged content is idempotent;
 * an old draft is NOT silently promoted by an unchanged import.
 *
 * Install dependencies first (including devDependencies for inert JSDOM):
 *   npm ci
 *   LISTENING_TEST_ONE_OWNER_ID=<owner-uuid> node --conditions=react-server --env-file=.env --import tsx scripts/install-listening-test-one.ts --apply
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { uploadIntents, users } from "../src/db/schema";
import { importCanonicalListeningPackage } from "../src/lib/import/listening/importer";
import { getStorageService } from "../src/lib/services/storage";
import { listeningTestOnePackage } from "./listening-test-one-package";

const args = new Set(process.argv.slice(2));
for (const argument of args) {
  if (!["--apply", "--publish"].includes(argument)) throw Error("Unrecognized option: " + argument);
}
const apply = args.has("--apply");
const publish = args.has("--publish");
if (publish && !apply) throw Error("--publish requires --apply");

async function main() {
  const { manifest, canonical, stored } = listeningTestOnePackage();
  const report = {
    sourceRef: manifest.id,
    parts: stored.sections.length,
    questions: stored.questions.length,
    vocabulary: stored.vocabulary.length,
    assetKey: manifest.audio.objectKey,
    mode: apply ? (publish ? "apply_and_publish" : "apply_draft") : "verify_source_only",
  };
  if (!apply) {
    console.log(JSON.stringify({ ok: true, ...report, databaseWritten: false, r2Checked: false }, null, 2));
    return;
  }
  if (process.env.STORAGE_PROVIDER !== "r2") throw Error("STORAGE_PROVIDER=r2 is required");
  const ownerId = process.env.LISTENING_TEST_ONE_OWNER_ID;
  if (!ownerId || !/^[a-f0-9-]{36}$/i.test(ownerId)) throw Error("LISTENING_TEST_ONE_OWNER_ID must be an owner UUID");
  const [owner] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, ownerId), eq(users.role, "owner"))).limit(1);
  if (!owner) throw Error("Actor is not the active database owner");
  const storage = getStorageService();
  const head = await storage.head(manifest.audio.objectKey);
  if (!head || head.size !== manifest.audio.bytes || head.contentType !== manifest.audio.contentType)
    throw Error("R2 full.mp3 missing, wrong size or MIME; no DB changes made");
  const blob = await storage.read(manifest.audio.objectKey);
  if (!blob || blob.contentType !== manifest.audio.contentType || blob.body.length !== manifest.audio.bytes)
    throw Error("R2 audio read or Content-Type mismatch; no DB changes made");
  if (createHash("sha256").update(blob.body).digest("hex") !== manifest.audio.sha256)
    throw Error("R2 SHA-256 mismatch; no DB changes made");
  // Import in ONE transaction. This is a *trusted owner CLI*, not an API accepting
  // arbitrary object keys. A verified pre-existing R2 object gains a tracked
  // upload intent, so the canonical importer and resource guard stay in use.
  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.uploadIntents.findFirst({
      where: eq(uploadIntents.objectKey, manifest.audio.objectKey),
    });
    if (existing && (existing.userId !== ownerId || existing.mimeType !== manifest.audio.contentType || existing.size !== manifest.audio.bytes))
      throw Error("R2 object key is already owned by an incompatible upload intent");
    const [created] = existing ? [] : await tx.insert(uploadIntents).values({
      userId: ownerId, purpose: "material_primary", status: "finalized",
      objectKey: manifest.audio.objectKey, originalName: "full.mp3",
      mimeType: manifest.audio.contentType, size: manifest.audio.bytes,
      directToStorage: true, expiresAt: new Date(Date.now() + 86_400_000), finalizedAt: new Date(),
    }).onConflictDoNothing({ target: uploadIntents.objectKey }).returning();
    const intent = created ?? existing ?? await tx.query.uploadIntents.findFirst({
      where: eq(uploadIntents.objectKey, manifest.audio.objectKey),
    });
    if (!intent || intent.userId !== ownerId) throw Error("Cannot verify audio object ownership");
    const imported = await importCanonicalListeningPackage(tx, canonical, {
      actorUserId: ownerId,
      assets: [{
        key: "audio.full", role: "audio", uploadId: intent.id,
        objectKey: intent.objectKey, mimeType: intent.mimeType, size: intent.size, originalName: intent.originalName,
      }],
      publish, publishAuthorized: publish,
      originalFilename: "content/listening/academic/test-01/source.html",
      acknowledgeGradeImpact: false,
    });
    if (!imported.ok) throw Error("Native import refused: " + imported.report.issues.map(i => i.message).join(" | "));
    return imported;
  });
  console.log(JSON.stringify({ ok: true, ...report, action: result.action, testId: result.targetId,
    publicationState: result.publicationState, lexical: result.lexical ?? null }, null, 2));
  if (publish && result.publicationState !== "published")
    console.error("Existing unchanged content was NOT promoted. Publish only using the guarded admin publication action.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Listening Test 1 installation failed");
  process.exitCode = 1;
});
