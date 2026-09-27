import { getDictionary, getLocale } from "@/lib/i18n";

export default async function Loading() {
  const dict = getDictionary(await getLocale());
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-5" data-route-loading>
      <p className="meta-text">{dict.common.loading}</p>
      <div aria-hidden className="h-8 w-1/2 rounded-lg bg-paper-sunken motion-safe:animate-pulse" />
      <div aria-hidden className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((key) => <div key={key} className="h-32 rounded-2xl border border-ink-100 bg-paper-raised motion-safe:animate-pulse" />)}
      </div>
    </div>
  );
}
