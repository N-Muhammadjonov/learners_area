import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { blockIfOver } from "@/lib/http/rate-limit";
import { refreshPeopleUsernames } from "@/lib/telegram/people-refresh";
export async function POST(req:NextRequest){
 if(!checkRequestOrigin(req).allowed)return NextResponse.json({error:'invalid_origin'},{status:403});
 const actor=await requireAdministrator();if(!actor)return NextResponse.json({error:'forbidden'},{status:403});
 const blocked=blockIfOver({name:'people_contacts_refresh',limit:12,windowMs:60_000},actor.id);if(blocked)return blocked;
 const input=z.object({ids:z.array(z.string().uuid()).max(25)}).safeParse(await req.json().catch(()=>null));
 if(!input.success)return NextResponse.json({error:'invalid_input'},{status:400});
 return NextResponse.json(await refreshPeopleUsernames(input.data.ids),{headers:{'Cache-Control':'private, no-store'}});
}
