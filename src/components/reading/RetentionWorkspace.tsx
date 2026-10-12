"use client";

import { useState, type ReactNode } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { RetentionAttemptPayload } from "@/lib/retention/types";
import { RetentionSession } from "./RetentionSession";

/** Results belong to the entry view; an assigned timed attempt gets the full workspace. */
export function RetentionWorkspace({ dict, initial, overview, history }: {
  dict: Dictionary;
  initial: RetentionAttemptPayload | null;
  overview: ReactNode;
  history: ReactNode;
}) {
  const [active, setActive] = useState(!!initial && initial.phase !== "completed" && initial.phase !== "timed_out");
  return <div className="flex flex-col gap-6" data-retention-workspace={active ? "active" : "entry"}>
    <div className={active ? "min-w-0" : "retention-hub-grid"}>
      <section className="panel" data-retention-session-region>
        <RetentionSession dict={dict} initial={initial} onActivityChange={setActive} />
      </section>
      {!active && overview}
    </div>
    {!active && history}
  </div>;
}
