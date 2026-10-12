import { redirect } from "next/navigation";
import { publicAuthPolicy } from "@/lib/auth/public-auth-policy";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetRequestForm } from "@/components/auth/ResetRequestForm";
import { getDictionary, getLocale } from "@/lib/i18n";

export default async function ResetPasswordPage() {
  if (!publicAuthPolicy().passwordEnabled) redirect("/login");
  const dict = getDictionary(await getLocale());
  return (
    <AuthShell title={dict.auth.resetTitle} subtitle={dict.auth.resetSubtitle}>
      <ResetRequestForm dict={dict} />
    </AuthShell>
  );
}
