export function EmptyState({
  icon = "○",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 py-12 text-center">
      <span aria-hidden className="text-2xl text-ink-300">{icon}</span>
      <p className="font-medium text-ink-900">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-500">{body}</p>}
      {action}
    </div>
  );
}
