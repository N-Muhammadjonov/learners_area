import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforce } from '@/lib/http/rate-limit';
import { requireActiveUser } from '@/lib/auth/current-user';
import { fullListeningDetail } from '@/lib/data/full-listening';
import { originalListeningState, saveOriginalListeningState } from '@/lib/data/listening-original-state';
import { hasOriginalListeningRuntime, originalListeningStorageKey } from '@/lib/listening/original-listening';
import { isUuid } from '@/lib/validation/ids';
import { db } from '@/db/client';
const headers = {'Cache-Control':'private, no-store'};
const schema = z.record(z.string().max(100),z.string().max(100000)).refine(v=>JSON.stringify(v).length<=100000);
async function context(id:string) {
  const user = await requireActiveUser();
  if (!user) return {response:NextResponse.json({error:'unauthenticated'},{status: 401,headers})};
  if (!isUuid(id)) return {response:NextResponse.json({error:'not_found'},{status:404,headers})};
  const detail = await fullListeningDetail(id,user.role);
  return detail && hasOriginalListeningRuntime(id,detail.pkg.sourceId) ? {user,detail} : {response:NextResponse.json({error:'not_found'},{status:404,headers})};
}
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const ctx=await context(id);
  if ('response' in ctx) return ctx.response;
  return NextResponse.json({values:await originalListeningState(ctx.user.id,id,db,originalListeningStorageKey(ctx.detail.pkg.sourceId))},{headers});
}
export async function PUT(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const ctx=await context(id);
  if ('response' in ctx) return ctx.response;
  const limited=enforce({name:'listening_authored_state',limit:240,windowMs:60000},ctx.user.id);if(limited)return limited;
  const parsed=schema.safeParse(await req.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:'invalid_input'},{status:400,headers});
  try {
    return NextResponse.json(await saveOriginalListeningState(ctx.user.id,id,parsed.data,ctx.detail.pkg.payload),{headers});
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error && error.message==='invalid_answers') return NextResponse.json({error:'invalid_input'},{status:400,headers});
    console.error('[listening-original-state] save failed',{testId:id});
    return NextResponse.json({error:'save_failed'},{status:503,headers});
  }
}
