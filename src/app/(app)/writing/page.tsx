import { requireActiveUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePromptsWithResources, typingSummary } from "@/lib/data/writing";
import { timed } from "@/lib/observability/timing";
import { Card } from "@/components/ui/Card";
import { StartPromptButton } from "@/components/writing/StartPromptButton";
import { TypingTrainer } from "@/components/writing/TypingTrainer";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";

export default async function WritingPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;

  const dict = getDictionary(locale);
  const [{ prompts, materials }, typing] = await Promise.all([
    timed("writing.promptsAndResources", listActivePromptsWithResources),
    timed("writing.typingSummary", () => typingSummary(user.id)),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.writing.practiceTitle}</h1>
        <Link href="/writing/history" className="text-sm text-signal-600 hover:underline">
          {dict.writing.historyTitle} →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {prompts.map((p) => (
          <Card key={p.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="badge bg-signal-100 text-signal-700">
                {p.taskType === "task1" ? dict.writing.task1 : dict.writing.task2}
              </span>
              <span className="text-xs uppercase tracking-wide text-ink-300">{p.category}</span>
            </div>
            <p className="text-sm text-ink-700">{p.prompt}</p>
            <div className="flex items-center justify-between text-xs text-ink-300">
              <span>{dict.writing.target}: {p.targetWordCount} {dict.common.words}</span>
              <StartPromptButton promptId={p.id} label={dict.common.continue} />
            </div>
            {/* Anything an administrator attached to this prompt. */}
            <ResourceBlocks dict={dict} blocks={materials.get(p.id) ?? []} />
          </Card>
        ))}
      </div>

      <TypingTrainer
        dict={dict}
        targets={prompts.map((p) => ({ id: p.id, label: p.category, text: p.prompt }))}
        initialSummary={{ count: typing.count, bestWpm: typing.bestWpm, bestAccuracy: typing.bestAccuracy }}
      />
    </div>
  );
}
