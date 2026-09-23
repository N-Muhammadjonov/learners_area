"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Dictionary } from "@/lib/i18n/en";

type DueItem = {
  entryId: string;
  term: string;
  definitionEn: string;
  translationUz: string | null;
  exampleSentence: string | null;
};

export function ReviewDeck({ dict, initialItems }: { dict: Dictionary; initialItems: DueItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);

  const current = items[index];

  if (!current) {
    return (
      <EmptyState
        icon="✓"
        title={dict.vocabulary.emptyDeck}
        action={
          <Button variant="secondary" onClick={() => router.push("/vocabulary")}>
            {dict.common.back}
          </Button>
        }
      />
    );
  }

  async function grade(g: "again" | "hard" | "good" | "easy") {
    if (!current) return;
    setGrading(true);
    await fetch(`/api/vocabulary/${current.entryId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade: g }),
    });
    setGrading(false);
    setRevealed(false);
    if (index + 1 < items.length) {
      setIndex(index + 1);
    } else {
      setItems([]);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs text-ink-300">
        {index + 1} / {items.length}
      </p>
      <Card className="flex min-h-[200px] w-full max-w-md flex-col items-center justify-center gap-3 text-center">
        <p className="font-display text-2xl text-ink-900">{current.term}</p>
        {revealed ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-700">{current.definitionEn}</p>
            {current.translationUz && <p className="text-sm text-signal-600">{current.translationUz}</p>}
            {current.exampleSentence && (
              <p className="mt-1 text-xs italic text-ink-300">{current.exampleSentence}</p>
            )}
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setRevealed(true)}>
            {dict.vocabulary.reveal}
          </Button>
        )}
      </Card>
      {revealed && (
        <div className="grid grid-cols-4 gap-2">
          <Button variant="secondary" disabled={grading} onClick={() => grade("again")}>{dict.vocabulary.grade.again}</Button>
          <Button variant="secondary" disabled={grading} onClick={() => grade("hard")}>{dict.vocabulary.grade.hard}</Button>
          <Button variant="secondary" disabled={grading} onClick={() => grade("good")}>{dict.vocabulary.grade.good}</Button>
          <Button variant="secondary" disabled={grading} onClick={() => grade("easy")}>{dict.vocabulary.grade.easy}</Button>
        </div>
      )}
    </div>
  );
}
