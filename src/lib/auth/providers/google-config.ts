/** Pure configuration check (no secrets are ever logged or returned). */
export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };
export function googleConfigFrom(env: NodeJS.ProcessEnv): { config: GoogleConfig | null; missing: string[] } {
  const missing: string[] = [];
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const origin = (env.PUBLIC_BASE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/$/, "");
  const base = env.GOOGLE_REDIRECT_URI?.trim() || (origin ? `${origin}/api/auth/google/callback` : "");
  if (!clientId.endsWith(".apps.googleusercontent.com")) missing.push("GOOGLE_CLIENT_ID");
  if (clientSecret.length < 10) missing.push("GOOGLE_CLIENT_SECRET");
  let redirectUri = "";
  try {
    const url = new URL(base);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol === "https:" || (local && url.protocol === "http:")) && url.pathname === "/api/auth/google/callback" && !url.search && !url.hash) redirectUri = url.toString();
    else missing.push("GOOGLE_REDIRECT_URI");
  } catch { missing.push("GOOGLE_REDIRECT_URI"); }
  return { config: missing.length ? null : { clientId, clientSecret, redirectUri }, missing };
}
