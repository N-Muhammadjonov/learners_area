"use client";
import Link from "next/link";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

const collections = ["essential", "academic", "general", "question_types", "mcq"] as const;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
type Card = {
  id: string;
  title: string;
  duration: number;
  completed: number;
  started: boolean;
  collection?: string;
};
export function FullListeningLibrary({ cards, dict }: { cards: Card[]; dict: Dictionary }) {
  const t = dict.fullListeningHub.library;
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("academic");
  const [section, setSection] = useState(0);
  const categoryCards = cards.filter(
    (c) => (c.collection ?? "academic") === collection,
  );
  const visible = categoryCards.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()),
  );
  const completed = categoryCards.reduce((n, c) => n + Number(c.completed), 0);
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
            {cards.filter((c) => (c.collection ?? "academic") === key).length})
          </button>
        ))}
      </nav>
      <div className="listening-summary card flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-3xl font-bold">{categoryCards.length}</p>
          <p>{t.publishedOnPage}</p>
        </div>
        <p>{t.flow}</p>
        <p>
          {fill(t.activitiesCompleted, { done: completed, total: categoryCards.length * 5 })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {collection === "general" &&
          [0, 1, 2, 3, 4].map((n) => (
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
            <span className="listening-library-badge badge">
              {section ? t.badgeSection : t.badgeFull}
            </span>
            <h2 className="font-display text-xl font-bold">{card.title}</h2>
            <p>
              {section
                ? fill(t.sectionOf, { n: section })
                : fill(t.fullMeta, { min: Math.round(card.duration / 60) })}
            </p>
            <progress
              className="w-full"
              max={5}
              value={Number(card.completed)}
              aria-label={fill(t.progressLabel, { title: card.title })}
            />
            <p>{fill(t.completedOf5, { done: card.completed })}</p>
            <Link
              className="btn-primary mt-auto"
              href={
                section
                  ? `/listening/tests/${card.id}/study?section=${section}`
                  : `/listening/tests/${card.id}`
              }
            >
              {section
                ? t.openSection
                : Number(card.completed) === 5
                  ? t.review
                  : card.started
                    ? t.continue
                    : t.start}
            </Link>
          </article>
        ))}
      </div>
      {!visible.length && (
        <p className="card p-5">{t.empty}</p>
      )}
    </section>
  );
}
