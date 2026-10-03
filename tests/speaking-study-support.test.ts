import test from "node:test";
import assert from "node:assert/strict";
import { cleanStudyHtml } from "../src/lib/speaking/rich-text";
import { studySupportSchema, speakingPromptDraft } from "../src/lib/speaking/study-support";
import { listeningStudySegments } from "../src/lib/listening/study-segments";
import { listeningPackageSchema, publicationIssues } from "../src/lib/listening/package";
import { lexicalAssistanceAllowed } from "../src/lib/listening/lexical-policy";

test("rich Speaking paste preserves fonts, emphasis, highlights and lists while stripping active content and remote resources", () => {
  const html = cleanStudyHtml('<p style="font-family: Georgia; font-size: 20px; color:#124a30; background-image:url(https://evil.invalid/a)"><strong>word</strong> <em>meaning</em> <mark>idea</mark></p><ul><li>Point</li></ul><font face="Times New Roman" color="#123456">Example</font><img src="https://evil.invalid/a" onerror="alert(1)"><script>steal()</script><iframe src="https://evil.invalid"></iframe><span onclick="steal()" style="position:fixed">safe</span>');
  assert.match(html, /font-family:Georgia/); assert.match(html, /font-size:20px/);
  for (const tag of ["strong", "em", "mark", "ul", "li", "font"]) assert.ok(html.includes(`<${tag}`));
  assert.doesNotMatch(html, /evil|onerror|onclick|script|iframe|position|background-image|steal/);
  assert.equal(cleanStudyHtml(html), html);
});
test("Speaking support is optional, vocabulary definitions are authored, and save payloads cannot select unknown modules", () => {
  assert.deepEqual(studySupportSchema.parse({}), { vocabularyHtml: "", modelAnswerHtml: "", ideasHtml: "", vocabulary: [] });
  assert.equal(studySupportSchema.safeParse({ vocabulary: [{ term: "bank" }] }).success, false);
  const draft = { part: "part1", topic: "Work", promptText: "Do you work?", availableIn: ["practice_alone"], studySupport: {} };
  assert.equal(speakingPromptDraft.safeParse(draft).success, true);
  assert.equal(speakingPromptDraft.safeParse({ ...draft, availableIn: ["forged"] }).success, false);
});
test("prepared Listening with one section/question and no transcript or drills can publish; invalid references still fail", () => {
  const p = listeningPackageSchema.parse({ schemaVersion:1, testId:"one-question", title:"One", category:"full", provenance:"Authored source", audio:{path:"audio.mp3",durationSec:60}, imagePath:null,
    sections:[{number:1,title:"One",reviewRequired:true}], questions:[{number:1,section:1,text:"Name?",instruction:"",options:[],key:"Alice",alternatives:[],pair:[],evidence:{at:0,why:""}}],keyword1:[],keyword2:[],vocabulary:[] });
  assert.deepEqual(publicationIssues(p), []);
  assert.equal(listeningPackageSchema.safeParse({...p,questions:[{...p.questions[0],section:2}]}).success, false);
  assert.equal(listeningPackageSchema.safeParse({...p,audio:{...p.audio,path:"../private.mp3"}}).success, false);
});
test("Listening drill context keys are independent, and all non-exam modes help outside an open exam", () => {
  const segments = listeningStudySegments({sections:[{number:1,title:"One",transcript:"A bank.",reviewRequired:false}],questions:[], keyword1:[{q:1,text:"bank",heard:"river bank",link:"edge",at:0,end:1}],keyword2:[]});
  assert.deepEqual(segments.map(s => s.key), ["s1", "k1:1:text", "k1:1:heard", "k1:1:link"]);
  const state = { submitted:false,staff:false,examInProgress:false };
  for (const mode of ["REVIEW_CONTROL","KEYWORD_PRACTICE","VOCABULARY_STUDY"] as const) {
    assert.equal(lexicalAssistanceAllowed(mode,state), true);
    assert.equal(lexicalAssistanceAllowed(mode,{...state,examInProgress:true}), false);
  }
  assert.equal(lexicalAssistanceAllowed("FULL_EXAM",state), false);
});
