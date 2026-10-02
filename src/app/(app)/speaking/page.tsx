import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { SPEAKING_HUB_CARDS } from "@/lib/speaking/hub";

/**
 * Speaking home: exactly four product entries (owner spec §26–29). The
 * lesson library, its empty state and the pronunciation drills all live on
 * the Speaking lessons page, never here.
 */
export default async function SpeakingPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.speakingHub;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="speaking">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.speaking.title}</h1>
        <p className="mt-1 text-base text-ink-500">{t.intro}</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" data-speaking-hub-cards>
        {SPEAKING_HUB_CARDS.map(({ key, href }) => (
          <li key={key}>
            <Link href={href} data-speaking-card={key}
              className="card group flex h-full min-h-56 flex-col gap-3 p-6 transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-500 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.cards[key].eyebrow}</span>
              <span className="font-display text-xl text-ink-900">{t.cards[key].title}</span>
              <span className="text-base text-ink-500">{t.cards[key].body}</span>
              <span className="btn-secondary mt-auto self-start">{t.cards[key].cta} <span aria-hidden>→</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
