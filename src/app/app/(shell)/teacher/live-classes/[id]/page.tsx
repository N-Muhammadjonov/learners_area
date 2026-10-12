import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClassAttendance, users } from "@/db/schema";
import { requireStaff } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getLiveClassDetail } from "@/lib/data/live-classes";
import { joinState, opensAt } from "@/lib/services/live-classes/window";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/time";
import { isUuid } from "@/lib/validation/ids";

export const dynamic = "force-dynamic";

/**
 * One class, and who was actually in it.
 *
 * The attendance list is the record: it shows the name and the moment each
 * student joined, because "who attended" is a question the centre has to answer
 * from data rather than from memory. Staff only, checked against the database.
 */
export default async function TeacherLiveClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  if (!staff) redirect("/app");
  const locale = await getLocale();
  const dict = getDictionary(locale);

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(id)) notFound();
  const detail = await getLiveClassDetail(id);
  if (!detail) notFound();
  const { liveClass } = detail;

  const roster = await db
    .select({ name: users.name, email: users.email, joinedAt: liveClassAttendance.joinedAt })
    .from(liveClassAttendance)
    .innerJoin(users, eq(users.id, liveClassAttendance.userId))
    .where(eq(liveClassAttendance.liveClassId, liveClass.id))
    .orderBy(asc(liveClassAttendance.joinedAt));

  const state = joinState(liveClass, new Date());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <BackLink fallbackHref="/app/teacher/live-classes" label={dict.liveClasses.manageTitle} data-class-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">{liveClass.title}</h1>
        {liveClass.topic && <p className="text-sm text-ink-500">{liveClass.topic}</p>}
      </div>

      <Card>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{dict.liveClasses.status[liveClass.status]}</dt>
            <dd className="text-ink-900" data-class-status={liveClass.status}>
              {dict.liveClasses.status[liveClass.status]}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{dict.liveClasses.scheduled}</dt>
            <dd className="text-ink-900">{formatDateTime(liveClass.scheduledAt, locale)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{dict.liveClasses.duration}</dt>
            <dd className="text-ink-900">
              {liveClass.durationMinutes} {dict.common.minutes}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{dict.liveClasses.joinWindow}</dt>
            <dd className="text-ink-900" data-class-window={state}>
              {formatDateTime(opensAt(liveClass), locale)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{dict.liveClasses.meetingLink}</dt>
            <dd className="text-ink-900" data-class-has-link={liveClass.meetingUrl ? "yes" : "no"}>
              {liveClass.meetingUrl ? dict.liveClasses.linkSet : dict.liveClasses.linkMissing}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{dict.liveClasses.recording}</dt>
            <dd className="text-ink-900" data-class-has-recording={liveClass.recordingUrl ? "yes" : "no"}>
              {liveClass.recordingUrl ? dict.liveClasses.linkSet : dict.liveClasses.linkMissing}
            </dd>
          </div>
        </dl>
      </Card>

      <Card data-class-roster>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-ink-900">{dict.liveClasses.attendance}</h2>
          <span className="text-sm text-ink-500" data-attendee-count={roster.length}>
            {roster.length} {dict.liveClasses.attendees}
          </span>
        </div>
        {roster.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500" data-roster-empty>
            {dict.liveClasses.noAttendees}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-ink-100">
            {roster.map((row) => (
              <li key={`${row.email}-${row.joinedAt.toISOString()}`} className="flex items-center justify-between py-2" data-attendee={row.email}>
                <span className="text-sm text-ink-900">{row.name}</span>
                <span className="text-xs text-ink-300" data-attended-at>
                  {formatDateTime(row.joinedAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
