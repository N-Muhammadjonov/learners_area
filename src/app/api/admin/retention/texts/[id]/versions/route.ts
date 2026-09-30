import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { createRetentionTextVersion } from "@/lib/data/retention-bank";
import { requireRetentionAdmin } from "@/lib/retention/admin";
import { invalidJson, retentionJson } from "@/lib/retention/http";
import { createRetentionVersionSchema } from "@/lib/validation/retention";

/**
 * POST /api/admin/retention/texts/:id/versions — Change.
 *
 * A change never edits v1. It writes v(n+1), moves the current pointer and leaves
 * every past attempt scoring against the version it was assigned (§94, §130).
 *
 * `expectedCurrentVersionId` is required from the editor: if another admin saved
 * in the meantime the answer is `retention_conflict` (409) with the version that
 * is current now, and the editor offers to reload. Saving over a newer version is
 * not an option the API offers.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireRetentionAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = createRetentionVersionSchema.safeParse(body);
  if (!parsed.success) return invalidJson();

  return retentionJson(async () => {
    const created = await createRetentionTextVersion({
      textId: id,
      bodyText: parsed.data.bodyText,
      scoringStructure: parsed.data.scoringStructure,
      expectedCurrentVersionId: parsed.data.expectedCurrentVersionId,
      actorUserId: gate.user.id,
    });
    return { ok: true, ...created };
  });
}
