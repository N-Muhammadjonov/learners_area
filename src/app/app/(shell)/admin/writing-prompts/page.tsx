import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";

/** Legacy route: the canonical Writing Management area owns exam prompts now. Old bookmarks land there. */
export default async function LegacyWritingPromptsPage() {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/app/dashboard");
  redirect("/app/admin/writing?section=exam");
}
