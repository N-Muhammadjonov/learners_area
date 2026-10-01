import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import {
  fullListeningDetail,
  fullListeningProgress,
} from "@/lib/data/full-listening";
import { ACTIVITY_NAMES, publicationIssues } from "@/lib/listening/package";
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
  return (
    <div className="mx-auto max-w-[1840px] space-y-6">
      <Link href="/listening" className="btn-secondary">
        ← Listening
      </Link>
      <h1 className="font-display text-3xl">{detail.test.title}</h1>
      <p>
        4 Sections · 40 Questions ·{" "}
        {Math.round(detail.pkg.payload.audio.durationSec / 60)} min · 5
        Activities
      </p>
      {detail.test.publicationState === "draft" && (
        <p role="status" className="card">
          QA draft. {publicationIssues(detail.pkg.payload).join(" · ")}
        </p>
      )}
      <p>
        {progress.activities.filter((a) => a.complete).length} / 5 completed
      </p>
      <div className="full-listening-grid">
        {ACTIVITY_NAMES.map((name, index) => {
          const activity = index + 1;
          const state = progress.activities[index]!;
          const locked = activity > 1 && !progress.exam;
          return (
            <article key={name} className="card flex min-h-64 flex-col gap-4">
              <span aria-hidden="true">
                {["🎧", "🔎", "🔑", "🧩", "📚"][index]}
              </span>
              <h2 className="font-display text-xl">{name}</h2>
              <p>
                {state.complete
                  ? "✓ Completed"
                  : state.latest
                    ? "In progress"
                    : "Not started"}
              </p>
              {state.latest?.score != null && (
                <p>
                  {state.latest.score} / {state.latest.total}
                </p>
              )}
              {locked ? (
                <p className="mt-auto">Complete Full Exam to unlock.</p>
              ) : (
                <Link
                  className="btn-primary mt-auto"
                  href={`/listening/tests/${id}/${activity}`}
                >
                  {state.complete ? "Review / Try again" : "Start / Continue"}
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
