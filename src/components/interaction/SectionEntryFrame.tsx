"use client";

import type { EntryFrameModel, EntryFrameShape } from "@/lib/interaction/section-entry";

type SectionEntryFrameProps = {
  routeKey: string;
  frame: EntryFrameModel;
  privateBoundary?: boolean;
  stalled?: boolean;
  slowMessage?: string;
  retryLabel?: string;
  onRetry?: () => void;
};

/**
 * A route-specific workspace identity with only its unresolved local region
 * skeletonized. It is intentionally not a generic "Loading" destination page.
 */
export function SectionEntryFrame({
  routeKey,
  frame,
  privateBoundary = false,
  stalled = false,
  slowMessage,
  retryLabel,
  onRetry,
}: SectionEntryFrameProps) {
  return (
    <section
      className="mx-auto flex w-full max-w-6xl flex-col gap-4"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
      data-entry-frame
      data-section-entry-frame={routeKey}
      data-private-loading-boundary={privateBoundary ? "true" : undefined}
    >
      <header>
        <h1 className="font-display text-2xl text-ink-900" tabIndex={-1}>{frame.title}</h1>
        {frame.subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-500">{frame.subtitle}</p>}
      </header>

      {frame.tabs && (
        <div className="flex gap-1 overflow-hidden rounded-md border border-ink-100 bg-paper-raised p-1" data-entry-tab-shell aria-hidden="true">
          {frame.tabs.map((label, index) => (
            <span key={`${label}-${index}`} className={`h-9 shrink-0 rounded-sm px-3 py-2 text-xs ${index === 0 ? "bg-signal-50 text-ink-500" : "text-ink-300"}`}>
              {label}
            </span>
          ))}
        </div>
      )}

      <EntryRegion shape={frame.shape} />

      {stalled && slowMessage && retryLabel && onRetry && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-band-bad/30 bg-band-bad/5 px-3 py-2 text-sm" role="alert" data-entry-retry>
          <span className="text-ink-700">{slowMessage}</span>
          <button type="button" className="btn-secondary" onClick={onRetry}>{retryLabel}</button>
        </div>
      )}
    </section>
  );
}

function EntryRegion({ shape }: { shape: EntryFrameShape }) {
  return (
    <div aria-hidden="true" data-entry-region={shape} data-async-loading={`entry-${shape}`} className="flex flex-col gap-3">
      {shape === "dashboard" && <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <Block key={item} className="h-20" />)}</div>
        <div className="grid gap-3 sm:grid-cols-2"><Block className="h-28" /><Block className="h-28" /></div>
      </>}
      {shape === "classes" && <RowSkeletons count={3} height="h-20" />}
      {shape === "assignments" && <RowSkeletons count={2} height="h-28" />}
      {shape === "list" && <RowSkeletons count={3} height="h-16" />}
      {shape === "reading" && <>
        <div className="flex gap-2 overflow-hidden"><Block className="h-8 w-20" /><Block className="h-8 w-24" /><Block className="h-8 w-20" /><Block className="h-8 w-24" /></div>
        <RowSkeletons count={3} height="h-16" />
      </>}
      {shape === "writing" && <>
        <Block className="h-28" />
        <Block className="h-36" />
      </>}
      {shape === "speaking" && <RowSkeletons count={2} height="h-20" />}
      {shape === "grammar" && <RowSkeletons count={3} height="h-20" />}
      {shape === "vocabulary" && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[0, 1, 2].map((item) => <Block key={item} className="h-14" />)}</div>
        <RowSkeletons count={2} height="h-16" />
      </>}
      {shape === "progress" && <>
        <Block className="h-28" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <Block key={item} className="h-20" />)}</div>
      </>}
      {shape === "mocks" && <>
        <Block className="h-20" />
        <Block className="h-24" />
      </>}
      {shape === "management" && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((item) => <Block key={item} className="h-24" />)}</div>}
      {shape === "simple" && <RowSkeletons count={2} height="h-14" />}
    </div>
  );
}

function RowSkeletons({ count, height }: { count: number; height: string }) {
  return <>{Array.from({ length: count }, (_, index) => <Block key={index} className={height} />)}</>;
}

function Block({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded-xl bg-ink-50 ${className}`} />;
}
