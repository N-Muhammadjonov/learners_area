import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import {
  fullListeningDetail,
  fullListeningProgress,
} from "@/lib/data/full-listening";
import { publicationBlockers } from "@/lib/listening/package";
import { getDictionary, getLocale } from "@/lib/i18n";

const fill = (t: string, v: Record<string, string | number>) =>
  t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
import { isUuid } from "@/lib/validation/ids";
export default async function Hub({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireActiveUser();
  if (!user) return null;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  const progress = await fullListeningProgress(user.id, id);
  const dict = getDictionary(await getLocale());
  const t = dict.fullListeningHub;
  const blockers = publicationBlockers(detail.pkg.payload);
  return (
    <div className="mx-auto max-w-[1840px] space-y-6">
      <BackLink fallbackHref="/listening" label={dict.nav.listening} />
      <h1 className="font-display text-3xl">{detail.test.title}</h1>
      <p>{fill(t.summary, { min: Math.round(detail.pkg.payload.audio.durationSec / 60) })}</p>
      {detail.test.publicationState === "draft" && (
        <p role="status" className="card">
          {t.qaDraft}{" "}
          {blockers
            .map((b) =>
              fill(b.kind === "transcript_missing" ? dict.listeningImport.blockMissing : dict.listeningImport.blockReview, {
                n: b.section,
              }),
            )
            .join(" ")}
        </p>
      )}
      <p>
        {fill(t.completedCount, { done: progress.activities.filter((a) => a.complete).length })}
      </p>
      <div className="full-listening-grid">
        {t.activities.map((name, index) => {
          const activity = index + 1;
          const state = progress.activities[index]!;
          const locked = activity > 1 && !progress.exam;
          return (
            <article key={name} className="card flex min-h-64 flex-col gap-4">
              <span aria-hidden="true">
                {["🎧", "🔎", "🔑", "🧩", "📚"][index]}
              </span>
              <h2 className="font-display text-xl font-bold">{name}</h2>
              <p>
                {state.complete
                  ? t.completed
                  : state.latest
                    ? t.inProgress
                    : t.notStarted}
              </p>
              {state.latest?.score != null && (
                <p>
                  {state.latest.score} / {state.latest.total}
                </p>
              )}
              {activity === 1 && (
                <Link
                  className="btn-secondary"
                  href={`/listening/tests/${id}/study`}
                >
                  {t.studyLink}
                </Link>
              )}
              {locked ? (
                <p className="mt-auto">{t.locked}</p>
              ) : (
                <Link
                  className="btn-primary mt-auto"
                  href={`/listening/tests/${id}/${activity}`}
                >
                  {activity === 1
                    ? t.exam
                    : state.complete
                      ? t.review
                      : t.start}
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
