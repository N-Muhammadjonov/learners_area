import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { readingLegacyDestination } from "@/lib/reading/destinations";

export const dynamic = "force-dynamic";

/**
 * A module opens on its first real section, Lessons. Older query links retain
 * their existing explicit destinations; never invent passage or exam content.
 */
export default async function ReadingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, query] = await Promise.all([requireActiveUser(), searchParams]);
  if (!user) return null;
  const target = readingLegacyDestination(Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ));
  redirect(target ?? "/app/reading/lessons");
}
