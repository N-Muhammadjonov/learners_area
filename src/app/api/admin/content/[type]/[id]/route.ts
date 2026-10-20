import { NextRequest, NextResponse } from "next/server";
import { actorOf, requireStaff } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { isUuid } from "@/lib/validation/ids";
import { canDeleteMaterialType, deleteMaterial } from "@/lib/content/delete-material";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{type: string; id: string}> }) {
  if (!checkRequestOrigin(req).allowed) return NextResponse.json({error:"invalid_origin"},{status:403});
  const user = await requireStaff();
  if (!user) return NextResponse.json({error:"forbidden"},{status:403});
  const { type, id } = await params;
  if (!canDeleteMaterialType(type) || !isUuid(id)) return NextResponse.json({error:"not_found"},{status:404});
  const action = await deleteMaterial(actorOf(user), type, id);
  return NextResponse.json(action === "deleted" ? {ok:true,action,resultsPreserved:true} : {error:action},
    {status:action === "forbidden" ? 403 : action === "not_found" ? 404 : 200,headers:{"Cache-Control":"private, no-store"}});
}
