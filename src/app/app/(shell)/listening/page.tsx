import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * LISTENING — the owner's FOUR destinations, and nothing else.
 *
 *   • Lessons            — authored lessons that carry listening material;
 *   • Academic Listening — the centre's published four-part Academic tests;
 *   • General Listening  — standalone General sections, one section per exercise;
 *   • Listening MCQ      — the dedicated 30-day programme, five staged questions a day.
 *
 * The four are different products, so this page is a DOORWAY and not a catalogue: it lists no
 * content, so it can neither file a day under Academic Listening, nor offer a full test inside the
 * MCQ programme, nor turn a General section into a day. Each destination states and pages its own
 * content on its own page, from its own reader.
 *
 * WHAT IS PRESERVED: the address itself (old bookmarks land here), the `?page=` parameter older
 * links carry (accepted and ignored — nothing is listed here any more, so there is no page to show),
 * and the link to the learner's own Listening history, which is a record of their work rather than a
 * product.
 */
const DESTINATIONS = [
  {
    key: "lessons",
    href: "/app/listening/lessons",
    emoji: "📚",
  },
  {
    key: "academic",
    href: "/app/listening/academic",
    emoji: "🎧",
  },
  {
    key: "general",
    href: "/app/listening/general",
    emoji: "🎙️",
  },
  {
    key: "mcq",
    href: "/app/listening/mcq",
    emoji: "🎯",
  },
] as const;

export default async function ListeningPage({
  searchParams,
}: {
  /** Older links carry `?page=`; the hub lists nothing, so the parameter is accepted and unused. */
  searchParams: Promise<{ page?: string }>;
}) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;

  const dict = getDictionary(locale);
  const t = dict.listening.hub;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening">
      <div>
        <h1 className="font-display text-2xl text-ink-900">🎧 {t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-listening-destinations>
        {DESTINATIONS.map((destination) => {
          // Each destination's own title and subtitle, from its own group — one vocabulary, and the
          // hub cannot describe a product differently from the page it opens.
          const copy = dict.listening[destination.key === "mcq" ? "mcqProgram" : destination.key];
          return (
            <section
              key={destination.key}
              className="card flex flex-col gap-2 p-5"
              data-listening-destination={destination.key}
            >
              <h2 className="font-display text-lg text-ink-900">
                {destination.emoji} {copy.title}
              </h2>
              <p className="text-sm text-ink-500">{copy.subtitle}</p>
              <div className="mt-auto pt-2">
                <Link
                  className="btn-primary"
                  href={destination.href}
                  data-listening-destination-open={destination.key}
                >
                  {t.open}
                </Link>
              </div>
            </section>
          );
        })}
      </div>

      {/* The learner's own record — not a product, and it says so. */}
      <p className="text-xs text-ink-300">
        <Link className="underline" href="/app/listening/history" data-listening-history-entry>
          {dict.listening.historyTitle}
        </Link>
      </p>
    </div>
  );
}
