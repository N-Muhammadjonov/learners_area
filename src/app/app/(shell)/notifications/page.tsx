import Link from "next/link";
import { NotificationRead } from "@/components/shell/NotificationRead";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listNotifications } from "@/lib/data/notifications";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

function localizedCopy(row: Awaited<ReturnType<typeof listNotifications>>[number], t: Awaited<ReturnType<typeof getDictionary>>["notifications"]) {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown> : {};
  const fill = (template: string, values: Record<string, unknown>) => template.replace(/\{([a-zA-Z]+)\}/g,
    (_, key: string) => typeof values[key] === "string" ? values[key] as string : "");
  const title = typeof payload.assignmentTitle === "string" ? payload.assignmentTitle : "";
  if (row.type === "ASSIGNMENT_ASSIGNED") return { title: t.assignmentAssignedTitle, body: fill(t.assignmentAssignedBody, { title }) };
  if (row.type === "ASSIGNMENT_DEADLINE_APPROACHING") return { title: t.assignmentDeadlineTitle, body: fill(t.assignmentDeadlineBody, { title }) };
  if (row.type === "ASSIGNMENT_OVERDUE") return { title: t.assignmentOverdueTitle, body: fill(t.assignmentOverdueBody, { title }) };
  if (row.type === "WRITING_REVIEW_REQUIRED") return { title: t.writingReviewTitle, body: fill(t.writingReviewBody, { student: payload.studentName }) };
  if (row.type === "TEACHER_FEEDBACK_RECEIVED") return { title: t.teacherFeedbackTitle, body: t.teacherFeedbackBody };
  return { title: row.title, body: row.body };
}

/**
 * The in-app notification inbox.
 *
 * Admission decisions, role changes and suspensions land here, which is why the
 * centre works with no Telegram bot or email provider configured.
 */
export default async function NotificationsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/login");

  const dict = getDictionary(await getLocale());
  const rows = await listNotifications(user.id, 30);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.notifications.title}</h1>
      {rows.length > 0 && <NotificationRead ids={rows.filter((row) => !row.readAt).map((row) => row.id)} label={dict.notifications.markRead} errorLabel={dict.common.error} />}
      {rows.length === 0 ? (
        <EmptyState icon="◔" title={dict.notifications.empty} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const copy = localizedCopy(row, dict.notifications);
            return (
            <Card data-notification-id={row.id} key={row.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-900">{copy.title}</span>
                <span className="text-xs text-ink-300">
                  {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </div>
              {copy.body && <p className="text-sm text-ink-500">{copy.body}</p>}
              {row.href && (
                <Link href={row.href} className="text-xs text-signal-700 underline">
                  {dict.common.continue}
                </Link>
              )}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
