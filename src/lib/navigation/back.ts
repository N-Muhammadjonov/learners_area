/** Go back in history only when the previous page is this site (pure, testable). */
export function shouldUseHistory(referrer: string, origin: string, historyLength: number): boolean {
  if (historyLength <= 1 || !referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}
