import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { speakingFacets } from "@/lib/data/speaking-practice";
import { speakingAiReadiness } from "@/lib/speaking/ai-readiness";
import { isStaff } from "@/lib/auth/roles";
import { AiExaminerSession } from "@/components/speaking/AiExaminerSession";
import { EmptyState } from "@/components/ui/EmptyState";
import { BackLink } from "@/components/ui/BackLink";

export const dynamic = "force-dynamic";

export default async function SpeakingAiPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  /*
   * §05 — this page no longer reads the bank. It used to call `listActivePrompts("ai")`, an unbounded
   * `findMany`, and hand every published prompt to the client so `buildExaminerSession` could sample
   * them in the browser: at 10 000 prompts, 10 007 rows read and 6.15 MB shipped per view.
   *
   * The only thing the page itself needs is whether the bank is empty, which is a bounded aggregate
   * rather than a payload. The exam script is drawn server-side on demand by
   * `GET /api/speaking/ai/script`, sampling the WHOLE corpus — deliberately not the first bounded page,
   * which would bias every exam toward whichever prompts sort first and strand the rest.
   */
  const { matching } = await speakingFacets({ channel: "ai" });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-route-usable="speaking-ai">
      <BackLink fallbackHref="/app/speaking" label={dict.common.back} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.speakingHub.cards.ai.title}</h1>
        <p className="mt-1 text-base text-ink-500">{dict.speakingAi.intro}</p>
      </div>
      {matching === 0 ? (
        <EmptyState icon="🎙" title={dict.speakingPractice.bankEmpty} />
      ) : (
        <AiExaminerSession dict={dict} readiness={(await speakingAiReadiness())} isStaff={isStaff(user.role)} />
      )}
    </div>
  );
}
