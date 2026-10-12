import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getDictionary, getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function RecoveryPage() {
  const dict = getDictionary(await getLocale());
  return <AuthShell title={dict.auth.loginTitle}>
    <Suspense><LoginForm dict={dict} recovery telegramConfigured={false} /></Suspense>
  </AuthShell>;
}
