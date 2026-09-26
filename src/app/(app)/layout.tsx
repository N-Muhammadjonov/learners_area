import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { getLocale, getDictionary } from "@/lib/i18n";
import { countUnread } from "@/lib/data/notifications";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export const dynamic = "force-dynamic";

/**
 * Nothing inside the centre belongs in a search engine. The sitemap never lists
 * these routes, `robots.txt` disallows them, and this makes the intent explicit
 * on the page itself — a private URL that leaked into a chat is still not
 * published by a crawler that follows it.
 */
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

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

  const locale = await getLocale();
  const dict = getDictionary(locale);
  const unread = await countUnread(user.id);

  return (
    <div className="flex min-h-dvh">
      <Sidebar dict={dict} role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          dict={dict}
          locale={locale}
          userName={user.name}
          role={user.role}
          unread={unread}
        />
        <main
          className="flex-1 bg-paper p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] md:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
