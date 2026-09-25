"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * Report a problem — from the page the problem happened on.
 *
 * The context is gathered here, not typed by the student: the current route, the
 * module it belongs to, the viewport and the last error code the app recorded.
 * The student only writes what they saw. Nothing else is collected, and the
 * server accepts nothing else.
 */
export function ReportProblem({ dict }: { dict: Dictionary }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [viewport, setViewport] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    setViewport(`${window.innerWidth}×${window.innerHeight}`);
    // The app records the last error code it showed (never a stack trace).
    const stored = window.sessionStorage.getItem("learners-area:last-error");
    setLastError(stored);
  }, []);

  // The first path segment is the module ("/vocabulary/review" → "vocabulary").
  const moduleName = pathname.split("/").filter(Boolean)[0] ?? "app";

  async function send() {
    setState("sending");
    const res = await fetch("/api/support/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        route: pathname,
        module: moduleName,
        message: message.trim(),
        viewport: viewport || undefined,
        lastErrorCode: lastError ?? undefined,
      }),
    });
    setState(res.ok ? "sent" : "failed");
    if (res.ok) setMessage("");
  }

  return (
    <div className="border-t border-ink-100 p-4">
      <button
        type="button"
        className="text-xs text-ink-300 underline hover:text-ink-500"
        onClick={() => setOpen((v) => !v)}
        data-report-toggle
      >
        {dict.support.open}
      </button>

      {open && (
        <div className="mt-3 rounded-sm bg-paper-sunken p-3" data-report-form>
          <p className="text-xs font-medium text-ink-700">{dict.support.title}</p>
          <p className="mt-1 text-xs text-ink-300">{dict.support.subtitle}</p>
          <textarea
            className="input mt-2 min-h-[70px] w-full text-xs"
            placeholder={dict.support.messagePlaceholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            data-report-message
          />
          <ul className="mt-2 flex flex-col gap-0.5 text-[11px] text-ink-300" data-report-context>
            <li>
              {dict.support.route}: <span data-report-route>{pathname}</span>
            </li>
            <li>
              {dict.support.module}: {moduleName}
            </li>
            {viewport && (
              <li>
                {dict.support.viewport}: {viewport}
              </li>
            )}
            <li>{dict.support.neverPrivate}</li>
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={state === "sending" || message.trim().length < 3}
              onClick={() => void send()}
              data-report-send
            >
              {state === "sending" ? dict.common.saving : dict.support.send}
            </Button>
            {state === "sent" && (
              <span className="text-xs text-band-good" data-report-sent>
                {dict.support.sent}
              </span>
            )}
            {state === "failed" && (
              <span className="text-xs text-band-bad" data-report-failed>
                {dict.support.failed}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
