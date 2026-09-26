import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { Breadcrumbs } from "./Breadcrumbs";
import { GlobalSearch } from "./GlobalSearch";
import { ProfileMenu } from "./ProfileMenu";
import type { Role } from "@/lib/auth/roles";

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
 *   2. **It never scrolls away.** The topbar is a fixed-height row inside the
 *      main column, and only the content below it scrolls — so the utilities are
 *      reachable from the bottom of a long passage without a trip back up.
 *
 * Focus mode is deliberately NOT here: it belongs next to the work it affects,
 * so it lives in the floating utility stack (ShellUtilities). A control that
 * hides navigation should not itself hide when navigation hides.
 */
export function Topbar({
  dict,
  locale,
  userName,
  userEmail,
  role,
  unread = 0,
}: {
  dict: Dictionary;
  locale: Locale;
  userName: string;
  userEmail?: string | null;
  role: Role;
  unread?: number;
}) {
  return (
    <header
      data-shell-topbar
      className="flex shrink-0 items-center gap-3 border-b border-ink-100 bg-paper-raised px-3 md:px-5"
      style={{ minHeight: "var(--shell-topbar-h)" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* The only way into the drawer on a phone; the brand artwork itself
            lives inside it. See MobileNav. */}
        <MobileNav dict={dict} role={role} />
        <Breadcrumbs dict={dict} />
      </div>

      <div className="hidden min-w-0 flex-[0_1_420px] justify-center lg:flex">
        <GlobalSearch dict={dict} variant="field" />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        <GlobalSearch dict={dict} variant="button" />
        <ThemeToggle nightLabel={dict.theme.night} dayLabel={dict.theme.day} currentLabel={dict.theme.toggle} />
        <LocaleSwitcher locale={locale} dict={dict} />
        <Link
          href="/notifications"
          aria-label={dict.notifications.title}
          className="relative hidden items-center justify-center rounded-[10px] border border-ink-100 text-ink-500 transition-colors hover:bg-paper-sunken hover:text-ink-900 sm:flex"
          style={{ width: "var(--icon-btn)", height: "var(--icon-btn)" }}
        >
          <span aria-hidden>◔</span>
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-600 px-1 text-[0.6875rem] font-medium text-signal-contrast">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <ProfileMenu dict={dict} userName={userName} userEmail={userEmail ?? null} role={role} />
      </div>
    </header>
  );
}
