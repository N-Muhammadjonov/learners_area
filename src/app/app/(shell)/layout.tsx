import { performanceDiagnosticsEnabled } from "@/lib/config/site";
import { PerformanceDiagnostics } from "@/components/diagnostics/PerformanceDiagnostics";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getLocale, getDictionary } from "@/lib/i18n";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { hasProfilePhoto } from "@/lib/profile/photo";
import { ShellUtilities } from "@/components/shell/ShellUtilities";
import { InstantInteractionProvider } from "@/components/interaction/InstantInteractionProvider";
import { InstantWorkspaceOutlet } from "@/components/interaction/InstantWorkspaceOutlet";
import { IdleShellPrefetch } from "@/components/interaction/IdleShellPrefetch";
import { sectionEntryFrames } from "@/lib/interaction/section-entry";

/**
 * The ordinary Learners Area shell, for every `/app/*` route except the exam
 * focus surfaces (which live in the sibling `(focus)` group and render their own
 * chrome).
 *
 * The access gate is NOT here — it is the parent (`src/app/app/layout.tsx`), so
 * both groups are covered by one database-backed check. This layout re-reads the
 * same user for the sidebar/topbar; `getCurrentUser()` is `cache()`d, so that is
 * one query per request, not two.
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
 *
 * Because this layout wraps the whole `/app` page tree and is not re-created on
 * client navigation between its routes, the shell stays mounted (sidebar scroll
 * position, open drawer, playback surfaces) while only the page content swaps.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const [user, locale] = await Promise.all([getCurrentUser(), getLocale()]);
  // The parent gate guarantees a user; this is a type narrowing, not a second gate.
  if (!user) return null;

  const dict = getDictionary(locale);
  const photoPresent = await hasProfilePhoto(user.id);

  const diagnostics = performanceDiagnosticsEnabled();
  const entryFrames = sectionEntryFrames(dict);
  return (
    <InstantInteractionProvider
      diagnostics={diagnostics}
      entryFrames={entryFrames}
      slowMessage={dict.errors.unknown}
      retryLabel={dict.errorPage.retry}
    >
      <div className="flex h-dvh overflow-hidden bg-paper" data-shell>
        <IdleShellPrefetch />
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
          <Sidebar dict={dict} role={user.role} email={user.email ?? ""} />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar
            dict={dict}
            locale={locale}
            userId={user.id}
            photoPresent={photoPresent}
            userName={user.name}
            userEmail={user.email}
            role={user.role}
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
