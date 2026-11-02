type DirectoryEntry = {
  id: string;
  entryType: string;
  username?: string | null;
};

export function directoryUsername(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Telegram usernames are ASCII. Match PostgreSQL's C collation, including ties,
// so merging the two ordered sources cannot skip people at page boundaries.
export function compareDirectoryEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  const left = directoryUsername(a.username);
  const right = directoryUsername(b.username);
  if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
  return compareText(left, right)
    || compareText(a.entryType, b.entryType)
    || compareText(a.id, b.id);
}
