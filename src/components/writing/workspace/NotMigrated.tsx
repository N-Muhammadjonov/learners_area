import type { Dictionary } from "@/lib/i18n/en";
export function NotMigrated({ dict }: { dict: Dictionary }) {
  return <p role="status" className="rounded-md border border-ink-100 bg-paper-sunken p-4 text-base text-ink-700" data-writing-not-migrated>{dict.writingWorkspace.notMigrated}</p>;
}
