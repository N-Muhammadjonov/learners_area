import Link from "next/link";
import { BrandBlock } from "@/components/shell/BrandBlock";
import type { Metadata } from "next";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BRAND } from "@/lib/config/brand";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { publicBaseUrl } from "@/lib/config/site";
import { ModuleEmoji, type ModuleEmojiKind } from "@/components/ui/ModuleEmoji";
import { DesktopIntro } from "@/components/brand/DesktopIntro";
export const metadata: Metadata = {
  title: `${BRAND.siteName} — IELTS inside a private centre`,
  description: BRAND.tagline,
  ...(publicBaseUrl
    ? {
        alternates: { canonical: `${publicBaseUrl}/` },
        openGraph: {
          url: `${publicBaseUrl}/`,
          title: BRAND.siteName,
          description: BRAND.tagline,
          type: "website",
        },
      }
    : {}),
};

const ornaments: ModuleEmojiKind[] = [
  "listening",
  "reading",
  "writing",
  "speaking",
  "grammar",
  "vocabulary",
];
export default async function Home() {
  const dict = getDictionary(await getLocale());
  const t = dict.landing;
  const user = await getCurrentUser();
  const destination = !user
    ? "/login"
    : hasPrivateAccess(user.accountStatus)
      ? "/app"
      : "/pending";
  return (
    <DesktopIntro destination={destination}>
    <div
      data-theme="night"
      className="la-welcome flex min-h-dvh flex-col bg-paper text-ink-900"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div className="la-welcome-cosmos" aria-hidden="true">
        <span className="la-welcome-ring la-welcome-ring-one" />
        <span className="la-welcome-ring la-welcome-ring-two" />
        <span className="la-welcome-aurora" />
      </div>
      <div className="px-6 pt-6"><a href="https://t.me/learners_area" target="_blank" rel="noopener noreferrer" aria-label={dict.shell.telegramBrand} data-landing-brand-link className="inline-flex rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><BrandBlock size={44} /></a></div>
      <main className="la-welcome-main flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="la-welcome-orbit" aria-hidden="true">
          {ornaments.map((kind, index) => (
            <span
              className={`la-welcome-chip la-welcome-chip-${index}`}
              key={kind}
            >
              <ModuleEmoji kind={kind} />
            </span>
          ))}
        </div>
        <h1 className="la-welcome-heading max-w-4xl font-display text-4xl font-bold leading-tight tracking-tight text-ink-900 sm:text-5xl md:text-6xl">
          <span className="la-welcome-text block">{t.headlineLead}</span>{" "}
          <span className="la-welcome-text la-welcome-text-second mt-1 block">
            {t.headlineWith}{" "}
            <span className="text-gold">{t.headlineAccent}</span>
          </span>
        </h1>
        <span
          aria-hidden="true"
          className="mt-8 block h-px w-24 bg-gold/70 sm:w-32"
          data-landing-divider
        />
        <Link
          href={destination}
          prefetch={false}
          data-landing-cta
          data-landing-cta-destination={destination}
          className="la-welcome-cta mt-10 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gold px-7 py-3 text-base font-semibold text-ink-950 transition-colors hover:bg-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-900"
        >
          {t.cta}
          <span aria-hidden="true">→</span>
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
    </DesktopIntro>
  );
}
