import Link from "next/link";
import { db } from "@/db/client";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { count, inArray } from "drizzle-orm";
import { liveClassAttendance } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listAllForTeacher } from "@/lib/data/live-classes";
import { Card } from "@/components/ui/Card";
import { NewLiveClassForm } from "@/components/live-classes/NewLiveClassForm";
import { ClassStatusControls } from "@/components/live-classes/ClassStatusControls";
import { formatDateTime } from "@/lib/time";

export default async function TeacherLiveClassesPage() {
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const staff = await requireStaff();
  if (!staff) redirect("/app");
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const classes = await listAllForTeacher(staff);

  /*
   * One grouped COUNT instead of one `findMany()` per class. The loop fetched every attendance row
   * for every class purely to take `.length`, so both the query count and the rows read scaled with
   * the timetable — measured at 3 attendance queries for 3 classes. The rendered numbers are the
   * same, they just come from a single statement.
   */
  const attendanceCounts = classes.length
    ? await db
        .select({ liveClassId: liveClassAttendance.liveClassId, attendees: count() })
        .from(liveClassAttendance)
        .where(inArray(liveClassAttendance.liveClassId, classes.map((c) => c.id)))
        .groupBy(liveClassAttendance.liveClassId)
    : [];
  const counts = new Map<string, number>(attendanceCounts.map((r) => [r.liveClassId, Number(r.attendees)]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.liveClasses.manageTitle}</h1>
        <NewLiveClassForm dict={dict} />
      </div>

      <div className="flex flex-col gap-3">
        {classes.map((c) => (
          <Card key={c.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink-900">{c.title}</p>
              <span className="badge bg-signal-100 text-signal-700">{dict.liveClasses.status[c.status]}</span>
            </div>
            <p className="text-xs text-ink-300">
              {formatDateTime(c.scheduledAt, locale)} · {c.durationMinutes} {dict.common.minutes} ·{" "}
              {counts.get(c.id) ?? 0} {dict.liveClasses.attendees}
            </p>
            <div className="flex items-center justify-between gap-2">
              <ClassStatusControls dict={dict} liveClassId={c.id} status={c.status} />
              <Link
                href={`/app/teacher/live-classes/${c.id}`}
                className="btn-secondary "
                data-class-roster-link={c.id}
              >
                {dict.liveClasses.attendance} →
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
