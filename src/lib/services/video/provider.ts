/**
 * The one place that decides whether an external video may be embedded.
 *
 * Two rules drive everything here:
 *
 *   1. A raw embed snippet is never accepted. Authorised staff paste a normal
 *      video URL (or an id), the server parses it, validates the id and stores
 *      the provider + id. Nothing a user types becomes HTML.
 *   2. Only an allowlisted provider may be framed, because the
 *      Content-Security-Policy has to name it (see security-headers.ts). A host
 *      that is not on the list does not get a silent broken frame — it is
 *      reported as unsupported so the lesson can say so plainly.
 *
 * Honesty note, copied here on purpose because it is a product promise and not
 * an implementation detail: a video that plays in the browser is delivered to the
 * browser, so its source is visible in devtools. This module standardises URLs
 * and keeps the raw link out of the interface; it is not, and is not presented
 * as, a secrecy mechanism.
 *
 * Pure module — unit tested without a server.
 */

export type VideoProvider = "youtube" | "direct";

/**
 * "direct" = a media file on the owner-authorised origin (AUTHORIZED_MEDIA_ORIGIN),
 * stored as `/media/<id>.(mp4|webm)` with an optional `/media/<id>.vtt` caption
 * file. Only media the centre is licensed to host goes there; this module never
 * copies or proxies third-party video. YouTube stays on its native player.
 */
export const DIRECT_MEDIA_ID = /^[A-Za-z0-9_-]{1,32}\.(mp4|webm)$/;
export function directMediaUrls(videoId: string, origin: string) {
  if (!DIRECT_MEDIA_ID.test(videoId)) throw new Error("invalid media id");
  return { src: `${origin}/media/${videoId}`, captions: `${origin}/media/${videoId.replace(/\.(mp4|webm)$/, ".vtt")}` };
}

export type ParsedVideo =
  | { ok: true; provider: VideoProvider; videoId: string }
  | { ok: false; reason: "unsupported_host" | "no_video_id" | "invalid_id" | "invalid_url" };

/** Hosts a learner's browser may be asked to load a player from. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * A YouTube id is 11 characters of [A-Za-z0-9_-]. Anything else — including a
 * `PLACEHOLDER1`-style demo string — is rejected rather than embedded, which is
 * what keeps a dead video from rendering as a black rectangle.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function idFromYouTube(url: URL): string | null {
  const path = url.pathname;
  if (url.hostname.endsWith("youtu.be")) {
    const id = path.split("/").filter(Boolean)[0];
    return id ?? null;
  }
  if (path === "/watch") return url.searchParams.get("v");
  for (const prefix of ["/embed/", "/shorts/", "/live/", "/v/"]) {
    if (path.startsWith(prefix)) return path.slice(prefix.length).split("/")[0] ?? null;
  }
  return null;
}

/** Parses a pasted URL or a bare id into a validated provider reference. */
export function parseVideoInput(raw: string, options: { mediaOrigin?: string | null } = {}): ParsedVideo {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "no_video_id" };

  // A bare id is accepted (staff often copy just the id).
  if (!trimmed.includes("/") && !trimmed.includes("://")) {
    return VIDEO_ID.test(trimmed)
      ? { ok: true, provider: "youtube", videoId: trimmed }
      : { ok: false, reason: "invalid_id" };
  }

  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid_url" };
  if (options.mediaOrigin && url.protocol === "https:" && url.origin === options.mediaOrigin) {
    const id = url.pathname.startsWith("/media/") ? url.pathname.slice("/media/".length) : "";
    return DIRECT_MEDIA_ID.test(id) && !url.search && !url.hash ? { ok: true, provider: "direct", videoId: id } : { ok: false, reason: "invalid_id" };
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return { ok: false, reason: "unsupported_host" };

  const id = idFromYouTube(url);
  if (!id) return { ok: false, reason: "no_video_id" };
  if (!VIDEO_ID.test(id)) return { ok: false, reason: "invalid_id" };
  return { ok: true, provider: "youtube", videoId: id };
}

/**
 * The URL that goes into the iframe.
 *
 * `youtube-nocookie` is the privacy-enhanced domain. `rel=0` limits
 * recommendations to the same channel; it does not disable them or branding.
 * `enablejsapi=1` lets the player report its end/position to the page; `origin`
 * is added only from the configured public origin (never "*"). `cc_load_policy=1`
 * keeps the owner-requested native captions on by default.
 */
export function embedUrlFor(provider: VideoProvider, videoId: string, options: { origin?: string } = {}): string {
  if (provider !== "youtube") throw new Error(`unsupported provider: ${provider}`);
  if (!VIDEO_ID.test(videoId)) throw new Error("invalid video id");
  const base = `https://www.youtube-nocookie.com/embed/${videoId}`;
  const params = new URLSearchParams({ rel: "0", playsinline: "1", enablejsapi: "1", controls: "1", cc_load_policy: "1" });
  if (options.origin) params.set("origin", options.origin);
  return `${base}?${params.toString()}`;
}

/**
 * Library-card thumbnail for a validated YouTube id (static image from YouTube's
 * image host; no player, no iframe). Returns null for anything that is not a
 * valid id so the card shows its neutral fallback instead of a broken image.
 */
export function youtubeThumbnailUrl(videoId: string): string | null {
  return VIDEO_ID.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

/** Where a "watch on the provider" link points, for the honest fallback action. */
export function watchUrlFor(provider: VideoProvider, videoId: string): string {
  if (provider !== "youtube") throw new Error(`unsupported provider: ${provider}`);
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Human-readable reason, used by the CMS form so a paste failure is explainable. */
export function describeParseFailure(reason: Extract<ParsedVideo, { ok: false }>["reason"]): string {
  switch (reason) {
    case "unsupported_host":
      return "Only YouTube links can be played inside Learners Area. Other hosts open as an external link instead.";
    case "no_video_id":
      return "That link does not contain a video id — copy the link from the video page itself.";
    case "invalid_id":
      return "That does not look like a real video id (11 characters). Check the link.";
    case "invalid_url":
      return "That is not a link the centre can read.";
  }
}
