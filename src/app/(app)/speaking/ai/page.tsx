import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePrompts } from "@/lib/data/speaking-practice";
import { findActiveAiSessionForUser, toAiSessionView } from "@/lib/data/speaking-ai-sessions";
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
  const prompts = await listActivePrompts();

  // RESUME, NEVER REBUILD (§11). If the learner has a session in progress it is
  // read back — same questions, same order, same cursor — rather than replaced
  // with a freshly planned one, so refreshing mid-interview cannot reshuffle the
  // examiner or lose the learner's place. A learner with no session in progress
  // starts one normally.
  const active = prompts.length > 0 ? await findActiveAiSessionForUser(user.id) : null;
  const initialSession = active ? await toAiSessionView(active) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-route-usable="speaking-ai">
      <BackLink fallbackHref="/speaking" label={dict.common.back} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.speakingHub.cards.ai.title}</h1>
        <p className="mt-1 text-base text-ink-500">{dict.speakingAi.intro}</p>
      </div>
      {prompts.length === 0 ? (
        <EmptyState icon="🎙" title={dict.speakingPractice.bankEmpty} />
      ) : (
        <AiExaminerSession
          dict={dict}
          readiness={await speakingAiReadiness()}
          isStaff={isStaff(user.role)}
          initialSession={initialSession}
        />
      )}
    </div>
  );
}
