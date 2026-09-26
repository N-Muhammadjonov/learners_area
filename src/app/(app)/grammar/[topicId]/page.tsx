import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getTopicMasteryFor, getTopicWithExercises } from "@/lib/data/grammar";
import { db } from "@/db/client";
import { writingSubmissions } from "@/db/schema";
import { GrammarQuiz } from "@/components/grammar/GrammarQuiz";
import { PracticeActivities } from "@/components/grammar/PracticeActivities";
import { TopicMasteryCard } from "@/components/grammar/TopicMasteryCard";
import { isUuid } from "@/lib/validation/ids";

export default async function GrammarTopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(topicId)) notFound();
  const detail = await getTopicWithExercises(topicId);
  if (!detail) notFound();
  const { topic, exercises } = detail;
  const { mastery } = await getTopicMasteryFor(user.id, topicId);

  const sourceIds = exercises.map((e) => e.sourceSubmissionId).filter((id): id is string => !!id);
  const ownedSourceIds = new Set(
    sourceIds.length
      ? (
          await db.query.writingSubmissions.findMany({
            where: eq(writingSubmissions.userId, user.id),
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
      <TopicMasteryCard dict={dict} mastery={mastery} />

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

      <PracticeActivities
        dict={dict}
        exercises={exercises.map((e) => ({
          id: e.id,
          order: e.order,
          promptText: e.promptText,
          translatePromptUz: e.translatePromptUz,
          targetStructures: e.targetStructures ?? [],
          activationPrompt: e.activationPrompt,
        }))}
      />
    </div>
  );
}
