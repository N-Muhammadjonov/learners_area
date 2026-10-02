import { BackLink } from "@/components/ui/BackLink";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listGeneralSets } from "@/lib/data/general-reading";
import { GeneralReadingSets } from "@/components/reading/GeneralReadingSets";

/** General Reading — the learning mode (develop reading), separate from IELTS Academic (measure reading). */
export default async function GeneralReadingPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  const sets = await listGeneralSets(user.id);
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6" data-general-reading-index>
      <BackLink fallbackHref="/reading?tab=academic" label={dict.common.back} />
      <header className="flex flex-col gap-2">
        <h1 className="section-title">{dict.generalReading.title}</h1>
        <p className="body-text">{dict.generalReading.subtitle}</p>
      </header>
      <GeneralReadingSets dict={dict} sets={sets} />
    </div>
  );
}
