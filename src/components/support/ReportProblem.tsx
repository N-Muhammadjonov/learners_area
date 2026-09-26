"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import { IconAlert, IconClose } from "@/components/ui/icons";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * Report a problem — from the page the problem happened on.
 *
 * The context is gathered here, not typed by the student: the current route, the
 * module it belongs to, the viewport and the last error code the app recorded.
 * The student only writes what they saw. Nothing else is collected, and the
 * server accepts nothing else.
 */
export function ReportProblem({ dict, floating = false }: { dict: Dictionary; floating?: boolean }) {
  // `floating` renders the same form as a panel anchored to the bottom-right
  // utility stack (see ShellUtilities). One implementation, so the sidebar entry
  // and the floating control can never send different context.
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [viewport, setViewport] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [error, setError] = useState("");

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
    try {
      // Never throws: a dropped connection leaves the form usable and says so,
      // instead of a button that stays on "Saving…" forever.
      const result = await requestJson("/api/support/reports", {
        body: {
          route: pathname,
          module: moduleName,
          message: message.trim(),
          viewport: viewport || undefined,
          lastErrorCode: lastError ?? undefined,
        },
      });
      if (result.ok) {
        setMessage("");
        setState("sent");
      } else {
        setError(failureMessage(result, { ...dict.auth, errorUnknown: dict.errors.unknown }));
        setState("failed");
      }
    } finally {
      // Whatever happened, the button comes back.
      setState((current) => (current === "sending" ? "idle" : current));
    }
  }

  return (
    <div className={floating ? "" : "border-t border-ink-100 p-4"}>
      {floating ? (
        <button
          type="button"
          data-report-toggle
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex min-h-[46px] items-center gap-2 rounded-full border border-ink-100 bg-paper-raised px-4 text-[0.9375rem] font-medium text-ink-700 shadow-card transition-colors hover:bg-paper-sunken"
        >
          <IconAlert className="text-[18px] text-ink-300" />
          <span className="hidden sm:inline">{dict.support.open}</span>
        </button>
      ) : (
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[0.9375rem] text-ink-500 transition-colors hover:bg-paper-sunken hover:text-ink-900"
          onClick={() => setOpen((v) => !v)}
          data-report-toggle
        >
          <IconAlert className="text-[19px] text-ink-300" />
          {dict.support.open}
        </button>
      )}

      {open && (
        <div
          className={
            floating
              ? "mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-[14px] border border-ink-100 bg-paper-raised p-4 shadow-raised"
              : "mt-3 rounded-[12px] bg-paper-sunken p-3"
          }
          data-report-form
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[0.875rem] font-medium text-ink-900">{dict.support.title}</p>
              <p className="mt-1 text-[0.8125rem] text-ink-300">{dict.support.subtitle}</p>
            </div>
            {floating && (
              <button
                type="button"
                aria-label={dict.common.cancel}
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-paper-sunken hover:text-ink-900"
              >
                <IconClose className="text-[16px]" />
              </button>
            )}
          </div>
          <textarea
            className="input mt-2 min-h-[80px] w-full"
            placeholder={dict.support.messagePlaceholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            data-report-message
          />
          <ul className="mt-2 flex flex-col gap-0.5 text-[0.75rem] text-ink-300" data-report-context>
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
              <span className="text-[0.8125rem] text-band-good" data-report-sent>
                {dict.support.sent}
              </span>
            )}
            {state === "failed" && (
              <span className="text-[0.8125rem] text-band-bad" data-report-failed>
                {error || dict.support.failed}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
