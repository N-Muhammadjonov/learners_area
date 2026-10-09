import { performanceDiagnosticsEnabled } from "@/lib/config/site";
import { PerformanceDiagnostics } from "@/components/diagnostics/PerformanceDiagnostics";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { getLocale, getDictionary } from "@/lib/i18n";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { OnlineActivity } from "@/components/shell/OnlineActivity";
import { ShellUtilities } from "@/components/shell/ShellUtilities";
import { InstantInteractionProvider } from "@/components/interaction/InstantInteractionProvider";
import { InstantWorkspaceOutlet } from "@/components/interaction/InstantWorkspaceOutlet";
import { sectionEntryFrames } from "@/lib/interaction/section-entry";
import { PrivateResourceScope } from "@/components/interaction/PrivateResourceScope";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";

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
  const riwiEnabled = riwiEnabledForRole(user.role);

  const diagnostics = performanceDiagnosticsEnabled();
  const entryFrames = sectionEntryFrames(dict);
  return (
    <InstantInteractionProvider
      diagnostics={diagnostics}
      entryFrames={entryFrames}
      slowMessage={dict.errors.unknown}
      retryLabel={dict.errorPage.retry}
    >
      {/* Private client read cache is bound to the DB-verified user id only. */}
      <PrivateResourceScope scope={user.id} />
      <OnlineActivity />
      <div className="flex h-dvh overflow-hidden bg-paper" data-shell>
        {diagnostics && <PerformanceDiagnostics />}
        {/*
          The rail is visible from 768px up and replaced by the drawer below that
          (see MobileNav, which is `md:hidden`).
          This `hidden md:flex` is load-bearing: without it the 288px rail stays
          in the flex row on a phone and squeezes the whole application into a
          narrow column at 390px.
        */}
        <aside
          className="hidden h-full shrink-0 flex-col overflow-y-auto border-r border-ink-100 bg-paper-raised px-3 py-5 md:flex"
          style={{ width: "var(--shell-sidebar-w)" }}
          data-shell-sidebar
          data-sidebar-scroll
        >
          <Sidebar dict={dict} role={user.role} email={user.email ?? ""} riwiEnabled={riwiEnabled} />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar
            dict={dict}
            locale={locale}
            userName={user.name}
            userEmail={user.email}
            role={user.role}
            riwiEnabled={riwiEnabled}
          />
          <main
            id="main-content"
            tabIndex={-1}
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
              <InstantWorkspaceOutlet>{children}</InstantWorkspaceOutlet>
            </div>
          </main>
          {/* Focus mode and report controls belong to the learning surface only. */}
          <ShellUtilities dict={dict} />
        </div>
      </div>
    </InstantInteractionProvider>
  );
}
