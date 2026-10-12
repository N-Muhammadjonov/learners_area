/** Public, browser-safe labels; identity remains the canonical source value. */
export function dictionaryPos(value: string) {
  return (
    (
      {
        n: "noun",
        v: "verb",
        a: "adjective",
        s: "adjective",
        r: "adverb",
      } as Record<string, string>
    )[value] ?? value
  );
}
