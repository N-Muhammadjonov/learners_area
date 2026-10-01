"use client";
import Link from "next/link";
import { useState } from "react";
const collections = [
  ["essential", "▶ Essential Recordings"],
  ["academic", "🎧 Academic Listening"],
  ["general", "🎙️ General Listening"],
  ["question_types", "📚 Question types"],
  ["mcq", "🔑 MCQ Mastery"],
] as const;
type Card = {
  id: string;
  title: string;
  duration: number;
  completed: number;
  started: boolean;
  collection?: string;
};
export function FullListeningLibrary({ cards }: { cards: Card[] }) {
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("academic");
  const [section, setSection] = useState(0);
  const categoryCards = cards.filter(
    (t) => (t.collection ?? "academic") === collection,
  );
  const visible = categoryCards.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()),
  );
  const completed = categoryCards.reduce((n, t) => n + Number(t.completed), 0);
  return (
    <section
      className="listening-library space-y-6"
      data-async-content="listening-tests"
    >
      <nav
        className="listening-collection-tabs"
        aria-label="Listening collections"
      >
        {collections.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={collection === key}
            onClick={() => {
              setCollection(key);
              setSection(0);
            }}
          >
            {label} (
            {cards.filter((t) => (t.collection ?? "academic") === key).length})
          </button>
        ))}
      </nav>
      <div className="listening-summary card flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-3xl font-bold">{categoryCards.length}</p>
          <p>Published tests on this page</p>
        </div>
        <p>Exam → Review → Keyword Match → Vocabulary</p>
        <p>
          {completed} / {categoryCards.length * 5} activities completed
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
              {n ? `🎙️ Section ${n}` : "🎧 Full Listening"}
            </button>
          ))}
        <label className="ml-auto">
          Search listening tests
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="full-listening-grid">
        {visible.map((t) => (
          <article
            key={t.id}
            className="listening-library-card card flex flex-col gap-3"
          >
            <span className="listening-library-badge badge">
              {section ? "10 questions · controlled review" : "40 questions"}
            </span>
            <h2 className="font-display text-xl font-bold">{t.title}</h2>
            <p>
              {section
                ? `Section ${section} of the full recording`
                : `4 Sections · ${Math.round(t.duration / 60)} min`}
            </p>
            <progress
              className="w-full"
              max={5}
              value={Number(t.completed)}
              aria-label={`${t.title}: completed activities`}
            />
            <p>{t.completed} / 5 completed</p>
            <Link
              className="btn-primary mt-auto"
              href={
                section
                  ? `/listening/tests/${t.id}/study?section=${section}`
                  : `/listening/tests/${t.id}`
              }
            >
              {section
                ? "▶ Open section"
                : Number(t.completed) === 5
                  ? "📖 Review"
                  : t.started
                    ? "▶ Continue"
                    : "▶ Start"}
            </Link>
          </article>
        ))}
      </div>
      {!visible.length && (
        <p className="card">No matching published tests in this collection.</p>
      )}
    </section>
  );
}
