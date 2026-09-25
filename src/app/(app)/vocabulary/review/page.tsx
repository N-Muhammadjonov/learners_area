import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";

/**
 * The revision deck lives inside the Vocabulary section now.
 *
 * This route is kept so an old bookmark still works: it sends the student to the
 * REVISION view of /vocabulary, which is the same engine and the same schedule as
 * everywhere else. Nothing was reimplemented here.
 */
export default async function VocabularyReviewPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  redirect("/vocabulary?tab=revision");
}
