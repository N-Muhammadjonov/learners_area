/**
 * The empty state, in one place.
 *
 * An empty screen is not a mistake to hide — it is the answer to a question the
 * reader just asked ("what is here?"), and it has to say so in a sentence and
 * point somewhere. A grid with nothing in it looks like a broken page; the same
 * grid with one honest line and a way out looks like a product that works.
 *
 * The icon accepts a node as well as a glyph so the shell's own stroke icons can
 * be used without a second component.
 */
export function EmptyState({
  icon = "○",
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center gap-2 py-12 text-center" data-empty-state>
      <span aria-hidden className="flex h-11 w-11 items-center justify-center text-[22px] text-ink-300">
        {icon}
      </span>
      <p className="font-medium text-ink-900">{title}</p>
      {body && <p className="max-w-[52ch] text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
