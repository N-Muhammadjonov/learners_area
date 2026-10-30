/** Pure helpers mirrored from original src/lib/services/video/provider.ts and src/components/courses/VideoLessonStudio.tsx.
 * No DOM, no network. The server stays the authority: these only validate what the page is about to frame or load. */

/** A YouTube id is 11 characters of [A-Za-z0-9_-] (provider.ts VIDEO_ID). */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Owner-authorised direct media file name (provider.ts DIRECT_MEDIA_ID). */
export const DIRECT_MEDIA_ID = /^[A-Za-z0-9_-]{1,32}\.(mp4|webm)$/;

const ORIGIN = /^https?:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/** Only a scheme + host (+ port) is ever used as the YouTube `origin` parameter. Anything else means no parameter. */
export function safeEmbedOrigin(value) {
  return typeof value === 'string' && ORIGIN.test(value) ? value : null;
}

/** The player iframe URL (provider.ts embedUrlFor + the `&start=` resume appended by VideoLessonStudio).
 * Parameter order and values match the original exactly; no autoplay parameter is ever added. */
export function embedUrlFor(provider, videoId, { origin = null, start = 0 } = {}) {
  if (provider !== 'youtube') throw new Error(`unsupported provider: ${provider}`);
  if (!YOUTUBE_ID.test(videoId)) throw new Error('invalid video id');
  const params = new URLSearchParams({ rel: '0', playsinline: '1', enablejsapi: '1', controls: '1', cc_load_policy: '1' });
  if (origin) params.set('origin', origin);
  const resume = start > 0 ? `&start=${Math.floor(start)}` : '';
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}${resume}`;
}

/** Static library still for a validated YouTube id (no iframe). Null for anything else, so the card shows its fallback. */
export function youtubeThumbnailUrl(videoId) {
  return YOUTUBE_ID.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

/** Direct media URLs must be https and come from one origin, as directMediaUrls() builds them on the server. */
export function safeDirectMedia(value) {
  if (!value || typeof value !== 'object') return null;
  const src = value.src;
  const captions = value.captions ?? null;
  try {
    const media = new URL(src);
    if (media.protocol !== 'https:') return null;
    if (captions !== null) {
      const track = new URL(captions);
      if (track.protocol !== 'https:' || track.origin !== media.origin) return null;
    }
  } catch {
    return null;
  }
  return { src, captions };
}

/** mm:ss label used for transcript lines, question seek buttons and the direct player. */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** "N min" label rule of video-lesson cards and the detail header: at least 1 minute, rounded. */
export function minutesFrom(durationSeconds) {
  return durationSeconds && durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : null;
}
