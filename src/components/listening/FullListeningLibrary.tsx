"use client";
import { StartTestButton } from "./StartTestButton";
import Link from "next/link";
import { ListeningTestActions } from "./ListeningTestActions";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

const collections = ["essential", "academic", "general"] as const;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
type Card = {
  id: string;
  title: string;
  duration: number;
  sectionNumbers?: number[];
  activityCount?: number;
  completed: number;
  started: boolean;
  collection?: string;
  legacy?: boolean;
  authoredRuntime?: boolean;
};
export function FullListeningLibrary({ cards, dict, management = false }: { cards: Card[]; dict: Dictionary; management?: boolean }) {
  const t = dict.fullListeningHub.library;
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("academic");
  const [section, setSection] = useState(0);
  const categoryOf = (card: Card) => ["question_types", "mcq"].includes(card.collection ?? "") ? "academic" : card.collection ?? "academic";
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
        {collections.map((key) => (
          <button
            key={key}
            type="button"
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
            {management && <ListeningTestActions id={card.id} title={card.title} dict={dict} />}
            <span className="listening-library-badge badge">
              {card.authoredRuntime ? dict.nav.listening : section ? t.badgeSection : t.badgeFull}
            </span>
            <h2 className="font-display text-xl font-bold">{card.title}</h2>
            <p>
              {card.authoredRuntime ? fill(t.authoredMeta, { min: Math.round(card.duration / 60) }) : section
                ? fill(t.sectionOf, { n: section })
                : card.legacy ? t.badgeFull : fill(t.fullMeta, { parts: card.sectionNumbers?.length ?? 4, min: Math.round(card.duration / 60) })}
            </p>
            {!card.authoredRuntime && <><progress
              className="w-full"
              max={card.activityCount ?? 5}
              value={Number(card.completed)}
              aria-label={fill(t.progressLabel, { title: card.title })}
            />
            <p>{fill(t.completedOf5, { done: card.completed, total: card.activityCount ?? 5 })}</p></>}
            {card.legacy ? management ? <Link className="btn-primary" href={`/admin/listening/${card.id}`}>{dict.common.continue} →</Link> : <StartTestButton testId={card.id} label={dict.listening.startAttempt} messages={dict.auth} /> : (
            <Link
              className="btn-primary mt-auto"
              href={
                section && !card.authoredRuntime
                  ? `/listening/tests/${card.id}/study?section=${section}`
                  : `/listening/tests/${card.id}`
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
