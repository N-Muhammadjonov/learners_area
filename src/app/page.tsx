import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";

export default function Home() {
  const dict = getDictionary(getLocale());

  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-signal-600 font-display text-sm text-white">
            L
          </span>
          <span className="font-display text-lg text-ink-900">{dict.marketing.title}</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-ink-700 hover:text-ink-900">
            {dict.marketing.ctaLogin}
          </Link>
          <Link href="/register" className="btn-primary">
            {dict.marketing.ctaStart}
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-16 text-center">
        <h1 className="font-display text-4xl leading-tight text-ink-900 sm:text-5xl">
          {dict.marketing.tagline}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-ink-500">{dict.marketing.heroBody}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">
            {dict.marketing.ctaStart}
          </Link>
          <Link href="/login" className="btn-secondary px-6 py-3 text-base">
            {dict.marketing.ctaLogin}
          </Link>
        </div>
        <p className="mt-4 text-xs text-ink-300">{dict.marketing.trialNote}</p>
      </main>

      <section className="border-t border-ink-100 bg-paper-raised py-16">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 sm:grid-cols-3">
          {[
            { title: dict.nav.writing, body: "Draft, submit, get a four-criterion breakdown, and see it in your history." },
            { title: dict.nav.vocabulary, body: "Every module feeds one spaced-repetition vocabulary box." },
            { title: dict.nav.progress, body: "A roadmap and skill summary built from what you've actually done." },
          ].map((f) => (
            <div key={f.title}>
              <h3 className="font-display text-lg text-ink-900">{f.title}</h3>
              <p className="mt-1.5 text-sm text-ink-500">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
