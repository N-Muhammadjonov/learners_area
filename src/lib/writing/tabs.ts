/** The eight Writing tools, URL-backed as /writing?tab=… (owner spec §36). */
export const WRITING_TABS = ["lessons", "exam", "translation", "typing", "topic-vocabulary", "grade", "activation", "language-stealing"] as const;
export type WritingTab = (typeof WRITING_TABS)[number];
export function parseWritingTab(value: string | string[] | undefined): WritingTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (WRITING_TABS as readonly string[]).includes(v ?? "") ? (v as WritingTab) : "lessons";
}
/**
 * Keyboard model for the tablist: Left/Right wrap, Home/End jump.
 *
 * The implementation moved to `@/lib/a11y/tablist` so the Vocabulary tablist could reuse the same
 * rule instead of growing a second copy; re-exported here unchanged so every existing importer of
 * `@/lib/writing/tabs` keeps working.
 */
export { nextTabIndex } from "@/lib/a11y/tablist";
