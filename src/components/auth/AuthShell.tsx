import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandLogo";

/**
 * The shell shared by every authentication and waiting screen.
 *
 * The wordmark lock-up is used here because these pages have the width for it,
 * and the theme decides which supplied file is shown (dark artwork at night,
 * light artwork by day) — never a filter over one file. It is deliberately the
 * only branding on the page: no second logo, no repeated name beside the
 * wordmark, and the form stays the first thing a reader interacts with.
 */
export function AuthShell({
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
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper-sunken p-4">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mx-auto mb-8 flex w-fit max-w-full items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-600"
          data-auth-brand
        >
          <BrandLogo kind="horizontal" className="h-12 max-w-[min(20rem,80vw)]" eager />
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
