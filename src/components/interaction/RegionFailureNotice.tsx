import { RegionRetryButton } from "@/components/interaction/RegionRetryButton";

export function RegionFailureNotice({
  message,
  retryLabel,
  region,
}: {
  message: string;
  retryLabel: string;
  region: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-band-bad/30 bg-band-bad/5 px-3 py-2 text-sm"
      role="alert"
      data-secondary-region-error={region}
    >
      <span className="text-ink-700">{message}</span>
      <RegionRetryButton label={retryLabel} region={region} />
    </div>
  );
}
