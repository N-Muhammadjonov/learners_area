import Link from "next/link";
import { StateBadge } from "@/components/ui/Badge";
import type { ComponentProps } from "react";
import { youtubeThumbnailUrl } from "@/lib/services/video/provider";
import { VideoThumbnail } from "@/components/video/VideoThumbnail";

type BadgeState = ComponentProps<typeof StateBadge>["state"];

/**
 * Thumbnail-first library card for TED / PODCAST. The whole card is one
 * internal Next Link (one tab stop); no iframe, no external link. Metadata is
 * only what is stored: duration when known, and the course path for
 * roadmap-linked items.
 */
export function VideoLessonCard({
  href,
  title,
  provider,
  videoId,
  durationSeconds,
  state,
  context,
  minutesLabel,
  entryId,
  standalone,
}: {
  href: string;
  title: string;
  provider: string;
  videoId: string;
  durationSeconds: number | null;
  state: BadgeState;
  context?: string | null;
  minutesLabel: string;
  entryId: string;
  standalone: boolean;
}) {
  const thumb = provider === "youtube" ? youtubeThumbnailUrl(videoId) : null;
  const minutes = durationSeconds && durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : null;
  return (
    <li className="min-w-0" data-video-lesson-entry={entryId}>
      <Link
        href={href}
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-paper-50 transition-colors hover:border-ink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600"
        data-video-lesson-open
        data-video-standalone-open={standalone ? entryId : undefined}
      >
        <VideoThumbnail src={thumb} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div><StateBadge state={state} /></div>
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink-900 sm:line-clamp-3" data-video-card-title>{title}</h3>
          {minutes !== null || context ? (
            <p className="mt-auto line-clamp-2 text-xs text-ink-500" data-video-card-meta>
              {[minutes !== null ? minutesLabel.replace("{n}", String(minutes)) : null, context].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
