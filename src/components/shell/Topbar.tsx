import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { LogoutButton } from "./LogoutButton";
import { MobileNav } from "./MobileNav";
import type { Role } from "@/lib/auth/session";

export function Topbar({
  dict,
  locale,
  userName,
  role,
}: {
  dict: Dictionary;
  locale: Locale;
  userName: string;
  role: Role;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-ink-100 bg-paper-raised px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <MobileNav dict={dict} role={role} />
        <div className="font-display text-lg text-ink-900 md:hidden">{dict.marketing.title}</div>
      </div>
      <div className="flex items-center gap-3">
        <LocaleSwitcher locale={locale} />
        <div className="group relative">
          <div className="flex h-8 w-8 cursor-default items-center justify-center rounded-full bg-signal-100 text-sm font-medium text-signal-700">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="invisible absolute right-0 top-9 z-10 w-44 rounded-md border border-ink-100 bg-paper-raised p-2 opacity-0 shadow-raised transition-all group-hover:visible group-hover:opacity-100">
            <p className="truncate px-2 py-1 text-sm text-ink-700">{userName}</p>
            <LogoutButton label={dict.nav.logout} />
          </div>
        </div>
      </div>
    </header>
  );
}
