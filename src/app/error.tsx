"use client";

import AppError from "./app/(shell)/error";

/**
 * Catches private layout failures (auth/DB), outside its nested boundary.
 *
 * The `/app` namespace gate lives in `src/app/app/layout.tsx`, one level below
 * this file, so a failure there is still caught here — that is the whole point of
 * keeping this boundary at the root.
 */
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="min-h-dvh bg-paper px-6 text-ink-900"><AppError {...props} /></main>;
}
