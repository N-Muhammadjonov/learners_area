import { performanceDiagnosticsEnabled } from "@/lib/config/site";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { PrivateResourceScope } from "@/components/interaction/PrivateResourceScope";
import { AccessChangeListener } from "@/components/interaction/AccessChangeListener";
import { getLocale } from "@/lib/i18n";

/**
 * `/app` — the authenticated application namespace.
 *
 * This layout owns exactly one job: the **database-backed access gate**. It reads
 * the authoritative user (role + account status are re-loaded from PostgreSQL on
 * every request, never trusted from the cookie), turns away an anonymous visitor
 * and an account without private access, and binds the private client read cache
 * to the DB-verified user id.
 *
 * It deliberately renders **no chrome**. The ordinary sidebar/topbar shell and the
 * exam focus chrome are two *siblings* under this gate —
 * `(shell)/layout.tsx` and `(focus)/layout.tsx` — so a focus route never inherits
 * a shell it must not show, and the gate itself cannot be skipped by either.
 *
 * Splitting the gate from the shell costs no extra query: `getCurrentUser()` is
 * wrapped in React `cache()`, so the shell layout reading it again in the same
 * request is served from memory (see src/lib/auth/current-user.ts).
 *
 * The URL is real and addressable (`/app/listening`, `/app/reading/retention`, …):
 * deep links, browser Back/Forward and the Next.js router all keep working, and
 * `/app/listening`-style historical URLs are redirected here by `next.config.mjs`.
 */

/** Nothing inside the centre belongs in a search engine. */
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function AppNamespaceLayout({ children }: { children: React.ReactNode }) {
  const [user, locale] = await Promise.all([getCurrentUser(), getLocale()]);
  if (!user) redirect("/login");
  if (!hasPrivateAccess(user.accountStatus)) redirect("/pending");
  // `locale` is read here so the cookie read stays in the same request scope as
  // the authoritative lookup; the shell that renders the dictionary reads it
  // again from React's cache.
  void locale;

  return (
    <>
      {/* Private client read cache is bound to the DB-verified user id only. */}
      <PrivateResourceScope scope={user.id} />
      {/* A single owner-triggered event stream when direct PostgreSQL LISTEN is configured. */}
      <AccessChangeListener enabled={Boolean(process.env.AUTH_EVENTS_DATABASE_URL)} />
      {children}
    </>
  );
}
