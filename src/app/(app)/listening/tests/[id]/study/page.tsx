import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listeningOccurrenceSpans } from "@/lib/services/lexical/listening-occurrences";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail, listeningExamState } from "@/lib/data/full-listening";
import { lexicalAssistanceAllowed } from "@/lib/listening/lexical-policy";
import { isUuid } from "@/lib/validation/ids";
import { getDictionary, getLocale } from "@/lib/i18n";
import { FullListeningStudy } from "@/components/listening/FullListeningStudy";
export default async function Study({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const user = await requireActiveUser();
  if (!user) return null;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  const p = detail.pkg.payload;
  // Controlled practice is a study surface: lexical help only after the exam was
  // submitted and while no exam attempt is open (exam integrity).
  const lexicalAssistance = lexicalAssistanceAllowed("REVIEW_CONTROL", await listeningExamState(user, id));
  return (
    <FullListeningStudy
      initialSection={Number((await searchParams).section ?? 1)}
      id={id}
      userId={user.id}
      title={detail.test.title}
      audioUrl={detail.test.audioUrl!}
      mapDiagram={p.mapDiagram}
      imageUrl={
        detail.pkg.imageObjectKey
          ? `/api/resources/${detail.pkg.imageObjectKey}`
          : null
      }
      questions={p.questions.map((q) => ({
        number: q.number,
        text: q.text,
        instruction: q.instruction,
        options: q.options,
      }))}
      sections={p.sections.map((s) => ({
        number: s.number,
        title: s.title,
        transcript: s.transcript,
      }))}
      lexicalAssistance={lexicalAssistance}
      occurrences={lexicalAssistance ? await listeningOccurrenceSpans(db, id) : {}}
      dict={getDictionary(await getLocale())}
    />
  );
}
