import { redirect } from "next/navigation";

/**
 * The people directory moved to /admin/people when roles gained OWNER and the
 * admission state. This route stays so an old bookmark or a link in a message
 * does not dead-end.
 */
export default function AdminUsersPage() {
  redirect("/admin/people");
}
