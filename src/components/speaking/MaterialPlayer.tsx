import { resolveEmbedSource } from "@/lib/embed";

export function MaterialPlayer({
  url,
  type,
  openLabel,
  emptyLabel,
}: {
  /** Null means the file has not been uploaded yet — a real state, not an error. */
  url: string | null;
  type: "video" | "audio" | "file" | "link";
  openLabel: string;
  emptyLabel: string;
}) {
  if (!url) {
    return (
      <p className="rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500" data-material-empty>
        {emptyLabel}
      </p>
    );
  }

  const source = resolveEmbedSource(url, type);

  if (source.kind === "iframe") {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-md bg-ink-950">
        <iframe
          src={source.embedUrl}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  if (source.kind === "video") {
    return (
      <video controls className="w-full rounded-md bg-ink-950">
        <source src={source.src} />
      </video>
    );
  }

  if (source.kind === "audio") {
    return <audio controls className="w-full" src={source.src} />;
  }

  // Only reached for a link we couldn't recognise/embed — an honest
  // exception, not the default path. Still no raw URL text is shown.
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="btn-secondary">
      {openLabel} ↗
    </a>
  );
}
