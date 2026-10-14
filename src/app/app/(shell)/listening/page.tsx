import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/** Module landing is the first learner section, not an empty hub. */
export default async function ListeningPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  redirect("/app/listening/lessons");
}
