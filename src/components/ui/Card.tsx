import { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card p-5 ${className}`} {...props} />;
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-300">{label}</span>
      <span className="font-display text-2xl text-ink-900">{value}</span>
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
    </Card>
  );
}
