import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingPassages, readingQuestions } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { NewQuestionForm } from "@/components/admin/NewQuestionForm";
import { ResourceComposer } from "@/components/resources/ResourceComposer";
import { listResourceBlocks, toResourceBlockView } from "@/lib/data/resources";

export default async function AdminPassageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, id) });
  if (!passage) notFound();
  const [questions, materials] = await Promise.all([
    db.query.readingQuestions.findMany({
      where: eq(readingQuestions.passageId, id),
      orderBy: asc(readingQuestions.order),
    }),
    // Materials are ordinary attached blocks; the admin page is where they are
    // written, and the same list is what a student sees while practising.
    listResourceBlocks("reading", id),
  ]);

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

      <ResourceComposer
        dict={dict}
        ownerType="reading"
        ownerId={passage.id}
        initial={toResourceBlockView(materials)}
        title={dict.resources.title}
      />

      <NewQuestionForm dict={dict} passageId={passage.id} />
    </div>
  );
}
