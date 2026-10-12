import { redirect } from "next/navigation";
import { publicAuthPolicy } from "@/lib/auth/public-auth-policy";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetConfirmForm } from "@/components/auth/ResetConfirmForm";
import { getDictionary, getLocale } from "@/lib/i18n";

export default async function ResetConfirmPage() {
  if (!publicAuthPolicy().passwordEnabled) redirect("/login");
  const dict = getDictionary(await getLocale());
  return (
    <AuthShell title={dict.auth.resetConfirmTitle}>
      <Suspense>
        <ResetConfirmForm dict={dict} />
      </Suspense>
    </AuthShell>
  );
}
