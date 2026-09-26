/**
 * What the reader sees while a route's data is in flight.
 *
 * The shell (sidebar, topbar) is rendered by the layout above this file and
 * stays exactly where it is: only the content area shows a skeleton. That is the
 * difference between "the application is thinking" and "the site went blank",
 * which is what a hard refresh used to look like.
 *
 * The skeleton approximates the real page structure — a heading, a row of
 * summary panels, then content blocks — so the layout does not jump when the
 * data arrives.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-8" data-route-loading aria-busy="true">
      <div className="flex flex-col gap-3">
        <span className="h-9 w-64 max-w-[60%] animate-pulse rounded-lg bg-paper-sunken" />
        <span className="h-5 w-96 max-w-[80%] animate-pulse rounded bg-paper-sunken" />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="panel flex flex-col gap-4">
            <span className="h-5 w-1/2 animate-pulse rounded bg-paper-sunken" />
            <span className="h-4 w-full animate-pulse rounded bg-paper-sunken" />
            <span className="h-4 w-3/4 animate-pulse rounded bg-paper-sunken" />
          </div>
        ))}
      </div>

      <div className="panel flex flex-col gap-3">
        <span className="h-5 w-40 animate-pulse rounded bg-paper-sunken" />
        <span className="h-4 w-full animate-pulse rounded bg-paper-sunken" />
        <span className="h-4 w-full animate-pulse rounded bg-paper-sunken" />
        <span className="h-4 w-2/3 animate-pulse rounded bg-paper-sunken" />
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
