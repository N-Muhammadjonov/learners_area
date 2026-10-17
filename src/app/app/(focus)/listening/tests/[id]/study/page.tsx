import {listeningSequenceAccess} from "@/lib/data/listening-sequence";
import {ListeningSequenceLocked} from "@/components/listening/ListeningSequenceLocked";
import { hasOriginalListeningRuntime } from "@/lib/listening/original-listening";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { listeningOccurrenceSpans, listeningSegmentSpans } from "@/lib/services/lexical/listening-occurrences";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail, listeningExamState } from "@/lib/data/full-listening";
import { lexicalAssistanceAllowed } from "@/lib/listening/lexical-policy";
import { mapDiagramSections } from "@/lib/listening/activities";
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
  if(!await listeningSequenceAccess(user,id))return <ListeningSequenceLocked dict={getDictionary(await getLocale())}/>;
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  if (hasOriginalListeningRuntime(id,detail.pkg.sourceId)) redirect(`/app/listening/tests/${id}#review`);
  const p = detail.pkg.payload;
  // Study help is available while no full exam attempt is open.
  const lexicalAssistance = lexicalAssistanceAllowed("REVIEW_CONTROL", await listeningExamState(user, id));
  return (
    <FullListeningStudy
      initialSection={Number((await searchParams).section ?? 1)}
      id={id}
      userId={user.id}
      title={detail.test.title}
      audioUrl={detail.test.audioUrl!}
      mapDiagram={p.mapDiagram}
      mapSections={mapDiagramSections(p)}
      imageUrl={
        detail.pkg.imageObjectKey
          ? `/api/resources/${detail.pkg.imageObjectKey}`
          : null
      }
      questions={p.questions.map((q) => ({
        number: q.number,
        section: q.section,
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
      segmentOccurrences={lexicalAssistance ? await listeningSegmentSpans(db, id) : {}}
      dict={getDictionary(await getLocale())}
    />
  );
}
