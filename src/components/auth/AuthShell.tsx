import Link from "next/link";

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
    <div className="flex min-h-screen items-center justify-center bg-paper-sunken p-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-signal-600 font-display text-sm text-white">
            L
          </span>
          <span className="font-display text-lg text-ink-900">Learners Area</span>
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
