import { Suspense } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getTopicMasteryFor, getTopicWithExercises } from "@/lib/data/grammar";
import { db } from "@/db/client";
import { writingSubmissions } from "@/db/schema";
import { GrammarQuiz } from "@/components/grammar/GrammarQuiz";
import { PracticeActivities } from "@/components/grammar/PracticeActivities";
import { TopicMasteryCard } from "@/components/grammar/TopicMasteryCard";
import { isUuid } from "@/lib/validation/ids";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import { listResourceBlocks, toResourceBlockView } from "@/lib/data/resources";

async function GrammarMaterials({ blocksPromise, dict }: {
  blocksPromise: Promise<
    | { ok: true; blocks: Awaited<ReturnType<typeof listResourceBlocks>> }
    | { ok: false }
  >;
  dict: ReturnType<typeof getDictionary>;
}) {
  const result = await blocksPromise;
  if (!result.ok) return <RegionFailureNotice region="grammar-materials" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />;
  return <ResourceBlocks dict={dict} blocks={toResourceBlockView(result.blocks)} />;
}

function GrammarMaterialsSkeleton() {
  return <div aria-hidden="true" className="h-16 animate-pulse rounded-xl bg-ink-50" data-async-loading="grammar-materials" />;
}

export default async function GrammarTopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(topicId)) notFound();
  const blocksPromise = listResourceBlocks("grammar", topicId).then(
    (blocks) => ({ ok: true as const, blocks }),
    () => ({ ok: false as const }),
  );
  const [detail, topicMastery] = await Promise.all([
    getTopicWithExercises(topicId, user.id),
    getTopicMasteryFor(user.id, topicId),
  ]);
  if (!detail) notFound();
  const { topic, exercises } = detail;
  const { mastery } = topicMastery;

  const sourceIds = exercises.map((e) => e.sourceSubmissionId).filter((id): id is string => !!id);
  const ownedSourceIds = new Set(
    sourceIds.length
      ? (
          await db.select({ id: writingSubmissions.id })
            .from(writingSubmissions)
            .where(and(eq(writingSubmissions.userId, user.id), inArray(writingSubmissions.id, sourceIds)))
        )
          .map((submission) => submission.id)
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
      <Suspense fallback={<GrammarMaterialsSkeleton />}>
        <GrammarMaterials blocksPromise={blocksPromise} dict={dict} />
      </Suspense>

      {exercises.length === 0 ? <EmptyState title={dict.grammar.noExercises}
        action={<Link href="/grammar" className="text-sm text-signal-600 underline">{dict.grammar.backToTopics}</Link>} /> : <>
      {topicMastery.unavailable ? (
        <RegionFailureNotice region="grammar-topic-mastery" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />
      ) : mastery && <TopicMasteryCard dict={dict} mastery={mastery} />}

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
      </>}
    </div>
  );
}
