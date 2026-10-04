import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { uploadIntents } from "@/db/schema";
import { abortUploadIntent } from "@/lib/data/uploads";
import { getStorageService, isSafeObjectKey } from "@/lib/services/storage";
import type { StorageService } from "@/lib/services/storage/types";
import { canonicalMimeFor, validateUploadFile } from "@/lib/validation/uploads";
import { verifySignature } from "@/lib/uploads/signature";
import { authorizeCapability } from "./capabilities";
import {
  extractKnowledgeText,
  isSupportedKnowledgeSourceFilename,
  KnowledgeParseError,
  RIWI_SOURCE_LIMIT_BYTES,
} from "./knowledge-parser";
import {
  createKnowledgeCandidate,
  KNOWLEDGE_RIGHTS_CLASSES,
  KNOWLEDGE_SOURCE_TYPES,
  KnowledgeServiceError,
} from "./knowledge";
import type { KnowledgePublicationScope, KnowledgeRightsClass, KnowledgeSourceType } from "./knowledge";
import type { Role } from "@/lib/auth/roles";

export type KnowledgeUploadActor = { id: string; role: Role; accountStatus: "active" | "pending" | "suspended" | "rejected" };

type KnowledgeUploadDatabase = typeof db;

type IngestKnowledgeUploadInput = {
  actor: KnowledgeUploadActor;
  uploadId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  provenance: string;
  rightsClass: KnowledgeRightsClass;
  scope: KnowledgePublicationScope;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function contentTypesMatch(actual: string, declared: string): boolean {
  return actual.split(";")[0]!.trim().toLowerCase() === declared.split(";")[0]!.trim().toLowerCase();
}

function ownerMayUpload(actor: KnowledgeUploadActor): boolean {
  return actor.role === "owner" && actor.accountStatus === "active"
    && authorizeCapability(actor, "riwi.knowledge.submit_candidate").allowed;
}

async function discardInvalidUpload(userId: string, uploadId: string, database: KnowledgeUploadDatabase, storage: StorageService) {
  await abortUploadIntent(userId, uploadId, { database, storage }).catch(() => ({ ok: false }));
}

/**
 * Parses a finalized, owner-owned shared upload intent and transactionally
 * associates its immutable private object with a candidate source. The proxy
 * intent path is used for this purpose so no presigned PUT remains capable of
 * overwriting the source after it has been parsed.
 */
export async function ingestUploadedKnowledgeSource(
  input: IngestKnowledgeUploadInput,
  deps: { database?: KnowledgeUploadDatabase; storage?: StorageService; now?: Date } = {},
) {
  const database = deps.database ?? db;
  const storage = deps.storage ?? getStorageService();
  if (!ownerMayUpload(input.actor)) throw new KnowledgeServiceError("forbidden");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.uploadId)) {
    throw new KnowledgeServiceError("invalid_input");
  }
  if (!KNOWLEDGE_SOURCE_TYPES.includes(input.sourceType) || !KNOWLEDGE_RIGHTS_CLASSES.includes(input.rightsClass)) {
    throw new KnowledgeServiceError("invalid_input");
  }

  const intent = await database.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, input.uploadId) });
  if (!intent || intent.userId !== input.actor.id || intent.purpose !== "riwi_knowledge_source") {
    throw new KnowledgeServiceError("not_found");
  }
  const now = deps.now ?? new Date();
  if (intent.status !== "finalized" || intent.usedAt || intent.expiresAt <= now) {
    throw new KnowledgeServiceError("invalid_state");
  }

  const reject = async (error: KnowledgeParseError): Promise<never> => {
    await discardInvalidUpload(input.actor.id, intent.id, database, storage);
    throw error;
  };

  if (!isSupportedKnowledgeSourceFilename(intent.originalName)) {
    return reject(new KnowledgeParseError("unsupported_format"));
  }
  if (!isSafeObjectKey(intent.objectKey)) return reject(new KnowledgeParseError("signature_mismatch"));
  if (!Number.isSafeInteger(intent.size) || intent.size <= 0) return reject(new KnowledgeParseError("source_empty"));
  if (intent.size > RIWI_SOURCE_LIMIT_BYTES) return reject(new KnowledgeParseError("source_too_large"));
  const uploadPolicy = validateUploadFile({
    filename: intent.originalName, contentType: intent.mimeType, size: intent.size, category: "file",
  });
  if (!uploadPolicy.ok || intent.mimeType !== canonicalMimeFor(intent.originalName, "file")) {
    return reject(new KnowledgeParseError("signature_mismatch"));
  }

  let bytes: Uint8Array;
  try {
    const head = await storage.head(intent.objectKey);
    if (!head || (typeof head.size === "number" && head.size !== intent.size)
      || (head.contentType && !contentTypesMatch(head.contentType, intent.mimeType))) {
      return reject(new KnowledgeParseError("signature_mismatch"));
    }
    const stored = await storage.readBounded(intent.objectKey, RIWI_SOURCE_LIMIT_BYTES);
    if (!stored) return reject(new KnowledgeParseError("signature_mismatch"));
    if (stored.body.byteLength > RIWI_SOURCE_LIMIT_BYTES) return reject(new KnowledgeParseError("source_too_large"));
    if (stored.body.byteLength !== intent.size) return reject(new KnowledgeParseError("signature_mismatch"));
    bytes = new Uint8Array(stored.body);
  } catch (error) {
    if (error instanceof KnowledgeParseError) throw error;
    throw error;
  }

  const signature = verifySignature(intent.originalName, bytes.slice(0, 4096));
  if (!signature.ok) {
    return reject(new KnowledgeParseError(signature.reason === "executable" ? "dangerous_content" : "signature_mismatch"));
  }

  try {
    const content = await extractKnowledgeText(intent.originalName, bytes);
    const source = await createKnowledgeCandidate({
      actor: input.actor,
      sourceType: input.sourceType,
      title: input.title,
      provenance: input.provenance,
      rightsClass: input.rightsClass,
      scope: input.scope,
      content,
      sourceUpload: { uploadId: intent.id, objectKey: intent.objectKey, checksum: sha256(bytes) },
    }, database);
    return { ...source, sourceChecksum: sha256(bytes) };
  } catch (error) {
    if (error instanceof KnowledgeParseError
      || (error instanceof KnowledgeServiceError && ["invalid_input", "duplicate_source"].includes(error.code))) {
      await discardInvalidUpload(input.actor.id, intent.id, database, storage);
    }
    throw error;
  }
}
