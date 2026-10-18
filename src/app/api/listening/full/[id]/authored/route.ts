import {listeningSequenceAccess} from "@/lib/data/listening-sequence";
import { originalListeningRuntime, originalListeningDefinition } from "@/lib/listening/original-listening";
import {NextRequest,NextResponse} from 'next/server';
import {requireActiveUser} from '@/lib/auth/current-user';
import {fullListeningDetail} from '@/lib/data/full-listening';
import {isUuid} from '@/lib/validation/ids';
import {listeningVocabularySession} from '@/lib/services/lexical/listening-occurrences';
import {db} from '@/db/client';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
/** JSON only, never a same-origin HTML execution endpoint. */
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const user=await requireActiveUser();if(!user)return NextResponse.json({error:'unauthenticated'},{status: 401,headers});
 const {id}=await params;if(!isUuid(id))return NextResponse.json({error:'not_found'},{status:404,headers});
 try{if(!await listeningSequenceAccess(user,id))return NextResponse.json({error:'sequence_locked'},{status:403,headers:{'Cache-Control':'private, no-store'}});const detail=await fullListeningDetail(id,user.role);
 if(req.nextUrl.searchParams.get('vocabulary')==='1'){
  if(!detail)return NextResponse.json({error:'not_found'},{status:404,headers});
  return NextResponse.json({vocabulary:await listeningVocabularySession(db,id,detail.pkg.payload.vocabulary)},{headers});
 }
 const definition=detail?originalListeningDefinition(id,detail.pkg.sourceId):null;const original=!!definition;const runtime=original?await originalListeningRuntime(id,detail!.pkg.sourceId):detail?.pkg.payload.authoredRuntime;
 if(!detail||!runtime)return NextResponse.json({error:'not_found'},{status:404,headers});
 // Vocabulary enrichment is optional UI metadata. A stale lexical row or a
 // temporarily unavailable enrichment table must never take the authored test,
 // its audio, or its saved runtime offline.
 return NextResponse.json({course:null,runtime,audioUrl:`/api/resources/${detail.pkg.audioObjectKey}?download=1`,nativePersistence:original,storageKey:definition?.storageKey,additionalAudio:definition?.media.slice(1).filter(m=>m.contentType.startsWith("audio/")).map(m=>({path:m.path,url:`/api/resources/${m.objectKey}?download=1`}))??[],audioPath:definition?.media[0]?.path??detail.pkg.payload.audio.path,imageUrl:detail.pkg.imageObjectKey?`/api/resources/${detail.pkg.imageObjectKey}?download=1`:null,imagePath:detail.pkg.payload.imagePath,vocabulary:[]},{headers});
 }catch{return NextResponse.json({error:'temporarily_unavailable'},{status:503,headers});}
}
