import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { PracticeStudio } from "@/components/speaking/PracticeStudio";
import { BackLink } from "@/components/ui/BackLink";

export const dynamic = "force-dynamic";

export default async function SpeakingPracticePage() {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(await getLocale());
  /*
   * §03/§04 — this page no longer reads the speaking bank at all. It used to call `listActivePrompts()`,
   * an unbounded `findMany` with no LIMIT, and hand every published prompt to the client: at 10 000
   * prompts that was 10 007 rows read and 6.15 MB shipped per view, growing with the corpus, and a
   * learner could only browse what the server had been willing to send. Discovery, search, paging and
   * study support are now bounded server-authoritative reads the studio makes on demand.
   */

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" data-route-usable="speaking-practice">
      <BackLink fallbackHref="/app/speaking" label={dict.common.back} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.speakingHub.cards.practice.title}</h1>
        <p className="mt-1 text-base text-ink-500">{dict.speakingPractice.intro}</p>
      </div>

      <PracticeStudio dict={dict} />


    </div>
  );
}
