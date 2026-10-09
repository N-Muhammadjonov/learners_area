import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/** Retired owner-selected activity. Preserve old bookmarks without a recorder. */
export default async function RetiredSpeakingPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  redirect("/speaking/lessons");
}
