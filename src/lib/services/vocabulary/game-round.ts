/** Pure selection helpers shared by the game UI and its regression tests. */
export function uniqueGameRound<T extends { id: string }>(
  items: readonly T[],
  limit: number,
  random: () => number = Math.random,
): T[] {
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  for (let index = unique.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [unique[index], unique[swap]] = [unique[swap]!, unique[index]!];
  }
  return unique.slice(0, Math.max(0, limit));
}

/** Round to the tenth-second resolution used by the Typing Race clock. */
export function elapsedTenths(startedAt: number, stoppedAt: number): number {
  return Math.max(0, Math.round((stoppedAt - startedAt) / 100) / 10);
}

export function formatRaceTime(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(1)} s`;
}

export function typingRaceAccuracy(correct: number, incorrect: number): number | null {
  const answered = correct + incorrect;
  return answered === 0 ? null : Math.round((correct / answered) * 100);
}

/** Conservative WPM: hide until there's enough actual typed text and elapsed time. */
export function honestWordsPerMinute(typedCharacters: number, elapsedSeconds: number): number | null {
  if (typedCharacters < 25 || elapsedSeconds < 5) return null;
  return Math.round((typedCharacters / 5) / (elapsedSeconds / 60));
}
