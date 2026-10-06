import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePrompts } from "@/lib/data/speaking-practice";
import { PracticeStudio } from "@/components/speaking/PracticeStudio";
import { BackLink } from "@/components/ui/BackLink";

export const dynamic = "force-dynamic";

export default async function SpeakingPracticePage() {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(await getLocale());
  const prompts = await listActivePrompts();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" data-route-usable="speaking-practice">
      <BackLink fallbackHref="/app/speaking" label={dict.common.back} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.speakingHub.cards.practice.title}</h1>
        <p className="mt-1 text-base text-ink-500">{dict.speakingPractice.intro}</p>
      </div>

      <PracticeStudio dict={dict} prompts={prompts} />


    </div>
  );
}
