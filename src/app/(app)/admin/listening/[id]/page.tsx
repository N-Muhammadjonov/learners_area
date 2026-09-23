import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningTests, listeningQuestions } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { MaterialPlayer } from "@/components/speaking/MaterialPlayer";
import { NewListeningQuestionForm } from "@/components/admin/NewListeningQuestionForm";

export default async function AdminTestDetailPage({ params }: { params: { id: string } }) {
  const dict = getDictionary(getLocale());
  const test = await db.query.listeningTests.findFirst({ where: eq(listeningTests.id, params.id) });
  if (!test) notFound();
  const questions = await db.query.listeningQuestions.findMany({
    where: eq(listeningQuestions.testId, params.id),
    orderBy: asc(listeningQuestions.order),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{test.title}</h1>
        <div className="mt-2">
          <MaterialPlayer url={test.audioUrl} type={test.audioType} openLabel="Open audio" />
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

      <NewListeningQuestionForm dict={dict} testId={test.id} />
    </div>
  );
}
