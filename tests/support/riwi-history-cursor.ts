export function installOwnerHistoryCursorTestSecret(): () => void {
  const original = process.env.AUTH_SECRET;
  if (!original) process.env.AUTH_SECRET = "riwi-owner-history-cursor-test-secret-not-for-production";
  return () => {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
  };
}
