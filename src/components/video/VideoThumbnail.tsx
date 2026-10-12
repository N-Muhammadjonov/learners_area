"use client";

/* eslint-disable @next/next/no-img-element */
// A plain <img>, on purpose: a static YouTube still on a library card needs no
// next/image remote-pattern config, and it is never a player or an iframe.
import { useState } from "react";

/**
 * 16:9 card thumbnail. Source order: the validated YouTube still for the
 * lesson's video id, then a neutral in-app fallback (also used when the image
 * fails to load). Decorative: the card's title is the accessible name.
 */
export function VideoThumbnail({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  const showImage = src !== null && !failed;
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-ink-100" data-video-thumb={showImage ? "image" : "fallback"}>
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          onError={() => setFailed(true)}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200 text-ink-500">
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
        </div>
      )}
    </div>
  );
}
