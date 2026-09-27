import Link from "next/link";
import type { Metadata } from "next";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BRAND } from "@/lib/config/brand";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { publicBaseUrl } from "@/lib/config/site";

export const metadata: Metadata = {
  title: `${BRAND.siteName} — IELTS inside a private centre`,
  description: BRAND.tagline,
  ...(publicBaseUrl ? {
    alternates: { canonical: `${publicBaseUrl}/` },
    openGraph: { url: `${publicBaseUrl}/`, title: BRAND.siteName, description: BRAND.tagline, type: "website" },
  } : {}),
};

/**
 * The public front door.
 *
 * Deliberately one thing: the name, and one way in. No feature list, no hero
 * image, no logo above the headline — the first dominant element is the sentence
 * itself. Anything else competes with the only action the page offers.
 *
 * The page is painted in the brand's night palette regardless of the reader's
 * Day/Night preference. That is a presentation decision, not a theme bypass: it
 * uses the same tokens as the rest of the product (`--paper`, `--ink-900`,
 * `--gold`), so the landing and the application can never drift apart, and the
 * reader's own Day/Night choice still governs everything behind the login.
 *
 * The call to action is resolved on the server from the database row: an
 * approved account goes straight to the dashboard, and every other state is sent
 * to the waiting screen that already knows how to explain itself. The account
 * status is never read from the cookie, so a stale tab cannot show the wrong way
 * in.
 */
export default async function Home() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const t = dict.landing;

  const user = await getCurrentUser();
  const destination = !user ? "/login" : hasPrivateAccess(user.accountStatus) ? "/dashboard" : "/pending";

  return (
    <div
      data-theme="night"
      className="flex min-h-dvh flex-col bg-paper text-ink-900"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="max-w-4xl font-display text-4xl leading-tight tracking-tight text-ink-900 sm:text-5xl md:text-6xl">
          <span className="block">{t.headlineLead}</span>
          {/*
            The two lines are block elements, so without a space between them the
            heading reads as "…next levelwith LEARNERS AREA" to a screen reader —
            and to anything else that takes the text rather than the picture. The
            explicit space is invisible on screen and keeps the sentence whole.
          */}
          {" "}
          <span className="mt-1 block">
            {t.headlineWith} <span className="text-gold">{t.headlineAccent}</span>
          </span>
        </h1>

        {/* One restrained divider: the only ornament on the page. */}
        <span aria-hidden className="mt-8 block h-px w-24 bg-gold/70 sm:w-32" data-landing-divider />

        <Link
          href={destination}
          data-landing-cta
          data-landing-cta-destination={destination}
          className="mt-10 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-gold px-7 py-3 text-base font-medium text-ink-950 transition-colors hover:bg-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-900"
        >
          {t.cta}
          <span aria-hidden>→</span>
        </Link>
      </main>

      <footer
        className="px-6 pb-8 text-center text-xs text-ink-300"
        style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
        data-landing-footer
      >
        {t.footer}
      </footer>
    </div>
  );
}
