/**
 * Turns a pasted URL into something that can be shown IN the page — an
 * embeddable iframe for known video hosts, a native <video>/<audio> tag for
 * direct media files. This is a UI-level courtesy (the viewer never sees or
 * clicks the raw URL, and never leaves the page for the hosts we recognise)
 * — it is not a security boundary. A determined viewer can still find the
 * underlying source in network requests; this doesn't hide *that* the
 * material is hosted elsewhere, only the raw link text and the need to
 * navigate away.
 *
 * Unrecognised links fall back to an explicit "Open material" action that
 * DOES leave the site — better to be honest about that limit than to fake
 * an inline player for something we can't actually embed.
 */

export type EmbedSource =
  | { kind: "iframe"; embedUrl: string }
  | { kind: "video"; src: string }
  | { kind: "audio"; src: string }
  | { kind: "external"; url: string };

function youTubeId(url: URL): string | null {
  if (url.hostname.includes("youtu.be")) return url.pathname.slice(1) || null;
  if (url.hostname.includes("youtube.com")) {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    if (url.pathname.startsWith("/embed/")) return url.pathname.split("/embed/")[1] ?? null;
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/shorts/")[1] ?? null;
  }
  return null;
}

function vimeoId(url: URL): string | null {
  if (!url.hostname.includes("vimeo.com")) return null;
  const match = url.pathname.match(/\/(\d+)/);
  return match ? match[1]! : null;
}

function googleDriveId(url: URL): string | null {
  if (!url.hostname.includes("drive.google.com")) return null;
  const match = url.pathname.match(/\/file\/d\/([^/]+)/);
  return match ? match[1]! : null;
}

export function resolveEmbedSource(rawUrl: string, primaryType: "video" | "audio" | "file" | "link"): EmbedSource {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "external", url: rawUrl };
  }

  const yt = youTubeId(url);
  if (yt) return { kind: "iframe", embedUrl: `https://www.youtube-nocookie.com/embed/${yt}` };

  const vimeo = vimeoId(url);
  if (vimeo) return { kind: "iframe", embedUrl: `https://player.vimeo.com/video/${vimeo}` };

  const drive = googleDriveId(url);
  if (drive) return { kind: "iframe", embedUrl: `https://drive.google.com/file/d/${drive}/preview` };

  const isDirectMedia = /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url.pathname);
  const isDirectAudio = /\.(mp3|wav|m4a|ogg)(\?.*)?$/i.test(url.pathname);

  if (primaryType === "video" && isDirectMedia) return { kind: "video", src: rawUrl };
  if (primaryType === "audio" && isDirectAudio) return { kind: "audio", src: rawUrl };
  if (isDirectMedia) return { kind: "video", src: rawUrl };
  if (isDirectAudio) return { kind: "audio", src: rawUrl };

  return { kind: "external", url: rawUrl };
}
