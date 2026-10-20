import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { BrandBlock } from "@/components/shell/BrandBlock";
import styles from "./AuthShell.module.css";

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
  prominentBrand = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Enlarge and animate the brand on /login only. */
  prominentBrand?: boolean;
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
          className={`mx-auto mb-6 flex w-fit max-w-full items-center justify-center rounded-sm px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-600 ${styles.brandMotion} ${prominentBrand ? styles.loginBrand : ""}`}
          data-auth-brand
        >
          <BrandBlock
            size={prominentBrand ? 60 : 44}
            className="justify-center"
            nameSuffix={
              <span className="ml-1.5 inline-flex align-middle" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" focusable="false">
                  <path d="m21.4 3.2-3.3 16.1c-.25 1.14-.92 1.42-1.86.87l-5.15-3.79-2.49 2.4c-.27.27-.5.5-1.02.5l.36-5.25L17.5 5.4c.42-.38-.09-.59-.65-.22L5.14 12.55.09 10.97c-1.09-.34-1.11-1.09.23-1.62L20.1 1.7c.92-.34 1.72.22 1.42 1.5z" />
                </svg>
              </span>
            }
          />
        </Link>
        <div className="card p-6">
          <h1 className="font-display text-xl text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div data-auth-footer className={`mt-4 text-center text-sm ${styles.footer}`}>{footer}</div>}
      </div>
    </div>
  );
}
