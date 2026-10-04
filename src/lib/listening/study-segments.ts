import type { ListeningPackage } from "./package";
export type ListeningStudySegment = { key: string; section: number; text: string };
/** Stable keys separate transcript, question and drill offsets in the same source. */
export function listeningStudySegments(payload: Pick<ListeningPackage, "sections"> & Partial<Pick<ListeningPackage, "questions" | "keyword1" | "keyword2" | "vocabulary">>): ListeningStudySegment[] {
  const sectionFor = (number: number) => payload.questions?.find(q => q.number === number)?.section ?? payload.sections[0]?.number ?? 1;
  return [
    ...payload.sections.map(s => ({ key: `s${s.number}`, section: s.number, text: s.transcript })),
    ...(payload.questions ?? []).flatMap(q => [{ key: `q${q.number}:text`, section: q.section, text: q.text }, { key: `q${q.number}:why`, section: q.section, text: q.evidence.why }, ...q.options.map((text, index) => ({ key: `q${q.number}:option:${index}`, section: q.section, text }))]),
    ...(payload.keyword1 ?? []).flatMap(row => ["text", "heard", "link"].map(field => ({ key: `k1:${row.q}:${field}`, section: row.part ?? sectionFor(row.sourceQuestion ?? row.q), text: row[field as "text" | "heard" | "link"] }))),
    ...(payload.vocabulary ?? []).map((row, index) => ({ key: `v:${index}:example`, section: payload.sections[0]?.number ?? 1, text: row.ex })),
    ...(payload.keyword2 ?? []).flatMap(row => ["heard", "link"].map(field => ({ key: `k2:${row.q}:${field}`, section: row.part ?? sectionFor(row.sourceQuestion ?? row.q), text: row[field as "heard" | "link"] }))),
  ];
}
