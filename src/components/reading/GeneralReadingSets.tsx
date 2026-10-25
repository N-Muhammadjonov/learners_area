import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Dictionary } from "@/lib/i18n/en";
import type { listGeneralSets } from "@/lib/data/general-reading";

type GeneralSet = Awaited<ReturnType<typeof listGeneralSets>>[number];

/** General Reading set cards: every set offers Passage 1 / 2 / 3 and Full Reading. */
export function GeneralReadingSets({ dict, sets, assessment = false }: { dict: Dictionary; sets: GeneralSet[]; assessment?: boolean }) {
  const t = dict.generalReading;
  if (sets.length === 0) return <EmptyState icon="◆" title={t.empty} body={t.emptyHint} />;
  return (
    <ul className="grid gap-4 md:grid-cols-2" data-general-reading-sets>
      {sets.map((set) => (
        <li key={set.id} className="card flex flex-col gap-3 p-5" data-general-set={set.id}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="card-title">{set.title}</h3>
            {set.level && <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-xs text-ink-500">{set.level}</span>}
          </div>
          {set.description && <p className="body-text text-sm">{set.description}</p>}
          <p className="text-xs text-ink-500">{!assessment && t.progress.replace("{checked}", String(set.checked)).replace("{total}", String(set.passages.length))}</p>
          <div className="flex flex-wrap gap-2">
            {!assessment && set.passages.map((passage) => (
              <Link key={passage.passageNo} prefetch={false} className="btn-secondary" href={`/app/reading/general/${set.id}?passage=${passage.passageNo}`} data-general-mode={passage.passageNo}>
                {t.passageN.replace("{n}", String(passage.passageNo))}
              </Link>
            ))}
            {(assessment ? set.passages.length === 3 : set.passages.length > 1) && (
              <Link prefetch={false} className="btn-primary" href={assessment ? `/app/reading/academic/${set.id}` : `/app/reading/general/${set.id}?passage=full`} data-general-mode="full">{t.full}</Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
