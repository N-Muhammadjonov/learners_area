import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail, fullListeningProgress, listeningExamState } from "@/lib/data/full-listening";
import { db } from "@/db/client";
import { listeningActivityRuns } from "@/db/schema";
import { gradePackage } from "@/lib/listening/package";
import { getAttemptDetail } from "@/lib/data/listening";
import { isUuid } from "@/lib/validation/ids";
import { enforce } from "@/lib/http/rate-limit";
const input = z.object({ kind:z.enum(["matching","completion","retry"]), answers:z.record(z.string().regex(/^\d{1,2}$/),z.string().max(500)), complete:z.boolean() });
export async function POST(req: NextRequest, context: { params: Promise<{ id:string }> }) {
 try { return await handle(req, context); } catch { return NextResponse.json({error:"practice_unavailable"},{status: 503,headers:{"Cache-Control":"private, no-store"}}); }
}
async function handle(req: NextRequest, { params }: { params: Promise<{ id:string }> }) {
 const user=await requireActiveUser(); if(!user) return NextResponse.json({error:"unauthenticated"},{status: 401});
 const limited=enforce({name:"listening_practice",limit:120,windowMs:60_000},user.id);if(limited)return limited;
 const {id}=await params; if(!isUuid(id)) return NextResponse.json({error:"not_found"},{status: 404});
 const detail=await fullListeningDetail(id,user.role); if(!detail) return NextResponse.json({error:"not_found"},{status: 404});
 if((await listeningExamState(user,id)).examInProgress) return NextResponse.json({error:"exam_in_progress"},{status: 409});
 const parsed=input.safeParse(await req.json().catch(()=>null)); if(!parsed.success) return NextResponse.json({error:"invalid_input"},{status: 400});
 const {kind,answers,complete}=parsed.data, p=detail.pkg.payload;
 if(!p.studyPack?.activities?.includes(kind)) return NextResponse.json({error:"not_found"},{status: 404});
 let questions=p.questions.filter(q=>q.kind===kind);
 if(kind==="retry") { const progress=await fullListeningProgress(user.id,id); const report=progress.exam ? await getAttemptDetail(progress.exam.id,user.id) : null; const missed=new Set(report?.answers.filter(a=>a.isCorrect===false).map(a=>report.questions.find(q=>q.id===a.questionId)?.order)); questions=p.questions.filter(q=>missed.has(q.number)); }
 const ids=questions.map(q=>String(q.number));
 if(!ids.length||!Object.keys(answers).length||Object.keys(answers).some(key=>!ids.includes(key))||(complete&&ids.some(key=>!answers[key]?.trim()))) return NextResponse.json({error:"invalid_questions"},{status: 400});
 const results=gradePackage(p,answers).filter(q=>Object.hasOwn(answers,String(q.number)));
 const score=results.filter(q=>q.correct).length;
 await db.insert(listeningActivityRuns).values({userId:user.id,testId:id,activity:4,answers:{...answers,_practice:kind},completed:complete,score,total:ids.length});
 return NextResponse.json({ok:true,score,total:ids.length,results:results.map(row=>({...row,key:p.questions.find(q=>q.number===row.number)!.key,evidence:p.questions.find(q=>q.number===row.number)!.evidence.why}))},{headers:{"Cache-Control":"private, no-store"}});
}
