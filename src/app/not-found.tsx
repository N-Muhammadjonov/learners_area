import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BRAND } from "@/lib/config/brand";

/**
 * A 404 that speaks the reader's language and offers a way back.
 *
 * This is the outer not-found, so it renders on the public side too (a wrong URL
 * before login). It stays deliberately plain: the brand, one sentence, two ways
 * forward. It never shows a request id, a stack or a path — a not-found page
 * that echoes the path is a small information leak and a large confusion.
 */
export default async function NotFound() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const t = dict.notFoundPage;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="font-display text-[1.25rem] text-ink-900">{BRAND.siteName}</p>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[1.75rem] leading-snug text-ink-900">{t.title}</h1>
        <p className="body-text max-w-[46ch]">{t.body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/app/dashboard" className="btn-primary">
          {t.dashboard}
        </Link>
        <Link href="/" className="btn-secondary">
          {t.back}
        </Link>
      </div>
    </main>
  );
}
