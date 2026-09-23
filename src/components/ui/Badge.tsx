export type ContentState = "locked" | "available" | "assigned" | "in_progress" | "completed";

const stateClass: Record<ContentState, string> = {
  locked: "badge-locked",
  available: "badge bg-signal-100 text-signal-700",
  assigned: "badge bg-band-warn/10 text-band-warn",
  in_progress: "badge bg-band-warn/10 text-band-warn",
  completed: "badge-done",
};

const stateLabel: Record<ContentState, string> = {
  locked: "Locked",
  available: "Available",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
};

export function StateBadge({ state }: { state: ContentState }) {
  return <span className={stateClass[state]}>{stateLabel[state]}</span>;
}

export function BandBadge({ band }: { band: number | null | undefined }) {
  if (band === null || band === undefined) {
    return <span className="badge-locked">—</span>;
  }
  const tone = band >= 7 ? "text-band-good" : band >= 5.5 ? "text-band-warn" : "text-band-bad";
  return <span className={`badge bg-paper-sunken font-mono ${tone}`}>{band.toFixed(1)}</span>;
}

export type VocabStateValue = "new" | "learning" | "review" | "known" | "mastered" | "activated";

const vocabStateClass: Record<VocabStateValue, string> = {
  new: "badge bg-ink-100 text-ink-500",
  learning: "badge bg-band-warn/10 text-band-warn",
  review: "badge bg-signal-100 text-signal-700",
  known: "badge bg-band-good/10 text-band-good",
  mastered: "badge bg-band-good/20 text-band-good",
  activated: "badge bg-signal-600 text-white",
};

export function VocabBadge({ state, label }: { state: VocabStateValue; label: string }) {
  return <span className={vocabStateClass[state]}>{label}</span>;
}
