import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listNotifications } from "@/lib/data/notifications";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

/**
 * The in-app notification inbox.
 *
 * Admission decisions, role changes and suspensions land here, which is why the
 * centre works with no Telegram bot or email provider configured.
 */
export default async function NotificationsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/login");

  const dict = getDictionary(getLocale());
  const rows = await listNotifications(user.id, 30);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.notifications.title}</h1>
      {rows.length === 0 ? (
        <EmptyState icon="◔" title={dict.notifications.empty} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Card key={row.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-900">{row.title}</span>
                <span className="text-xs text-ink-300">
                  {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </div>
              {row.body && <p className="text-sm text-ink-500">{row.body}</p>}
              {row.href && (
                <Link href={row.href} className="text-xs text-signal-700 underline">
                  {dict.common.continue}
                </Link>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
