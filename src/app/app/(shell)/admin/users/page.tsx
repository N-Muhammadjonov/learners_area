import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";

/**
 * The people directory moved to /admin/people when roles gained OWNER and the
 * admission state. This route stays so an old bookmark or a link in a message
 * does not dead-end.
 */
export default async function AdminUsersPage() {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/app");
  redirect("/app/admin/people");
}
