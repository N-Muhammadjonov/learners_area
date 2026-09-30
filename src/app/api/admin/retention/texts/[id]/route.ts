import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { getRetentionTextDetail, setRetentionTextActive } from "@/lib/data/retention-bank";
import { requireRetentionAdmin } from "@/lib/retention/admin";
import { invalidJson, retentionJson } from "@/lib/retention/http";
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
 * "Delete" in the owner's words. The row is never removed: attempts, scores and
 * versions keep pointing at it, and it simply stops being handed to learners.
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
