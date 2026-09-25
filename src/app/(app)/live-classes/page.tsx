import { and, eq, inArray } from "drizzle-orm";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { db } from "@/db/client";
import { courses, liveClassAttendance, users } from "@/db/schema";
import { listUpcoming, listPast } from "@/lib/data/live-classes";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { JoinButton } from "@/components/live-classes/JoinButton";
import { joinState, opensAt } from "@/lib/services/live-classes/window";

export default async function LiveClassesPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());

  const ielts = await db.query.courses.findFirst({ where: eq(courses.slug, "ielts") });
  if (!ielts) {
    return <p className="text-sm text-ink-500">No course configured yet.</p>;
  }

  const [upcoming, past] = await Promise.all([listUpcoming(ielts.id), listPast(ielts.id)]);
  const allIds = [...upcoming, ...past].map((c) => c.id);
  const attendedRows = allIds.length
    ? await db.query.liveClassAttendance.findMany({
        where: and(eq(liveClassAttendance.userId, user.id), inArray(liveClassAttendance.liveClassId, allIds)),
      })
    : [];
  const attendedSet = new Map(attendedRows.map((a) => [a.liveClassId, a.joinedAt]));

  // The teacher's name is shown because "who is running this class" is part of
  // deciding whether to be there.
  const teacherIds = [
    ...new Set([...upcoming, ...past].map((c) => c.teacherUserId).filter((id): id is string => Boolean(id))),
  ];
  const teachers = teacherIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, teacherIds))
    : [];
  const teacherName = new Map(teachers.map((t) => [t.id, t.name]));

  const now = new Date();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-2xl text-ink-900">{dict.liveClasses.title}</h1>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300">{dict.liveClasses.upcoming}</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon="○" title={dict.liveClasses.noClasses} />
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((c) => {
              const state = joinState(c, now);
              return (
                <Card key={c.id} className="flex items-center justify-between gap-3" data-live-class={c.id}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{c.title}</p>
                    {c.topic && <p className="text-xs text-ink-500">{c.topic}</p>}
                    <p className="text-xs text-ink-300">
                      {new Date(c.scheduledAt).toLocaleString()} · {c.durationMinutes} {dict.common.minutes} ·{" "}
                      {(c.teacherUserId ? teacherName.get(c.teacherUserId) : null) ?? dict.liveClasses.teacher}{" "}
                      {c.status === "live" && (
                        <span className="text-band-bad">· {dict.liveClasses.liveNow}</span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0" data-live-state={state}>
                    <JoinButton
                      liveClassId={c.id}
                      meetingUrl={c.meetingUrl}
                      label={dict.liveClasses.join}
                      joinedLabel={dict.liveClasses.joined}
                      alreadyJoined={attendedSet.has(c.id)}
                      state={state}
                      opensAtLabel={`${dict.liveClasses.opensAt} ${opensAt(c).toLocaleString()}`}
                      watchedLabel={dict.liveClasses.closedWatchRecording}
                      cancelledLabel={dict.liveClasses.status.cancelled}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300">{dict.liveClasses.past}</h2>
          <div className="flex flex-col gap-2">
            {past.map((c) => (
              <Card key={c.id} className="flex items-center justify-between gap-3" data-live-class={c.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{c.title}</p>
                  <p className="text-xs text-ink-300">
                    {new Date(c.scheduledAt).toLocaleDateString()} · {dict.liveClasses.status[c.status]}
                    {attendedSet.has(c.id) && (
                      <span className="text-band-good"> · {dict.liveClasses.youAttended}</span>
                    )}
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
