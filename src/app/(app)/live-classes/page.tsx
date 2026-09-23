import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { db } from "@/db/client";
import { courses, liveClassAttendance } from "@/db/schema";
import { listUpcoming, listPast } from "@/lib/data/live-classes";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { JoinButton } from "@/components/live-classes/JoinButton";

export default async function LiveClassesPage() {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());

  const ielts = await db.query.courses.findFirst({ where: eq(courses.slug, "ielts") });
  if (!ielts) {
    return <p className="text-sm text-ink-500">No course configured yet.</p>;
  }

  const [upcoming, past] = await Promise.all([listUpcoming(ielts.id), listPast(ielts.id)]);
  const allIds = [...upcoming, ...past].map((c) => c.id);
  const attendedRows = allIds.length
    ? await db.query.liveClassAttendance.findMany({
        where: and(eq(liveClassAttendance.userId, session.sub), inArray(liveClassAttendance.liveClassId, allIds)),
      })
    : [];
  const attendedSet = new Set(attendedRows.map((a) => a.liveClassId));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-2xl text-ink-900">{dict.liveClasses.title}</h1>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300">{dict.liveClasses.upcoming}</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon="○" title={dict.liveClasses.noClasses} />
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((c) => (
              <Card key={c.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink-900">{c.title}</p>
                  <p className="text-xs text-ink-300">
                    {new Date(c.scheduledAt).toLocaleString()} · {c.durationMinutes} {dict.common.minutes} ·{" "}
                    <span className={c.status === "live" ? "text-band-bad" : ""}>{dict.liveClasses.status[c.status]}</span>
                  </p>
                </div>
                <JoinButton
                  liveClassId={c.id}
                  meetingUrl={c.meetingUrl}
                  label={dict.liveClasses.join}
                  joinedLabel={dict.liveClasses.joined}
                  alreadyJoined={attendedSet.has(c.id)}
                />
              </Card>
            ))}
          </div>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300">{dict.liveClasses.past}</h2>
          <div className="flex flex-col gap-2">
            {past.map((c) => (
              <Card key={c.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink-900">{c.title}</p>
                  <p className="text-xs text-ink-300">
                    {new Date(c.scheduledAt).toLocaleDateString()} · {dict.liveClasses.status[c.status]}
                  </p>
                </div>
                {c.recordingUrl && (
                  <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="btn-secondary">
                    {dict.liveClasses.recording}
                  </a>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
