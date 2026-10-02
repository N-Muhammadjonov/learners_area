/**
 * Practice on your own: Part → Topic → Questions.
 *
 * Pure grouping over the canonical `speaking_prompts` rows (no second bank).
 * A topic is the row's `topic`; rows without one fall into a single
 * per-part "untitled" bucket so nothing published is hidden. Order follows
 * the input order (the query orders by part, then creation).
 */
export type PracticePart = "part1" | "part2" | "part3";
export const PRACTICE_PARTS: readonly PracticePart[] = ["part1", "part2", "part3"];
export const UNTITLED_TOPIC = "__untitled__";

export type BrowsablePrompt = { id: string; part: string; topic: string | null };
export type TopicGroup<P extends BrowsablePrompt> = { key: string; title: string | null; prompts: P[] };

export function topicKey(topic: string | null | undefined): string {
  const t = topic?.trim();
  return t ? t.toLowerCase() : UNTITLED_TOPIC;
}

export function groupByTopic<P extends BrowsablePrompt>(prompts: readonly P[], part: PracticePart): TopicGroup<P>[] {
  const groups = new Map<string, TopicGroup<P>>();
  for (const p of prompts) {
    if (p.part !== part) continue;
    const key = topicKey(p.topic);
    const g = groups.get(key) ?? { key, title: p.topic?.trim() || null, prompts: [] };
    g.prompts.push(p);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function partCounts(prompts: readonly BrowsablePrompt[]): Record<PracticePart, number> {
  const counts: Record<PracticePart, number> = { part1: 0, part2: 0, part3: 0 };
  for (const p of prompts) if (p.part in counts) counts[p.part as PracticePart] += 1;
  return counts;
}

export function parsePart(value: string | null | undefined): PracticePart | null {
  return (PRACTICE_PARTS as readonly string[]).includes(value ?? "") ? (value as PracticePart) : null;
}

/** An unknown topic key in the URL resolves to "no topic chosen", never to a guess. */
export function resolveTopic<P extends BrowsablePrompt>(groups: TopicGroup<P>[], key: string | null | undefined): TopicGroup<P> | null {
  return groups.find((g) => g.key === key) ?? null;
}
