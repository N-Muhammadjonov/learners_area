import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { blockIfOver } from "@/lib/http/rate-limit";
import { heartbeat } from "@/lib/services/presence";
export async function POST(req:NextRequest) {
  if(!checkRequestOrigin(req).allowed) return NextResponse.json({error:"invalid_origin"},{status:403});
  const user=await requireActiveUser();
  if(!user)return NextResponse.json({error:"unauthenticated"},{status:401});
  const blocked=blockIfOver({name:"presence",limit:8,windowMs:60_000},`presence:${user.id}`);
  if(blocked)return blocked;
  await heartbeat(user.id);
  return new NextResponse(null,{status:204,headers:{"Cache-Control":"private, no-store"}});
}
