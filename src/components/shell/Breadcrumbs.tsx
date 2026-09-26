"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { breadcrumbsFor, parentFor } from "@/lib/nav/routes";
import { IconBack, IconChevronRight } from "@/components/ui/icons";

/**
 * Back, and where you are.
 *
 * The Back button resolves a real parent from the route table
 * (`src/lib/nav/routes.ts`) instead of calling `history.back()`. A reader who
 * arrived from a bookmark or a link in a chat has no history, and a Back button
 * that does nothing is worse than no button. Top-level pages show neither the
 * button nor the trail: the sidebar already says which module is open, and an
 * arrow on a page with nowhere above it is furniture.
 */
export function Breadcrumbs({ dict }: { dict: Dictionary }) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname, dict);
  const parent = parentFor(pathname, dict);

  if (crumbs.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2" data-breadcrumbs>
      {parent && (
        <Link
          href={parent.href}
          data-back-button
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-ink-100 px-2.5 text-[0.875rem] font-medium text-ink-500 transition-colors hover:bg-paper-sunken hover:text-ink-900"
        >
          <IconBack className="text-[17px]" />
          <span className="hidden sm:inline">{dict.shell.back}</span>
        </Link>
      )}
      <nav aria-label={dict.shell.back} className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={`${crumb.href}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <IconChevronRight className="shrink-0 text-[14px] text-ink-300" />}
              {last ? (
                <span className="truncate text-[0.9375rem] font-medium text-ink-900" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hidden truncate text-[0.875rem] text-ink-300 transition-colors hover:text-ink-700 sm:inline"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
