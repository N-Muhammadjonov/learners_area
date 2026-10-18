import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/validation/ids";

/** Existing test bookmarks retain the same test identity and authoritative focus hub. */
export default async function LegacyAcademicListeningTestPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  if (!isUuid(testId)) notFound();
  redirect(`/app/listening/tests/${testId}`);
}
