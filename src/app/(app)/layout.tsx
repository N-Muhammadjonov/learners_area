import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { getLocale, getDictionary } from "@/lib/i18n";
import { countUnread } from "@/lib/data/notifications";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { ShellUtilities } from "@/components/shell/ShellUtilities";

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
 *
 * ---------------------------------------------------------------------------
 * The shell owns the viewport
 * ---------------------------------------------------------------------------
 *
 * Every element here is exactly as tall as its space and no taller:
 *
 *   html/body            h-dvh, overflow hidden
 *   ├─ aside (sidebar)   h-full, overflow-y auto   ← its own scrollbar
 *   └─ column            min-h-0, flex-1
 *      ├─ header         fixed height (--shell-topbar-h)
 *      └─ main           min-h-0, flex-1, overflow-y auto  ← its own scrollbar
 *
 * This is the fix for the defect the owner reported: the shell used to be
 * `min-h-dvh`, so the sidebar grew the document and scrolling the navigation
 * dragged the passage out of view. A `min-h-0` is what lets a flex child shrink
 * below its content and scroll instead of stretching its parent — without it,
 * `overflow-y: auto` does nothing at all.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPrivateAccess(user.accountStatus)) redirect("/pending");

  const locale = await getLocale();
  const dict = getDictionary(locale);
  // One cheap count, and only for the badge that displays it.
  const unread = await countUnread(user.id);

  return (
    <div className="flex h-dvh overflow-hidden bg-paper" data-shell>
      <Sidebar dict={dict} role={user.role} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar
          dict={dict}
          locale={locale}
          userName={user.name}
          userEmail={user.email}
          role={user.role}
          unread={unread}
        />
        <main
          id="main-content"
          data-shell-main
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-paper"
        >
          <div
            className="mx-auto w-full"
            style={{
              maxWidth: "var(--shell-content-max)",
              paddingInline:
                "calc(var(--shell-pad-x) + env(safe-area-inset-left)) calc(var(--shell-pad-x) + env(safe-area-inset-right))",
              paddingBlock: "var(--shell-pad-y)",
              paddingBottom: "calc(var(--shell-pad-y) + env(safe-area-inset-bottom))",
            }}
          >
            {children}
          </div>
        </main>
        {/* Focus mode and "report a problem" live on the learning surface only.
            See ShellUtilities: management pages never show focus mode. */}
        <ShellUtilities dict={dict} />
      </div>
    </div>
  );
}
