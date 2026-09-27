"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { dictionaryForDocument } from "@/lib/i18n/client";
import { parentFor } from "@/lib/nav/routes";
import { IconAlert } from "@/components/ui/icons";

/**
 * The private area's error surface.
 *
 * Three things it must never do: replace the whole product with a blank screen,
 * speak English at an Uzbek reader, or leave the reader with no way forward.
 * It sits *inside* the shell (see the route group's layout), so navigation stays
 * on screen — an error in one panel is not a reason to lose the sidebar.
 *
 * The digest is recorded, never the message or the stack: a stack trace in the
 * browser is how internals leak, and the code is enough for "Report a problem"
 * to attach.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  const dict = dictionaryForDocument();
  const parent = parentFor(pathname, dict);

  useEffect(() => {
    try {
      window.sessionStorage.setItem("learners-area:last-error", error.digest ?? "render_error");
    } catch {
      // Recovery must still work when browser storage is unavailable.
    }
  }, [error]);

  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-start gap-4 py-16" data-app-error>
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl border border-band-bad/40 bg-band-bad/10 text-[24px] text-band-bad">
        <IconAlert />
      </span>
      <h1 className="font-display text-[1.5rem] leading-snug text-ink-900">{dict.errorPage.title}</h1>
      <p className="body-text">{dict.errorPage.body}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => reset()} data-error-retry>
          {dict.errorPage.retry}
        </Button>
        {parent && (
          <Link href={parent.href} className="btn-secondary" data-error-back>
            {dict.errorPage.back}
          </Link>
        )}
        <Link href="/dashboard" className="btn-ghost" data-error-dashboard>
          {dict.errorPage.dashboard}
        </Link>
      </div>

      <p className="meta-text">
        {dict.errorPage.code}:{" "}
        <span data-error-code={error.digest ?? "render_error"}>{error.digest ?? "render_error"}</span>
      </p>
    </div>
  );
}
