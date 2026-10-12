/** Escape LIKE/ILIKE wildcards (and the escape char) so typed text matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
