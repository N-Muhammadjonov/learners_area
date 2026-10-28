import { redirect } from "next/navigation";
import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { allowedScopes } from "@/lib/reporter/access";
import { listRoster } from "@/lib/reporter/roster";
import { escapeLike } from "@/lib/validation/like";
import { REPORT_FORMATS } from "@/lib/reporter/exports";
import { PERIOD_KINDS } from "@/lib/reporter/period";
import { TIMEZONE } from "@/lib/time";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/** Staff choose a student from this list; capped so the page stays bounded. */
const STUDENT_LIST_CAP = 1000;

const FORMAT_LABELS: Record<(typeof REPORT_FORMATS)[number], string> = {
  pdf: "PDF", docx: "Word (DOCX)", xlsx: "Excel (XLSX)", csv: "CSV", json: "JSON", zip: "ZIP (all formats + manifest)",
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  const user = await requireActiveUser();
  if (!user) redirect("/login");
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const t = dict.reporter;
  const { error, q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 60);
  const errorText = error && error in t.errors ? t.errors[error as keyof typeof t.errors] : null;
  const role = user.role;
  const scopes = allowedScopes(role);
  const staff = role !== "student";
  // Teachers choose only from their explicit roster; only Owners may search the centre roster.
  const teacher = role === "teacher";
  const canSelectStudents = teacher || role === "owner";
  const students = teacher
    ? await listRoster(user.id)
    : role === "owner"
      ? await db.select({ id: users.id, name: users.name }).from(users).where(query ? and(eq(users.role, "student"), ilike(users.name, `%${escapeLike(query)}%`)) : eq(users.role, "student")).orderBy(asc(users.name), asc(users.id)).limit(STUDENT_LIST_CAP)
      : [];
  const periodLabel: Record<(typeof PERIOD_KINDS)[number], string> = {
    on_demand: t.periodOnDemand, weekly: t.periodWeekly, monthly: t.periodMonthly, yearly: t.periodYearly, custom: t.periodCustom,
  };
  const scopeLabel = { owner: t.scopeOwner, teacher: teacher ? t.scopeRoster : t.scopeTeacher, student: staff ? t.scopeStudent : t.scopeSelf, operations: t.scopeOperations };

  return (
    <div className="flex flex-col gap-4" data-reporter>
      <div>
        <h1 className="font-display text-2xl text-ink-900">{t.title}</h1>
        <p className="text-sm text-ink-500">{t.subtitle}</p>
      </div>
      {errorText && <p className="rounded-md border border-band-bad/40 bg-band-bad/10 p-3 text-sm text-band-bad" role="alert" data-reporter-error>{errorText}</p>}
      {role === "owner" && (
        <form method="get" action="/app/reports" className="flex flex-wrap items-end gap-3" data-reporter-student-search>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink-700">{t.studentSearch}</span>
            <input type="search" name="q" defaultValue={query} maxLength={60} className="input" />
          </label>
          <button type="submit" className="btn-secondary min-h-11">{t.studentSearchButton}</button>
        </form>
      )}
      {role === "owner" && students.length >= STUDENT_LIST_CAP && <p className="text-xs text-ink-500" role="status" data-reporter-list-capped>{t.listCapped.replace("{n}", String(STUDENT_LIST_CAP))}</p>}
      <Card className="p-4">
        <form method="get" action="/api/reports" className="flex flex-col gap-4" data-reporter-form>
          <input type="hidden" name="ui" value="1" />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-ink-700">{t.scope}</legend>
            {scopes.map((s, i) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="radio" name="scope" value={s} defaultChecked={i === 0} /> {scopeLabel[s]}
              </label>
            ))}
          </fieldset>
          {canSelectStudents && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink-700">{t.student}</span>
              {students.length === 0 ? <span className="text-ink-500">{teacher ? t.noRoster : t.noStudents}</span> : (
                <select name="subject" className="input" defaultValue="">
                  <option value="">—</option>
                  {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <span className="text-xs text-ink-500">{t.studentHint}</span>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink-700">{t.period}</span>
            <select name="period" className="input" defaultValue="monthly">
              {PERIOD_KINDS.map((p) => <option key={p} value={p}>{periodLabel[p]}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm"><span className="font-semibold text-ink-700">{t.from}</span><input type="date" name="from" className="input" /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="font-semibold text-ink-700">{t.to}</span><input type="date" name="to" className="input" /></label>
            <p className="text-xs text-ink-500 sm:col-span-2">{t.customHint}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink-700">{t.format}</span>
              <select name="format" className="input" defaultValue="pdf">
                {REPORT_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink-700">{t.language}</span>
              <select name="lang" className="input" defaultValue={locale}>
                <option value="uz">O&apos;zbekcha</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-ink-500">{t.timezoneNote}: {TIMEZONE}. {t.privacy}</p>
          <div><button type="submit" className="btn-primary">{t.download}</button></div>
        </form>
      </Card>
    </div>
  );
}
