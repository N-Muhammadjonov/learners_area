import { originalTestOneRuntime, usesOriginalTestOne } from "@/lib/listening/original-test-one";
import {NextRequest,NextResponse} from 'next/server';
import {requireActiveUser} from '@/lib/auth/current-user';
import {fullListeningDetail} from '@/lib/data/full-listening';
import {isUuid} from '@/lib/validation/ids';
import {listeningVocabularySession} from '@/lib/services/lexical/listening-occurrences';
import {db} from '@/db/client';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
/** JSON only, never a same-origin HTML execution endpoint. */
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const user=await requireActiveUser();if(!user)return NextResponse.json({error:'unauthenticated'},{status: 401,headers});
 const {id}=await params;if(!isUuid(id))return NextResponse.json({error:'not_found'},{status:404,headers});
 try{const detail=await fullListeningDetail(id,user.role);const original=!!detail && usesOriginalTestOne(id,detail.pkg.sourceId);const runtime=original?await originalTestOneRuntime():detail?.pkg.payload.authoredRuntime;
 if(!detail||!runtime)return NextResponse.json({error:'not_found'},{status:404,headers});
 // Vocabulary enrichment is optional UI metadata. A stale lexical row or a
 // temporarily unavailable enrichment table must never take the authored test,
 // its audio, or its saved runtime offline.
 let vocabulary=[] as Awaited<ReturnType<typeof listeningVocabularySession>>;
 try{vocabulary=await listeningVocabularySession(db,id,detail.pkg.payload.vocabulary);}
 catch(err){console.warn('[listening-authored] vocabulary enrichment unavailable',{testId:id,error:err instanceof Error?err.message:String(err)});}
 return NextResponse.json({runtime,audioUrl:`/api/resources/${detail.pkg.audioObjectKey}?download=1`,nativePersistence:original,audioPath:original?"audio/full.mp3":detail.pkg.payload.audio.path,imageUrl:detail.pkg.imageObjectKey?`/api/resources/${detail.pkg.imageObjectKey}`:null,imagePath:detail.pkg.payload.imagePath,vocabulary},{headers});
 }catch{return NextResponse.json({error:'temporarily_unavailable'},{status:503,headers});}
}
