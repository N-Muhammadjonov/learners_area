import { MaterialPlayer } from "./MaterialPlayer";
import type { materialBlocks } from "@/db/schema";

type Block = typeof materialBlocks.$inferSelect;

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BlockRenderer({ block, openLabel }: { block: Block; openLabel: string }) {
  switch (block.type) {
    case "text":
      return <p className="whitespace-pre-line text-sm text-ink-700">{block.textContent}</p>;

    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.objectUrl ?? ""}
          alt={block.originalName ?? ""}
          className="max-h-96 w-full rounded-md object-contain"
        />
      );

    case "audio":
      return <MaterialPlayer url={block.objectUrl ?? ""} type="audio" openLabel={openLabel} />;

    case "link":
      // Reuse the same embed-or-clean-card logic as materials' primary
      // link, so a YouTube/Vimeo link dropped into a description plays
      // inline too; anything else falls back to an honest "open" action.
      return <MaterialPlayer url={block.linkUrl ?? ""} type="link" openLabel={openLabel} />;

    case "file":
      return (
        <a
          href={block.objectUrl ?? ""}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-sm border border-ink-100 bg-paper-sunken px-3 py-2 text-sm hover:border-signal-400"
        >
          <span aria-hidden>📄</span>
          <span className="flex-1 truncate text-ink-900">{block.originalName ?? "File"}</span>
          <span className="text-xs text-ink-300">{formatSize(block.size)}</span>
        </a>
      );

    default:
      return null;
  }
}
