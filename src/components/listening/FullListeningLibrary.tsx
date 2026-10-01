"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
type Card = {
  id: string;
  title: string;
  duration: number;
  completed: number;
  started: boolean;
};
export function FullListeningLibrary({ cards }: { cards: Card[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const visible = useMemo(
    () =>
      cards.filter(
        (t) =>
          ["All", "Full Listening"].includes(filter) &&
          t.title.toLowerCase().includes(search.toLowerCase()),
      ),
    [cards, search, filter],
  );
  const completed = cards.reduce((n, t) => n + Number(t.completed), 0);
  return (
    <section
      className="listening-library space-y-6"
      data-async-content="listening-tests"
    >
      <div className="card flex items-center justify-between">
        <span>Learning progress on this page</span>
        <span>
          {completed} / {cards.length * 5} activities
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[
          "All",
          "Full Listening",
          "Section 1",
          "Section 2",
          "Section 3",
          "Section 4",
        ].map((name) => (
          <button
            type="button"
            className={filter === name ? "btn-primary" : "btn-secondary"}
            aria-pressed={filter === name}
            key={
              name === "All"
                ? "✨ All"
                : name === "Full Listening"
                  ? "🎧 Full Listening"
                  : `🎙️ ${name}`
            }
            onClick={() => setFilter(name)}
          >
            {name === "All"
              ? "✨ All"
              : name === "Full Listening"
                ? "🎧 Full Listening"
                : `🎙️ ${name}`}
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
            className="listening-library-card card flex min-h-72 flex-col gap-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="listening-library-badge badge">
                40 QUESTIONS
              </span>
              <span className="text-sm">
                {Number(t.completed) === 5
                  ? "✓ Completed"
                  : t.started
                    ? "In progress"
                    : "Not started"}
              </span>
            </div>
            <h2 className="font-display text-xl font-bold">{t.title}</h2>
            <p>4 Sections · 40 Questions · {Math.round(t.duration / 60)} min</p>
            <p>5 Activities</p>
            <div>
              <progress
                className="w-full"
                max={5}
                value={Number(t.completed)}
              />
              <p>{t.completed} / 5 completed</p>
            </div>
            <Link
              className="btn-primary mt-auto"
              href={`/listening/tests/${t.id}`}
            >
              {Number(t.completed) === 5
                ? "📖 Review"
                : t.started
                  ? "▶ Continue"
                  : "▶ Start"}
            </Link>
          </article>
        ))}
      </div>
      {!visible.length && (
        <p className="card">
          {filter.startsWith("Section")
            ? "No independently published section materials in this category."
            : "No matching published Full Listening tests."}
        </p>
      )}
    </section>
  );
}
