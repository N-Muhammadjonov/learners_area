/** The four Speaking entries, in owner order. A fifth top-level mode is a spec violation. */
export const SPEAKING_HUB_CARDS = [
  { key: "partner", href: "/app/speaking/live-partner" },
  { key: "practice", href: "/app/speaking/practice" },
  { key: "ai", href: "/app/speaking/ai" },
  { key: "lessons", href: "/app/speaking/lessons" },
] as const;
export type SpeakingHubCardKey = (typeof SPEAKING_HUB_CARDS)[number]["key"];
