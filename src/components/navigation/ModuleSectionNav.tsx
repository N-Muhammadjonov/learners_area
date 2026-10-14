"use client";

import { InstantLink } from "@/components/interaction/InstantLink";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { nextTabIndex } from "@/lib/a11y/tablist";

export type ModuleSectionLink = {
  key: string;
  label: string;
  href: string;
  /** Query-driven sections share the same real page. */
  queryValue?: string;
  defaultQuery?: boolean;
};

/** Real section links retain native link behaviour and browser history. */
export function ModuleSectionNav({ module, label, links }: {
  module: string;
  label: string;
  links: ModuleSectionLink[];
}) {
  const pathname = usePathname();
  const query = useSearchParams();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const selectedQuery = query.get("tab");
  const queryIsKnown = links.some(link => link.queryValue === selectedQuery);

  // The Reading attempt surface keeps its existing focus behaviour.
  if (module === "reading" && pathname.startsWith("/app/reading/attempts/")) return null;

  return (
    <nav aria-label={label} className="-mx-1 flex min-w-0 gap-1 overflow-x-auto border-b border-ink-100 px-1" data-module-sections={module}>
      {links.map((link, index) => {
        const targetPath = link.href.split("?")[0]!;
        const selected = link.queryValue !== undefined
          ? pathname === targetPath && (selectedQuery === link.queryValue || (!queryIsKnown && link.defaultQuery === true))
          : pathname === targetPath || pathname.startsWith(`${targetPath}/`);
        const href = link.queryValue !== undefined && pathname === targetPath
          ? (() => {
              const params = new URLSearchParams(query.toString());
              if (link.defaultQuery) params.delete("tab");
              else params.set("tab", link.queryValue!);
              return `${targetPath}${params.size ? `?${params}` : ""}`;
            })()
          : link.href;
        return (
          <InstantLink key={link.key} href={href} scroll={false} intentPrefetch={link.key !== "retention"}
            ref={element => { refs.current[index] = element; }}
            aria-current={selected ? "page" : undefined}
            id={`${module}-section-${link.key}`}
            data-module-section={link.key} data-active={selected ? "true" : "false"}
            onKeyDown={event => {
              const next = nextTabIndex(index, event.key, links.length);
              if (next === null) return;
              event.preventDefault();
              // Focus alone moves with arrows. Enter follows the focused real link.
              refs.current[next]?.focus();
            }}
            className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${selected ? "border-signal-600 text-ink-900 dark:border-signal-400" : "border-transparent text-ink-500 hover:text-ink-900"}`}>
            {link.label}
          </InstantLink>
        );
      })}
    </nav>
  );
}
