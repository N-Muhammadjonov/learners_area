import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { getLocale, getDictionary } from "@/lib/i18n";
import { countUnread } from "@/lib/data/notifications";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export const dynamic = "force-dynamic";

/**
 * The private area of the centre.
 *
 * The gate is a database read, not a cookie read: `getCurrentUser()` re-loads
 * role and admission status on every request, so a suspended account is turned
 * away on its next click even with a valid session cookie and an open tab.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPrivateAccess(user.accountStatus)) redirect("/pending");

  const locale = getLocale();
  const dict = getDictionary(locale);
  const unread = await countUnread(user.id);

  return (
    <div className="flex min-h-screen">
      <Sidebar dict={dict} role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          dict={dict}
          locale={locale}
          userName={user.name}
          role={user.role}
          unread={unread}
        />
        <main className="flex-1 bg-paper p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
