import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingPassages, readingQuestions } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { NewQuestionForm } from "@/components/admin/NewQuestionForm";

export default async function AdminPassageDetailPage({ params }: { params: { id: string } }) {
  const dict = getDictionary(getLocale());
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, params.id) });
  if (!passage) notFound();
  const questions = await db.query.readingQuestions.findMany({
    where: eq(readingQuestions.passageId, params.id),
    orderBy: asc(readingQuestions.order),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{passage.title}</h1>
        <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-line text-sm text-ink-500">{passage.bodyText}</p>
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

      <NewQuestionForm dict={dict} passageId={passage.id} />
    </div>
  );
}
