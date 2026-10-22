import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { RULES, consume } from "@/lib/http/rate-limit";
import { privateHeaders } from "@/lib/dictionary/api";
import { pinnedRelease, searchDictionary } from "@/lib/dictionary/store";
import { searchContent } from "@/lib/search/content";
import { navigationSearch, rankSearchHits, type SearchHit } from "@/lib/search/navigation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({error:"unauthenticated"},{status:401,headers:privateHeaders});
  const limited=consume(RULES.vocabularySearch,`global-search:${user.id}`);
  if (!limited.ok) return NextResponse.json({error:"rate_limited"},{status:429,headers:{...privateHeaders,"Retry-After":String(limited.retryAfterSeconds)}});
  const query=(req.nextUrl.searchParams.get("q")??"").trim().slice(0,64);
  if(query.length<2)return NextResponse.json({query,results:[],tooShort:true},{headers:privateHeaders});
  const dict=getDictionary(await getLocale());
  const navigation=navigationSearch(query,dict);
  const [content,dictionary]=await Promise.allSettled([
    searchContent(query,user.id),
    (async ():Promise<SearchHit[]>=>{
      const release=await pinnedRelease();
      const hits=await Promise.all([searchDictionary(query,"EN",release),searchDictionary(query,"UZ",release)]);
      const seen=new Set<string>();
      return hits.flatMap((items,index)=>items.slice(0,5).filter(hit=>{
        if(seen.has(hit.lexeme_id))return false;seen.add(hit.lexeme_id);return true;
      }).map(hit=>({type:"dictionary",title:hit.display_lemma,context:hit.translation_uz,href:`/app/vocabulary?${new URLSearchParams({tab:"dictionary",q:query,direction:index?"UZ":"EN",entry:hit.lexeme_id})}`})));
    })(),
  ]);
  const partial=content.status==="rejected"||content.value.failedCategories>0||dictionary.status==="rejected";
  const results=rankSearchHits([...navigation,...(content.status==="fulfilled"?content.value.results:[]),...(dictionary.status==="fulfilled"?dictionary.value:[])],query);
  // An outage is not an empty successful search. Working categories stay usable.
  if(partial&&!results.length)return NextResponse.json({error:"search_unavailable"},{status:503,headers:privateHeaders});
  return NextResponse.json({query,results,partial},{headers:privateHeaders});
}
