export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-ink-100 ${className}`}>
      <div className="h-full rounded-full bg-signal-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
