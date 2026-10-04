"use client";
import { useFocusEntry } from "@/lib/interaction/focus-entry";
/** Test entry is separate from library browsing; dismissing focus remains respected. */
export function TestFocusEntry({ identity }: { identity: string }) {
  useFocusEntry(identity);
  return null;
}
