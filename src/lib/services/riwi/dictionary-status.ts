/** Portable, content-free catalogue result classification. */
export function canonicalDictionaryStatus(entry: unknown | null | undefined): "resolved" | "unresolved" {
  return entry === null || entry === undefined ? "unresolved" : "resolved";
}
