"use client";

import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * One compact module identity above section tabs, immediately below the
 * hamburger/topbar row. Keep it outside the individual lesson surfaces so
 * sidebar, browser-back and direct links have the same context.
 * The real page <h1> stays inside each route for semantic heading order.
 */
export function ModuleContextHeading({ dict }: { dict: Dictionary }) {
  const pathname = usePathname() ?? "";
  const modules = [
    { key: "listening", path: "/app/listening", label: dict.nav.listening },
    { key: "video-lessons", path: "/app/video-lessons", label: dict.nav.videoLessons },
    { key: "reading", path: "/app/reading", label: dict.nav.reading },
    { key: "writing", path: "/app/writing", label: dict.nav.writing },
    { key: "speaking", path: "/app/speaking", label: dict.nav.speaking },
    { key: "grammar", path: "/app/grammar", label: dict.nav.grammar },
    { key: "vocabulary", path: "/app/vocabulary", label: dict.nav.vocabulary },
  ] as const;
  const module = modules.find(item => pathname === item.path || pathname.startsWith(item.path + "/"));
  if (!module) return null;
  return (
    <p
      aria-hidden="true"
      data-module-context-heading={module.key}
      className="mb-4 pl-3 text-xl font-semibold leading-7 text-ink-900"
    >
      {module.label}
    </p>
  );
}
