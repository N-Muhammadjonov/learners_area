/** writing_language_patterns.function values (0031 CHECK) and how Topic Vocabulary groups them. */
export const PATTERN_FUNCTIONS = ["collocation", "sentence_frame", "cohesion", "comparison", "concession", "trend", "argument"] as const;
export type PatternFunction = (typeof PATTERN_FUNCTIONS)[number];
export function isPatternFunction(v: unknown): v is PatternFunction {
  return typeof v === "string" && (PATTERN_FUNCTIONS as readonly string[]).includes(v);
}
/** Section a pattern appears under (PDF p.13: collocations · power phrases · sentence frames). */
export const PATTERN_SECTION: Record<PatternFunction, "collocations" | "powerPhrases" | "frames"> = {
  collocation: "collocations",
  argument: "powerPhrases", concession: "powerPhrases", cohesion: "powerPhrases",
  sentence_frame: "frames", comparison: "frames", trend: "frames",
};
