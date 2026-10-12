import { Suspense } from "react";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { db } from "@/db/client";
import { courses, liveClasses, liveClassAttendance, users } from "@/db/schema";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { JoinButton } from "@/components/live-classes/JoinButton";
import { joinState, opensAt } from "@/lib/services/live-classes/window";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import { listResourceBlocksForOwners } from "@/lib/data/resources";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { timed } from "@/lib/observability/timing";
import { formatDate, formatDateTime } from "@/lib/time";

async function LiveClassesContent({ user, locale, dict }: {
  user: CurrentUser;
  locale: Awaited<ReturnType<typeof getLocale>>;
  dict: ReturnType<typeof getDictionary>;
}) {
  // Course existence and both class windows resolve concurrently by the stable
  // slug, removing the old course-id -> class-list request waterfall.
  const [ielts, upcomingRows, pastRows] = await Promise.all([
    timed("liveClasses.entry.course", () => db.select({ id: courses.id }).from(courses).where(eq(courses.slug, "ielts")).limit(1)),
    timed("liveClasses.entry.upcoming", () => db.select({ liveClass: {
      id: liveClasses.id,
      teacherUserId: liveClasses.teacherUserId,
      title: liveClasses.title,
      topic: liveClasses.topic,
      scheduledAt: liveClasses.scheduledAt,
      durationMinutes: liveClasses.durationMinutes,
      meetingUrl: liveClasses.meetingUrl,
      recordingUrl: liveClasses.recordingUrl,
      status: liveClasses.status,
    } })
      .from(liveClasses)
      .innerJoin(courses, eq(liveClasses.courseId, courses.id))
      .where(and(eq(courses.slug, "ielts"), inArray(liveClasses.status, ["upcoming", "live"])))
      .orderBy(asc(liveClasses.scheduledAt))),
    timed("liveClasses.entry.past", () => db.select({ liveClass: {
      id: liveClasses.id,
      teacherUserId: liveClasses.teacherUserId,
      title: liveClasses.title,
      topic: liveClasses.topic,
      scheduledAt: liveClasses.scheduledAt,
      durationMinutes: liveClasses.durationMinutes,
      meetingUrl: liveClasses.meetingUrl,
      recordingUrl: liveClasses.recordingUrl,
      status: liveClasses.status,
    } })
      .from(liveClasses)
      .innerJoin(courses, eq(liveClasses.courseId, courses.id))
      .where(and(eq(courses.slug, "ielts"), inArray(liveClasses.status, ["completed", "recorded", "cancelled"])))
      .orderBy(desc(liveClasses.scheduledAt))
      .limit(10)),
  ]);
  if (ielts.length === 0) return <p className="text-sm text-ink-500">{dict.formCopy.noCourse}</p>;
  const upcoming = upcomingRows.map((row) => row.liveClass);
  const past = pastRows.map((row) => row.liveClass);
  const allIds = [...upcoming, ...past].map((liveClass) => liveClass.id);
  const teacherIds = [...new Set([...upcoming, ...past].map((liveClass) => liveClass.teacherUserId).filter((id): id is string => Boolean(id)))];

  // Attendance controls the learner's join state and remains core. Teacher names
  // and attached materials are secondary; start all dependent reads together.
  const [attendanceResult, teachersResult, materialsResult] = await Promise.allSettled([
    allIds.length
      ? timed("liveClasses.entry.attendance", () => db.select({
          liveClassId: liveClassAttendance.liveClassId,
          joinedAt: liveClassAttendance.joinedAt,
        })
          .from(liveClassAttendance)
          .where(and(eq(liveClassAttendance.userId, user.id), inArray(liveClassAttendance.liveClassId, allIds))))
      : Promise.resolve([]),
    teacherIds.length
      ? timed("liveClasses.entry.teachers", () => db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, teacherIds)))
      : Promise.resolve([]),
    timed("liveClasses.entry.materials", () => listResourceBlocksForOwners("live_class", allIds)),
  ]);
  if (attendanceResult.status === "rejected") throw attendanceResult.reason;
  const attendedRows = attendanceResult.value;
  const attendedSet = new Map(attendedRows.map((attendance) => [attendance.liveClassId, attendance.joinedAt]));
  const teachers = teachersResult.status === "fulfilled" ? teachersResult.value : [];
  const materials = materialsResult.status === "fulfilled" ? materialsResult.value : new Map();
  const secondaryUnavailable = teachersResult.status === "rejected" || materialsResult.status === "rejected";
  const teacherName = new Map(teachers.map((teacher) => [teacher.id, teacher.name]));
  const now = new Date();

  return (
    <div className="flex flex-col gap-6" data-live-classes-content data-async-content="live-classes">
      {secondaryUnavailable && (
        <RegionFailureNotice
          region="live-class-metadata"
          message={dict.errors.unknown}
          retryLabel={dict.errorPage.retry}
        />
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300">{dict.liveClasses.upcoming}</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon="○" title={dict.liveClasses.noClasses} />
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((c) => {
              const state = joinState(c, now);
              return (
                <Card key={c.id} className="flex flex-col gap-2" data-live-class={c.id}>
                  <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{c.title}</p>
                    {c.topic && <p className="text-xs text-ink-500">{c.topic}</p>}
                    <p className="text-xs text-ink-300">
                      {formatDateTime(c.scheduledAt, locale)} · {c.durationMinutes} {dict.common.minutes} ·{" "}
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
                      opensAtLabel={`${dict.liveClasses.opensAt} ${formatDateTime(opensAt(c), locale)}`}
                      watchedLabel={dict.liveClasses.closedWatchRecording}
                      cancelledLabel={dict.liveClasses.status.cancelled}
                    />
                  </div>
                  </div>
                  <ResourceBlocks dict={dict} blocks={materials.get(c.id) ?? []} />
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
              <Card key={c.id} className="flex flex-col gap-2" data-live-class={c.id}>
                <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{c.title}</p>
                  <p className="text-xs text-ink-300">
                    {formatDate(c.scheduledAt, locale)} · {dict.liveClasses.status[c.status]}
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
                </div>
                <ResourceBlocks dict={dict} blocks={materials.get(c.id) ?? []} />
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LiveClassesSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3" data-async-loading="live-classes">
      {[0, 1, 2].map((row) => <div key={row} className="h-20 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

export default async function LiveClassesPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-route-usable="live-classes">
      <h1 className="font-display text-2xl text-ink-900">{dict.liveClasses.title}</h1>
      <Suspense fallback={<LiveClassesSkeleton />}>
        <LiveClassesContent user={user} locale={locale} dict={dict} />
      </Suspense>
    </div>
  );
}
