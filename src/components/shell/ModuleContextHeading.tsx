"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { parentFor } from "@/lib/nav/routes";
import { IconBack } from "@/components/ui/icons";
import { Breadcrumbs } from "./Breadcrumbs";
import { Suspense } from "react";
import { ModuleHeaderTitle } from "./ModuleHeaderSections";

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
  // A Management subsection still needs a real parent-link on direct visits.
  // Only the module label, not the entire breadcrumb trail, is visible here.
  const parent = activeModule.key === "management" ? parentFor(pathname, dict) : null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {parent && (
        <Link href={parent.href} aria-label={`${dict.shell.back}: ${parent.label}`}
          className="flex h-10 shrink-0 items-center rounded-[10px] border border-ink-100 px-2 text-ink-700 hover:text-ink-900">
          <IconBack className="text-[17px]" />
        </Link>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
      <span
        data-module-context-heading={activeModule.key}
        aria-current="location"
        className="min-w-0 truncate text-base font-semibold text-ink-900"
      >
        {activeModule.label}
      </span>
      <Suspense fallback={null}><ModuleHeaderTitle dict={dict} /></Suspense>
      </div>
    </div>
  );
}
