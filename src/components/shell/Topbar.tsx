import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";
import { BRAND } from "@/lib/config/brand";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { LogoutButton } from "./LogoutButton";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { FocusToggle } from "./FocusToggle";
import type { Role } from "@/lib/auth/session";

export function Topbar({
  dict,
  locale,
  userName,
  role,
  unread = 0,
}: {
  dict: Dictionary;
  locale: Locale;
  userName: string;
  role: Role;
  unread?: number;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-ink-100 bg-paper-raised px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <MobileNav dict={dict} role={role} />
        <div className="font-display text-lg text-ink-900 md:hidden">{BRAND.siteName}</div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <FocusToggle
          enterLabel={dict.focus.enter}
          exitLabel={dict.focus.exit}
          hint={dict.focus.hint}
        />
        <ThemeToggle
          nightLabel={dict.theme.night}
          dayLabel={dict.theme.day}
          currentLabel={dict.theme.toggle}
        />
        <Link
          href="/notifications"
          aria-label={dict.notifications.title}
          className="relative flex h-9 w-9 items-center justify-center rounded-sm border border-ink-100 text-ink-500 hover:bg-paper-sunken hover:text-ink-900"
        >
          <span aria-hidden>◔</span>
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-600 px-1 text-[10px] font-medium text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <LocaleSwitcher locale={locale} />
        <div className="group relative">
          <button
            type="button"
            aria-haspopup="menu"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-signal-100 text-sm font-medium text-signal-700"
          >
            {userName.charAt(0).toUpperCase()}
          </button>
          <div className="invisible absolute right-0 top-9 z-20 w-48 rounded-md border border-ink-100 bg-paper-raised p-2 opacity-0 shadow-raised transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
            <p className="truncate px-2 py-1 text-sm text-ink-700">{userName}</p>
            <p className="px-2 pb-1 text-xs uppercase tracking-wide text-ink-300">{role}</p>
            <LogoutButton label={dict.nav.logout} />
          </div>
        </div>
      </div>
    </header>
  );
}
