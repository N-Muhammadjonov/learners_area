import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Exam / assessment focus surfaces inside `/app`.
 *
 * These routes are siblings of the ordinary shell group, so they deliberately do
 * NOT inherit the sidebar/topbar shell — a formal Listening or Reading exam owns
 * the whole viewport. The database-backed access gate is still applied: it lives
 * in the parent (`src/app/app/layout.tsx`) and covers this group too.
 *
 * `getCurrentUser()` is `cache()`d, so this read is served from the request cache
 * when the parent already performed it.
 */
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return null;
  return <>{children}</>;
}
