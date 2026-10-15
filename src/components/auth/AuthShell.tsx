import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { BrandBlock } from "@/components/shell/BrandBlock";

/**
 * The shell shared by every authentication and waiting screen.
 *
 * The wordmark lock-up is used here because these pages have the width for it,
 * and the theme decides which supplied file is shown (dark artwork at night,
 * light artwork by day) — never a filter over one file. It is deliberately the
 * only branding on the page: no second logo, no repeated name beside the
 * wordmark, and the form stays the first thing a reader interacts with.
 */
export async function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  return (
    <div data-shell data-auth-shell className="relative flex min-h-dvh items-center justify-center bg-paper-sunken px-4 pb-6 pt-24">
      <header data-auth-controls className="absolute inset-x-0 top-0 flex flex-wrap items-center justify-end gap-3 p-4">
        <ThemeToggle nightLabel={dict.theme.night} dayLabel={dict.theme.day} currentLabel={dict.theme.toggle} errorLabel={dict.common.error} />
        <LocaleSwitcher locale={locale} dict={dict} />
      </header>
      <div className="w-full max-w-sm">
        {/*
          Mark plus the name as real text — not the horizontal wordmark file.
          The artwork belongs here as the mark; the name is a heading a screen
          reader can read, the browser can select and the translation layer could
          reach, and it stays sharp at every zoom level.
        */}
        <Link
          href="https://t.me/learners_area"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={dict.shell.telegramBrand}
          className="mx-auto mb-6 flex w-fit max-w-full items-center justify-center rounded-sm px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-600"
          data-auth-brand
        >
          <BrandBlock size={44} className="justify-center" />
        </Link>
        <div className="card p-6">
          <h1 className="font-display text-xl text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-ink-500">{footer}</div>}
      </div>
    </div>
  );
}
