import type { ListeningPackage } from "./package";
export type PracticeKind = "matching" | "completion" | "retry";
export function packageActivities(p: ListeningPackage) {
  const authored = p.studyPack?.activities;
  if (authored) return authored.filter(key => key !== "mcq" || p.questions.some(q => q.options.length && q.kind !== "matching"));
  if (p.studyPack) return ["exam","review",...(p.keyword1.length ? ["script"] : []),...(p.questions.some(q => q.options.length) ? ["mcq"] : []),...(p.studyPack.recall.length ? ["recall"] : []),...(p.vocabulary.length ? ["vocab"] : [])];
  return ["exam","review",...(p.keyword1.length ? ["keyword1"] : []),...(p.keyword2.length ? ["keyword2"] : []),...(p.vocabulary.length ? ["vocab"] : [])];
}
export const activityPath: Record<string, string> = { exam:"1",review:"2",script:"3",keyword1:"3",keyword2:"4",recall:"4",vocab:"5",mcq:"mcq",matching:"matching",completion:"completion",retry:"retry" };
