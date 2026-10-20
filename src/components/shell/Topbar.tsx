import { NotificationBell } from "./NotificationBell";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { ModuleContextHeading } from "./ModuleContextHeading";
import { GlobalSearch } from "./GlobalSearch";
import { ProfileMenu } from "./ProfileMenu";
import type { Role } from "@/lib/auth/roles";
import { Suspense } from "react";
import { ModuleHeaderNavigation, ModuleHeaderTitle } from "./ModuleHeaderSections";

/**
 * The topbar.
 *
 *   LEFT    Back (only on a nested route) and where you are
 *   CENTRE  search — a field on a wide desktop, a button that opens the same
 *           dialog everywhere else
 *   RIGHT   Day | Night, UZ | EN, and the profile menu
 *
 * Two rules it obeys:
 *
 *   1. **Nothing here is an unexplained icon.** The theme control shows both
 *      options as words, the profile control shows a name, and the one icon-only
 *      button on small screens (search) carries an `aria-label` and opens a
 *      visible field.
 *   2. **It never scrolls away.** The topbar is a pinned header inside the
 *      main column, and only the content below it scrolls — so the utilities are
 *      reachable from the bottom of a long passage without a trip back up.
 *      Module section titles and links share this blue header.
 *
 * Focus mode is deliberately NOT here: it belongs next to the work it affects,
 * so it lives in the floating utility stack (ShellUtilities). A control that
 * hides navigation should not itself hide when navigation hides.
 */
export function Topbar({
  dict,
  locale,
  userId,
  photoPresent,
  userName,
  userEmail,
  role,
}: {
  dict: Dictionary;
  locale: Locale;
  userId: string;
  photoPresent: boolean;
  userName: string;
  userEmail?: string | null;
  role: Role;
}) {
  return (
    <header
      data-shell-topbar
      className="relative z-50 grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-ink-100 bg-paper-raised px-3 py-2 md:px-5 lg:block lg:px-0 lg:py-0"
    >
      <div data-module-header-controls className="contents lg:flex lg:min-w-0 lg:items-center lg:gap-3 lg:px-5" style={{ minHeight: "var(--shell-topbar-h)" }}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* The only way into the drawer on a phone; the brand artwork itself
            lives inside it. See MobileNav. */}
        <MobileNav dict={dict} role={role} />
        <ModuleContextHeading dict={dict} />
      </div>

      <div className="flex min-w-0 shrink-0 justify-center lg:flex-[0_1_420px]">
        <GlobalSearch dict={dict} />
      </div>

      <div data-header-theme-controls className="col-span-2 col-start-2 row-start-2 flex shrink-0 items-center justify-end gap-2 lg:order-none">
        <ThemeToggle nightLabel={dict.theme.night} dayLabel={dict.theme.day} currentLabel={dict.theme.toggle} errorLabel={dict.common.error} />
        <LocaleSwitcher locale={locale} dict={dict} />
      </div>
      <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-1.5 md:gap-2">
        <NotificationBell label={dict.notifications.title} loadingLabel={dict.common.loading} />
        <ProfileMenu key={userId} userId={userId} initialPhotoPresent={photoPresent} dict={dict} userName={userName} userEmail={userEmail ?? null} role={role} />
      </div>
      </div>
      <Suspense fallback={null}><ModuleHeaderTitle dict={dict} /></Suspense>
      <Suspense fallback={null}><ModuleHeaderNavigation dict={dict} /></Suspense>
      <div id="module-header-extra" className="col-span-full -mx-3 min-w-0 px-3 md:-mx-5 md:px-5 lg:mx-0" />
    </header>
  );
}
