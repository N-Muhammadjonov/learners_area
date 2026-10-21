import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { textDictionaryAccess } from "@/lib/services/lexical/source-access";
import { textDictionaryMeanings } from "@/lib/dictionary/text-meanings";
import { isUuid } from "@/lib/validation/ids";
import { consume, RULES } from "@/lib/http/rate-limit";
const headers = { "Cache-Control": "private, no-store" };

/** Checked occurrences use /lookup. Other words open exact dictionary choices. */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  const sourceType=req.nextUrl.searchParams.get("sourceType")??"listening";
  const sourceId=req.nextUrl.searchParams.get("sourceId")??"";
  const term=(req.nextUrl.searchParams.get("q")??"").trim();
  if (!isUuid(sourceId)||!["reading","listening","retention"].includes(sourceType)||!term||term.length>80)
    return NextResponse.json({error:"invalid_input"},{status:400,headers});
  const limit=consume(RULES.vocabularySearch,"text-dictionary:"+user.id);
  if (!limit.ok) return NextResponse.json({error:"rate_limited"},{status:429,headers:{...headers,"Retry-After":String(limit.retryAfterSeconds)}});
  try {
    const access=await textDictionaryAccess(user,sourceType,sourceId);
    if(access!=="allowed")return NextResponse.json({error:access==="locked"?"lexical_assistance_locked":"source_not_found"},{status:access==="locked"?403:404,headers});
    return NextResponse.json({status:"dictionary",contextual:null,...await textDictionaryMeanings(term)},{headers});
  } catch {
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers });
  }
}
