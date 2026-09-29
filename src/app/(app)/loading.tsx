import { getLocale, getDictionary } from "@/lib/i18n";

/** Static, data-free fallback lets automatic Link prefetch stop before private page payloads. */
export default async function Loading() {
  const dict = getDictionary(await getLocale());
  return (
    <section
      className="workspace-route-feedback"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-route-loading
      data-private-loading-boundary
    >
      <h1 className="workspace-route-feedback__title">{dict.common.loading}</h1>
      <div className="workspace-route-feedback__skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
