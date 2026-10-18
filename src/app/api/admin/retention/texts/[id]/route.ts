import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { getRetentionTextDetail, permanentlyDeleteRetentionText, setRetentionTextActive } from "@/lib/data/retention-bank";
import { requireRetentionAdmin } from "@/lib/retention/admin";
import { forbidden, invalidJson, retentionJson } from "@/lib/retention/http";
import { retentionActiveSchema } from "@/lib/validation/retention";

/**
 * GET /api/admin/retention/texts/:id — one text, with the body and the structure.
 *
 * This is the only read that returns the Measurement Structure, and it is behind
 * the admin gate: the rubric is authoring data, never learner data (§93).
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireRetentionAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;

  return retentionJson(async () => {
    const detail = await getRetentionTextDetail(id, db);
    return { ok: true, text: detail };
  });
}

/**
 * PATCH /api/admin/retention/texts/:id — archive or restore.
 *
 * Archive is a separate reversible status operation; permanent deletion is DELETE.
 * Restore is the same call with `active: true`, so undoing a mis-click does not
 * require a new version.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireRetentionAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = retentionActiveSchema.safeParse(body);
  if (!parsed.success) return invalidJson();

  return retentionJson(async () => {
    const result = await setRetentionTextActive({ textId: id, active: parsed.data.active, actorUserId: gate.user.id });
    return { ok: true, ...result };
  });
}

/** Owner-only permanent deletion removes authored content, never scored history. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireRetentionAdmin();
  if (!gate.ok) return gate.response;
  if (gate.user.role !== "owner") return forbidden();
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidJson();
  const expectedLabel = (body as Record<string, unknown>).expectedLabel;
  if (typeof expectedLabel !== "string" || !/^(A2|B1|B2|C1|C2)-[0-9]{3,}$/.test(expectedLabel)) return invalidJson();
  return retentionJson(async () => {
    const result = await permanentlyDeleteRetentionText({ textId: id, expectedLabel, actorUserId: gate.user.id }, db);
    return { ok: true, ...result };
  });
}
