import { db } from "@/db/client";
import { eq } from "drizzle-orm";
import { liveClassAttendance } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listAllForTeacher } from "@/lib/data/live-classes";
import { Card } from "@/components/ui/Card";
import { NewLiveClassForm } from "@/components/live-classes/NewLiveClassForm";
import { ClassStatusControls } from "@/components/live-classes/ClassStatusControls";

export default async function TeacherLiveClassesPage() {
  const dict = getDictionary(getLocale());
  const classes = await listAllForTeacher();

  const counts = new Map<string, number>();
  for (const c of classes) {
    const rows = await db.query.liveClassAttendance.findMany({ where: eq(liveClassAttendance.liveClassId, c.id) });
    counts.set(c.id, rows.length);
  }

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
              {new Date(c.scheduledAt).toLocaleString()} · {c.durationMinutes} {dict.common.minutes} ·{" "}
              {counts.get(c.id) ?? 0} {dict.liveClasses.attendees}
            </p>
            <ClassStatusControls dict={dict} liveClassId={c.id} status={c.status} />
          </Card>
        ))}
      </div>
    </div>
  );
}
