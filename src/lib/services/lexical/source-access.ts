import "server-only";
import { readingSourceAccess } from "./context";
import { retentionVocabularyAccess } from "./retention-occurrences";
import { fullListeningDetail, listeningExamState } from "@/lib/data/full-listening";
import { listeningProductOf } from "@/lib/data/listening-product";
import { lexicalAssistanceAllowed, modeForListeningProduct } from "@/lib/listening/lexical-policy";
import type { Role } from "@/lib/auth/roles";

/** A fallback cannot turn Academic into General or reopen a hidden text. */
export async function textDictionaryAccess(user:{id:string;role:Role},sourceType:string,sourceId:string) {
  if (sourceType==="reading") return readingSourceAccess(user,sourceId);
  if (sourceType==="retention") {
    const access=await retentionVocabularyAccess(user.id,sourceId);
    return !access ? "not_found" : access.locked ? "locked" : "allowed";
  }
  if (sourceType!=="listening") return "not_found";
  if (!(await fullListeningDetail(sourceId,user.role))) return "not_found";
  return lexicalAssistanceAllowed(modeForListeningProduct((await listeningProductOf(sourceId))??"unclassified"),await listeningExamState(user,sourceId)) ? "allowed" : "locked";
}
