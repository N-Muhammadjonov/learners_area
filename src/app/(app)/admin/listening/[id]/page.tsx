import { BackLink } from "@/components/ui/BackLink";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningTests, listeningQuestions } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { MaterialPlayer } from "@/components/speaking/MaterialPlayer";
import { ListeningTestActions } from "@/components/listening/ListeningTestActions";
import { fullListeningDetail } from "@/lib/data/full-listening";
import { isUuid } from "@/lib/validation/ids";

export default async function AdminTestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  if (!isUuid(id)) notFound();
  if (await fullListeningDetail(id, administrator.role)) redirect(`/listening/tests/${id}`);
  const dict = getDictionary(await getLocale());
  const test = await db.query.listeningTests.findFirst({ where: eq(listeningTests.id, id) });
  if (!test) notFound();
  const questions = await db.query.listeningQuestions.findMany({
    where: eq(listeningQuestions.testId, id),
    orderBy: asc(listeningQuestions.order),
  });

  return (
    <div className="listening-workspace mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink fallbackHref="/admin/listening" label={dict.common.back} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{test.title}</h1>
        <div className="mt-2">
          <MaterialPlayer url={test.audioUrl} type={test.audioType} openLabel="Open audio" emptyLabel="No audio file uploaded yet." />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {questions.map((q) => (
          <Card key={q.id}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-900">{q.order}. {q.questionText}</span>
              <span className="text-xs text-ink-300">{q.type}</span>
            </div>
            <p className="mt-1 text-xs text-ink-300">Answer: {q.correctAnswer}</p>
          </Card>
        ))}
      </div>

      <ListeningTestActions dict={dict} id={test.id} title={test.title} />
    </div>
  );
}
