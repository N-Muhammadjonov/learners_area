import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { PrivateResourceScope } from "@/components/interaction/PrivateResourceScope";

export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Authenticated focus surfaces deliberately do not inherit the ordinary
 * Learners Area shell. The database-backed account/admission gate remains
 * identical to the private application gate.
 */
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPrivateAccess(user.accountStatus)) redirect("/pending");

  return (
    <>
      <PrivateResourceScope scope={user.id} />
      {children}
    </>
  );
}
