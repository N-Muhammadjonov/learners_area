import { BackLink } from "@/components/ui/BackLink";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarTopics, grammarExercises } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { NewExerciseForm } from "@/components/admin/NewExerciseForm";

export default async function AdminTopicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  const topic = await db.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, id) });
  if (!topic) notFound();
  const exercises = await db.query.grammarExercises.findMany({
    where: eq(grammarExercises.topicId, id),
    orderBy: asc(grammarExercises.order),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink fallbackHref="/admin/grammar" label={dict.common.back} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{topic.title}</h1>
        <p className="text-sm text-ink-500">{topic.explanation}</p>
      </div>

      <div className="flex flex-col gap-2">
        {exercises.map((ex) => (
          <Card key={ex.id}>
            <p className="text-sm font-medium text-ink-900">{ex.order}. {ex.promptText}</p>
            <p className="mt-1 text-xs text-band-good">Correct: {ex.correctOption}</p>
          </Card>
        ))}
      </div>

      <NewExerciseForm dict={dict} topicId={topic.id} />
    </div>
  );
}
