import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const locale = getLocale();
  const dict = getDictionary(locale);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-sunken p-4">
      <div className="w-full max-w-xl">
        <div className="card p-6">
          <h1 className="font-display text-xl text-ink-900">{dict.onboarding.title}</h1>
          <p className="mt-1 text-sm text-ink-500">{dict.onboarding.subtitle}</p>
          <div className="mt-6">
            <OnboardingForm dict={dict} locale={locale} />
          </div>
        </div>
      </div>
    </div>
  );
}
