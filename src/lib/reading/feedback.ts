import "server-only";
import {createHash} from "node:crypto";
import supplement from "../../../content/reading/feedback-supplement.json";
import type {readingQuestions} from "@/db/schema";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
type Question=typeof readingQuestions.$inferSelect;
const patches=supplement.questions as Record<string,{passageId:string;bodySha:string;questionSha:string;quote:string;explanation:string}>;
import {isUnstatedAnswer} from "./unstated";

/** Display-only feedback: exact source excerpts and the unchanged server key.
 * Authored explanations win. Supplements cannot survive a source/key edit and
 * never change attempts, answers, grading, publication or lexical identity. */
export function withReadingFeedback<T extends Question>(questions:T[],body:string):T[] {
 const bodySha=hash(body);
 return questions.map(q=>{
  const patch=patches[q.id];
  const valid=!!patch && patch.passageId===q.passageId && patch.bodySha===bodySha && patch.questionSha===hash(q.questionText+"\n"+q.correctAnswer) && body.includes(patch.quote);
  const evidenceQuote=q.evidenceQuote?.trim() ? q.evidenceQuote : valid ? patch.quote : null;
  const explanation=q.explanation?.trim() ? q.explanation : valid ? patch.explanation : defaultExplanation(q,evidenceQuote && body.includes(evidenceQuote) ? evidenceQuote : null);
  const evidenceType = !q.evidenceQuote?.trim() && valid ? "source_marker" as const : q.evidenceType;
  return {...q,evidenceQuote,explanation,evidenceType};
 });
}
function defaultExplanation(q:Question,quote:string|null) {
 if(isUnstatedAnswer(q.correctAnswer)) return "The passage does not state the detail needed to confirm or contradict this claim. Related facts are insufficient; do not infer an answer from outside knowledge.";
 if(!quote) return "";
 const answer=q.correctAnswer.trim().replaceAll("_"," ").toUpperCase();
 if(["TRUE","YES"].includes(answer))return `The quoted evidence agrees with the statement in this question. This supports the answer ${answer}.`;
 if(["FALSE","NO"].includes(answer))return `Compare the claim in the question with the quoted evidence: the information contradicts the claim, so the answer is ${answer}.`;
 if(q.type==="short_answer")return `The quoted section supplies the information needed for this gap. Use the answer ${q.correctAnswer}, following the question's word or choice limit.`;
 return `The quoted section is the source of the match. It supports the stored choice ${q.correctAnswer}; compare its meaning with the other options.`;
}
