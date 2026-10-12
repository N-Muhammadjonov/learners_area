import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/current-user";
import { AiControlError, ownerAiStatus, setOwnerAiControl } from "@/lib/services/coach/owner-control";

export const dynamic = "force-dynamic";

/**
 * Owner master switch for external AI.
 *  GET  → safe status (no secret values, keys or endpoint URLs).
 *  POST → { externalEnabled, providerId } — provider must already be REGISTERED
 *         server-side; no endpoint, key or URL is accepted from a request.
 * OWNER only (role read from the database); origin is checked by middleware;
 * every change is an audit_log record.
 */
const schema = z.object({
  externalEnabled: z.boolean(),
  providerId: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,31}$/).nullable(),
  // A model identifier only; owner-control validates it with MODEL_ID.
  model: z.string().trim().max(100).nullable().optional(),
  fallback: z.enum(["riwi", "none"]).optional(),
}).strict();

export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  return NextResponse.json(await ownerAiStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input" } }, { status: 400 });
  try {
    await setOwnerAiControl(owner.id, parsed.data);
  } catch (error) {
    if (error instanceof AiControlError) return NextResponse.json({ error: { code: error.code } }, { status: 400 });
    return NextResponse.json({ error: { code: "save_failed", retryable: true } }, { status: 503 });
  }
  return NextResponse.json(await ownerAiStatus(), { headers: { "Cache-Control": "no-store" } });
}
