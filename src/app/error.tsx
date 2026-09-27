"use client";

import AppError from "./(app)/error";

/** Catches private layout failures (auth/DB), outside its nested boundary. */
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="min-h-dvh bg-paper px-6 text-ink-900"><AppError {...props} /></main>;
}
