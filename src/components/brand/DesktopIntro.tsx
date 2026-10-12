"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export const DESKTOP_INTRO_QUERY = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";
import { BRAND, INTRO_VIDEO } from "@/lib/config/brand";

/** The server supplies only an authorized destination, never session details. */
export function DesktopIntro({ destination, children }: { destination: string; children: ReactNode }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const redirected = useRef(false);
  const [desktop, setDesktop] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_INTRO_QUERY);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!desktop) return;
    const continueToApp = () => {
      if (redirected.current) return;
      redirected.current = true;
      router.replace(destination);
    };
    const el = video.current;
    // Bounds stalled download/playback as well as rejected autoplay.
    const fallback = () => setUnavailable(true);
    const timeout = window.setTimeout(fallback, 20_000);
    el?.addEventListener("ended", continueToApp);
    el?.addEventListener("error", fallback);
    // Install listeners before play: an immediate rejection/error is observable.
    el?.play().catch(fallback);
    return () => {
      window.clearTimeout(timeout);
      el?.removeEventListener("ended", continueToApp);
      el?.removeEventListener("error", fallback);
      el?.pause();
    };
  }, [desktop, destination, router]);

  return <div data-root-entry>{desktop && !unavailable ? (
    <main className="flex min-h-dvh items-center justify-center bg-black" data-desktop-intro>
      <video ref={video} src={INTRO_VIDEO} autoPlay muted playsInline preload="auto"
        aria-hidden="true" tabIndex={-1} className="h-dvh w-full object-contain" />
    </main>
  ) : <div data-touch-welcome>{children}</div>}
    <noscript><a href={destination} className="text-white underline">{BRAND.siteName}</a></noscript>
  </div>;
}
