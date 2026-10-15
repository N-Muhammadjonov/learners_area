"use client";
import { StartTestButton } from "./StartTestButton";
import Link from "next/link";
import { ListeningTestActions } from "./ListeningTestActions";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { CollectionTab } from "@/lib/listening/product";

/**
 * Every collection the library can show, INCLUDING the two practice products.
 *
 * `question_types` and `mcq` used to be folded into the academic tab, which presented a
 * dedicated MCQ training package as if it were a formal Academic full test. A card is listed
 * under its OWN collection: a practice package is visible under its own name and never
 * counted as an academic test. The labels for both collections already exist in the dictionary.
 */
const collections = ["essential", "academic", "general", "question_types", "mcq", "uncatalogued"] as const satisfies readonly CollectionTab[];
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
type Card = {
  id: string;
  title: string;
  duration: number;
  sectionNumbers?: number[];
  activityCount?: number;
  /** The real question count of a row with no canonical package (never an assumed 40). */
  questions?: number;
  completed: number;
  started: boolean;
  collection?: string;
  legacy?: boolean;
  authoredRuntime?: boolean;
  publicationState?: string;
};
export function FullListeningLibrary({ cards, dict, management = false }: { cards: Card[]; dict: Dictionary; management?: boolean }) {
  const t = dict.fullListeningHub.library;
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("academic");
  const [section, setSection] = useState(0);
  // The card's own collection decides its tab. Nothing is reclassified here: the catalogue
  // membership rule lives in `src/lib/listening/product.ts` and is read by the server, which
  // files each card under the product its authored facts prove. A card that proves NOTHING is
  // `uncatalogued` — it used to fall back to "academic", which stated something untrue about
  // the content. The extra tab appears only when such a card exists.
  const categoryOf = (card: Card) => card.collection ?? "uncatalogued";
  const tabs = collections.filter(
    (key) => key !== "uncatalogued" || cards.some((card) => categoryOf(card) === "uncatalogued"),
  );
  const categoryCards = cards.filter(
    (c) => categoryOf(c) === collection,
  );
  const visible = categoryCards.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()) && (!section || (c.sectionNumbers ?? [1,2,3,4]).includes(section)),
  );
  return (
    <section
      className="listening-library space-y-6"
      data-async-content="listening-tests"
    >
      <nav
        className="listening-collection-tabs"
        aria-label={t.collections}
      >
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            data-listening-collection={key}
            aria-pressed={collection === key}
            onClick={() => {
              setCollection(key);
              setSection(0);
            }}
          >
            {t[key]} (
            {cards.filter((c) => categoryOf(c) === key).length})
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        {collection === "general" &&
          [0, ...new Set(categoryCards.flatMap(card => card.sectionNumbers ?? [1,2,3,4]))].sort((a,b) => a-b).map((n) => (
            <button
              type="button"
              key={n}
              aria-pressed={section === n}
              className={section === n ? "btn-primary" : "btn-secondary"}
              onClick={() => setSection(n)}
            >
              {n ? fill(t.sectionN, { n }) : t.fullListening}
            </button>
          ))}
        <label className="ml-auto">
          {t.search}
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="full-listening-grid">
        {visible.map((card) => (
          <article
            key={card.id}
            className="listening-library-card card p-5 flex flex-col gap-3"
          >
            {management && card.publicationState === "archived" && <p data-archived-listening-test className="text-sm text-ink-500">Archived. Use Delete to permanently remove this unused test.</p>}
            {management && <ListeningTestActions id={card.id} title={card.title} dict={dict} />}
            <span className="listening-library-badge badge">
              {card.legacy
                ? fill(t.questionsMeta, { n: card.questions ?? 0 })
                : card.authoredRuntime
                  ? dict.nav.listening
                  : section
                    ? t.badgeSection
                    : t.badgeFull}
            </span>
            <h2 className="font-display text-xl font-bold">{card.title}</h2>
            <p>
              {card.authoredRuntime ? fill(t.authoredMeta, { min: Math.round(card.duration / 60) }) : section
                ? fill(t.sectionOf, { n: section })
                : card.legacy ? t.legacyMeta : fill(t.fullMeta, { parts: card.sectionNumbers?.length ?? 4, min: Math.round(card.duration / 60) })}
            </p>
            {!card.authoredRuntime && <><progress
              className="w-full"
              max={card.activityCount ?? 5}
              value={Number(card.completed)}
              aria-label={fill(t.progressLabel, { title: card.title })}
            />
            <p>{fill(t.completedOf5, { done: card.completed, total: card.activityCount ?? 5 })}</p></>}
            {card.legacy ? management ? <Link className="btn-primary" href={`/app/admin/listening/${card.id}`}>{dict.common.continue} →</Link> : <StartTestButton testId={card.id} label={dict.listening.startAttempt} messages={dict.auth} /> : (
            <Link
              className="btn-primary mt-auto"
              href={
                section && !card.authoredRuntime
                  ? `/app/listening/tests/${card.id}/study?section=${section}`
                  : `/app/listening/tests/${card.id}`
              }
            >
              {section
                ? t.openSection
                : Number(card.completed) >= (card.activityCount ?? 5)
                  ? t.review
                  : card.started
                    ? t.continue
                    : t.start}
            </Link>            )}

          </article>
        ))}
      </div>
      {!visible.length && (
        <p className="card p-5">{t.empty}</p>
      )}
    </section>
  );
}
