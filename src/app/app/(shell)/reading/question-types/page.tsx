import { redirect, notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { readingQuestionType } from "@/lib/reading/question-model";
import { readingLegacyDestination } from "@/lib/reading/destinations";

/** Preserve old bookmarks while type practice now lives in General Reading. */
export default async function ReadingTypesPage({ searchParams }: {
  searchParams: Promise<{ type?: string; page?: string; q?: string; topic?: string; status?: string }>;
}) {
  const [user, query] = await Promise.all([requireActiveUser(), searchParams]);
  if (!user) return null;
  const selected = query.type ? readingQuestionType(query.type) : null;
  if (query.type && !selected) notFound();
  redirect(readingLegacyDestination({ ...query, tab: "types", type: selected?.id })!);
}
