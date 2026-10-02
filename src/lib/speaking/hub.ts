/** The four Speaking entries, in owner order. A fifth top-level mode is a spec violation. */
export const SPEAKING_HUB_CARDS = [
  { key: "partner", href: "/speaking/live-partner" },
  { key: "practice", href: "/speaking/practice" },
  { key: "ai", href: "/speaking/ai" },
  { key: "lessons", href: "/speaking/lessons" },
] as const;
export type SpeakingHubCardKey = (typeof SPEAKING_HUB_CARDS)[number]["key"];
