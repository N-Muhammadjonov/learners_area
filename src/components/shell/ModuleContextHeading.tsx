"use client";

import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { Breadcrumbs } from "./Breadcrumbs";

/**
 * The module identity lives ONLY in the fixed topbar, left of global search.
 * Nested routes inherit the same stable module name while their page h1
 * identifies the actual section. Non-module routes keep their breadcrumbs.
 */
export function ModuleContextHeading({ dict }: { dict: Dictionary }) {
  const pathname = usePathname() ?? "";
  const modules = [
    { key: "dashboard", path: "/app", label: dict.nav.dashboard, exact: true },
    { key: "listening", path: "/app/listening", label: dict.nav.listening },
    { key: "video-lessons", path: "/app/video-lessons", label: dict.nav.videoLessons },
    { key: "reading", path: "/app/reading", label: dict.nav.reading },
    { key: "writing", path: "/app/writing", label: dict.nav.writing },
    { key: "speaking", path: "/app/speaking", label: dict.nav.speaking },
    { key: "grammar", path: "/app/grammar", label: dict.nav.grammar },
    { key: "vocabulary", path: "/app/vocabulary", label: dict.nav.vocabulary },
    { key: "live-classes", path: "/app/live-classes", label: dict.nav.liveClasses },
    { key: "assignments", path: "/app/assignments", label: dict.nav.assignments },
    { key: "progress", path: "/app/progress", label: dict.nav.progress },
    { key: "mocks", path: "/app/mocks", label: dict.nav.mockTests },
    { key: "management", path: "/app/management", label: dict.nav.management },
    { key: "management", path: "/app/admin", label: dict.nav.management },
    { key: "management", path: "/app/teacher", label: dict.nav.management },
    { key: "management", path: "/app/owner", label: dict.nav.management },
  ] as const;
  const activeModule = modules.find(item =>
    ("exact" in item && item.exact)
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(item.path + "/")
  );
  if (!activeModule) return <Breadcrumbs dict={dict} />;
  return (
    <span
      data-module-context-heading={activeModule.key}
      aria-current="location"
      className="min-w-0 truncate text-base font-semibold text-ink-900"
    >
      {activeModule.label}
    </span>
  );
}
