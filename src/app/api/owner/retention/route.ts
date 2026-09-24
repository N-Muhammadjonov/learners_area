import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/current-user";
import { runRetention } from "@/lib/services/retention";

/**
 * POST /api/owner/retention — preview or run the retention policy.
 *
 * A preview is the default: the caller has to ask explicitly for `dryRun: false`
 * before anything is deleted. Both paths are idempotent, and only the owner may
 * call either of them.
 */
const schema = z.object({ dryRun: z.boolean().default(true) });

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  const dryRun = parsed.success ? parsed.data.dryRun : true;

  const result = await runRetention({ dryRun, actorUserId: owner.id });
  return NextResponse.json({
    ok: true,
    dryRun: result.dryRun,
    config: result.config,
    results: result.results,
  });
}
