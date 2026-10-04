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
 try{const detail=await fullListeningDetail(id,user.role);const runtime=detail?.pkg.payload.authoredRuntime;
 if(!detail||!runtime)return NextResponse.json({error:'not_found'},{status:404,headers});
 return NextResponse.json({runtime,audioUrl:detail.test.audioUrl,audioPath:detail.pkg.payload.audio.path,imageUrl:detail.pkg.imageObjectKey?`/api/resources/${detail.pkg.imageObjectKey}`:null,imagePath:detail.pkg.payload.imagePath,vocabulary:await listeningVocabularySession(db,id,detail.pkg.payload.vocabulary)},{headers});
 }catch{return NextResponse.json({error:'temporarily_unavailable'},{status:503,headers});}
}
