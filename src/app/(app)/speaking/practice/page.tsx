import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePrompts } from "@/lib/data/speaking-practice";
import { PracticeStudio } from "@/components/speaking/PracticeStudio";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function SpeakingPracticePage() {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(getLocale());
  const prompts = await listActivePrompts();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.speakingPractice.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{dict.speakingPractice.intro}</p>
      </div>

      {prompts.length === 0 ? (
        <EmptyState icon="🎙" title={dict.speakingPractice.historyEmpty} />
      ) : (
        <PracticeStudio dict={dict} prompts={prompts} />
      )}

      <p className="rounded-sm border border-ink-100 bg-paper-sunken p-3 text-xs text-ink-500">
        {dict.speakingPractice.noTranscriptBody}
      </p>
    </div>
  );
}
