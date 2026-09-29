import { performanceDiagnosticsEnabled } from "@/lib/config/site";
import { PerformanceDiagnostics } from "@/components/diagnostics/PerformanceDiagnostics";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { getLocale, getDictionary } from "@/lib/i18n";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { ShellUtilities } from "@/components/shell/ShellUtilities";

/**
 * This segment is request-dynamic through `getCurrentUser()` and `getLocale()`
 * reading request cookies; do not force the entire tree dynamic redundantly.
 * The database-backed account/admission gate still runs before every response.
 */

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
  // Locale is request-cookie data, so read it alongside (not after) the
  // authoritative user lookup. The DB-backed gate remains mandatory.
  const [user, locale] = await Promise.all([getCurrentUser(), getLocale()]);
  if (!user) redirect("/login");
  if (!hasPrivateAccess(user.accountStatus)) redirect("/pending");

  const dict = getDictionary(locale);

  return (
    <div className="flex h-dvh overflow-hidden bg-paper" data-shell>
      {performanceDiagnosticsEnabled() && <PerformanceDiagnostics />}
      {/*
        The rail is visible from 768px up and replaced by the drawer below that
        (see MobileNav, which is `md:hidden`).
        
        This `hidden md:flex` is load-bearing: without it the 288px rail stays in
        the flex row on a phone and squeezes the whole application into a ~126px
        column at 390px. Every page still "worked", every card was 100px wide, and
        only a width measurement caught it.
      */}
      <aside
        className="hidden h-full shrink-0 flex-col overflow-y-auto border-r border-ink-100 bg-paper-raised px-3 py-5 md:flex"
        style={{ width: "var(--shell-sidebar-w)" }}
        data-shell-sidebar
        data-sidebar-scroll
      >
        <Sidebar dict={dict} role={user.role} email={user.email ?? ""} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar
          dict={dict}
          locale={locale}
          userName={user.name}
          userEmail={user.email}
          role={user.role}
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
