import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail } from "@/lib/data/full-listening";
import { isUuid } from "@/lib/validation/ids";
import { getDictionary, getLocale } from "@/lib/i18n";
import { FullListeningStudy } from "@/components/listening/FullListeningStudy";
export default async function Study({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireActiveUser();
  if (!user) return null;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  const p = detail.pkg.payload;
  return (
    <FullListeningStudy
      id={id}
      userId={user.id}
      title={detail.test.title}
      audioUrl={detail.test.audioUrl!}
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
      dict={getDictionary(await getLocale())}
    />
  );
}
