import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import packs from "../src/lib/video/ted-study-pack.json";
const read=(p:string)=>readFileSync(p,"utf8");
test("TED-MIC-04/15–18 local reflection uses the shared recorder with no network/storage/server path",()=>{
 const component=read("src/components/audio/LocalReflectionRecorder.tsx");
 assert.match(component,/createRecorder\(/);assert.doesNotMatch(component,/new MediaRecorder|fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|caches\.|\/api\/|@\/db|@aws-sdk|transcrib|SpeakingAttempt/);
 assert.match(component,/URL\.createObjectURL\(result\.blob\)/);assert.match(component,/URL\.revokeObjectURL/);
 const schema=read("src/db/schema.ts");assert.doesNotMatch(schema,/ted_voice_recordings|video_summary_audio/);
});
test("TED summary is explicit metadata, never inferred at runtime from English labels",()=>{
 for(const pack of packs){const summary=Object.values(pack.tasks).filter(t=>"kind" in t && t.kind==="summary");assert.equal(summary.length,1);assert.equal(summary[0]!.name,"Summary writing");}
 const source=read("src/components/courses/TedStudyPractice.tsx");assert.match(source,/task\.kind === "summary"/);assert.doesNotMatch(source,/name\.includes|name\.match/);
});
test("TED-MIC-19 written persistence keeps the normal summaryText API, without audio fields",()=>{
 const studio=read("src/components/courses/VideoLessonStudio.tsx");assert.match(studio,/writeLesson\("response", \{ responseText: opinion, summaryText: summary \}\)/);
 const route=read("src/app/api/video-lessons/[id]/response/route.ts");assert.match(route,/summaryText: z\.string/);assert.doesNotMatch(route,/audioUrl|audioBlob|objectKey|voice/);
});
