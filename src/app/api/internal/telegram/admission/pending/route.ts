import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError } from "@/lib/telegram/http";
import { listPendingAccessRequests } from "@/lib/data/admission";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "ADMISSIONS");
  if (!actor.ok) return actorError(actor.error);

  try {
    const requests = await listPendingAccessRequests();
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
    const pageSize = 8;
    const slice = requests.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({
      page,
      pageSize,
      total: requests.length,
      requests: slice.map((row) => ({
        id: row.id,
        userId: row.userId,
        applicantName: row.applicantName,
        applicantEmail: row.applicantEmail,
        applicantRole: row.applicantRole,
        applicantStatus: row.applicantStatus,
        message: row.message,
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    console.error("[telegram] pending list failed");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
