import { redirect } from "next/navigation";
import { and, asc, eq, ilike, notInArray, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listRoster, ROSTER_LIST_CAP } from "@/lib/reporter/roster";
import { escapeLike } from "@/lib/validation/like";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bounded selection lists; ordered so the cap is deterministic. */
const LIST_CAP = 1000;

/** Teacher rosters: the explicit source of a teacher's RIWI Reporter visibility. */
export default async function TeacherRosterPage({ searchParams }: { searchParams: Promise<{ teacher?: string; status?: string; q?: string }> }) {
  const actor = await requireAdministrator();
  if (!actor) redirect("/app");
  const [{ teacher, status, q }, locale] = await Promise.all([searchParams, getLocale()]);
  const dict = getDictionary(locale);
  const t = dict.reporter.roster;
  const teachers = await db.select({ id: users.id, name: users.name }).from(users)
    .where(eq(users.role, "teacher")).orderBy(asc(users.name), asc(users.id)).limit(LIST_CAP);
  const selected = teacher && UUID.test(teacher) ? teachers.find((x) => x.id === teacher) ?? null : null;
  const roster = selected ? await listRoster(selected.id) : [];
  const assignedIds = roster.map((s) => s.id);
  const query = (q ?? "").trim().slice(0, 60);
  const filters: SQL[] = [eq(users.role, "student")];
  if (assignedIds.length) filters.push(notInArray(users.id, assignedIds));
  if (query) filters.push(ilike(users.name, `%${escapeLike(query)}%`));
  const candidates = selected
    ? await db.select({ id: users.id, name: users.name }).from(users)
        .where(and(...filters)).orderBy(asc(users.name), asc(users.id)).limit(LIST_CAP)
    : [];
  const statusText = status === "saved" ? t.saved : status === "unchanged" ? t.unchanged : status === "failed" ? t.failed : null;

  return (
    <div className="flex flex-col gap-4" data-teacher-roster>
      <BackLink fallbackHref="/app/management" label={dict.nav.management} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{t.title}</h1>
        <p className="text-sm text-ink-500">{t.body}</p>
      </div>
      {statusText && <p role="status" className="rounded-md border border-ink-200 p-3 text-sm" data-roster-status={status}>{statusText}</p>}
      <Card className="p-4">
        {teachers.length === 0 ? <p className="text-sm text-ink-500">{t.noTeachers}</p> : (
          <form method="get" action="/app/admin/roster" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink-700">{t.teacher}</span>
              <select name="teacher" className="input" defaultValue={selected?.id ?? ""}>
                <option value="">{t.chooseTeacher}</option>
                {teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <button type="submit" className="btn-secondary min-h-11">{t.chooseTeacher}</button>
          </form>
        )}
      </Card>
      {selected && (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold text-ink-900">{t.assigned}: {selected.name}</h2>
          {roster.length === 0 ? <p className="text-sm text-ink-500">{t.none}</p> : (
            <ul className="flex flex-col gap-2" data-roster-list>
              {roster.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{s.name}</span>
                  <form method="post" action="/api/admin/roster">
                    <input type="hidden" name="teacherId" value={selected.id} />
                    <input type="hidden" name="studentId" value={s.id} />
                    <input type="hidden" name="action" value="unassign" />
                    <button type="submit" className="btn-secondary min-h-11">{t.remove}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form method="get" action="/app/admin/roster" className="flex flex-wrap items-end gap-3" data-roster-search>
            <input type="hidden" name="teacher" value={selected.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink-700">{dict.reporter.studentSearch}</span>
              <input type="search" name="q" defaultValue={query} maxLength={60} className="input" />
            </label>
            <button type="submit" className="btn-secondary min-h-11">{dict.reporter.studentSearchButton}</button>
          </form>
          {candidates.length >= LIST_CAP && <p className="text-xs text-ink-500" role="status">{dict.reporter.listCapped.replace("{n}", String(LIST_CAP))}</p>}
          {roster.length >= ROSTER_LIST_CAP ? null : candidates.length > 0 && (
            <form method="post" action="/api/admin/roster" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="teacherId" value={selected.id} />
              <input type="hidden" name="action" value="assign" />
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-ink-700">{t.add}</span>
                <select name="studentId" className="input" required defaultValue="">
                  <option value="" disabled>—</option>
                  {candidates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <button type="submit" className="btn-primary min-h-11">{t.addButton}</button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
