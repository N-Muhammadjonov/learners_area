"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useOptionalInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { WRITING_TABS, nextTabIndex, type WritingTab } from "@/lib/writing/tabs";

export function WritingNav({ active, labels, label }: { active: WritingTab; labels: Record<WritingTab, string>; label: string }) {
  const router = useRouter();
  const interaction = useOptionalInstantInteraction();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // These controls are ARIA tabs, not anchors. Begin the same immediate
  // navigation feedback as native module links while Next owns URL/history.
  const go = (tab: WritingTab) => {
    if (tab === active) return;
    const href = `/app/writing?tab=${tab}`;
    interaction?.beginNavigation(href);
    router.push(href, { scroll: false });
  };
  return (
    <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-ink-100 px-1" data-writing-tablist>
      {WRITING_TABS.map((tab, i) => {
        const selected = tab === active;
        return (
          <button key={tab} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`writing-tab-${tab}`}
            aria-selected={selected} aria-controls="writing-panel" tabIndex={selected ? 0 : -1} data-writing-tab={tab}
            onClick={() => go(tab)}
            onKeyDown={(e) => {
              const n = nextTabIndex(i, e.key, WRITING_TABS.length);
              if (n === null) return;
              e.preventDefault();
              refs.current[n]?.focus();
              go(WRITING_TABS[n]!);
            }}
            className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${selected ? "border-signal-600 text-ink-900 dark:border-signal-400 dark:text-white" : "border-transparent text-ink-500 hover:text-ink-900 dark:text-white dark:hover:text-white"}`}>
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );
}
