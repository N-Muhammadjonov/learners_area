"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * The private area's error surface.
 *
 * It records a short *code* (never a stack trace or a message that might carry
 * private text) so that "Report a problem" can attach what actually happened,
 * and it gives the student a way forward instead of a blank screen.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the framework's own digest — no message, no stack.
    const code = error.digest ?? "render_error";
    window.sessionStorage.setItem("learners-area:last-error", code);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-12" data-app-error>
      <h1 className="font-display text-xl text-ink-900">Something went wrong on this page.</h1>
      <p className="text-sm text-ink-500">
        The error code was recorded so you can attach it to a report — open “Report a problem” in the menu.
      </p>
      <span className="text-xs text-ink-300" data-error-code={error.digest ?? "render_error"}>
        {error.digest ?? "render_error"}
      </span>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
