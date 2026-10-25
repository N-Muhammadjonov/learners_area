/** Server-only configuration shared by the HTTP relay and server-rendered views. */
export function backendOrigin(): string {
  const raw = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000";
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BACKEND_INTERNAL_URL must be an HTTP origin");
  }
  return url.origin;
}
