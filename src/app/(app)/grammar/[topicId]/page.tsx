import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getTopicWithExercises } from "@/lib/data/grammar";
import { db } from "@/db/client";
import { writingSubmissions } from "@/db/schema";
import { GrammarQuiz } from "@/components/grammar/GrammarQuiz";

export default async function GrammarTopicPage({ params }: { params: { topicId: string } }) {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());

  const detail = await getTopicWithExercises(params.topicId);
  if (!detail) notFound();
  const { topic, exercises } = detail;

  const sourceIds = exercises.map((e) => e.sourceSubmissionId).filter((id): id is string => !!id);
  const ownedSourceIds = new Set(
    sourceIds.length
      ? (
          await db.query.writingSubmissions.findMany({
            where: eq(writingSubmissions.userId, session.sub),
          })
        )
          .map((s) => s.id)
          .filter((id) => sourceIds.includes(id))
      : []
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/grammar" className="text-sm text-signal-600 hover:underline">
          ← {dict.grammar.backToTopics}
        </Link>
        <h1 className="mt-2 font-display text-2xl text-ink-900">{topic.title}</h1>
        <p className="text-sm text-ink-500">{topic.explanation}</p>
      </div>
      <GrammarQuiz
        dict={dict}
        topicId={topic.id}
        exercises={exercises.map((e) => ({
          id: e.id,
          order: e.order,
          promptText: e.promptText,
          options: e.options,
          fromEssay: !!e.sourceSubmissionId && ownedSourceIds.has(e.sourceSubmissionId),
        }))}
      />
    </div>
  );
}
