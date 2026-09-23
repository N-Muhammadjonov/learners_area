import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarTopics, grammarExercises } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { NewExerciseForm } from "@/components/admin/NewExerciseForm";

export default async function AdminTopicDetailPage({ params }: { params: { id: string } }) {
  const dict = getDictionary(getLocale());
  const topic = await db.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, params.id) });
  if (!topic) notFound();
  const exercises = await db.query.grammarExercises.findMany({
    where: eq(grammarExercises.topicId, params.id),
    orderBy: asc(grammarExercises.order),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
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
