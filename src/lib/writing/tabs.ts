/** The eight Writing tools, URL-backed as /writing?tab=… (owner spec §36). */
export const WRITING_TABS = ["lessons", "exam", "translation", "typing", "topic-vocabulary", "grade", "activation", "language-stealing"] as const;
export type WritingTab = (typeof WRITING_TABS)[number];
export function parseWritingTab(value: string | string[] | undefined): WritingTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (WRITING_TABS as readonly string[]).includes(v ?? "") ? (v as WritingTab) : "lessons";
}
/** Keyboard model for the tablist: Left/Right wrap, Home/End jump. */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
