import { BackLink } from "@/components/ui/BackLink";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listLivePartnerQuestions } from "@/lib/data/speaking-practice";
import { getLivePartnerProfile } from "@/lib/data/live-partner";
import { LivePartnerClient } from "@/components/speaking/LivePartnerClient";

export const dynamic = "force-dynamic";

/** The client registers availability while this room is mounted. */
export default async function LivePartnerPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  const [questions, profile] = await Promise.all([listLivePartnerQuestions(), getLivePartnerProfile(user.id)]);
  return (
    <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-4" data-route-usable="live-partner">
      <BackLink fallbackHref="/app/speaking" label={dict.common.back} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.livePartner.title}</h1>
        <p className="text-sm text-ink-500">{dict.livePartner.intro}</p>
      </div>
      <LivePartnerClient dict={dict} me={{ userId: user.id, name: user.name, ...profile }} questions={questions.questions} />
    </div>
  );
}
